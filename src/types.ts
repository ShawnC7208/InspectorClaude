export type Source = "chat" | "cowork" | "code";

export type CaptureMode =
  | "claude_code_log"
  | "claude_ai_export"
  | "current_chat_input"
  | "manual_import"
  | "checkpoint"
  | "task_summary"
  | "artifact_summary"
  | "report_import";

export type CoachingCategory =
  | "prompt_clarity"
  | "context_health"
  | "workflow_structure"
  | "ai_harness"
  | "efficiency"
  | "privacy"
  | "session_hygiene";

export type Severity = "info" | "low" | "medium" | "high";
export type ScoreStatus = "excellent" | "healthy" | "needs_attention" | "at_risk" | "unavailable";

export type RedactedEvidence = {
  id: string;
  source: Source;
  captureMode: CaptureMode;
  interactionId: string;
  eventId?: string;
  label: string;
  excerpt?: string;
};

export type CapabilityProfile = {
  id: string;
  source: Source;
  supportsExactTokens: boolean;
  supportsEstimatedTokens: boolean;
  supportsToolTraces: boolean;
  supportsLiveEvents: boolean;
  supportsFilePaths: boolean;
  supportsArtifacts: boolean;
  supportsHistoricalIndexing: boolean;
};

// Per-session token usage, summed across all assistant turns in a session.
// Only Claude Code logs carry exact usage; other sources stay estimate-only.
export type TokenUsage = {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  total: number;
  // cacheRead / (input + cacheCreation + cacheRead). High = stable, reused context.
  cacheHitRatio: number;
};

export type InteractionRecord = {
  id: string;
  source: Source;
  captureMode: CaptureMode;
  title?: string;
  projectPath?: string;
  taskId?: string;
  startedAt?: string;
  endedAt?: string;
  model?: string;
  turnCount?: number;
  toolCallCount?: number;
  estimatedTokens?: number;
  exactTokens?: number;
  tokenUsage?: TokenUsage;
  costEstimate?: number;
  capabilityProfileId: string;
  metadata?: Record<string, string | number | boolean>;
};

export type EventRecord = {
  id: string;
  interactionId: string;
  timestamp?: string;
  eventType:
    | "prompt"
    | "response"
    | "tool_call"
    | "tool_result"
    | "file_event"
    | "permission"
    | "compaction"
    | "checkpoint"
    | "imported_message";
  actor?: "user" | "assistant" | "system" | "tool";
  toolName?: string;
  status?: "ok" | "failed" | "denied" | "cancelled";
  filePaths?: string[];
  tokenEstimate?: number;
  exactTokens?: number;
  contentHash?: string;
  redactedExcerpt?: string;
  metadata?: Record<string, string | number | boolean>;
};

export type LensFinding = {
  id: string;
  category: CoachingCategory;
  title: string;
  severity: Severity;
  confidence: number;
  source: Source | "all";
  interactionIds: string[];
  captureModes: CaptureMode[];
  explanation: string;
  recommendation: string;
  evidence?: RedactedEvidence[];
  ruleId?: string;
  // Salient tokens shared across a detected cluster (repeated-work detection).
  keywords?: string[];
  // Representative redacted excerpts of the repeated work behind this finding.
  examples?: string[];
};

export type LensRule = {
  id: string;
  title: string;
  category: LensFinding["category"];
  severity: LensFinding["severity"];
  appliesTo: Source[];
  description: string;
  requiredCapabilities?: string[];
  evaluate: "implemented_in_code";
};

export type LensScore = {
  id: string;
  label: string;
  value: number;
  status: ScoreStatus;
  confidence: number;
  explanation: string;
};

export type CoachingRecommendation = {
  id: string;
  title: string;
  category: CoachingCategory;
  surface: Source | "all";
  impact: "low" | "medium" | "high";
  effort: "low" | "medium" | "high";
  confidence: number;
  explanation: string;
  nextAction: string;
  relatedFindingIds: string[];
};

