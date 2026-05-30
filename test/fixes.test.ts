/**
 * Regression tests for recent bug fixes:
 *  1. Redaction false positives (git hashes, UUIDs should not be redacted)
 *  2. mergeDatasets deduplication by both interaction and event IDs
 *  3. detectSensitiveSignals scoping (tool-call file paths must not fire)
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { redactText } from "../src/redaction.js";
import { mergeDatasets } from "../src/dataset.js";
import { evaluateRules } from "../src/rules.js";
import { buildDashboardModel } from "../src/analyzer.js";
import type { NormalizedDataset } from "../src/types.js";

// ---------------------------------------------------------------------------
// 1. Redaction: distinguishing real secrets from routine identifiers
// ---------------------------------------------------------------------------

test("redaction: 40-char git SHA is not redacted", () => {
  const sha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
  const result = redactText(`Commit ${sha} was reverted.`);
  assert.ok(!result.includes("[REDACTED"), `Expected no redaction, got: ${result}`);
  assert.ok(result.includes(sha));
});

test("redaction: UUID is not redacted", () => {
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  const result = redactText(`Session id ${uuid} loaded.`);
  assert.ok(!result.includes("[REDACTED"), `Expected no redaction, got: ${result}`);
  assert.ok(result.includes(uuid));
});

test("redaction: real base64 blob containing + IS redacted", () => {
  // 44-char standard base64 that contains '+' (produced from bytes with value 0xFB etc.)
  // c2VjcmV0w7vDr8K+dG9rZW4xMjM0NTY3ODkwYWJjZGVm decodes to "secret<binary>token1234567890abcdef"
  const b64 = "c2VjcmV0w7vDr8K+dG9rZW4xMjM0NTY3ODkwYWJjZGVm";
  assert.ok(b64.includes("+"), "Precondition: test string must contain +");
  const result = redactText(`Authorization: Bearer ${b64}`);
  assert.ok(result.includes("[REDACTED_TOKEN]"), `Expected [REDACTED_TOKEN], got: ${result}`);
  assert.ok(!result.includes(b64));
});

test("redaction: labeled token keyword triggers redaction even without + or /", () => {
  const result = redactText("token=abcdefghijklmnopqrstuvwxyz1234567890");
  assert.ok(result.includes("[REDACTED_TOKEN]"), `Expected [REDACTED_TOKEN], got: ${result}`);
});

test("redaction: password label triggers redaction", () => {
  const result = redactText("password: mysuperlongpassword123456789");
  assert.ok(result.includes("[REDACTED_TOKEN]"), `Expected [REDACTED_TOKEN], got: ${result}`);
});

test("redaction: GitHub token prefix triggers redaction", () => {
  const result = redactText("ghs-ABCDEFGHIJKLMNOPQRS1234567890");
  assert.ok(result.includes("[REDACTED_SECRET]"), `Expected [REDACTED_SECRET], got: ${result}`);
});

test("redaction: local path in text IS redacted", () => {
  const result = redactText("The file at /Users/shawn/project/secrets.env was opened.");
  assert.ok(result.includes("[REDACTED_LOCAL_PATH]"), `Expected [REDACTED_LOCAL_PATH], got: ${result}`);
});

test("redaction: email address IS redacted", () => {
  const result = redactText("Contact user@example.com for access.");
  assert.ok(result.includes("[REDACTED_EMAIL]"), `Expected [REDACTED_EMAIL], got: ${result}`);
});

// ---------------------------------------------------------------------------
// 2. mergeDatasets: deduplication by interaction and event IDs
// ---------------------------------------------------------------------------

test("mergeDatasets: duplicate interaction from sub-agent file is deduplicated", () => {
  const shared: NormalizedDataset = {
    interactions: [
      { id: "sess-abc", source: "code", captureMode: "claude_code_log", capabilityProfileId: "claude_code_v1" }
    ],
    events: [
      { id: "evt-1", interactionId: "sess-abc", eventType: "prompt", actor: "user" }
    ],
    capabilityProfiles: []
  };

  // Second dataset re-emits the same interaction (simulates sub-agent JSONL sharing sessionId)
  const subAgent: NormalizedDataset = {
    interactions: [
      { id: "sess-abc", source: "code", captureMode: "claude_code_log", capabilityProfileId: "claude_code_v1" }
    ],
    events: [
      { id: "evt-1", interactionId: "sess-abc", eventType: "prompt", actor: "user" }, // dup event
      { id: "evt-2", interactionId: "sess-abc", eventType: "tool_call", toolName: "Bash" }  // new event
    ],
    capabilityProfiles: []
  };

  const merged = mergeDatasets([shared, subAgent]);

  assert.equal(merged.interactions.length, 1, "Should have exactly 1 interaction after dedup");
  assert.equal(merged.events.length, 2, "Should have 2 unique events (dup evt-1 dropped)");
  assert.ok(merged.events.some((e) => e.id === "evt-1"));
  assert.ok(merged.events.some((e) => e.id === "evt-2"));
});

test("mergeDatasets: distinct interactions from different files both survive", () => {
  const first: NormalizedDataset = {
    interactions: [
      { id: "sess-1", source: "code", captureMode: "claude_code_log", capabilityProfileId: "claude_code_v1" }
    ],
    events: [
      { id: "evt-a", interactionId: "sess-1", eventType: "prompt", actor: "user" }
    ],
    capabilityProfiles: []
  };
  const second: NormalizedDataset = {
    interactions: [
      { id: "sess-2", source: "code", captureMode: "claude_code_log", capabilityProfileId: "claude_code_v1" }
    ],
    events: [
      { id: "evt-b", interactionId: "sess-2", eventType: "prompt", actor: "user" }
    ],
    capabilityProfiles: []
  };

  const merged = mergeDatasets([first, second]);

  assert.equal(merged.interactions.length, 2);
  assert.equal(merged.events.length, 2);
});

// ---------------------------------------------------------------------------
// 3. Privacy scoring: tool-call file paths must NOT trigger privacy findings
// ---------------------------------------------------------------------------

test("privacy: file path in a tool_call event does NOT trigger a privacy finding", () => {
  const dataset: NormalizedDataset = {
    interactions: [
      { id: "sess-1", source: "code", captureMode: "claude_code_log", capabilityProfileId: "claude_code_v1" }
    ],
    events: [
      {
        id: "evt-tool",
        interactionId: "sess-1",
        eventType: "tool_call",
        toolName: "Read",
        redactedExcerpt: "Read [REDACTED_LOCAL_PATH]"
      }
    ],
    capabilityProfiles: []
  };

  const findings = evaluateRules(dataset);
  const privacyFindings = findings.filter((f) => f.ruleId === "privacy.sensitive_signal");
  assert.equal(privacyFindings.length, 0, `Tool-call path should not fire a privacy finding. Got: ${JSON.stringify(privacyFindings)}`);
});

test("privacy: the same local path in a prompt event DOES trigger a privacy finding", () => {
  const dataset: NormalizedDataset = {
    interactions: [
      { id: "sess-1", source: "code", captureMode: "claude_code_log", capabilityProfileId: "claude_code_v1" }
    ],
    events: [
      {
        id: "evt-prompt",
        interactionId: "sess-1",
        eventType: "prompt",
        actor: "user",
        redactedExcerpt: "Please check the file at [REDACTED_LOCAL_PATH] for issues."
      }
    ],
    capabilityProfiles: []
  };

  const findings = evaluateRules(dataset);
  assert.ok(
    findings.some((f) => f.ruleId === "privacy.sensitive_signal"),
    `Expected a privacy finding for prompt with local path. Got: ${JSON.stringify(findings.map((f) => f.ruleId))}`
  );
});

test("privacy: true secret tag in a tool_result DOES trigger a privacy finding", () => {
  const dataset: NormalizedDataset = {
    interactions: [
      { id: "sess-1", source: "code", captureMode: "claude_code_log", capabilityProfileId: "claude_code_v1" }
    ],
    events: [
      {
        id: "evt-result",
        interactionId: "sess-1",
        eventType: "tool_result",
        toolName: "Bash",
        redactedExcerpt: "Output: API_KEY=[REDACTED_SECRET] found in env"
      }
    ],
    capabilityProfiles: []
  };

  const findings = evaluateRules(dataset);
  assert.ok(
    findings.some((f) => f.ruleId === "privacy.sensitive_signal"),
    `Expected a privacy finding for tool_result with secret tag. Got: ${JSON.stringify(findings.map((f) => f.ruleId))}`
  );
});

test("privacy: clean dataset with only routine tool calls scores above 80", () => {
  const dataset: NormalizedDataset = {
    interactions: [
      { id: "sess-1", source: "code", captureMode: "claude_code_log", capabilityProfileId: "claude_code_v1" }
    ],
    events: [
      {
        id: "evt-1",
        interactionId: "sess-1",
        eventType: "tool_call",
        toolName: "Read",
        redactedExcerpt: "Read [REDACTED_LOCAL_PATH]"
      },
      {
        id: "evt-2",
        interactionId: "sess-1",
        eventType: "tool_result",
        toolName: "Read",
        redactedExcerpt: "File contents..."
      },
      {
        id: "evt-3",
        interactionId: "sess-1",
        eventType: "prompt",
        actor: "user",
        redactedExcerpt: "Can you review the auth module?"
      }
    ],
    capabilityProfiles: []
  };

  const dashboard = buildDashboardModel(dataset);
  const privacyScore = dashboard.scores.find((s) => s.id === "privacy");
  assert.ok(privacyScore, "Privacy score should be present");
  assert.ok(
    (privacyScore?.value ?? 0) > 80,
    `Expected privacy score > 80 for clean dataset, got ${privacyScore?.value}`
  );
});
