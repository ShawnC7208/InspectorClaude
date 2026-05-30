---
description: Record a Claude Cowork task checkpoint for InspectorClaude coaching.
argument-hint: <task-id> <phase> <summary>
allowed-tools: ["mcp__plugin_inspectorclaude_inspectorclaude__record_cowork_checkpoint"]
---

# Record Cowork Checkpoint

Turn an explicit Cowork task update into a InspectorClaude checkpoint.

Ask for any missing required values:

- task id
- phase: intake, planning, implementation, review, handoff, or done
- summary

Then call `record_cowork_checkpoint`.

Focus the result on done criteria, handoff quality, and next review step.
