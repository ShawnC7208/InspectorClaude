import { readFile } from "node:fs/promises";
import { CAPABILITY_PROFILES } from "../capabilities.js";
import { mergeDatasets } from "../dataset.js";
import { excerpt, stableHash } from "../redaction.js";
import type { EventRecord, InteractionRecord, NormalizedDataset } from "../types.js";

type ParseOptions = {
  title?: string;
  projectPath?: string;
  /**
   * Deprecated: parsing always keeps short redacted working text so deterministic
   * rules still run. Dashboard/report builders decide whether excerpts are emitted.
   */
  includeEvidence?: boolean;
};

export type ClaudeCodeJsonlTextInput = {
  text: string;
  title?: string;
  projectPath?: string;
};

type JsonObject = Record<string, unknown>;

export function parseClaudeCodeJsonlText(text: string, options: ParseOptions = {}): NormalizedDataset {
  const events: EventRecord[] = [];
  let sessionId = `code-${stableHash(text || options.projectPath || "empty")}`;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  let model: string | undefined;
  let projectPath = options.projectPath;
  let turnCount = 0;
  let malformedCount = 0;
  let exactTokens = 0;
  const pendingTools: Array<{ id?: string; name: string }> = [];
  const toolsById = new Map<string, string>();

  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;

    let parsed: JsonObject;
    try {
      parsed = JSON.parse(line) as JsonObject;
    } catch {
      malformedCount += 1;
      events.push({
        id: `${sessionId}-malformed-${index + 1}`,
        interactionId: sessionId,
        eventType: "imported_message",
        actor: "system",
        status: "failed",
        contentHash: stableHash(line),
        redactedExcerpt: "Malformed JSONL line skipped"
      });
      return;
    }

    const timestamp = stringField(parsed.timestamp) ?? stringField(parsed.createdAt);
    const parsedSessionId = stringField(parsed.sessionId) ?? stringField(parsed.session_id) ?? nestedString(parsed, ["message", "session_id"]);
    if (parsedSessionId && events.length === 0) {
      sessionId = `code-${stableHash(parsedSessionId)}`;
    }
    startedAt ??= timestamp;
    endedAt = timestamp ?? endedAt;
    projectPath ??= stringField(parsed.cwd) ?? stringField(parsed.projectPath);
    model ??= stringField(parsed.model) ?? nestedString(parsed, ["message", "model"]);
    exactTokens += usageTokens(parsed);

    const extracted = extractEvents(parsed, sessionId, index);
    for (const event of extracted) {
      if (event.eventType === "prompt" || event.eventType === "response") turnCount += 1;
      if (event.eventType === "tool_call" && event.toolName) {
        const toolUseId = typeof event.metadata?.toolUseId === "string" ? event.metadata.toolUseId : undefined;
        pendingTools.push({ id: toolUseId, name: event.toolName });
        if (toolUseId) toolsById.set(toolUseId, event.toolName);
      }
      if (event.eventType === "tool_result" && !event.toolName) {
        const toolUseId = typeof event.metadata?.toolUseId === "string" ? event.metadata.toolUseId : undefined;
        event.toolName = toolUseId ? toolsById.get(toolUseId) : undefined;
        if (!event.toolName) event.toolName = pendingTools.shift()?.name;
      }
      events.push(event);
    }
  });

  const toolCallCount = events.filter((event) => event.eventType === "tool_call").length;
  const interaction: InteractionRecord = {
    id: sessionId,
    source: "code",
    captureMode: "claude_code_log",
    title: options.title ?? (projectPath ? `Claude Code: ${projectPath.split("/").at(-1)}` : "Claude Code session"),
    projectPath,
    startedAt,
    endedAt,
    model,
    turnCount,
    toolCallCount,
    estimatedTokens: estimateTokens(events),
    exactTokens: exactTokens || undefined,
    capabilityProfileId: CAPABILITY_PROFILES.code.id
  };

  if (malformedCount > 0) {
    events.push({
      id: `${sessionId}-malformed-summary`,
      interactionId: sessionId,
      eventType: "imported_message",
      actor: "system",
      status: "failed",
      redactedExcerpt: `${malformedCount} malformed JSONL line(s) were skipped`
    });
  }

  return {
    interactions: [interaction],
    events,
    capabilityProfiles: [CAPABILITY_PROFILES.code]
  };
}

