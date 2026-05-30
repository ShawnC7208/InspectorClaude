# InspectorClaude V1 Architecture and Implementation Plan

## Source-of-Truth Specs

This plan follows the numbered specs in `Spec Docs/`. The older implementation plan is background only.

## Smallest Buildable V1 Architecture

InspectorClaude V1 should start as an on-demand local analyzer that produces a `LensDashboardModel`.

```text
supported local or explicit inputs
  -> parsers
  -> normalized InteractionRecord/EventRecord arrays
  -> redaction
  -> deterministic rules
  -> scores, recommendations, skill opportunities
  -> LensDashboardModel
  -> reports and MCP App UI
```

Key choices:

- Use TypeScript contracts as the product boundary so the dashboard, reports, and MCP tools consume the same shape.
- Keep analysis in memory for V1. No SQLite, background index, cloud sync, or telemetry.
- Treat Claude Code JSONL as the richest automatic source.
- Treat Chat and Cowork as explicit inputs only.
- Make unsupported metrics visible through capability profiles and capability notes.
- Run privacy detection and redaction before evidence is exposed.
- Prefer deterministic rules first; AI coaching can be layered later only with explicit disclosure.

## Tradeoffs

- In-memory analysis is less powerful than a database for large history, but it is simpler, inspectable, privacy-preserving, and matches V1.
- Fixture-based parsing will not capture every Claude Code JSONL variant immediately, but it gives a safe contract and fast test loop.
- Rules may feel conservative early, but explainable findings are more trustworthy than opaque generated coaching.
- MCP App UI is deferred until the dashboard model is stable, preventing UI work from defining hidden analyzer behavior.

## Milestones

### Milestone 1: Core Analyzer

- TypeScript project structure.
- Core `LensDashboardModel` and normalized record types.
- Claude Code JSONL parser.
- Redaction utilities.
- Deterministic rules across prompt clarity, context health, workflow structure, AI harness, efficiency, and privacy.
- Fixture tests for malformed JSONL, repeated tools, privacy, verification gaps, compaction, and skill opportunities.

### Milestone 2: Reports

- Markdown report export from `LensDashboardModel`.
- JSON report export preserving the model shape.
- Source limitation notes and privacy disclosure.
- Skill opportunity and privacy report variants.

### Milestone 3: MCP Tools and Plugin Commands

- Local MCP server.
- `show_dashboard`, `analyze_code_logs`, `analyze_current_chat`, `import_transcript`, `record_cowork_checkpoint`, `get_coaching_report`, `recommend_improvements`, and `export_report`.
- Plugin command metadata and initial skills.

### Milestone 4: Dashboard UI

- MCP App UI rendering only from `LensDashboardModel`.
- Overview, Activity, Anti-Patterns, Context Health, AI Harness, Skills, Privacy, and Reports views.
- Clear partial data states and unsupported metric labels.

### Milestone 5: Packaging and Smoke Tests

- Plugin package.
- Local MCP server package.
- Dashboard asset bundle.
- Install documentation.
- Fixture smoke test that opens dashboard and exports reports.

## Current Foundation

The initial implementation includes the TypeScript contracts, fixture-based Claude Code parser, deterministic scoring/rules, redaction, and a sample dashboard generator. Storage, sync, and live hooks are intentionally out of scope until this pipeline works end to end.
