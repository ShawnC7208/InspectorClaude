# InspectorClaude Local MCP Server

The local MCP server exposes InspectorClaude analysis tools over stdio. It is local-first and does not create a database, sync data, or read hidden Claude Chat/Cowork stores.

## Start

```sh
npm run mcp
```

The built server entrypoint is:

```sh
node dist/src/mcpServer.js
```

## Tools

- `show_dashboard`
- `analyze_code_logs`
- `analyze_current_chat`
- `import_transcript`
- `record_cowork_checkpoint`
- `get_coaching_report`
- `recommend_improvements`
- `export_report`

## Privacy Defaults

- Evidence mode is `metadata_only` unless `includeEvidence: true` is passed.
- Claude Code logs are read-only.
- Claude Chat requires explicit `messagesOrSummary`.
- Claude Cowork requires explicit checkpoints, transcripts, or summaries.

## Example JSON-RPC Call

MCP stdio uses `Content-Length` framed JSON-RPC messages. The body can be:

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"analyze_code_logs","arguments":{"projectPath":"fixtures/claude-code-sample.jsonl"}}}
```

The result contains both text content and structured dashboard data.

`show_dashboard` accepts `source: "all"` and combines whichever explicit inputs are provided:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"show_dashboard","arguments":{"source":"all","projectPath":"fixtures/claude-code-sample.jsonl","messagesOrSummary":"Help improve this","transcriptOrSummary":"Claude should review the launch materials."}}}
```

If no source inputs are provided, `show_dashboard` defaults to all supported local sources. It can also scope results with:

- `timeRange.start` and `timeRange.end`
- `taskId`
- `dimensions`

`analyze_code_logs` can read the default local Claude log folder when `projectPath` is omitted. It also accepts:

- `since`
- `limit`
- `dimensions`

`record_cowork_checkpoint` accepts optional `artifacts` and `metrics` fields and includes them in the explicit checkpoint analysis.

`get_coaching_report`, `recommend_improvements`, and `export_report` can either use an explicit `dashboardModel` or build one from supported source arguments.

Session reports require `sessionId`.

## Dashboard Resource

The server exposes a local dashboard resource:

```text
inspectorclaude://dashboard
```

The resource returns `text/html` rendered from the latest `LensDashboardModel` created by `show_dashboard`, `analyze_code_logs`, `analyze_current_chat`, `import_transcript`, or `record_cowork_checkpoint` in the current server process. If no analysis has run yet, the resource renders an empty state that explains local-first behavior and unavailable metrics.