export function parseClaudeCodeJsonlTexts(inputs: ClaudeCodeJsonlTextInput[]): NormalizedDataset {
  return mergeDatasets(inputs.map((input) => parseClaudeCodeJsonlText(input.text, input)));
}

export async function parseClaudeCodeJsonlFiles(filePaths: string[]): Promise<NormalizedDataset> {
  const inputs = await Promise.all(
    filePaths.map(async (filePath) => ({
      text: await readFile(filePath, "utf8"),
      title: filePath.split("/").at(-1)
    }))
  );
  return parseClaudeCodeJsonlTexts(inputs);
}

function extractEvents(parsed: JsonObject, interactionId: string, lineIndex: number): EventRecord[] {
  const timestamp = stringField(parsed.timestamp) ?? stringField(parsed.createdAt);
  const type = stringField(parsed.type);
  const eventType = stringField(parsed.eventType) ?? stringField(parsed.event_type);
  const message = objectField(parsed.message);
  const role = stringField(message?.role) ?? type;
  const content = message?.content ?? parsed.content;
  const baseId = `${interactionId}-${lineIndex + 1}`;

  const compactText = stringifyContent(content || parsed);
  if (
    type === "summary" ||
    type === "compact" ||
    type === "compaction" ||
    eventType === "summary" ||
    eventType === "compact" ||
    eventType === "compaction"
  ) {
    const compactEvent = event(baseId, interactionId, timestamp, "compaction", "system", content || parsed);
    compactEvent.metadata = {
      hasDurableSummary: /\b(next steps?|decisions?|open questions?|state summary|summary:|todo|remaining)\b/i.test(compactText)
    };
    return [compactEvent];
  }

  if (type === "permission" || stringField(parsed.permission) || stringField(parsed.decision)) {
    return [
      {
        ...event(baseId, interactionId, timestamp, "permission", "system", parsed),
        status: includesText(parsed, "denied") || stringField(parsed.decision)?.toLowerCase() === "deny" ? "denied" : "ok"
      }
    ];
  }

  if (type === "subagent" || stringField(parsed.subagent) || stringField(parsed.transcriptPath)) {
    return [
      {
        ...event(baseId, interactionId, timestamp, "file_event", "system", parsed),
        metadata: {
          kind: "subagent_reference",
          transcriptPathHash: stableHash(stringField(parsed.transcriptPath) ?? stringifyContent(parsed))
        }
      }
    ];
  }

  if (Array.isArray(content)) {
    const extracted: EventRecord[] = [];
    for (const [contentIndex, item] of content.entries()) {
      if (!isObject(item)) continue;
      const itemType = stringField(item.type);
      if (itemType === "tool_use") {
        const toolName = stringField(item.name) ?? "unknown_tool";
        extracted.push({
          ...event(`${baseId}-tool-${contentIndex}`, interactionId, timestamp, "tool_call", "assistant", item),
          toolName,
          filePaths: extractFilePaths(JSON.stringify(item)),
          metadata: { ...toolMetadata(toolName, item), ...toolUseMetadata(item) }
        });
      } else if (itemType === "tool_result") {
        extracted.push({
          ...event(`${baseId}-result-${contentIndex}`, interactionId, timestamp, "tool_result", "tool", item),
          status: isFailedToolResult(item) ? "failed" : "ok",
          filePaths: extractFilePaths(JSON.stringify(item)),
          metadata: toolResultMetadata(item)
        });
      } else if (itemType === "text") {
        extracted.push(event(`${baseId}-text-${contentIndex}`, interactionId, timestamp, role === "user" ? "prompt" : "response", actorFromRole(role), item.text));
      }
    }
    if (extracted.length > 0) return extracted;
  }

  if (role === "user") {
    return [event(baseId, interactionId, timestamp, "prompt", "user", content)];
  }

  if (role === "assistant") {
    return [event(baseId, interactionId, timestamp, "response", "assistant", content)];
  }

  return [event(baseId, interactionId, timestamp, "imported_message", "system", parsed)];
}

