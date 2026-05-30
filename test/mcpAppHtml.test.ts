import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMcpAppHtml } from "../src/mcpAppHtml.js";

// The MCP app renders client-side from an injected model, so its view markup
// lives in an embedded JS string. These checks guard the Activity features that
// are mirrored from the standalone dashboard.
test("MCP app embeds the activity import-help and per-session findings UI", () => {
  const html = renderMcpAppHtml();

  // Import instructions
  assert.ok(html.includes("How to add Claude Chat"));
  assert.ok(html.includes("Settings → Privacy → Export data"));
  assert.ok(html.includes("~/.inspectorclaude/imports/chat/"));
  assert.ok(html.includes("~/.inspectorclaude/imports/cowork/"));

  // Expandable per-session findings
  assert.ok(html.includes("session-row--expandable"));
  assert.ok(html.includes("Findings in this session"));
  assert.ok(html.includes("groupFindingsByInteraction"));

  // Per-session token columns
  assert.ok(html.includes("Cache hit"));
  assert.ok(html.includes("sessTokens"));
});
