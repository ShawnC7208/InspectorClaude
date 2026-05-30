import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboardModel } from "../src/analyzer.js";
import { emptyDashboardModel, renderDashboardHtml } from "../src/dashboardHtml.js";
import { parseClaudeCodeJsonlText } from "../src/parsers/claudeCodeJsonl.js";
import type { LensDashboardModel } from "../src/types.js";

test("dashboard HTML renders all required V1 views from LensDashboardModel", () => {
  const model = buildDashboardModel(
    parseClaudeCodeJsonlText(
      [
        JSON.stringify({ sessionId: "s1", timestamp: "2026-01-01T00:00:00Z", type: "user", message: "Fix this" }),
        JSON.stringify({ sessionId: "s1", timestamp: "2026-01-01T00:01:00Z", type: "assistant", message: "Done" })
      ].join("\n")
    )
  );
  const html = renderDashboardHtml(model);

  for (const view of ["Overview", "Activity", "Anti-Patterns", "Context Health", "AI Harness", "Skills", "Privacy", "Reports"]) {
    assert.ok(html.includes(view), `missing ${view}`);
  }
  assert.ok(html.includes("lens-dashboard-model"));
  assert.ok(html.includes("Local only"));
  assert.ok(html.includes("Metadata only"));
  assert.ok(html.includes("Analyze All"));
  assert.ok(html.includes("/api/analyze-all"));
  assert.ok(html.includes("Claude Code"));
  assert.ok(html.includes("Local JSONL session logs"));
  assert.ok(html.includes("Export history"));
  assert.ok(html.includes("Not stored in on-demand mode"));
  assert.ok(html.includes("Outbound AI"));
  assert.ok(html.includes("None - local analysis only"));
  assert.equal(html.includes("<strong>Claude Code</strong><span>Local JSONL session logs</span>"), true);
});

test("dashboard HTML labels partial and unsupported metrics as unavailable", () => {
  const html = renderDashboardHtml(emptyDashboardModel("2026-01-01T00:00:00Z"));

  assert.ok(html.includes("InspectorClaude is ready for local analysis"));
  assert.ok(html.includes("Unavailable"));
  assert.ok(html.includes("No cloud sync or telemetry is enabled by default."));
  assert.ok(html.includes("Chat and Cowork analysis require explicit user-provided input."));
});

test("dashboard HTML renders activity filter counts and filtered empty state", () => {
  const model = buildDashboardModel(
    parseClaudeCodeJsonlText(
      JSON.stringify({
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:00Z",
        type: "user",
        message: { role: "user", content: "Help improve this" }
      })
    )
  );
  const html = renderDashboardHtml(model);

  assert.ok(html.includes('data-source-filter="chat"'));
  assert.ok(html.includes('data-source-filter="cowork"'));
  assert.ok(html.includes('data-source-filter="code"'));
  assert.ok(html.includes("Code <span>1</span>"));
  assert.ok(html.includes("Chat <span>0</span>"));
  assert.ok(html.includes("data-filter-empty"));
  assert.ok(html.includes("No sessions match this source filter."));
  assert.ok(html.includes("No supported Chat logs were found."));
});

test("dashboard HTML shows session duration when timestamps are available", () => {
  const model = buildDashboardModel(
    parseClaudeCodeJsonlText(
      [
        JSON.stringify({ sessionId: "s1", timestamp: "2026-01-01T00:00:00Z", type: "user", message: { role: "user", content: "Help improve this" } }),
        JSON.stringify({ sessionId: "s1", timestamp: "2026-01-01T01:15:00Z", type: "assistant", message: { role: "assistant", content: "Done" } })
      ].join("\n")
    )
  );
  const html = renderDashboardHtml(model);

  assert.ok(html.includes("1h 15m"));
});

test("dashboard HTML ranks top findings by severity before rule order", () => {
  const model: LensDashboardModel = {
    ...emptyDashboardModel("2026-01-01T00:00:00Z"),
    findings: [
      {
        id: "low",
        category: "ai_harness",
        title: "Low finding",
        severity: "low",
        confidence: 0.95,
        source: "code",
        interactionIds: ["s1"],
        captureModes: ["claude_code_log"],
        explanation: "Low severity.",
        recommendation: "Later."
      },
      {
        id: "high",
        category: "privacy",
        title: "High finding",
        severity: "high",
        confidence: 0.7,
        source: "code",
        interactionIds: ["s1"],
        captureModes: ["claude_code_log"],
        explanation: "High severity.",
        recommendation: "Now."
      }
    ]
  };
  const html = renderDashboardHtml(model);

  assert.ok(html.indexOf("High finding") < html.indexOf("Low finding"));
});

test("dashboard HTML escapes user-controlled model text", () => {
  const model: LensDashboardModel = {
    ...emptyDashboardModel("2026-01-01T00:00:00Z"),
    summary: {
      ...emptyDashboardModel("2026-01-01T00:00:00Z").summary,
      headline: "<script>alert('bad')</script>"
    },
    findings: [
      {
        id: "xss",
        category: "privacy",
        title: "<img src=x onerror=alert(1)>",
        severity: "medium",
        confidence: 0.9,
        source: "chat",
        interactionIds: ["chat-1"],
        captureModes: ["manual_import"],
        explanation: "Do not render <b>HTML</b>.",
        recommendation: "Escape text before display.",
        evidence: [
          {
            id: "ev-1",
            source: "chat",
            captureMode: "manual_import",
            interactionId: "chat-1",
            label: "Evidence",
            excerpt: "</script><script>alert(1)</script>"
          }
        ]
      }
    ]
  };
  const html = renderDashboardHtml(model);

  assert.ok(html.includes("&lt;script&gt;alert"));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.equal(html.includes("<img src=x onerror=alert(1)>"), false);
  assert.equal(html.includes("</script><script>alert(1)</script>"), false);
});
