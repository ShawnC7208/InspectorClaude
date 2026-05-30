import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildDashboardModel } from "../src/analyzer.js";
import { attachProjectHarnessMetadata } from "../src/localFiles.js";
import { parseClaudeCodeJsonlFiles, parseClaudeCodeJsonlText, parseClaudeCodeJsonlTexts } from "../src/parsers/claudeCodeJsonl.js";
import { analyzeCurrentChatInput, importTranscriptInput, recordCoworkCheckpointInput } from "../src/parsers/explicitInputs.js";
import {
  buildCoachingReport,
  buildPrivacyReport,
  buildSessionReport,
  buildSkillOpportunityReport,
  exportReportJson,
  exportReportMarkdown
} from "../src/reports.js";
import { evaluateRules } from "../src/rules.js";
import type { NormalizedDataset } from "../src/types.js";

test("parses Claude Code JSONL fixtures without crashing on malformed lines", async () => {
  const fixture = await readFile("fixtures/claude-code-sample.jsonl", "utf8");
  const dataset = parseClaudeCodeJsonlText(fixture);

  assert.equal(dataset.interactions.length, 1);
  assert.ok(dataset.events.some((event) => event.redactedExcerpt?.includes("Malformed JSONL line")));
  assert.ok(dataset.events.some((event) => event.toolName === "Read"));
});

test("builds a dashboard model with deterministic findings and privacy defaults", async () => {
  const fixture = await readFile("fixtures/claude-code-sample.jsonl", "utf8");
  const dashboard = buildDashboardModel(parseClaudeCodeJsonlText(fixture));

  assert.equal(dashboard.privacy.localOnly, true);
  assert.equal(dashboard.privacy.cacheEnabled, false);
  assert.equal(dashboard.privacy.evidenceMode, "metadata_only");
  assert.equal(dashboard.findings.some((finding) => finding.evidence?.some((evidence) => evidence.excerpt)), false);
  assert.ok(dashboard.sources.find((source) => source.source === "chat")?.limitations.some((text) => text.includes("does not scrape")));
  assert.ok(dashboard.findings.some((finding) => finding.category === "prompt_clarity"));
  assert.ok(dashboard.findings.some((finding) => finding.ruleId === "efficiency.repeated_file_reads"));
  assert.ok(dashboard.findings.some((finding) => finding.ruleId === "workflow.edits_without_verification"));
  assert.ok(dashboard.findings.some((finding) => finding.category === "ai_harness"));
  assert.ok(dashboard.findings.some((finding) => finding.category === "privacy"));
  assert.ok(dashboard.recommendations.length >= 1);
  assert.equal(new Set(dashboard.summary.topActions).size, dashboard.summary.topActions.length);
});

test("can include redacted evidence excerpts when explicitly requested", async () => {
  const fixture = await readFile("fixtures/claude-code-sample.jsonl", "utf8");
  const dashboard = buildDashboardModel(parseClaudeCodeJsonlText(fixture), { evidenceMode: "redacted_excerpts" });

  assert.equal(dashboard.privacy.evidenceMode, "redacted_excerpts");
  assert.ok(dashboard.findings.some((finding) => finding.evidence?.some((evidence) => evidence.excerpt)));
});

test("evidence labels are user-facing rather than raw event type enums", async () => {
  const fixture = await readFile("fixtures/claude-code-sample.jsonl", "utf8");
  const dashboard = buildDashboardModel(parseClaudeCodeJsonlText(fixture), { evidenceMode: "redacted_excerpts" });
  const labels = dashboard.findings.flatMap((finding) => finding.evidence?.map((evidence) => evidence.label) ?? []);

  assert.ok(labels.length > 0);
  assert.equal(labels.includes("imported_message"), false);
  assert.ok(labels.some((label) => label === "User prompt" || label === "Claude Code log event" || label.startsWith("Tool")));
});

test("finding confidence varies by evidence strength instead of using one placeholder", async () => {
  const fixture = await readFile("fixtures/claude-code-sample.jsonl", "utf8");
  const dashboard = buildDashboardModel(parseClaudeCodeJsonlText(fixture), { evidenceMode: "redacted_excerpts" });
  const confidences = new Set(dashboard.findings.map((finding) => finding.confidence));

  assert.ok(confidences.size > 1);
  assert.ok(dashboard.findings.every((finding) => finding.confidence >= 0.55 && finding.confidence <= 0.92));
});

test("metadata-only parse option does not disable deterministic analysis", async () => {
  const fixture = await readFile("fixtures/claude-code-sample.jsonl", "utf8");
  const dashboard = buildDashboardModel(parseClaudeCodeJsonlText(fixture, { includeEvidence: false }));

  assert.ok(dashboard.findings.some((finding) => finding.category === "prompt_clarity"));
  assert.ok(dashboard.findings.some((finding) => finding.category === "privacy"));
});

