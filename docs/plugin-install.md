# InspectorClaude Plugin Install and Smoke Test

InspectorClaude V1 ships as a local-first development plugin package in `claude-plugin/`.

This package is intentionally simple for the first install milestone:

- Plugin metadata lives in `claude-plugin/.claude-plugin/plugin.json`.
- Claude command prompts live in `claude-plugin/commands/`.
- InspectorClaude coaching skills live in `claude-plugin/skills/`.
- The MCP server is configured in `claude-plugin/.mcp.json`.

## Build

From the repository root:

```sh
npm install
npm run build
```

The source plugin expects the repository layout to remain intact and starts:

```sh
node ../dist/src/mcpServer.js
```

from inside `claude-plugin/`.

For a relocatable local install folder, prepare a copied plugin with bundled server files:

```sh
npm run setup-plugin -- --plugin-dir /path/to/InspectorClaude-Plugin
```

The prepared plugin copies the built MCP server into `server/` and configures `.mcp.json` with `${CLAUDE_PLUGIN_ROOT}/server/mcpServer.js`.

Use `--force` to replace an existing prepared plugin folder:

```sh
npm run setup-plugin -- --plugin-dir /path/to/InspectorClaude-Plugin --force
```

## Local Plugin Workflow

Use your Claude plugin development workflow to install or symlink either `claude-plugin/` or the folder created by `setup-plugin`.

After install, these commands should be discoverable:

- `/inspectorclaude:open-dashboard`
- `/inspectorclaude:analyze-code-logs`
- `/inspectorclaude:coach-this-chat`
- `/inspectorclaude:record-cowork-checkpoint`
- `/inspectorclaude:context-health`
- `/inspectorclaude:recommend-skills`
- `/inspectorclaude:export-report`

The plugin exposes these skills:

- `ai-collaboration-coach`
- `context-curator`
- `skill-recommender`
- `cowork-task-coach`

## Smoke Tests

Run the automated package and analyzer checks:

```sh
npm test
```

Generate a dashboard model from all supported default sources:

```sh
npm run cli -- analyze-all --format dashboard-json
```

Generate a fixture report:

```sh
npm run cli -- export-report --source code --path fixtures/claude-code-sample.jsonl --format markdown
```

Start the local dashboard server:

```sh
npm run dashboard
```

Open:

```text
http://127.0.0.1:8765/inspectorclaude-dashboard.html
```

Click **Analyze All**. The dashboard should render from `LensDashboardModel`, show source capability notes, and label unsupported metrics as unavailable.

Start the MCP server directly:

```sh
npm run mcp
```

Claude should be able to list the InspectorClaude MCP tools and call `show_dashboard`, `analyze_code_logs`, `analyze_current_chat`, `import_transcript`, `record_cowork_checkpoint`, `get_coaching_report`, `recommend_improvements`, and `export_report`.

Claude Code prefixes plugin MCP tools as:

```text
mcp__plugin_inspectorclaude_inspectorclaude__<tool-name>
```

## Privacy Smoke Checks

Verify these behaviors before treating the package as V1-ready:

- Claude Code logs are read locally and are not modified.
- Claude Chat and Cowork analysis require explicit user-provided content, supported exports, summaries, checkpoints, or supported local session files.
- Hidden Claude app databases are not scraped.
- No SQLite database is created.
- No cloud sync or telemetry is enabled by default.
- Reports and dashboard evidence remain metadata-only unless redacted excerpts are explicitly enabled.
