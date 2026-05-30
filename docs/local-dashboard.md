# InspectorClaude Local Dashboard

InspectorClaude can render a local, static dashboard from any `LensDashboardModel`.

The dashboard is dependency-free HTML for the first UI phase. It is meant to prove the product surface before adding packaging-specific MCP App UI assets.

## Render From Claude Code Logs

The easiest local dashboard command is:

```sh
npm run cli -- analyze-all --format html --output /tmp/inspectorclaude-dashboard.html
```

For an interactive local dashboard with an **Analyze All** refresh button:

```sh
npm run dashboard
```

Then open:

```text
http://127.0.0.1:8765/inspectorclaude-dashboard.html
```

The button calls the local InspectorClaude server and reruns `analyze-all`. It does not grant invisible access to hidden Claude Chat or Cowork stores.

It recursively reads supported `.jsonl` sessions from `~/.claude` by default and can merge explicit Chat or Cowork files:

```sh
npm run cli -- analyze-all --chat-file chat-summary.md --cowork-file cowork-summary.md --format html --output /tmp/inspectorclaude-dashboard.html
```

The local dashboard also creates and reads these import inboxes:

```text
~/.inspectorclaude/imports/chat
~/.inspectorclaude/imports/cowork
```

Drop `.md`, `.txt`, or `.json` Chat/Cowork exports, transcripts, summaries, or checkpoints there, then click **Analyze All**.

To render only Claude Code logs:

```sh
npm run cli -- analyze-code-logs --path fixtures/claude-code-sample.jsonl --format html --output /tmp/inspectorclaude-dashboard.html
```

## Render From Explicit Chat Input

```sh
npm run cli -- analyze-chat --file fixtures/chat-import.md --format html --output /tmp/inspectorclaude-chat-dashboard.html
```

## Render From Explicit Cowork Input

```sh
npm run cli -- analyze-cowork --file fixtures/cowork-summary.md --format html --output /tmp/inspectorclaude-cowork-dashboard.html
```

## Privacy Behavior

- The dashboard renders from the model only.
- Evidence is metadata-only unless analysis explicitly enables redacted excerpts.
- Chat and Cowork content must be provided by the user.
- No database, cloud sync, or telemetry is required.
- Export history is not stored in on-demand mode.
- Optional outbound AI analysis is not used by default.
- Unsupported metrics are labeled unavailable instead of inferred.

## MCP Resource

The MCP server exposes:

```text
inspectorclaude://dashboard
```

The resource renders the latest dashboard model created by a dashboard/analyzer tool call in the current MCP server process. If no analysis has run yet, it renders an empty local-first dashboard state.
