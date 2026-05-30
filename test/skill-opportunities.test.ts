/**
 * Tests for similarity-clustered skill opportunities (options B + C):
 *   - paraphrased repeated prompts collapse into one clustered opportunity
 *   - distinct recurring patterns stay separate
 *   - opportunities carry keywords, examples, a local scaffold, and a draft prompt
 *   - impact scales with how often the pattern recurs
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateRules } from "../src/rules.js";
import { buildDashboardModel } from "../src/analyzer.js";
import type { NormalizedDataset } from "../src/types.js";

function datasetFromPrompts(prompts: { interactionId: string; text: string }[]): NormalizedDataset {
  const interactionIds = [...new Set(prompts.map((p) => p.interactionId))];
  return {
    interactions: interactionIds.map((id) => ({
      id,
      source: "code",
      captureMode: "claude_code_log",
      capabilityProfileId: "claude_code_v1"
    })),
    events: prompts.map((p, i) => ({
      id: `evt-${i}`,
      interactionId: p.interactionId,
      eventType: "prompt" as const,
      actor: "user" as const,
      redactedExcerpt: p.text
    })),
    capabilityProfiles: []
  };
}

// A recurring "add parser tests" request, worded differently each time.
const PARSER_TESTS = [
  { interactionId: "s1", text: "Add unit tests for the parser module" },
  { interactionId: "s2", text: "Write unit tests covering the parser" },
  { interactionId: "s3", text: "Add more unit tests to the parser" }
];

test("clusters paraphrased prompts into a single repeated-pattern finding", () => {
  const findings = evaluateRules(datasetFromPrompts(PARSER_TESTS));
  const repeated = findings.filter((f) => f.ruleId === "harness.repeated_prompt_pattern");
  assert.equal(repeated.length, 1, `expected one cluster, got ${repeated.length}`);
  assert.ok((repeated[0].keywords ?? []).includes("parser"), "keywords should capture the shared subject");
  assert.ok((repeated[0].keywords ?? []).includes("tests"), "keywords should capture the shared verb/object");
  assert.ok((repeated[0].examples ?? []).length >= 2, "should retain representative examples");
});

test("keeps distinct recurring patterns as separate opportunities", () => {
  const dataset = datasetFromPrompts([
    ...PARSER_TESTS,
    { interactionId: "s4", text: "Regenerate the changelog from recent commits" },
    { interactionId: "s5", text: "Regenerate changelog from the commits" }
  ]);
  const model = buildDashboardModel(dataset);
  const repeated = model.skillOpportunities.filter((s) => s.kind === "repeated_prompt");
  assert.equal(repeated.length, 2, "two unrelated clusters should yield two opportunities");
  const names = new Set(repeated.map((s) => s.suggestedName));
  assert.equal(names.size, 2, "clusters should get distinct derived names");
});

test("opportunity carries a scaffold, a draft prompt, and frequency-based impact", () => {
  const model = buildDashboardModel(datasetFromPrompts(PARSER_TESTS));
  const skill = model.skillOpportunities.find((s) => s.kind === "repeated_prompt");
  assert.ok(skill, "expected a repeated-prompt opportunity");
  assert.ok(skill!.suggestedName.endsWith("-skill"), "name derived from keywords");
  assert.ok(skill!.scaffold.includes("name:"), "scaffold should be a paste-ready skill stub");
  assert.ok(skill!.draftPrompt.includes("Representative requests"), "draft prompt should hand examples to Claude");
  assert.ok(skill!.examples.some((e) => skill!.draftPrompt.includes(e)), "draft prompt embeds the captured examples");
  // Seen across three sessions → strongest signal.
  assert.equal(skill!.occurrenceCount, 3);
  assert.equal(skill!.impact, "high");
});

test("a pattern seen twice is medium impact", () => {
  const model = buildDashboardModel(datasetFromPrompts(PARSER_TESTS.slice(0, 2)));
  const skill = model.skillOpportunities.find((s) => s.kind === "repeated_prompt");
  assert.ok(skill, "expected an opportunity");
  assert.equal(skill!.occurrenceCount, 2);
  assert.equal(skill!.impact, "medium");
});
