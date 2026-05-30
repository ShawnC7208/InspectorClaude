/**
 * Tests for src/parsers/claudeAiExport.ts
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseClaudeAiExportFile, parseClaudeAiExportJson } from "../src/parsers/claudeAiExport.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// fileURLToPath decodes %20 → space so Node's fs APIs get a real path.
// The URL goes up 2 levels from dist/test/ to reach the source test/fixtures/.
const FIXTURE_PATH = fileURLToPath(new URL("../../test/fixtures/claude-ai-export-sample.json", import.meta.url));

async function loadFixture(): Promise<unknown> {
  const text = await readFile(FIXTURE_PATH, "utf8");
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// parseClaudeAiExportJson — pure unit tests
// ---------------------------------------------------------------------------

test("parseClaudeAiExportJson: returns empty dataset for non-array input", () => {
  const dataset = parseClaudeAiExportJson(null);
  assert.equal(dataset.interactions.length, 0);
  assert.equal(dataset.events.length, 0);
});

test("parseClaudeAiExportJson: returns empty dataset for empty array", () => {
  const dataset = parseClaudeAiExportJson([]);
  assert.equal(dataset.interactions.length, 0);
});

test("parseClaudeAiExportJson: tolerates wrapped { conversations: [...] } format", () => {
  const dataset = parseClaudeAiExportJson({
    conversations: [
      {
        uuid: "x",
        name: "Test",
        chat_messages: [{ uuid: "m1", text: "Hello", sender: "human", created_at: "2024-01-01T00:00:00Z" }]
      }
    ]
  });
  assert.equal(dataset.interactions.length, 1);
});

test("parseClaudeAiExportJson: fixture produces 3 interactions", async () => {
  const json = await loadFixture();
  const dataset = parseClaudeAiExportJson(json);
  assert.equal(dataset.interactions.length, 3);
});

test("parseClaudeAiExportJson: all interactions have source=chat", async () => {
  const json = await loadFixture();
  const dataset = parseClaudeAiExportJson(json);
  assert.ok(dataset.interactions.every((i) => i.source === "chat"));
});

test("parseClaudeAiExportJson: all interactions have captureMode=claude_ai_export", async () => {
  const json = await loadFixture();
  const dataset = parseClaudeAiExportJson(json);
  assert.ok(dataset.interactions.every((i) => i.captureMode === "claude_ai_export"));
});

test("parseClaudeAiExportJson: preserves conversation title", async () => {
  const json = await loadFixture();
  const dataset = parseClaudeAiExportJson(json);
  assert.equal(dataset.interactions[0].title, "Help me write a sorting algorithm");
});

test("parseClaudeAiExportJson: preserves startedAt timestamp", async () => {
  const json = await loadFixture();
  const dataset = parseClaudeAiExportJson(json);
  assert.equal(dataset.interactions[0].startedAt, "2024-03-10T09:00:00.000000+00:00");
});

// ---------------------------------------------------------------------------
// Sender → actor + eventType mapping
// ---------------------------------------------------------------------------

test("sender=human maps to actor=user and eventType=prompt", async () => {
  const json = await loadFixture();
  const dataset = parseClaudeAiExportJson(json);
  const prompts = dataset.events.filter((e) => e.eventType === "prompt");
  assert.ok(prompts.length > 0, "Expected at least one prompt event");
  assert.ok(prompts.every((e) => e.actor === "user"));
});

test("sender=assistant maps to actor=assistant and eventType=response", async () => {
  const json = await loadFixture();
  const dataset = parseClaudeAiExportJson(json);
  const responses = dataset.events.filter((e) => e.eventType === "response");
  assert.ok(responses.length > 0, "Expected at least one response event");
  assert.ok(responses.every((e) => e.actor === "assistant"));
});

test("first conversation has 6 events (3 prompts + 3 responses)", async () => {
  const json = await loadFixture();
  const dataset = parseClaudeAiExportJson(json);
  const firstInteractionId = dataset.interactions[0].id;
  const events = dataset.events.filter((e) => e.interactionId === firstInteractionId);
  assert.equal(events.length, 6);
  assert.equal(events.filter((e) => e.eventType === "prompt").length, 3);
  assert.equal(events.filter((e) => e.eventType === "response").length, 3);
});

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

test("attachment count is reflected in the redacted excerpt", async () => {
  const json = await loadFixture();
  const dataset = parseClaudeAiExportJson(json);
  // conv-bbb-222 first message has 1 attachment
  const secondInteractionId = dataset.interactions[1].id;
  const events = dataset.events.filter((e) => e.interactionId === secondInteractionId);
  const promptWithAttachment = events.find((e) => e.eventType === "prompt");
  assert.ok(promptWithAttachment?.redactedExcerpt?.includes("attachment"), `Expected attachment mention. Got: ${promptWithAttachment?.redactedExcerpt}`);
});

// ---------------------------------------------------------------------------
// Empty conversation
// ---------------------------------------------------------------------------

test("empty conversation produces an interaction with no events", async () => {
  const json = await loadFixture();
  const dataset = parseClaudeAiExportJson(json);
  const emptyInteraction = dataset.interactions.find((i) => i.title === "Empty conversation");
  assert.ok(emptyInteraction, "Expected 'Empty conversation' interaction");
  const events = dataset.events.filter((e) => e.interactionId === emptyInteraction.id);
  assert.equal(events.length, 0);
  assert.equal(emptyInteraction.turnCount, 0);
});

// ---------------------------------------------------------------------------
// Unknown / system sender
// ---------------------------------------------------------------------------

test("unknown sender with empty text is dropped", () => {
  const dataset = parseClaudeAiExportJson([
    {
      uuid: "conv-x",
      name: "Test",
      chat_messages: [
        { uuid: "m1", text: "", sender: "system", created_at: "2024-01-01T00:00:00Z" }
      ]
    }
  ]);
  assert.equal(dataset.events.length, 0);
});

test("unknown sender with non-empty text produces imported_message event", () => {
  const dataset = parseClaudeAiExportJson([
    {
      uuid: "conv-x",
      name: "Test",
      chat_messages: [
        { uuid: "m1", text: "Context injection note", sender: "system", created_at: "2024-01-01T00:00:00Z" }
      ]
    }
  ]);
  assert.equal(dataset.events.length, 1);
  assert.equal(dataset.events[0].eventType, "imported_message");
  assert.equal(dataset.events[0].actor, "system");
});

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

test("same conversation uuid parsed twice is deduplicated", async () => {
  const json = await loadFixture();
  const first = parseClaudeAiExportJson(json);
  const second = parseClaudeAiExportJson(json);
  // Merging both datasets should not double-count
  const { mergeDatasets } = await import("../src/dataset.js");
  const merged = mergeDatasets([first, second]);
  assert.equal(merged.interactions.length, first.interactions.length);
  assert.equal(merged.events.length, first.events.length);
});

// ---------------------------------------------------------------------------
// File-based entry point (reads .json directly — no zip needed in CI)
// ---------------------------------------------------------------------------

test("parseClaudeAiExportFile: reads a .json file directly", async () => {
  const dataset = await parseClaudeAiExportFile(FIXTURE_PATH);
  assert.equal(dataset.interactions.length, 3);
  assert.ok(dataset.interactions.every((i) => i.captureMode === "claude_ai_export"));
});

// ---------------------------------------------------------------------------
// Rules integration — chat export data fires session_hygiene rules
// ---------------------------------------------------------------------------

test("frustration_signals fires on chat export with correction phrases", async () => {
  const json = await loadFixture();
  const dataset = parseClaudeAiExportJson(json);
  const { evaluateRules } = await import("../src/rules.js");
  const findings = evaluateRules(dataset);
  assert.ok(
    findings.some((f) => f.ruleId === "session_hygiene.frustration_signals"),
    `Expected frustration_signals. Got: ${JSON.stringify(findings.map((f) => f.ruleId))}`
  );
});

test("chat export interaction appears in dashboard activity with source=chat", async () => {
  const json = await loadFixture();
  const dataset = parseClaudeAiExportJson(json);
  const { buildDashboardModel } = await import("../src/analyzer.js");
  const dashboard = buildDashboardModel(dataset);
  assert.ok(dashboard.activity.sessions.some((s) => s.source === "chat"));
  assert.ok(dashboard.sources.find((s) => s.source === "chat")?.enabled);
});
