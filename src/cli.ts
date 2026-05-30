#!/usr/bin/env node
import { access, cp, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { datasetForAllSources, ensureDefaultImportFolders } from "./analyzeAll.js";
import { buildDashboardModel } from "./analyzer.js";
import { renderDashboardHtml } from "./dashboardHtml.js";
import { codeDatasetFromPath } from "./localFiles.js";
import { analyzeCurrentChatInput, importTranscriptInput, recordCoworkCheckpointInput } from "./parsers/explicitInputs.js";
import {
  buildCoachingReport,
  buildLensReport,
  buildPrivacyReport,
  buildSkillOpportunityReport,
  exportReportJson,
  exportReportMarkdown
} from "./reports.js";
import type { CaptureMode, LensDashboardModel, LensReport, NormalizedDataset, Source } from "./types.js";

type CliArgs = {
  command?: string;
  options: Map<string, string | boolean>;
};

type OutputFormat = "dashboard-json" | "report-json" | "markdown" | "html";

/** Programmatic entry-point used by tests — returns output as a string. */
export async function runCli(argv: string[]): Promise<string> {
  const args = parseArgs(argv);
  if (!args.command || args.options.has("help") || args.options.has("h")) {
    return helpText();
  }
  return runCommand(args);
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (!args.command || args.options.has("help") || args.options.has("h")) {
    process.stdout.write(helpText());
    return;
  }

  const result = await runCommand(args);
  const outputPath = stringOption(args, "output");
  if (outputPath) {
    await writeFile(outputPath, result, "utf8");
    return;
  }
  process.stdout.write(result);
}

async function runCommand(args: CliArgs): Promise<string> {
  if (args.command === "setup-plugin") {
    return setupPlugin(args);
  }

  if (args.command === "analyze-all") {
    await ensureDefaultImportFolders();
    const dataset = await datasetForAllSources({
      codePath: stringOption(args, "code-path") ?? stringOption(args, "path"),
      skipCode: args.options.has("skip-code"),
      chatFiles: listOption(args, "chat-file"),
      coworkFiles: listOption(args, "cowork-file")
    });
    return renderOutput(buildDashboardModel(dataset, dashboardOptions(args)), args);
  }

  if (args.command === "analyze-code-logs") {
    const dataset = await codeDatasetFromPath(requiredString(args, "path"));
    return renderOutput(buildDashboardModel(dataset, dashboardOptions(args)), args);
  }

  if (args.command === "analyze-chat") {
    const text = await readFile(requiredString(args, "file"), "utf8");
    const dataset = analyzeCurrentChatInput({
      title: stringOption(args, "title"),
      messagesOrSummary: text
    });
    return renderOutput(buildDashboardModel(dataset, dashboardOptions(args)), args);
  }

  if (args.command === "analyze-cowork") {
    const file = requiredString(args, "file");
    const text = await readFile(file, "utf8");
    const captureMode = stringOption(args, "capture-mode") as CaptureMode | undefined;
    const taskId = stringOption(args, "task-id");
    const phase = stringOption(args, "phase");
    const dataset =
      captureMode === "checkpoint" || taskId || phase
        ? recordCoworkCheckpointInput({
            taskId: taskId ?? stripExtension(file.split("/").at(-1) ?? "cowork-task"),
            phase: coworkPhase(phase),
            summary: text
          })
        : importTranscriptInput({
            source: "cowork",
            title: stringOption(args, "title"),
            transcriptOrSummary: text,
            captureMode: captureMode ?? "task_summary"
          });
    return renderOutput(buildDashboardModel(dataset, dashboardOptions(args)), args);
  }

  if (args.command === "export-report") {
    const source = requiredString(args, "source") as Source;
    const dataset = await datasetForSource(source, args);
    const model = buildDashboardModel(dataset, dashboardOptions(args));
    const report = reportForType(model, reportType(args), stringOption(args, "session-id"));
    const format = stringOption(args, "format") ?? "markdown";
    if (format === "json" || format === "report-json") return exportReportJson(report);
    if (format === "markdown") return exportReportMarkdown(report);
    throw new Error(`Unsupported format: ${format}`);
  }

  throw new Error(`Unknown command: ${args.command}`);
}

async function setupPlugin(args: CliArgs): Promise<string> {
  const output = requiredString(args, "plugin-dir");
  const targetDir = resolve(output);
  const sourceDir = resolve("claude-plugin");
  const serverEntry = resolveServerEntry(stringOption(args, "server-entry"));

  await assertReadable(serverEntry, `MCP server entrypoint not found: ${serverEntry}. Run npm run build first.`);

  if (args.options.has("force")) {
    await rm(targetDir, { recursive: true, force: true });
  } else {
    await assertMissing(targetDir, `Plugin output already exists: ${targetDir}. Pass --force to replace it.`);
  }

  await cp(sourceDir, targetDir, { recursive: true });
  await cp(resolve("dist/src"), resolve(targetDir, "server"), { recursive: true });
  await writeFile(
    resolve(targetDir, ".mcp.json"),
    `${JSON.stringify(
      {
        "inspectorclaude": {
          command: "node",
          args: ["${CLAUDE_PLUGIN_ROOT}/server/mcpServer.js"]
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return `InspectorClaude plugin prepared at ${targetDir}\nMCP server: ${serverEntry}\nBundled server: ${resolve(targetDir, "server/mcpServer.js")}\n`;
}

async function datasetForSource(source: Source, args: CliArgs): Promise<NormalizedDataset> {
  if (source === "code") return codeDatasetFromPath(requiredString(args, "path"));

  const file = requiredString(args, "file");
  const text = await readFile(file, "utf8");
  if (source === "chat") {
    return analyzeCurrentChatInput({
      title: stringOption(args, "title"),
      messagesOrSummary: text
    });
  }

  return importTranscriptInput({
    source: "cowork",
    title: stringOption(args, "title"),
    transcriptOrSummary: text,
    captureMode: (stringOption(args, "capture-mode") as CaptureMode | undefined) ?? "task_summary"
  });
}

function renderOutput(model: LensDashboardModel, args: CliArgs): string {
  const format = outputFormat(args);
  if (format === "dashboard-json") return `${JSON.stringify(model, null, 2)}\n`;
  if (format === "html") return renderDashboardHtml(model);

  const report = reportForType(model, reportType(args), stringOption(args, "session-id"));
  if (format === "report-json") return exportReportJson(report);
  return exportReportMarkdown(report);
}

function reportForType(model: LensDashboardModel, reportType: LensReport["reportType"], sessionId?: string): LensReport {
  if (reportType === "privacy") return buildPrivacyReport(model);
  if (reportType === "skill_opportunity") return buildSkillOpportunityReport(model);
  if (reportType === "session") {
    if (!sessionId) throw new Error("--session-id is required for session reports");
    return buildLensReport(model, { reportType: "session", sessionId });
  }
  return buildCoachingReport(model);
}

function dashboardOptions(args: CliArgs): { evidenceMode: "metadata_only" | "redacted_excerpts" } {
  return {
    evidenceMode: args.options.has("include-evidence") ? "redacted_excerpts" : "metadata_only"
  };
}

function outputFormat(args: CliArgs): OutputFormat {
  const format = stringOption(args, "format") ?? "dashboard-json";
  if (format === "json") return "dashboard-json";
  if (format === "dashboard-json" || format === "report-json" || format === "markdown" || format === "html") return format;
  throw new Error(`Unsupported format: ${format}`);
}

function reportType(args: CliArgs): LensReport["reportType"] {
  const value = stringOption(args, "report-type") ?? "coaching";
  if (value === "coaching" || value === "session" || value === "skill_opportunity" || value === "privacy") return value;
  throw new Error(`Unsupported report type: ${value}`);
}

function coworkPhase(value: string | undefined): "intake" | "planning" | "implementation" | "review" | "handoff" | "done" {
  if (value === "intake" || value === "planning" || value === "implementation" || value === "review" || value === "handoff" || value === "done") return value;
  return "planning";
}

function parseArgs(argv: string[]): CliArgs {
  const [command, ...rest] = argv;
  const options = new Map<string, string | boolean>();

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) continue;
    const rawKey = arg.slice(2);
    const [key, inlineValue] = rawKey.split("=", 2);
    if (inlineValue !== undefined) {
      options.set(key, inlineValue);
      continue;
    }

    const next = rest[index + 1];
    if (next && !next.startsWith("--")) {
      options.set(key, next);
      index += 1;
    } else {
      options.set(key, true);
    }
  }

  return { command, options };
}

function requiredString(args: CliArgs, key: string): string {
  const value = stringOption(args, key);
  if (!value) throw new Error(`Missing required --${key}`);
  return value;
}

function stringOption(args: CliArgs, key: string): string | undefined {
  const value = args.options.get(key);
  return typeof value === "string" ? value : undefined;
}

function listOption(args: CliArgs, key: string): string[] {
  return (stringOption(args, key) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function stripExtension(value: string): string {
  return value.replace(/\.[^.]+$/, "");
}

function resolveServerEntry(value: string | undefined): string {
  if (!value) return resolve("dist/src/mcpServer.js");
  return isAbsolute(value) ? value : resolve(value);
}

async function assertReadable(path: string, message: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new Error(message);
  }
}

async function assertMissing(path: string, message: string): Promise<void> {
  try {
    await access(path);
  } catch {
    return;
  }
  throw new Error(message);
}

function helpText(): string {
  return `InspectorClaude local analyzer

Commands:
  setup-plugin --plugin-dir <plugin-dir> [--server-entry <dist/src/mcpServer.js>] [--force]
  analyze-all [--code-path <file-or-dir>] [--chat-file <txt-or-md>[,<txt-or-md>]] [--cowork-file <txt-or-md>[,<txt-or-md>]] [--format dashboard-json|report-json|markdown|html]
  analyze-code-logs --path <file-or-dir> [--format dashboard-json|report-json|markdown|html] [--include-evidence]
  analyze-chat --file <txt-or-md> [--title <title>] [--format dashboard-json|report-json|markdown|html] [--include-evidence]
  analyze-cowork --file <txt-or-md> [--title <title>] [--capture-mode task_summary|artifact_summary|checkpoint] [--task-id <id>] [--phase <phase>] [--format dashboard-json|report-json|markdown|html]
  export-report --source code|chat|cowork --path <code-file-or-dir> --format markdown|json [--report-type coaching|privacy|skill_opportunity|session] [--session-id <id>]

Defaults:
  setup-plugin copies claude-plugin and rewrites .mcp.json to an absolute local MCP server path
  analyze-all reads .jsonl sessions under ~/.claude unless --code-path, --path, or --skip-code is used
  --format dashboard-json for analyze commands
  --format markdown for export-report
  evidence mode is metadata-only unless --include-evidence is set
  --output <file> writes output instead of printing to stdout
`;
}

function printHelp(): void {
  process.stdout.write(helpText());
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
