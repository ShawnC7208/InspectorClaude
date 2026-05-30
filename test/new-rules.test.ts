/**
 * Tests for the 6 new rules added in Path A:
 *   session_hygiene.mega_session
 *   session_hygiene.frustration_signals
 *   session_hygiene.speed_accept
 *   efficiency.runaway_agent_loops
 *   efficiency.mcp_tool_bloat
 *   harness.instruction_bloat
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateRules } from "../src/rules.js";
import { buildDashboardModel } from "../src/analyzer.js";
import type { EventRecord, NormalizedDataset } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDataset(events: Partial<EventRecord>[], interactionId = "sess-1"): NormalizedDataset {
  return {
    interactions: [{ id: interactionId, source: "code", captureMode: "claude_code_log", capabilityProfileId: "claude_code_v1" }],
    events: events.map((e, i) => ({
      id: `evt-${i}`,
      interactionId,
      eventType: "prompt" as const,
      actor: "user" as const,
      ...e
    })),
    capabilityProfiles: []
  };
}

function makePrompts(count: number, interactionId = "sess-1"): Partial<EventRecord>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `prompt-${i}`,
    eventType: "prompt" as const,
    actor: "user" as const,
    interactionId,
    redactedExcerpt: `Question number ${i}`
  }));
}

// ---------------------------------------------------------------------------
// 1. session_hygiene.mega_session
// ---------------------------------------------------------------------------

test("mega_session: fires when a session has 20+ user prompts", () => {
  const dataset = makeDataset(makePrompts(21));
  const findings = evaluateRules(dataset);
  assert.ok(
    findings.some((f) => f.ruleId === "session_hygiene.mega_session"),
    `Expected mega_session finding. Got: ${JSON.stringify(findings.map((f) => f.ruleId))}`
  );
});

test("mega_session: does not fire for short sessions", () => {
  const dataset = makeDataset(makePrompts(10));
  const findings = evaluateRules(dataset);
  assert.equal(findings.some((f) => f.ruleId === "session_hygiene.mega_session"), false);
});

test("mega_session: has session_hygiene category", () => {
  const dataset = makeDataset(makePrompts(22));
  const finding = evaluateRules(dataset).find((f) => f.ruleId === "session_hygiene.mega_session");
  assert.equal(finding?.category, "session_hygiene");
  assert.equal(finding?.severity, "low");
});

// ---------------------------------------------------------------------------
// 2. session_hygiene.frustration_signals
// ---------------------------------------------------------------------------

test("frustration_signals: fires when 2+ frustration prompts exist in a session", () => {
  const dataset = makeDataset([
    { eventType: "prompt", actor: "user", redactedExcerpt: "Help me write a function" },
    { eventType: "response", actor: "assistant", redactedExcerpt: "Here is the function..." },
    { eventType: "prompt", actor: "user", redactedExcerpt: "No that's wrong, try again" },
    { eventType: "response", actor: "assistant", redactedExcerpt: "Here is a revised version..." },
    { eventType: "prompt", actor: "user", redactedExcerpt: "That's still wrong, start over" }
  ]);
  const findings = evaluateRules(dataset);
  assert.ok(
    findings.some((f) => f.ruleId === "session_hygiene.frustration_signals"),
    `Expected frustration finding. Got: ${JSON.stringify(findings.map((f) => f.ruleId))}`
  );
});

test("frustration_signals: does not fire for a single correction", () => {
  const dataset = makeDataset([
    { eventType: "prompt", actor: "user", redactedExcerpt: "Help me write a function" },
    { eventType: "response", actor: "assistant", redactedExcerpt: "Here is the function..." },
    { eventType: "prompt", actor: "user", redactedExcerpt: "No that's wrong, try again" }
  ]);
  assert.equal(evaluateRules(dataset).some((f) => f.ruleId === "session_hygiene.frustration_signals"), false);
});

test("frustration_signals: does not fire for normal conversation", () => {
  const dataset = makeDataset([
    { eventType: "prompt", actor: "user", redactedExcerpt: "Help me refactor this" },
    { eventType: "response", actor: "assistant", redactedExcerpt: "Sure, here are a few options..." },
    { eventType: "prompt", actor: "user", redactedExcerpt: "Can you also add tests?" }
  ]);
  assert.equal(evaluateRules(dataset).some((f) => f.ruleId === "session_hygiene.frustration_signals"), false);
});

// ---------------------------------------------------------------------------
// 3. session_hygiene.speed_accept
// ---------------------------------------------------------------------------

test("speed_accept: fires when 3+ large responses are followed by a reply within 15s", () => {
  const now = Date.now();
  const events: Partial<EventRecord>[] = [];
  for (let i = 0; i < 4; i++) {
    events.push({ eventType: "response", actor: "assistant", timestamp: new Date(now + i * 60_000).toISOString(), redactedExcerpt: "A".repeat(250) });
    events.push({ eventType: "prompt", actor: "user", timestamp: new Date(now + i * 60_000 + 5_000).toISOString(), redactedExcerpt: "Ok continue" });
  }
  const dataset = makeDataset(events);
  const findings = evaluateRules(dataset);
  assert.ok(
    findings.some((f) => f.ruleId === "session_hygiene.speed_accept"),
    `Expected speed_accept finding. Got: ${JSON.stringify(findings.map((f) => f.ruleId))}`
  );
});

test("speed_accept: does not fire when responses are small", () => {
  const now = Date.now();
  const events: Partial<EventRecord>[] = [];
  for (let i = 0; i < 4; i++) {
    events.push({ eventType: "response", actor: "assistant", timestamp: new Date(now + i * 60_000).toISOString(), redactedExcerpt: "Short reply" });
    events.push({ eventType: "prompt", actor: "user", timestamp: new Date(now + i * 60_000 + 5_000).toISOString(), redactedExcerpt: "Ok continue" });
  }
  assert.equal(evaluateRules(makeDataset(events)).some((f) => f.ruleId === "session_hygiene.speed_accept"), false);
});

test("speed_accept: does not fire when review gaps are adequate", () => {
  const now = Date.now();
  const events: Partial<EventRecord>[] = [];
  for (let i = 0; i < 4; i++) {
    events.push({ eventType: "response", actor: "assistant", timestamp: new Date(now + i * 120_000).toISOString(), redactedExcerpt: "A".repeat(250) });
    events.push({ eventType: "prompt", actor: "user", timestamp: new Date(now + i * 120_000 + 60_000).toISOString(), redactedExcerpt: "Looks good, continue" });
  }
  assert.equal(evaluateRules(makeDataset(events)).some((f) => f.ruleId === "session_hygiene.speed_accept"), false);
});

// ---------------------------------------------------------------------------
// 4. efficiency.runaway_agent_loops
// ---------------------------------------------------------------------------

test("runaway_agent_loops: fires when session has 20+ tool calls and 3+ failures", () => {
  const toolCalls: Partial<EventRecord>[] = Array.from({ length: 22 }, (_, i) => ({
    eventType: "tool_call" as const,
    toolName: "Bash",
    redactedExcerpt: `command ${i}`
  }));
  const failures: Partial<EventRecord>[] = Array.from({ length: 4 }, (_, i) => ({
    eventType: "tool_result" as const,
    toolName: "Bash",
    status: "failed" as const,
    redactedExcerpt: `error ${i}`
  }));
  const dataset = makeDataset([...toolCalls, ...failures]);
  const findings = evaluateRules(dataset);
  assert.ok(
    findings.some((f) => f.ruleId === "efficiency.runaway_agent_loops"),
    `Expected runaway_agent_loops. Got: ${JSON.stringify(findings.map((f) => f.ruleId))}`
  );
});

test("runaway_agent_loops: does not fire with many tools but few failures", () => {
  const toolCalls: Partial<EventRecord>[] = Array.from({ length: 22 }, (_, i) => ({
    eventType: "tool_call" as const,
    toolName: "Bash",
    redactedExcerpt: `command ${i}`
  }));
  const failures: Partial<EventRecord>[] = [{ eventType: "tool_result", toolName: "Bash", status: "failed" }];
  assert.equal(evaluateRules(makeDataset([...toolCalls, ...failures])).some((f) => f.ruleId === "efficiency.runaway_agent_loops"), false);
});

test("runaway_agent_loops: does not fire with many failures but few tool calls", () => {
  const toolCalls: Partial<EventRecord>[] = Array.from({ length: 5 }, () => ({ eventType: "tool_call" as const, toolName: "Bash" }));
  const failures: Partial<EventRecord>[] = Array.from({ length: 5 }, () => ({ eventType: "tool_result" as const, toolName: "Bash", status: "failed" as const }));
  assert.equal(evaluateRules(makeDataset([...toolCalls, ...failures])).some((f) => f.ruleId === "efficiency.runaway_agent_loops"), false);
});

// ---------------------------------------------------------------------------
// 5. efficiency.mcp_tool_bloat
// ---------------------------------------------------------------------------

test("mcp_tool_bloat: fires when session uses 15+ distinct tools", () => {
  const tools = Array.from({ length: 16 }, (_, i) => ({
    eventType: "tool_call" as const,
    toolName: `Tool${i}`,
    redactedExcerpt: `call ${i}`
  }));
  const dataset = makeDataset(tools);
  const findings = evaluateRules(dataset);
  assert.ok(
    findings.some((f) => f.ruleId === "efficiency.mcp_tool_bloat"),
    `Expected mcp_tool_bloat. Got: ${JSON.stringify(findings.map((f) => f.ruleId))}`
  );
});

test("mcp_tool_bloat: does not fire when tool variety is reasonable", () => {
  const tools = ["Read", "Edit", "Bash", "Grep", "WebFetch"].map((name) => ({
    eventType: "tool_call" as const,
    toolName: name
  }));
  assert.equal(evaluateRules(makeDataset(tools)).some((f) => f.ruleId === "efficiency.mcp_tool_bloat"), false);
});

test("mcp_tool_bloat: repeated use of same tool does not inflate count", () => {
  const tools = Array.from({ length: 30 }, () => ({ eventType: "tool_call" as const, toolName: "Bash" }));
  assert.equal(evaluateRules(makeDataset(tools)).some((f) => f.ruleId === "efficiency.mcp_tool_bloat"), false);
});

// ---------------------------------------------------------------------------
// 6. harness.instruction_bloat
// ---------------------------------------------------------------------------

test("instruction_bloat: fires when claudeMdBytes >= 4000", () => {
  const dataset: NormalizedDataset = {
    interactions: [
      {
        id: "sess-1",
        source: "code",
        captureMode: "claude_code_log",
        capabilityProfileId: "claude_code_v1",
        projectPath: "/some/project",
        metadata: { harnessScanAvailable: true, hasClaudeMd: true, claudeMdBytes: 5000 }
      }
    ],
    events: [],
    capabilityProfiles: []
  };
  const findings = evaluateRules(dataset);
  assert.ok(
    findings.some((f) => f.ruleId === "harness.instruction_bloat"),
    `Expected instruction_bloat. Got: ${JSON.stringify(findings.map((f) => f.ruleId))}`
  );
});

test("instruction_bloat: does not fire for reasonably sized CLAUDE.md", () => {
  const dataset: NormalizedDataset = {
    interactions: [
      {
        id: "sess-1",
        source: "code",
        captureMode: "claude_code_log",
        capabilityProfileId: "claude_code_v1",
        projectPath: "/some/project",
        metadata: { harnessScanAvailable: true, hasClaudeMd: true, claudeMdBytes: 1200 }
      }
    ],
    events: [],
    capabilityProfiles: []
  };
  assert.equal(evaluateRules(dataset).some((f) => f.ruleId === "harness.instruction_bloat"), false);
});

test("instruction_bloat: does not generate a skill opportunity (trimming != creating)", () => {
  const dataset: NormalizedDataset = {
    interactions: [
      {
        id: "sess-1",
        source: "code",
        captureMode: "claude_code_log",
        capabilityProfileId: "claude_code_v1",
        projectPath: "/some/project",
        metadata: { harnessScanAvailable: true, hasClaudeMd: true, claudeMdBytes: 8000 }
      }
    ],
    events: [],
    capabilityProfiles: []
  };
  const dashboard = buildDashboardModel(dataset);
  const bloatSkill = dashboard.skillOpportunities.find((s) => s.relatedFindingIds.some((id) => id.includes("instruction_bloat")));
  assert.equal(bloatSkill, undefined, "instruction_bloat should not produce a skill opportunity");
});

// ---------------------------------------------------------------------------
// Dashboard integration
// ---------------------------------------------------------------------------

test("session_hygiene appears as a score area in the dashboard model", () => {
  const dataset = makeDataset(makePrompts(5));
  const dashboard = buildDashboardModel(dataset);
  assert.ok(
    dashboard.scores.some((s) => s.id === "session_hygiene"),
    `Expected session_hygiene score. Got: ${JSON.stringify(dashboard.scores.map((s) => s.id))}`
  );
});

test("new rules fire and register under the correct categories", () => {
  const now = Date.now();
  // Combine signals for mega_session + frustration_signals
  const events: Partial<EventRecord>[] = [
    ...makePrompts(21),
    { eventType: "prompt", actor: "user", redactedExcerpt: "No that's wrong, try again" },
    { eventType: "prompt", actor: "user", redactedExcerpt: "Still wrong, start over" }
  ];
  const dashboard = buildDashboardModel(makeDataset(events));
  const categories = new Set(dashboard.findings.map((f) => f.category));
  assert.ok(categories.has("session_hygiene"), "session_hygiene category should be present in findings");
});