test("tool results inherit tool identity and non-failing error text stays ok", () => {
  const text = [
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }] } }),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "0 errors found", is_error: false }] } })
  ].join("\n");

  const dataset = parseClaudeCodeJsonlText(text);
  const result = dataset.events.find((event) => event.eventType === "tool_result");

  assert.equal(result?.toolName, "Bash");
  assert.equal(result?.status, "ok");
  assert.equal(evaluateRules(dataset).some((finding) => finding.ruleId === "efficiency.repeated_tool_failure"), false);
});

test("findings preserve non-code source and capture mode", () => {
  const dataset: NormalizedDataset = {
    interactions: [
      {
        id: "chat-1",
        source: "chat",
        captureMode: "current_chat_input",
        title: "Imported chat",
        capabilityProfileId: "explicit_chat_input_v1"
      }
    ],
    events: [
      {
        id: "chat-1-prompt-1",
        interactionId: "chat-1",
        eventType: "prompt",
        actor: "user",
        redactedExcerpt: "Use the same review checklist for this workflow"
      },
      {
        id: "chat-1-prompt-2",
        interactionId: "chat-1",
        eventType: "prompt",
        actor: "user",
        redactedExcerpt: "Use the same review checklist for this workflow"
      }
    ],
    capabilityProfiles: []
  };

  const finding = evaluateRules(dataset).find((candidate) => candidate.ruleId === "harness.repeated_prompt_pattern");

  assert.equal(finding?.source, "chat");
  assert.deepEqual(finding?.captureModes, ["current_chat_input"]);
  assert.equal(finding?.evidence?.[0]?.captureMode, "current_chat_input");
});

test("normalizes explicit chat input without implying hidden history access", () => {
  const dataset = analyzeCurrentChatInput({
    title: "Strategy chat",
    messagesOrSummary: "Help improve this launch plan. Email me@example.com for details."
  });
  const dashboard = buildDashboardModel(dataset);

  assert.equal(dataset.interactions[0].source, "chat");
  assert.equal(dataset.interactions[0].captureMode, "current_chat_input");
  assert.equal(dashboard.sources.find((source) => source.source === "chat")?.enabled, true);
  assert.ok(dashboard.capabilityNotes.some((note) => note.source === "chat" && note.message.includes("does not scrape hidden")));
  assert.ok(dashboard.findings.some((finding) => finding.source === "chat" && finding.category === "privacy"));
});

test("current chat input participates in prompt clarity rules", () => {
  const dashboard = buildDashboardModel(
    analyzeCurrentChatInput({
      messagesOrSummary: "Help improve this"
    })
  );

  assert.ok(dashboard.findings.some((finding) => finding.source === "chat" && finding.ruleId === "prompt.vague_initial"));
});

test("chat transcript imports preserve user and assistant turns when role labels exist", () => {
  const dataset = importTranscriptInput({
    source: "chat",
    transcriptOrSummary: "User: Help improve this\nAssistant: Sure, what should I focus on?\nUser: Actually use bullets."
  });

  assert.equal(dataset.events.filter((event) => event.eventType === "prompt").length, 2);
  assert.equal(dataset.events.filter((event) => event.eventType === "response").length, 1);
});

test("normalizes Cowork checkpoints and flags missing done criteria", () => {
  const dataset = recordCoworkCheckpointInput({
    taskId: "launch-review",
    phase: "planning",
    summary: "Claude should review the launch materials and prepare notes."
  });
  const dashboard = buildDashboardModel(dataset);

  assert.equal(dataset.interactions[0].source, "cowork");
  assert.equal(dataset.interactions[0].captureMode, "checkpoint");
  assert.ok(dashboard.findings.some((finding) => finding.ruleId === "workflow.cowork_missing_done_criteria"));
});

test("does not flag Cowork checkpoint when review criteria are explicit", () => {
  const dataset = recordCoworkCheckpointInput({
    taskId: "launch-review",
    phase: "planning",
    summary: "Claude should review the launch materials. Done means a risk list, suggested edits, and handoff notes are ready."
  });

  assert.equal(evaluateRules(dataset).some((finding) => finding.ruleId === "workflow.cowork_missing_done_criteria"), false);
});

