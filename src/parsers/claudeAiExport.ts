/**
 * Parser for claude.ai data exports.
 *
 * Anthropic lets users export their full conversation history from:
 *   claude.ai → Settings → Privacy → Export data
 *
 * The export arrives as a ZIP file containing conversations.json at the root.
 * This parser handles:
 *   - A .zip file (shells out to `unzip`, available on macOS/Linux)
 *   - An extracted directory containing conversations.json
 *   - A conversations.json file directly
 *
 * Auto-discovery scans ~/Downloads for files matching claude*export*.zip.
 */

import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { CAPABILITY_PROFILES } from "../capabilities.js";
import { mergeDatasets } from "../dataset.js";
import { excerpt, stableHash } from "../redaction.js";
import type { EventRecord, InteractionRecord, NormalizedDataset } from "../types.js";

const execFileAsync = promisify(execFile);

// Matches zip filenames like "claude-ai-export-2024-01-15.zip" or "claude-data-export.zip"
const EXPORT_ZIP_PATTERN = /claude.*(export|data).*\.zip$/i;
// Matches Anthropic's actual export directory format: data-{uuid}-{number}-{uuid}-batch-{number}
const EXPORT_DIR_PATTERN = /^data-[0-9a-f-]+-batch-\d+$/i;
const CONVERSATIONS_ENTRY = "conversations.json";

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Scans ~/Downloads for claude.ai exports — either:
 *   - Directories named data-{uuid}-batch-{n}  (Anthropic's actual export format)
 *   - ZIP files matching claude*export*.zip      (alternative packaging)
 *
 * Returns paths sorted newest-first (lexicographic, which works since names are date/uuid stamped).
 */
export async function discoverClaudeAiExportFiles(): Promise<string[]> {
  const found: string[] = [];
  const downloads = join(homedir(), "Downloads");
  try {
    const entries = await readdir(downloads, { withFileTypes: true });
    for (const entry of entries) {
      const isExportDir = entry.isDirectory() && EXPORT_DIR_PATTERN.test(entry.name);
      const isExportZip = entry.isFile() && EXPORT_ZIP_PATTERN.test(entry.name);
      if (isExportDir || isExportZip) {
        found.push(join(downloads, entry.name));
      }
    }
  } catch {
    // Downloads folder may not exist or may not be readable — safe to skip.
  }
  return found.sort().reverse(); // newest export first
}

// ---------------------------------------------------------------------------
// File-level entry points
// ---------------------------------------------------------------------------

/**
 * Parse a claude.ai export from a file or directory path.
 *
 * Accepts:
 *   - /path/to/claude-ai-export-2024-01-15.zip
 *   - /path/to/extracted-export-dir/   (must contain conversations.json)
 *   - /path/to/conversations.json
 */
export async function parseClaudeAiExportFile(filePath: string): Promise<NormalizedDataset> {
  const info = await stat(filePath);

  if (info.isFile() && filePath.toLowerCase().endsWith(".zip")) {
    const json = await readJsonFromZip(filePath, CONVERSATIONS_ENTRY);
    return parseClaudeAiExportJson(json);
  }

  if (info.isFile() && filePath.toLowerCase().endsWith(".json")) {
    const text = await readFile(filePath, "utf8");
    return parseClaudeAiExportJson(JSON.parse(text) as unknown);
  }

  if (info.isDirectory()) {
    const jsonPath = join(filePath, CONVERSATIONS_ENTRY);
    const text = await readFile(jsonPath, "utf8");
    return parseClaudeAiExportJson(JSON.parse(text) as unknown);
  }

  throw new Error(`Unsupported claude.ai export format at: ${filePath}. Expected a .zip, a .json, or a directory containing conversations.json.`);
}

// ---------------------------------------------------------------------------
// Pure JSON parsing (also used directly in tests)
// ---------------------------------------------------------------------------

/**
 * Parse the deserialized contents of conversations.json into a NormalizedDataset.
 * Top-level JSON is an array of conversation objects.
 */
export function parseClaudeAiExportJson(json: unknown): NormalizedDataset {
  if (!Array.isArray(json)) {
    // Tolerate wrapped formats: { conversations: [...] }
    if (isObject(json) && Array.isArray((json as Record<string, unknown>).conversations)) {
      return parseClaudeAiExportJson((json as Record<string, unknown>).conversations);
    }
    return { interactions: [], events: [], capabilityProfiles: [] };
  }

  const datasets: NormalizedDataset[] = json.map((conv, index) => parseConversation(conv, index));
  return mergeDatasets(datasets);
}

// ---------------------------------------------------------------------------
// Conversation + message parsing
// ---------------------------------------------------------------------------

function parseConversation(conv: unknown, index: number): NormalizedDataset {
  if (!isObject(conv)) return { interactions: [], events: [], capabilityProfiles: [] };

  const uuid = stringField(conv.uuid) ?? `export-conv-${index}`;
  const title = stringField(conv.name) ?? "Claude Chat";
  const createdAt = stringField(conv.created_at);
  const updatedAt = stringField(conv.updated_at);
  const interactionId = `chat-${stableHash(uuid)}`;

  const rawMessages: unknown[] = Array.isArray(conv.chat_messages) ? conv.chat_messages : [];
  const events: EventRecord[] = rawMessages.flatMap((msg, msgIndex) => parseMessage(msg, interactionId, msgIndex));

  const turnCount = events.filter((e) => e.eventType === "prompt" || e.eventType === "response").length;
  const estimatedTokens = events.reduce((sum, e) => sum + (e.tokenEstimate ?? 0), 0);

  const interaction: InteractionRecord = {
    id: interactionId,
    source: "chat",
    captureMode: "claude_ai_export",
    title,
    startedAt: createdAt,
    endedAt: updatedAt,
    turnCount,
    estimatedTokens,
    capabilityProfileId: "claude_ai_export_v1"
  };

  return {
    interactions: [interaction],
    events,
    capabilityProfiles: [CAPABILITY_PROFILES.chat]
  };
}

function parseMessage(msg: unknown, interactionId: string, index: number): EventRecord[] {
  if (!isObject(msg)) return [];

  const uuid = stringField(msg.uuid) ?? `msg-${index}`;
  const sender = stringField(msg.sender); // "human" | "assistant"
  const text = stringField(msg.text) ?? "";
  const timestamp = stringField(msg.created_at);
  const id = `${interactionId}-msg-${stableHash(uuid)}-${index}`;

  // claude.ai may include file/image attachments on messages
  const attachmentCount =
    (Array.isArray(msg.attachments) ? msg.attachments.length : 0) +
    (Array.isArray(msg.files) ? msg.files.length : 0);

  const fullText = attachmentCount > 0 ? `${text}\n[${attachmentCount} attachment(s)]` : text;

  // Determine event shape
  let eventType: EventRecord["eventType"];
  let actor: EventRecord["actor"];

  if (sender === "human") {
    eventType = "prompt";
    actor = "user";
  } else if (sender === "assistant") {
    eventType = "response";
    actor = "assistant";
  } else {
    // System message or unknown sender — skip empty ones, keep non-empty as imported_message
    if (!fullText.trim()) return [];
    eventType = "imported_message";
    actor = "system";
  }

  const event: EventRecord = {
    id,
    interactionId,
    timestamp,
    eventType,
    actor,
    tokenEstimate: Math.ceil(fullText.length / 4) || undefined,
    contentHash: stableHash(fullText),
    redactedExcerpt: excerpt(fullText)
  };

  return [event];
}

// ---------------------------------------------------------------------------
// ZIP helpers
// ---------------------------------------------------------------------------

async function readJsonFromZip(zipPath: string, entryName: string): Promise<unknown> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("unzip", ["-p", zipPath, entryName]));
  } catch (error) {
    throw new Error(`Could not extract ${entryName} from ${zipPath}. Make sure 'unzip' is installed. Original error: ${error}`);
  }
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    throw new Error(`${entryName} inside ${zipPath} is not valid JSON.`);
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
