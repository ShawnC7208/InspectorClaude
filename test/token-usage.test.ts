/**
 * Tests for per-session token usage and the high-token-session rule:
 *   - parser preserves the input/output/cache breakdown
 *   - context.high_token_session flags outliers vs. the user's own sessions
 *   - cold-start guard, all-equal guard, and severity scaling
 *   - dashboard model surfaces token totals + per-session flags
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateRules } from "../src/rules.js";
import { buildDashboardModel } from "../src/analyzer.js";
import { parseClaudeCodeJsonlText } from "../src/parsers/claudeCodeJsonl.js";
import type { InteractionRecord, NormalizedDataset } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function codeInteraction(id: string, total: number, cacheHitRatio = 0.6): InteractionRecord {
  return {
    id,
    source: "code",
    captureMode: "claude_code_log",
    capabilityProfileId: "claude_code_v1",
    title: id,
    estimatedTokens: total,
    exactTokens: total,
    tokenUsage: { input: total, output: 0, cacheCreation: 0, cacheRead: 0, total, cacheHitRatio }
  };
}

function datasetOf(interactions: InteractionRecord[]): NormalizedDataset {
  return { interactions, events: [], capabilityProfiles: [] };
}

const HIGH_TOKEN_RULE = "context.high_token_session";

// ---------------------------------------------------------------------------
// Parser breakdown
// ---------------------------------------------------------------------------

test("parser preserves the token breakdown and computes cache-hit ratio", () => {
  const text = [
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-05-22T14:00:00.000Z",
      message: { role: "assistant", usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 20, cache_read_input_tokens: 80 }, content: [{ type: "text", text: "a" }] }
    }),
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-05-22T14:00:05.000Z",
      message: { role: "assistant", usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 120 }, content: [{ type: "text", text: "b" }] }
    })
  ].join("\n");

  const usage = parseClaudeCodeJsonlText(text).interactions[0].tokenUsage;
  assert.ok(usage, "expected tokenUsage to be populated");
  assert.equal(usage.input, 200);
  assert.equal(usage.output, 100);
  assert.equal(usage.cacheCreation, 20);
  assert.equal(usage.cacheRead, 200);
  assert.equal(usage.total, 520);
  // cacheRead / (input + cacheCreation + cacheRead) = 200 / 420
  assert.ok(Math.abs(usage.cacheHitRatio - 200 / 420) < 1e-9);
});

test("parser leaves tokenUsage undefined when logs carry no usage", () => {
  const text = JSON.stringify({ type: "user", message: { role: "user", content: "hi" } });
  assert.equal(parseClaudeCodeJsonlText(text).interactions[0].tokenUsage, undefined);
});

// ---------------------------------------------------------------------------
// high_token_session rule
// ---------------------------------------------------------------------------

test("high_token_session: flags a clear outlier among the user's sessions", () => {
  const dataset = datasetOf([
    codeInteraction("a", 100_000),
    codeInteraction("b", 100_000),
    codeInteraction("c", 100_000),
    codeInteraction("d", 100_000),
    codeInteraction("heavy", 1_000_000, 0.2)
  ]);
  const findings = evaluateRules(dataset).filter((f) => f.ruleId === HIGH_TOKEN_RULE);
  assert.equal(findings.length, 1, `expected one finding, got ${findings.length}`);
  assert.deepEqual(findings[0].interactionIds, ["heavy"]);
  // 1M is >= 2x the ~250k threshold → high severity.
  assert.equal(findings[0].severity, "high");
  // Low cache-hit → churn-flavoured recommendation.
  assert.match(findings[0].recommendation, /churn|summary|fresh/i);
});

test("high_token_session: cold-start guard suppresses flags under 5 sessions", () => {
  const dataset = datasetOf([codeInteraction("a", 100_000), codeInteraction("heavy", 5_000_000, 0.1)]);
  assert.equal(evaluateRules(dataset).filter((f) => f.ruleId === HIGH_TOKEN_RULE).length, 0);
});

test("high_token_session: does not fire when all sessions are similar", () => {
  const dataset = datasetOf(Array.from({ length: 6 }, (_, i) => codeInteraction(`s${i}`, 100_000)));
  assert.equal(evaluateRules(dataset).filter((f) => f.ruleId === HIGH_TOKEN_RULE).length, 0);
});

test("high_token_session: a moderate outlier is medium severity", () => {
  const dataset = datasetOf([
    codeInteraction("a", 100_000),
    codeInteraction("b", 100_000),
    codeInteraction("c", 100_000),
    codeInteraction("d", 100_000),
    // Above the ~250k fallback threshold but below 2x → medium.
    codeInteraction("heavy", 300_000, 0.7)
  ]);
  const findings = evaluateRules(dataset).filter((f) => f.ruleId === HIGH_TOKEN_RULE);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "medium");
});

// ---------------------------------------------------------------------------
// Dashboard model surfacing
// ---------------------------------------------------------------------------

test("dashboard model surfaces token totals and per-session flags", () => {
  const dataset = datasetOf([
    codeInteraction("a", 100_000),
    codeInteraction("b", 100_000),
    codeInteraction("c", 100_000),
    codeInteraction("d", 100_000),
    codeInteraction("heavy", 1_000_000, 0.2)
  ]);
  const model = buildDashboardModel(dataset);

  const totals = model.summary.tokenTotals;
  assert.ok(totals);
  assert.equal(totals.exactTotal, 1_400_000);
  assert.equal(totals.sessionsWithExact, 5);
  assert.equal(totals.heaviestSessionId, "heavy");
  assert.equal(totals.heaviestSessionTokens, 1_000_000);

  const heavy = model.activity.sessions.find((s) => s.interactionId === "heavy");
  assert.ok(heavy);
  assert.equal(heavy.tokenSource, "exact");
  assert.equal(heavy.totalTokens, 1_000_000);
  assert.equal(heavy.highUsage, true);

  const light = model.activity.sessions.find((s) => s.interactionId === "a");
  assert.equal(light?.highUsage, undefined);
});