test("merges multiple Claude Code JSONL inputs into one dashboard model", async () => {
  const first = await readFile("fixtures/claude-code-sample.jsonl", "utf8");
  const second = await readFile("fixtures/claude-code-search-permission.jsonl", "utf8");
  const dataset = parseClaudeCodeJsonlTexts([
    { text: first, title: "sample one", projectPath: "/Users/example/project-one" },
    { text: second, title: "sample two", projectPath: "/Users/example/project-two" }
  ]);
  const dashboard = buildDashboardModel(dataset);

  assert.equal(dataset.interactions.length, 2);
  assert.equal(dashboard.sources.find((source) => source.source === "code")?.interactionCount, 2);
  assert.ok(dashboard.findings.some((finding) => finding.ruleId === "efficiency.repeated_broad_search"));
  assert.ok(dashboard.findings.some((finding) => finding.ruleId === "privacy.permission_denied"));
});

test("reads multiple Claude Code JSONL files", async () => {
  const dataset = await parseClaudeCodeJsonlFiles(["fixtures/claude-code-sample.jsonl", "fixtures/claude-code-search-permission.jsonl"]);

  assert.equal(dataset.interactions.length, 2);
  assert.ok(dataset.events.some((event) => event.eventType === "permission" && event.status === "denied"));
});

test("project harness scan detects CLAUDE.md and local harness assets from Code cwd", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inspectorclaude-harness-"));
  await mkdir(join(dir, ".claude", "agents"), { recursive: true });
  await mkdir(join(dir, ".claude", "hooks"), { recursive: true });
  await writeFile(join(dir, "CLAUDE.md"), "Use npm test before handoff.\n", "utf8");
  await writeFile(join(dir, ".claude", "settings.json"), "{}\n", "utf8");
  await writeFile(join(dir, ".claude", "agents", "reviewer.md"), "Review changes.\n", "utf8");
  await writeFile(join(dir, ".claude", "hooks", "verify.sh"), "npm test\n", "utf8");
  await writeFile(join(dir, ".mcp.json"), "{}\n", "utf8");

  const dataset = parseClaudeCodeJsonlText(
    JSON.stringify({
      type: "user",
      timestamp: "2026-01-01T00:00:00Z",
      cwd: dir,
      message: { role: "user", content: "Help improve this" }
    })
  );
  const enriched = await attachProjectHarnessMetadata(dataset);
  const dashboard = buildDashboardModel(enriched);

  assert.equal(enriched.interactions[0].projectPath, dir);
  assert.equal(enriched.interactions[0].metadata?.hasClaudeMd, true);
  assert.equal(dashboard.harness.scannedProjectCount, 1);
  assert.equal(dashboard.harness.claudeMdProjects, 1);
  assert.equal(dashboard.harness.agentProjects, 1);
  assert.equal(dashboard.harness.hookProjects, 1);
  assert.equal(dashboard.harness.mcpConfigProjects, 1);
  assert.equal(dashboard.findings.some((finding) => finding.ruleId === "harness.missing_project_instructions"), false);
});

test("project harness scan recommends CLAUDE.md only when a readable project root lacks it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inspectorclaude-no-harness-"));
  const dataset = parseClaudeCodeJsonlText(
    JSON.stringify({
      type: "user",
      timestamp: "2026-01-01T00:00:00Z",
      cwd: dir,
      message: { role: "user", content: "Help improve this" }
    })
  );
  const dashboard = buildDashboardModel(await attachProjectHarnessMetadata(dataset));

  assert.equal(dashboard.harness.scannedProjectCount, 1);
  assert.equal(dashboard.harness.claudeMdProjects, 0);
  assert.ok(dashboard.findings.some((finding) => finding.ruleId === "harness.missing_project_instructions"));
  assert.ok(dashboard.findings.some((finding) => finding.ruleId === "harness.missing_project_harness_assets"));
});

test("imports Cowork summaries with explicit capture mode", () => {
  const dataset = importTranscriptInput({
    source: "cowork",
    title: "Artifact summary",
    captureMode: "artifact_summary",
    transcriptOrSummary: "Artifact summary with expected output, constraints, and review criteria."
  });

  assert.equal(dataset.interactions[0].source, "cowork");
  assert.equal(dataset.interactions[0].captureMode, "artifact_summary");
});

test("parses usage fields, stable session ids, subagent references, and context-health signals", async () => {
  const fixture = await readFile("fixtures/claude-code-context-harness.jsonl", "utf8");
  const dataset = parseClaudeCodeJsonlText(fixture);
  const findings = evaluateRules(dataset);

  assert.equal(dataset.interactions[0].id, "code-6154a8c8db7c6dae");
  assert.equal(dataset.interactions[0].exactTokens, 18);
  assert.ok(dataset.events.some((event) => event.metadata?.kind === "subagent_reference"));
  assert.ok(findings.some((finding) => finding.ruleId === "prompt.repeated_corrections"));
  assert.ok(findings.some((finding) => finding.ruleId === "context.topic_shift_without_summary"));
  assert.ok(findings.some((finding) => finding.ruleId === "context.compaction_without_summary"));
  assert.ok(findings.some((finding) => finding.ruleId === "efficiency.duplicate_tool_output"));
  assert.ok(findings.some((finding) => finding.ruleId === "harness.project_instruction_opportunity"));
});

