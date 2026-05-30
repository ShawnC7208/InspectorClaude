---
description: Analyze the current chat or a pasted chat summary with InspectorClaude.
argument-hint: [optional focus]
allowed-tools: ["mcp__plugin_inspectorclaude_inspectorclaude__analyze_current_chat"]
---

# Coach This Chat

Analyze the current Claude Chat content the user explicitly provides or asks to review.

Use `analyze_current_chat` with the user-provided chat text or summary. Do not claim access to hidden Claude Chat history.

Return:

- Prompt clarity observations.
- Context health observations.
- Workflow improvements.
- One or two next actions.
