import type { CapabilityProfile, Source } from "./types.js";

export const CAPABILITY_PROFILES: Record<Source, CapabilityProfile> = {
  code: {
    id: "claude_code_log_v1",
    source: "code",
    supportsExactTokens: false,
    supportsEstimatedTokens: true,
    supportsToolTraces: true,
    supportsLiveEvents: false,
    supportsFilePaths: true,
    supportsArtifacts: false,
    supportsHistoricalIndexing: true
  },
  chat: {
    id: "explicit_chat_input_v1",
    source: "chat",
    supportsExactTokens: false,
    supportsEstimatedTokens: true,
    supportsToolTraces: false,
    supportsLiveEvents: false,
    supportsFilePaths: false,
    supportsArtifacts: false,
    supportsHistoricalIndexing: false
  },
  cowork: {
    id: "explicit_cowork_checkpoint_v1",
    source: "cowork",
    supportsExactTokens: false,
    supportsEstimatedTokens: true,
    supportsToolTraces: false,
    supportsLiveEvents: false,
    supportsFilePaths: false,
    supportsArtifacts: true,
    supportsHistoricalIndexing: false
  }
};

export function capabilityLimitations(source: Source): string[] {
  if (source === "code") {
    return [
      "Exact token and cost metrics are unavailable unless present in logs.",
      "Live hook telemetry is not used in this V1 analyzer.",
      "Original Claude Code logs are read-only."
    ];
  }

  if (source === "chat") {
    return [
      "Full chat history is available via claude.ai → Settings → Privacy → Export data (place the ZIP in ~/Downloads).",
      "InspectorClaude does not scrape hidden Claude app databases.",
      "Tool traces are unavailable in chat exports; prompt/response coaching still applies."
    ];
  }

  return [
    "Cowork analysis requires explicit checkpoints, summaries, or report imports.",
    "Automatic Cowork telemetry is not assumed in V1.",
    "Tool traces are unavailable unless included in user-provided summaries."
  ];
}
