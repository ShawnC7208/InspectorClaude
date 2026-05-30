import { CAPABILITY_PROFILES } from "../capabilities.js";
import { excerpt, stableHash } from "../redaction.js";
import type { CaptureMode, EventRecord, InteractionRecord, NormalizedDataset, Source } from "../types.js";

export type AnalyzeCurrentChatInput = {
  title?: string;
  messagesOrSummary: string;
};

export type ImportTranscriptInput = {
  source: Source;
  title?: string;
  transcriptOrSummary: string;
  captureMode?: CaptureMode;
};

export type CoworkCheckpointInput = {
  taskId: string;
  phase: "intake" | "planning" | "implementation" | "review" | "handoff" | "done";
  summary: string;
  artifacts?: string[];
  metrics?: Record<string, string | number | boolean>;
  timestamp?: string;
};

export function analyzeCurrentChatInput(input: AnalyzeCurrentChatInput): NormalizedDataset {
  return explicitTextDataset({
    source: "chat",
    captureMode: "current_chat_input",
    title: input.title ?? "Current Claude Chat",
    text: input.messagesOrSummary,
    eventType: "prompt"
  });
}

export function importTranscriptInput(input: ImportTranscriptInput): NormalizedDataset {
  const captureMode = input.captureMode ?? defaultImportCaptureMode(input.source);
  if (input.source === "chat") {
    const turns = parseChatTurns(input.transcriptOrSummary);
    if (turns.length > 0) {
      return chatTranscriptDataset({
        title: input.title ?? defaultTitle(input.source),
        captureMode,
        turns
      });
    }
  }

  return explicitTextDataset({
    source: input.source,
    captureMode,
    title: input.title ?? defaultTitle(input.source),
    text: input.transcriptOrSummary,
    eventType: input.source === "chat" ? "imported_message" : undefined
  });
}

export function recordCoworkCheckpointInput(input: CoworkCheckpointInput): NormalizedDataset {
  const text = [
    `Phase: ${input.phase}`,
    `Summary: ${input.summary}`,
    input.artifacts?.length ? `Artifacts: ${input.artifacts.join(", ")}` : "",
    input.metrics ? `Metrics: ${JSON.stringify(input.metrics)}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  const interactionId = `cowork-${stableHash(`${input.taskId}:${text}`)}`;
  const event: EventRecord = {
    id: `${interactionId}-checkpoint-1`,
    interactionId,
    timestamp: input.timestamp,
    eventType: "checkpoint",
    actor: "user",
    tokenEstimate: estimateTokens(text),
    contentHash: stableHash(text),
    redactedExcerpt: excerpt(text)
  };

  const interaction: InteractionRecord = {
    id: interactionId,
    source: "cowork",
    captureMode: "checkpoint",
    title: `Cowork checkpoint: ${input.taskId}`,
    taskId: input.taskId,
    startedAt: input.timestamp,
    endedAt: input.timestamp,
    turnCount: 1,
    estimatedTokens: event.tokenEstimate,
    capabilityProfileId: CAPABILITY_PROFILES.cowork.id
  };

  return {
    interactions: [interaction],
    events: [event],
    capabilityProfiles: [CAPABILITY_PROFILES.cowork]
  };
}

function explicitTextDataset(input: {
  source: Source;
  captureMode: CaptureMode;
  title: string;
  text: string;
  eventType?: EventRecord["eventType"];
}): NormalizedDataset {
  const interactionId = `${input.source}-${stableHash(`${input.captureMode}:${input.title}:${input.text}`)}`;
  const event: EventRecord = {
    id: `${interactionId}-import-1`,
    interactionId,
    eventType: input.eventType ?? (input.source === "cowork" ? "checkpoint" : "imported_message"),
    actor: "user",
    tokenEstimate: estimateTokens(input.text),
    contentHash: stableHash(input.text),
    redactedExcerpt: excerpt(input.text)
  };

  const interaction: InteractionRecord = {
    id: interactionId,
    source: input.source,
    captureMode: input.captureMode,
    title: input.title,
    turnCount: 1,
    estimatedTokens: event.tokenEstimate,
    capabilityProfileId: CAPABILITY_PROFILES[input.source].id
  };

  return {
    interactions: [interaction],
    events: [event],
    capabilityProfiles: [CAPABILITY_PROFILES[input.source]]
  };
}

function chatTranscriptDataset(input: {
  title: string;
  captureMode: CaptureMode;
  turns: Array<{ actor: "user" | "assistant"; text: string }>;
}): NormalizedDataset {
  const text = input.turns.map((turn) => `${turn.actor}: ${turn.text}`).join("\n");
  const interactionId = `chat-${stableHash(`${input.captureMode}:${input.title}:${text}`)}`;
  const events: EventRecord[] = input.turns.map((turn, index) => ({
    id: `${interactionId}-turn-${index + 1}`,
    interactionId,
    eventType: turn.actor === "user" ? "prompt" : "response",
    actor: turn.actor,
    tokenEstimate: estimateTokens(turn.text),
    contentHash: stableHash(turn.text),
    redactedExcerpt: excerpt(turn.text)
  }));

  const interaction: InteractionRecord = {
    id: interactionId,
    source: "chat",
    captureMode: input.captureMode,
    title: input.title,
    turnCount: events.length,
    estimatedTokens: events.reduce((sum, event) => sum + (event.tokenEstimate ?? 0), 0),
    capabilityProfileId: CAPABILITY_PROFILES.chat.id
  };

  return {
    interactions: [interaction],
    events,
    capabilityProfiles: [CAPABILITY_PROFILES.chat]
  };
}

function parseChatTurns(text: string): Array<{ actor: "user" | "assistant"; text: string }> {
  const turns: Array<{ actor: "user" | "assistant"; text: string }> = [];
  let current: { actor: "user" | "assistant"; text: string } | undefined;

  for (const line of text.split(/\r?\n/)) {
    const userMatch = line.match(/^\s*(?:user|human)\s*:\s*(.*)$/i);
    const assistantMatch = line.match(/^\s*(?:assistant|claude)\s*:\s*(.*)$/i);
    if (userMatch || assistantMatch) {
      if (current && current.text.trim()) turns.push({ ...current, text: current.text.trim() });
      current = {
        actor: userMatch ? "user" : "assistant",
        text: (userMatch?.[1] ?? assistantMatch?.[1] ?? "").trim()
      };
      continue;
    }
    if (current) {
      current.text = `${current.text}\n${line}`.trim();
    }
  }

  if (current && current.text.trim()) turns.push({ ...current, text: current.text.trim() });
  return turns;
}

function defaultImportCaptureMode(source: Source): CaptureMode {
  if (source === "cowork") return "task_summary";
  if (source === "code") return "manual_import";
  return "manual_import";
}

function defaultTitle(source: Source): string {
  if (source === "chat") return "Claude Chat import";
  if (source === "cowork") return "Claude Cowork summary";
  return "Claude Code import";
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4) || 0;
}
