---
description: Review Claude context health and suggest when to summarize, split, or restart.
argument-hint: [source]
allowed-tools: ["mcp__plugin_inspectorclaude_inspectorclaude__show_dashboard", "mcp__plugin_inspectorclaude_inspectorclaude__get_coaching_report"]
---

# InspectorClaude Context Health

Review context-health findings from InspectorClaude.

Prefer a dashboard model from `show_dashboard`, then summarize only the context-health findings:

- long sessions
- topic shifts
- missing summaries
- compaction quality
- restart or split opportunities

Give practical next actions, not raw log details.