export type SkillOpportunity = {
  id: string;
  suggestedName: string;
  // Primary surface for badges/reports: the single source when an opportunity
  // is confined to one, otherwise "all" when it spans several.
  surface: Source | "all";
  // Every distinct surface the underlying findings came from.
  surfaces: Source[];
  // How many findings rolled up into this opportunity (the strength signal).
  occurrenceCount: number;
  problem: string;
  evidenceSummary: string;
  draftBehavior: string;
  impact: "low" | "medium" | "high";
  relatedFindingIds: string[];
  // What kind of asset this opportunity suggests, used to pick the scaffold.
  kind: "repeated_prompt" | "preference" | "missing_instructions" | "workflow";
  // Salient shared tokens from the detected cluster (drives naming + display).
  keywords: string[];
  // Representative redacted excerpts of the repeated work, shown to the user.
  examples: string[];
  // Deterministic, paste-ready starter generated locally (option B).
  scaffold: string;
  // A complete prompt the user (or recommend_improvements) hands to Claude so
  // it can author the actual skill from this evidence (option C).
  draftPrompt: string;
};

export type CapabilityNote = {
  id: string;
  source: Source;
  capabilityProfileId: string;
  message: string;
};

export type SourceSummary = {
  source: Source;
  enabled: boolean;
  captureModes: CaptureMode[];
  interactionCount: number;
  eventCount?: number;
  dateRange?: {
    start?: string;
    end?: string;
  };
  capabilityProfileId: string;
  limitations: string[];
};

export type TokenTotals = {
  // Summed exact tokens across sessions that report usage (Claude Code).
  exactTotal: number;
  // Summed estimated tokens across sessions without exact usage.
  estimatedTotal: number;
  // How many sessions contributed exact usage (drives cold-start framing).
  sessionsWithExact: number;
  heaviestSessionId?: string;
  heaviestSessionTitle?: string;
  heaviestSessionTokens?: number;
};

export type PracticeSummary = {
  overallScore: LensScore;
  headline: string;
  topActions: string[];
  tokenTotals?: TokenTotals;
};

export type ActivityTimeline = {
  sessions: Array<{
    interactionId: string;
    source: Source;
    title?: string;
    startedAt?: string;
    endedAt?: string;
    eventCount: number;
    findingCount: number;
    // Total tokens for the session; exact for Code, estimated otherwise.
    totalTokens?: number;
    // "exact" (Code usage), "estimated" (length-based), or "none".
    tokenSource?: "exact" | "estimated" | "none";
    // cacheRead share of input — only present for exact (Code) sessions.
    cacheHitRatio?: number;
    // Flagged by the high-token-session rule as an outlier vs. the user's own sessions.
    highUsage?: boolean;
  }>;
};

export type PrivacySummary = {
  evidenceMode: "metadata_only" | "redacted_excerpts";
  cacheEnabled: boolean;
  redactionApplied: boolean;
  findingCount: number;
  exportedThisSession: boolean;
  localOnly: boolean;
  notes: string[];
};

export type HarnessSummary = {
  projectCount: number;
  scannedProjectCount: number;
  claudeMdProjects: number;
  settingsProjects: number;
  agentProjects: number;
  hookProjects: number;
  mcpConfigProjects: number;
  notes: string[];
};

export type LensDashboardModel = {
  generatedAt: string;
  timeRange?: {
    start?: string;
    end?: string;
  };
  sources: SourceSummary[];
  summary: PracticeSummary;
  scores: LensScore[];
  activity: ActivityTimeline;
  findings: LensFinding[];
  recommendations: CoachingRecommendation[];
  skillOpportunities: SkillOpportunity[];
  harness: HarnessSummary;
  privacy: PrivacySummary;
  capabilityNotes: CapabilityNote[];
};

export type NormalizedDataset = {
  interactions: InteractionRecord[];
  events: EventRecord[];
  capabilityProfiles: CapabilityProfile[];
};

export type LensReport = {
  version: string;
  generatedAt: string;
  reportType: "coaching" | "session" | "skill_opportunity" | "privacy";
  dashboardModel?: LensDashboardModel;
  summary: string;
  findings: LensFinding[];
  recommendations: CoachingRecommendation[];
  sourceLimitations: CapabilityNote[];
};
