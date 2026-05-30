# InspectorClaude Plugin

InspectorClaude is a local-first coaching dashboard for Claude usage.

The plugin provides user-facing commands and skills that call the local InspectorClaude analyzer and MCP server. V1 reads supported local Claude Code JSONL logs and explicit Chat/Cowork inputs. It does not scrape hidden Claude app databases, create a database, sync to the cloud, or enable telemetry.

## Local Development Install

From the repository root:

```sh
npm install
npm run build
```

Then copy or symlink this `claude-plugin` directory into your Claude plugin install workflow.

See `../docs/plugin-install.md` for the full smoke-test checklist.

For a copied plugin folder with bundled MCP server files, run:

```sh
npm run setup-plugin -- --plugin-dir /path/to/InspectorClaude-Plugin
```

From the repository root, the MCP server entrypoint is:

```sh
node dist/src/mcpServer.js
```

The plugin `.mcp.json` runs the same built server as `../dist/src/mcpServer.js` from this directory.

For a browser-based local dashboard during development:

```sh
npm run dashboard
```

Open:

```text
http://127.0.0.1:8765/inspectorclaude-dashboard.html
```

## Privacy Defaults

- Claude Code logs are read in place and not modified.
- Chat and Cowork require explicit current-chat input, exports, summaries, checkpoints, or supported local session files.
- Reports and dashboard evidence are metadata-only unless redacted excerpts are explicitly enabled.
- No cloud sync or telemetry is enabled by default.
