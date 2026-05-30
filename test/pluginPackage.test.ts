import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const PLUGIN_DIR = "claude-plugin";

test("plugin package exposes required metadata", async () => {
  const manifest = JSON.parse(await readFile(join(PLUGIN_DIR, ".claude-plugin", "plugin.json"), "utf8")) as {
    name?: string;
    version?: string;
    description?: string;
    author?: { name?: string };
  };

  assert.equal(manifest.name, "inspectorclaude");
  assert.equal(manifest.version, "0.1.0");
  assert.ok(manifest.description?.includes("Local-first"));
  assert.ok(manifest.description?.includes("Claude Chat, Cowork, and Code"));
  assert.ok(manifest.author?.name);
});

test("plugin MCP config starts the built local stdio server", async () => {
  const config = JSON.parse(await readFile(join(PLUGIN_DIR, ".mcp.json"), "utf8")) as {
    "inspectorclaude"?: {
      command?: string;
      args?: string[];
    };
  };
  const server = config["inspectorclaude"];

  assert.equal(server?.command, "node");
  assert.deepEqual(server?.args, ["../dist/src/mcpServer.js"]);
});

test("plugin package includes all V1 commands", async () => {
  const commands = [
    "open-dashboard.md",
    "analyze-code-logs.md",
    "coach-this-chat.md",
    "record-cowork-checkpoint.md",
    "context-health.md",
    "recommend-skills.md",
    "export-report.md"
  ];

  for (const command of commands) {
    const content = await readFile(join(PLUGIN_DIR, "commands", command), "utf8");
    assert.ok(content.includes("allowed-tools:"), `${command} should declare its MCP tool access`);
    assert.ok(content.includes("mcp__plugin_inspectorclaude_inspectorclaude__"), `${command} should use Claude Code plugin MCP tool naming`);
    assert.ok(content.includes("InspectorClaude") || content.includes("Lens"), `${command} should be user-facing`);
  }
});

test("plugin package includes all V1 skills", async () => {
  const skills = [
    ["ai-collaboration-coach", "AI Collaboration Coach"],
    ["context-curator", "Context Curator"],
    ["skill-recommender", "Skill Recommender"],
    ["cowork-task-coach", "Cowork Task Coach"]
  ];

  for (const [directory, title] of skills) {
    const skillPath = join(PLUGIN_DIR, "skills", directory, "SKILL.md");
    await access(skillPath);
    const content = await readFile(skillPath, "utf8");
    assert.ok(content.includes(`name: ${directory}`), `${directory} should declare a stable skill name`);
    assert.ok(content.includes(`# ${title}`), `${directory} should include a readable title`);
  }
});

test("plugin docs preserve V1 privacy boundaries", async () => {
  const readme = await readFile(join(PLUGIN_DIR, "README.md"), "utf8");

  assert.ok(readme.includes("does not scrape hidden Claude app databases"));
  assert.ok(readme.includes("No cloud sync or telemetry"));
  assert.ok(readme.includes("Chat and Cowork require explicit"));
});
