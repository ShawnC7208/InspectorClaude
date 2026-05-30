# Contributing to InspectorClaude

Thanks for your interest in improving InspectorClaude! This project is local-first
and privacy-focused — contributions should preserve those principles.

## Development setup

```bash
npm install
npm run build
npm test
```

All 100+ tests should pass before you open a pull request.

## Project layout

- `src/` — TypeScript source (analyzer, rules, MCP servers, dashboard, CLI).
- `test/` — Node test runner suites (`*.test.ts`), compiled to `dist/test/`.
- `claude-plugin/` — the Claude Code plugin package (commands, skills, MCP config).
- `docs/` — user-facing docs for the CLI, dashboard, MCP server, and plugin.
- `fixtures/` — synthetic sample data used by tests and manual runs.

## Guidelines

- **Keep it local-first.** No telemetry, no network calls to external services,
  no reading of Claude app databases or hidden chat history.
- **Redact sensitive data.** Anything that flows into findings or reports must go
  through the redaction logic in `src/redaction.ts`. Never commit real secrets,
  tokens, personal paths, or machine-specific config.
- **Prefer deterministic rules.** Coaching rules in `src/rules.ts` should be
  explainable and testable. Add a test in `test/` for every new rule or fix.
- **Match the surrounding code style.** No new lint/formatter config is required —
  follow the conventions already in the file you're editing.

## Pull requests

1. Branch from `main`.
2. Add or update tests covering your change.
3. Run `npm test` and make sure the build is clean.
4. Describe the behavior change and any new coaching rules in the PR description.

## Reporting issues

Open a GitHub issue with steps to reproduce. Please **do not** paste real session
logs, secrets, or personal file paths — use redacted or synthetic examples.
