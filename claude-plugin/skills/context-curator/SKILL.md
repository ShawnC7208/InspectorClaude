---
name: context-curator
description: Use this skill when the user asks about InspectorClaude context health, long sessions, summaries, restarts, compactions, topic drift, or keeping Claude conversations focused and resumable.
version: 0.1.0
---

# Context Curator

Help users keep Claude conversations focused, resumable, and easy to steer.

## Signals To Watch

- Long sessions without summaries.
- Topic shifts without checkpoints.
- Repeated re-explanation.
- Compaction without durable state.
- Unclear next steps after implementation or review.

## Coaching Moves

- Ask for a state summary: goal, decisions, open questions, changed files, and next step.
- Split unrelated work into a new conversation.
- Restart when the session is overloaded or the task changed substantially.
- Use short checkpoints before handoff.

## Summary Template

```text
Summarize the current state:
- Goal
- Decisions made
- Current artifacts or files
- Open questions
- Risks
- Next step
```
