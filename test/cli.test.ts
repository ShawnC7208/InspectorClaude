import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { runCli } from "../src/cli.js";

// Only used for the --output file-write test (which actually needs the write side-effect)
// and for setup-plugin (which needs real FS ops under a temp dir).
const execFileAsync = promisify(execFile);
const CLI = "dist/src/cli.js";

test("CLI analyzes Claude Code logs as metadata-only dashboard JSON", async () => {
  const stdout = await runCli(["analyze-code-logs", "--path", "fixtures/claude-code-sample.jsonl"]);
  const dashboard = JSON.parse(stdout);

  assert.equal(dashboard.privacy.evidenceMode, "metadata_only");
  assert.equal(dashboard.sources.find((source: { source: string }) => source.source === "code").enabled, true);
  assert.equal(dashboard.findings.some((finding: { evidence?: Array<{ excerpt?: string }> }) => finding.evidence?.some((evidence) => evidence.excerpt)), false);
});

test("CLI exports Markdown reports with source limitations", async () => {
  const stdout = await runCli([
    "export-report",
    "--source", "code",
    "--path", "fixtures/claude-code-sample.jsonl",
    "--format", "markdown"
  ]);

  assert.ok(stdout.includes("# InspectorClaude Coaching Report"));
  assert.ok(stdout.includes("Evidence mode: metadata only"));
  assert.ok(stdout.includes("## Source Limitations"));
});

test("CLI analyzes explicit chat input without hidden history access", async () => {
  const stdout = await runCli([
    "analyze-chat",
    "--file", "fixtures/chat-import.md",
    "--format", "report-json"
  ]);
  const report = JSON.parse(stdout);

  assert.equal(report.reportType, "coaching");
  assert.ok(report.dashboardModel.sources.find((source: { source: string }) => source.source === "chat").enabled);
  assert.ok(report.sourceLimitations.some((note: { message: string }) => note.message.includes("does not scrape hidden")));
});

test("CLI analyzes explicit Cowork summaries", async () => {
  const stdout = await runCli([
    "analyze-cowork",
    "--file", "fixtures/cowork-summary.md",
    "--capture-mode", "checkpoint",
    "--task-id", "launch-review"
  ]);
  const dashboard = JSON.parse(stdout);

  assert.ok(dashboard.sources.find((source: { source: string }) => source.source === "cowork").enabled);
  assert.ok(dashboard.findings.some((finding: { ruleId?: string }) => finding.ruleId === "workflow.cowork_missing_done_criteria"));
});

test("CLI analyze-all merges Code logs and explicit Chat/Cowork imports", async () => {
  const stdout = await runCli([
    "analyze-all",
    "--code-path", "fixtures/claude-code-sample.jsonl",
    "--chat-file", "fixtures/chat-import.md",
    "--cowork-file", "fixtures/cowork-summary.md",
    "--format", "dashboard-json"
  ]);
  const dashboard = JSON.parse(stdout);

  assert.equal(dashboard.sources.find((source: { source: string }) => source.source === "code").enabled, true);
  assert.equal(dashboard.sources.find((source: { source: string }) => source.source === "chat").enabled, true);
  assert.equal(dashboard.sources.find((source: { source: string }) => source.source === "cowork").enabled, true);
  assert.ok(dashboard.activity.sessions.some((session: { source: string }) => session.source === "chat"));
  assert.ok(dashboard.activity.sessions.some((session: { source: string }) => session.source === "cowork"));
});

test("CLI analyze-all can build an explicit-import dashboard without Code logs", async () => {
  const stdout = await runCli([
    "analyze-all",
    "--skip-code",
    "--chat-file", "fixtures/chat-import.md",
    "--format", "html"
  ]);

  assert.ok(stdout.includes("<!doctype html>"));
  // Count only the fixture session, not any sessions from the user's local import folder.
  const chatButtonMatch = stdout.match(/data-source-filter="chat"[^>]*>Chat <span>(\d+)<\/span>/);
  const chatCount = chatButtonMatch ? Number(chatButtonMatch[1]) : 0;
  assert.ok(chatCount >= 1, `Expected at least 1 chat session, got ${chatCount}`);
  assert.ok(stdout.includes('data-source-filter="code"'));
});

test("CLI can write output to a file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inspectorclaude-cli-"));
  const outputPath = join(dir, "report.md");
  // Intentionally uses subprocess — exercises the --output file-write path in main()
  await execFileAsync("node", [
    CLI,
    "export-report",
    "--source", "code",
    "--path", "fixtures/claude-code-sample.jsonl",
    "--format", "markdown",
    "--output", outputPath
  ]);

  const output = await readFile(outputPath, "utf8");
  assert.ok(output.includes("# InspectorClaude Coaching Report"));
});

test("CLI setup-plugin copies the plugin and writes an absolute MCP server path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inspectorclaude-plugin-"));
  const pluginDir = join(dir, "InspectorClaude");
  const stdout = await runCli(["setup-plugin", "--plugin-dir", pluginDir]);

  assert.ok(stdout.includes(pluginDir));
  await access(join(pluginDir, ".claude-plugin", "plugin.json"));
  await access(join(pluginDir, "commands", "open-dashboard.md"));
  await access(join(pluginDir, "skills", "ai-collaboration-coach", "SKILL.md"));
  await access(join(pluginDir, "server", "mcpServer.js"));

  const mcpConfig = JSON.parse(await readFile(join(pluginDir, ".mcp.json"), "utf8"));
  assert.equal(mcpConfig["inspectorclaude"].command, "node");
  assert.equal(mcpConfig["inspectorclaude"].args[0], "${CLAUDE_PLUGIN_ROOT}/server/mcpServer.js");
});

test("CLI setup-plugin refuses to replace an existing plugin without force", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inspectorclaude-plugin-"));
  const pluginDir = join(dir, "InspectorClaude");
  await runCli(["setup-plugin", "--plugin-dir", pluginDir]);

  await assert.rejects(
    runCli(["setup-plugin", "--plugin-dir", pluginDir]),
    /Pass --force to replace it/
  );
});

test("CLI renders dashboard HTML from analyzer commands", async () => {
  const stdout = await runCli([
    "analyze-code-logs",
    "--path", "fixtures/claude-code-sample.jsonl",
    "--format", "html"
  ]);

  assert.ok(stdout.includes("<!doctype html>"));
  assert.ok(stdout.includes("InspectorClaude"));
  assert.ok(stdout.includes("data-view=\"overview\""));
  assert.ok(stdout.includes("data-view=\"reports\""));
});

test("CLI rejects unsupported export report formats", async () => {
  await assert.rejects(
    runCli([
      "export-report",
      "--source", "code",
      "--path", "fixtures/claude-code-sample.jsonl",
      "--format", "banana"
    ]),
    /Unsupported format: banana/
  );
});

test("CLI requires session id for session reports", async () => {
  await assert.rejects(
    runCli([
      "export-report",
      "--source", "code",
      "--path", "fixtures/claude-code-sample.jsonl",
      "--format", "json",
      "--report-type", "session"
    ]),
    /--session-id is required/
  );
});