function event(
  id: string,
  interactionId: string,
  timestamp: string | undefined,
  eventType: EventRecord["eventType"],
  actor: EventRecord["actor"],
  rawContent: unknown
): EventRecord {
  const text = stringifyContent(rawContent);
  return {
    id,
    interactionId,
    timestamp,
    eventType,
    actor,
    status: eventType === "tool_call" || eventType === "tool_result" ? "ok" : undefined,
    filePaths: extractFilePaths(text),
    tokenEstimate: Math.ceil(text.length / 4) || undefined,
    contentHash: stableHash(text),
    redactedExcerpt: excerpt(text)
  };
}

function isFailedToolResult(item: JsonObject): boolean {
  if (item.is_error === true) return true;
  const status = stringField(item.status)?.toLowerCase();
  if (status === "failed" || status === "error" || status === "denied" || status === "cancelled") return true;
  const content = stringifyContent(item.content ?? item);
  return /\b(command not found|permission denied|traceback|uncaught exception|failed with|fatal:|error:)\b/i.test(content);
}

function usageTokens(parsed: JsonObject): number {
  const usage = objectField(parsed.usage) ?? objectField(objectField(parsed.message)?.usage);
  if (!usage) return 0;
  const tokenKeys = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"];
  return tokenKeys.reduce((sum, key) => sum + numberField(usage[key]), 0);
}

function estimateTokens(events: EventRecord[]): number {
  return events.reduce((sum, eventRecord) => sum + (eventRecord.tokenEstimate ?? 0), 0);
}

function extractFilePaths(value: string): string[] | undefined {
  const paths = new Set<string>();
  for (const match of value.matchAll(/(?:\/Users|\/home|\/private\/var|\.\/|\/tmp)[A-Za-z0-9._~ /-]+/g)) {
    paths.add(match[0].trim());
  }
  return paths.size > 0 ? [...paths] : undefined;
}

function toolMetadata(toolName: string, item: JsonObject): Record<string, string | number | boolean> | undefined {
  const input = objectField(item.input);
  if (!input) return undefined;
  if (toolName === "Bash") {
    const command = stringField(input.command);
    return command ? { commandHash: stableHash(command), commandPreview: excerpt(command, 120) } : undefined;
  }
  if (toolName === "Grep") {
    const pattern = stringField(input.pattern);
    const path = stringField(input.path);
    return {
      ...(pattern ? { patternHash: stableHash(pattern), patternPreview: excerpt(pattern, 80) } : {}),
      ...(path ? { searchPath: path } : {})
    };
  }
  if (toolName === "Glob") {
    const pattern = stringField(input.pattern);
    return pattern ? { patternHash: stableHash(pattern), patternPreview: excerpt(pattern, 80) } : undefined;
  }
  return undefined;
}

function toolUseMetadata(item: JsonObject): Record<string, string | number | boolean> | undefined {
  const id = stringField(item.id);
  return id ? { toolUseId: id } : undefined;
}

function toolResultMetadata(item: JsonObject): Record<string, string | number | boolean> | undefined {
  const id = stringField(item.tool_use_id) ?? stringField(item.toolUseId);
  return id ? { toolUseId: id } : undefined;
}

function includesText(value: unknown, needle: string): boolean {
  return stringifyContent(value).toLowerCase().includes(needle.toLowerCase());
}

function stringifyContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return JSON.stringify(value);
}

function actorFromRole(role: string | undefined): EventRecord["actor"] {
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") return role;
  return undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function objectField(value: unknown): JsonObject | undefined {
  return isObject(value) ? value : undefined;
}

function nestedString(value: JsonObject, path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return stringField(current);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