test("durable compaction summaries are not flagged as weak compaction", () => {
  const text = [
    JSON.stringify({ type: "user", sessionId: "summary-session", message: { role: "user", content: "Help improve this" } }),
    JSON.stringify({
      type: "compaction",
      sessionId: "summary-session",
      content: "State summary: decisions made, open questions, next steps, remaining risks."
    })
  ].join("\n");

  const findings = evaluateRules(parseClaudeCodeJsonlText(text));

  assert.equal(findings.some((finding) => finding.ruleId === "context.compaction_without_summary"), false);
});

test("normal prompts containing compact are not parsed as compaction events", () => {
  const text = JSON.stringify({
    type: "user",
    message: { role: "user", content: "Please make this more compact." }
  });
  const dataset = parseClaudeCodeJsonlText(text);

  assert.equal(dataset.events[0].eventType, "prompt");
});

test("tool results prefer explicit tool use ids over FIFO order", () => {
  const text = [
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "/tmp/a.txt" } },
          { type: "tool_use", id: "tool-2", name: "Bash", input: { command: "npm test" } }
        ]
      }
    }),
    JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tool-2", content: "error: failed", is_error: true }]
      }
    })
  ].join("\n");

  const result = parseClaudeCodeJsonlText(text).events.find((event) => event.eventType === "tool_result");

  assert.equal(result?.toolName, "Bash");
});

test("builds metadata-only Markdown and JSON coaching reports", async () => {
  const fixture = await readFile("fixtures/claude-code-sample.jsonl", "utf8");
  const dashboard = buildDashboardModel(parseClaudeCodeJsonlText(fixture));
  const report = buildCoachingReport(dashboard);
  const markdown = exportReportMarkdown(report);
  const json = exportReportJson(report);

  assert.equal(report.reportType, "coaching");
  assert.ok(report.dashboardModel);
  assert.ok(markdown.includes("# InspectorClaude Coaching Report"));
  assert.ok(markdown.includes("Evidence mode: metadata only"));
  assert.ok(markdown.includes("## Source Limitations"));
  assert.ok(markdown.includes("InspectorClaude does not scrape hidden Claude app databases"));
  assert.ok(markdown.includes("Evidence: metadata only"));
  assert.equal(markdown.includes("[REDACTED_SECRET]"), false);
  assert.equal(JSON.parse(json).dashboardModel.privacy.evidenceMode, "metadata_only");
});

test("redacted evidence reports include short redacted excerpts only when requested", async () => {
  const fixture = await readFile("fixtures/claude-code-sample.jsonl", "utf8");
  const dashboard = buildDashboardModel(parseClaudeCodeJsonlText(fixture), { evidenceMode: "redacted_excerpts" });
  const markdown = exportReportMarkdown(buildCoachingReport(dashboard));

  assert.ok(markdown.includes("Evidence mode: redacted excerpts"));
  assert.ok(markdown.includes("[REDACTED_"));
  assert.equal(markdown.includes("sk-testsecret1234567890"), false);
});

test("builds privacy and skill opportunity report variants", async () => {
  const fixture = await readFile("fixtures/claude-code-context-harness.jsonl", "utf8");
  const dashboard = buildDashboardModel(parseClaudeCodeJsonlText(fixture));
  const privacyReport = buildPrivacyReport(dashboard);
  const skillReport = buildSkillOpportunityReport(dashboard);

  assert.equal(privacyReport.reportType, "privacy");
  assert.equal(privacyReport.findings.every((finding) => finding.category === "privacy"), true);
  assert.equal(privacyReport.dashboardModel, undefined);
  assert.equal(skillReport.reportType, "skill_opportunity");
  assert.equal(skillReport.findings.every((finding) => finding.category === "ai_harness"), true);
});

test("builds scoped session reports", async () => {
  const first = await readFile("fixtures/claude-code-sample.jsonl", "utf8");
  const second = await readFile("fixtures/claude-code-context-harness.jsonl", "utf8");
  const dashboard = buildDashboardModel(
    parseClaudeCodeJsonlTexts([
      { text: first, title: "sample one" },
      { text: second, title: "sample two" }
    ])
  );
  const sessionId = dashboard.activity.sessions[1].interactionId;
  const report = buildSessionReport(dashboard, sessionId);

  assert.equal(report.reportType, "session");
  assert.ok(report.findings.length > 0);
  assert.equal(report.findings.every((finding) => finding.interactionIds.includes(sessionId)), true);
  assert.equal(report.dashboardModel, undefined);
});
