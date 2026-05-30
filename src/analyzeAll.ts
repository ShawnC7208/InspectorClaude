import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { mergeDatasets } from "./dataset.js";
import { codeDatasetFromPath } from "./localFiles.js";
import { discoverClaudeAiExportFiles, parseClaudeAiExportFile } from "./parsers/claudeAiExport.js";
import { analyzeCurrentChatInput, importTranscriptInput } from "./parsers/explicitInputs.js";
import type { NormalizedDataset } from "./types.js";

export type AnalyzeAllOptions = {
  codePath?: string;
  skipCode?: boolean;
  skipChatExport?: boolean;
  chatFiles?: string[];
  coworkFiles?: string[];
};

export const DEFAULT_CLAUDE_CODE_LOG_PATH = `${homedir()}/.claude`;
export const DEFAULT_LENS_IMPORT_ROOT = `${homedir()}/.inspectorclaude/imports`;
export const DEFAULT_CHAT_IMPORT_DIR = `${DEFAULT_LENS_IMPORT_ROOT}/chat`;
export const DEFAULT_COWORK_IMPORT_DIR = `${DEFAULT_LENS_IMPORT_ROOT}/cowork`;

export async function datasetForAllSources(options: AnalyzeAllOptions = {}): Promise<NormalizedDataset> {
  const datasets: NormalizedDataset[] = [];
  const codePath = options.codePath ?? DEFAULT_CLAUDE_CODE_LOG_PATH;
  const codeWasExplicit = Boolean(options.codePath);
  const chatFiles = [...(await defaultImportFiles(DEFAULT_CHAT_IMPORT_DIR)), ...(options.chatFiles ?? [])];
  const coworkFiles = [...(await defaultImportFiles(DEFAULT_COWORK_IMPORT_DIR)), ...(options.coworkFiles ?? [])];

  if (!options.skipCode) {
    try {
      datasets.push(await codeDatasetFromPath(codePath));
    } catch (error) {
      if (codeWasExplicit) throw error;
    }
  }

  // Auto-discover claude.ai export zips in ~/Downloads
  if (!options.skipChatExport) {
    const exportFiles = await discoverClaudeAiExportFiles();
    for (const file of exportFiles) {
      try {
        datasets.push(await parseClaudeAiExportFile(file));
      } catch {
        // Malformed or inaccessible export — skip silently, don't block other sources.
      }
    }
  }

  for (const file of unique(chatFiles)) {
    const text = await readFile(file, "utf8");
    datasets.push(
      analyzeCurrentChatInput({
        title: file.split("/").at(-1),
        messagesOrSummary: text
      })
    );
  }

  for (const file of unique(coworkFiles)) {
    const text = await readFile(file, "utf8");
    datasets.push(
      importTranscriptInput({
        source: "cowork",
        title: file.split("/").at(-1),
        transcriptOrSummary: text,
        captureMode: "task_summary"
      })
    );
  }

  if (datasets.length === 0) {
    throw new Error("No analyzable sources found. Add Claude Code logs, pass Chat/Cowork files, or disable skipCode.");
  }

  return mergeDatasets(datasets);
}

export async function ensureDefaultImportFolders(): Promise<void> {
  try {
    await mkdir(DEFAULT_CHAT_IMPORT_DIR, { recursive: true });
    await mkdir(DEFAULT_COWORK_IMPORT_DIR, { recursive: true });
    await writeReadme(
      join(DEFAULT_LENS_IMPORT_ROOT, "README.md"),
      `# InspectorClaude Imports

Put explicit Claude Chat and Cowork exports, pasted transcripts, summaries, or checkpoints in these folders.

- chat/
- cowork/

InspectorClaude also auto-discovers claude.ai data export ZIPs placed in ~/Downloads
(filename must match: claude*export*.zip).

To export your Claude chat history:
  claude.ai → Settings → Privacy → Export data

InspectorClaude reads these folders when you run Analyze All. It does not scrape hidden Claude app databases.
`
    );
    await writeReadme(
      join(DEFAULT_CHAT_IMPORT_DIR, "README.md"),
      "# Chat imports\n\nAdd .md, .txt, or .json files containing Claude Chat transcripts or summaries here.\n"
    );
    await writeReadme(
      join(DEFAULT_COWORK_IMPORT_DIR, "README.md"),
      "# Cowork imports\n\nAdd .md, .txt, or .json files containing Cowork checkpoints, transcripts, or summaries here.\n"
    );
  } catch {
    // Restricted hosts can still analyze explicit files and existing readable imports.
  }
}

async function defaultImportFiles(directory: string): Promise<string[]> {
  const info = await safeStat(directory);
  if (!info?.isDirectory()) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(md|txt|json)$/i.test(entry.name) && entry.name.toLowerCase() !== "readme.md")
    .map((entry) => join(directory, entry.name))
    .sort();
}

async function writeReadme(path: string, text: string): Promise<void> {
  if (await safeStat(path)) return;
  await writeFile(path, text, "utf8");
}

async function safeStat(path: string): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
