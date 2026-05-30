---
description: Analyze local Claude Code logs with InspectorClaude.
argument-hint: [path]
allowed-tools: ["mcp__plugin_inspectorclaude_inspectorclaude__analyze_code_logs"]
---

# Analyze Claude Code Logs

Analyze Claude Code JSONL logs locally.

If the user provides a path, pass it as `projectPath`. Otherwise use the default supported Claude Code log location when available.

Keep the response concise:

- Summarize sources analyzed.
- Show the top findings and recommendations.
- Mention that original logs were read-only.
