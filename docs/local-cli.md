# InspectorClaude Local CLI

The local CLI runs the V1 analyzer on demand. It does not start a server, create a database, sync data, or read hidden Claude Chat/Cowork stores.

## Commands

Prepare a local Claude plugin folder:

```sh
npm run setup-plugin -- --plugin-dir /path/to/InspectorClaude-Plugin
```

This copies `claude-plugin/`, bundles the built MCP server into `server/`, and rewrites `.mcp.json` to use `${CLAUDE_PLUGIN_ROOT}/server/mcpServer.js`. Pass `--force` to replace an existing prepared plugin folder.

Analyze all supported local/default sources:

```sh
npm run cli -- analyze-all --format html --output /tmp/inspectorclaude-dashboard.html
```

`analyze-all` recursively reads supported `.jsonl` sessions from `~/.claude` by default. Chat and Cowork still require explicit user-provided files unless they are available as supported JSONL/session exports:

```sh
npm run cli -- analyze-all --chat-file chat-summary.md --cowork-file cowork-summary.md --format html --output /tmp/inspectorclaude-dashboard.html
```

It also reads default InspectorClaude import inboxes:

```text
~/.inspectorclaude/imports/chat
~/.inspectorclaude/imports/cowork
```

Put `.md`, `.txt`, or `.json` Chat/Cowork exports, transcripts, summaries, or checkpoints there, then run `analyze-all` or click **Analyze All** in the local dashboard.

Analyze Claude Code JSONL logs:

```sh
npm run cli -- analyze-code-logs --path fixtures/claude-code-sample.jsonl
```

Analyze a directory of Claude Code logs:

```sh
npm run cli -- analyze-code-logs --path ~/.claude/projects
```

Analyze explicit Claude Chat input:

```sh
npm run cli -- analyze-chat --file chat-summary.md --format report-json
```

Analyze explicit Cowork input:

```sh
npm run cli -- analyze-cowork --file cowork-summary.md --capture-mode checkpoint --task-id launch-review
```

Export a Markdown report:

```sh
npm run cli -- export-report --source code --path fixtures/claude-code-sample.jsonl --format markdown
```

Export a scoped session report:

```sh
npm run cli -- export-report --source code --path fixtures/claude-code-sample.jsonl --format json --report-type session --session-id <interaction-id>
```

## Formats

Analyze commands default to `dashboard-json`.

Supported analyze formats:

- `dashboard-json`
- `report-json`
- `markdown`
- `html`

`export-report` supports:

- `markdown`
- `json`

## Privacy Defaults

- Evidence mode is `metadata_only` by default.
- Use `--include-evidence` only when redacted evidence excerpts are explicitly desired.
- Original Claude Code logs are read-only.
- InspectorClaude only reads supported `.jsonl`, `.md`, `.txt`, and `.json` import files; it does not scrape hidden app databases.
- `analyze-all` merges discovered `.jsonl` sessions with explicit imports from flags or the InspectorClaude import inbox.

## Output Files

Use `--output <file>` to write the result instead of printing to stdout.

Session reports require `--session-id` so they do not accidentally include all findings.
