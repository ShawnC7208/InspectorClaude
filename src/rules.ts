import { hasSensitiveSignal } from "./redaction.js";
import type { CaptureMode, EventRecord, LensFinding, LensRule, NormalizedDataset, Source } from "./types.js";

export const RULES: LensRule[] = [
  rule("prompt.vague_initial", "Vague initial prompt", "prompt_clarity", "medium", ["chat", "cowork", "code"]),
  rule("prompt.repeated_corrections", "Repeated user corrections", "prompt_clarity", "medium", ["chat", "cowork", "code"]),
  rule("context.long_without_summary", "Long session without summary", "context_health", "medium", ["chat", "cowork", "code"]),
  rule("context.topic_shift_without_summary", "Topic shift without summary", "context_health", "medium", ["chat", "cowork", "code"]),
  rule("context.compaction_without_summary", "Compaction without durable summary", "context_health", "medium", ["code"]),
  rule("workflow.edits_without_verification", "Code edits without verification", "workflow_structure", "medium", ["code"]),
  rule("workflow.cowork_missing_done_criteria", "Cowork checkpoint missing done criteria", "workflow_structure", "medium", ["cowork"]),
  rule("harness.missing_project_instructions", "Missing project instructions", "ai_harness", "low", ["code"]),
  rule("harness.missing_project_harness_assets", "Missing project harness assets", "ai_harness", "low", ["code"]),
  rule("harness.repeated_prompt_pattern", "Repeated pattern could become a skill", "ai_harness", "low", ["chat", "cowork", "code"]),
  rule("harness.project_instruction_opportunity", "Project instruction opportunity", "ai_harness", "low", ["chat", "cowork", "code"]),
  rule("efficiency.repeated_tool_failure", "Repeated tool failure loop", "efficiency", "high", ["code"]),
  rule("efficiency.repeated_file_reads", "Repeated file reads", "efficiency", "medium", ["code"]),
  rule("efficiency.repeated_broad_search", "Repeated broad search", "efficiency", "medium", ["code"]),
  rule("efficiency.duplicate_tool_output", "Duplicate tool output", "efficiency", "medium", ["code"]),
  rule("privacy.permission_denied", "Permission denied during session", "privacy", "medium", ["code"]),
  rule("privacy.sensitive_signal", "Possible sensitive information", "privacy", "high", ["chat", "cowork", "code"]),
  rule("session_hygiene.mega_session", "Very long session", "session_hygiene", "low", ["code", "chat", "cowork"]),
  rule("session_hygiene.frustration_signals", "Frustration signals in prompts", "session_hygiene", "medium", ["code", "chat", "cowork"]),
  rule("session_hygiene.speed_accept", "Responses accepted without review window", "session_hygiene", "medium", ["code"]),
  rule("efficiency.runaway_agent_loops", "High tool usage with repeated failures", "efficiency", "high", ["code"]),
  rule("efficiency.mcp_tool_bloat", "Excessive number of distinct tools in session", "efficiency", "low", ["code"]),
  rule("harness.instruction_bloat", "CLAUDE.md too large — inflates every request", "ai_harness", "medium", ["code"])
];

export function evaluateRules(dataset: NormalizedDataset): LensFinding[] {
  const findings: LensFinding[] = [];
  findings.push(...detectVagueInitialPrompt(dataset));
  findings.push(...detectRepeatedCorrections(dataset));
  findings.push(...detectLongSessionWithoutSummary(dataset));
  findings.push(...detectTopicShiftWithoutSummary(dataset));
  findings.push(...detectCompactionWithoutSummary(dataset));
  findings.push(...detectEditsWithoutVerification(dataset));
  findings.push(...detectCoworkMissingDoneCriteria(dataset));
  findings.push(...detectProjectHarnessInventory(dataset));
  findings.push(...detectRepeatedPromptPattern(dataset));
  findings.push(...detectProjectInstructionOpportunities(dataset));
  findings.push(...detectRepeatedToolFailures(dataset));
  findings.push(...detectRepeatedFileReads(dataset));
  findings.push(...detectRepeatedBroadSearches(dataset));
  findings.push(...detectDuplicateToolOutput(dataset));
  findings.push(...detectPermissionDenials(dataset));
  findings.push(...detectSensitiveSignals(dataset));
  findings.push(...detectMegaSessions(dataset));
  findings.push(...detectFrustrationSignals(dataset));
  findings.push(...detectSpeedAccept(dataset));
  findings.push(...detectRunawayAgentLoops(dataset));
  findings.push(...detectMcpToolBloat(dataset));
  findings.push(...detectInstructionBloat(dataset));
  return findings;
}

function detectProjectHarnessInventory(dataset: NormalizedDataset): LensFinding[] {
  const codeProjects = new Map<string, (typeof dataset.interactions)[number]>();
  for (const interaction of dataset.interactions) {
    if (interaction.source === "code" && interaction.projectPath && interaction.metadata?.harnessScanAvailable === true) {
      codeProjects.set(interaction.projectPath, interaction);
    }
  }

  return [...codeProjects.values()].flatMap((interaction) => {
    const findings: LensFinding[] = [];
    if (interaction.metadata?.hasClaudeMd !== true) {
      findings.push(
        finding({
          id: "harness.missing_project_instructions",
          source: "code",
          interactionIds: [interaction.id],
          title: "Project does not appear to have Claude instructions",
          explanation: "InspectorClaude scanned the local project root from the Code log and did not find a `CLAUDE.md` file.",
          recommendation: "Add a `CLAUDE.md` with project goals, conventions, verification commands, and review standards.",
          captureModes: [interaction.captureMode]
        })
      );
    }

    const hasAnyAdvancedAsset =
      interaction.metadata?.hasClaudeAgents === true || interaction.metadata?.hasClaudeHooks === true || interaction.metadata?.hasMcpConfig === true;
    if (!hasAnyAdvancedAsset) {
      findings.push(
        finding({
          id: "harness.missing_project_harness_assets",
          source: "code",
          interactionIds: [interaction.id],
          title: "Project has no detected hooks, agents, or MCP config",
          explanation: "The project root was readable, but Lens did not detect local Claude agents, hooks, or MCP connector configuration.",
          recommendation: "For repeated work, consider adding a small hook, project agent, or MCP config after the workflow is stable enough to reuse.",
          captureModes: [interaction.captureMode]
        })
      );
    }

    return findings;
  });
}

function detectVagueInitialPrompt(dataset: NormalizedDataset): LensFinding[] {
  return dataset.interactions.flatMap((interaction) => {
    const events = byInteraction(dataset.events, interaction.id);
    const firstPrompt = events.find((event) => event.eventType === "prompt");
    const text = firstPrompt?.redactedExcerpt?.toLowerCase() ?? "";
    if (!firstPrompt || text.length === 0 || text.length > 180) return [];

    const hasOutputCue = /\b(format|table|json|bullets|draft|report|plan|list|summary)\b/.test(text);
    const hasConstraintCue = /\b(audience|tone|constraints?|deadline|criteria|must|avoid|include)\b/.test(text);
    const vagueCue = /\b(help|improve|fix|analyze|review|make|build)\b/.test(text);
    if (!vagueCue || hasOutputCue || hasConstraintCue) return [];

    return [
      finding({
        id: "prompt.vague_initial",
        source: interaction.source,
        interactionIds: [interaction.id],
        title: "Initial request may be underspecified",
        explanation: "The first request appears broad and does not clearly name output format, constraints, audience, or review criteria.",
        recommendation: "Start important prompts with the goal, relevant context, desired output format, and how you will judge success.",
        captureModes: [interaction.captureMode],
        evidenceEvent: firstPrompt,
        evidenceEvents: events
      })
    ];
  });
}

function detectLongSessionWithoutSummary(dataset: NormalizedDataset): LensFinding[] {
  return dataset.interactions.flatMap((interaction) => {
    const events = byInteraction(dataset.events, interaction.id);
    const hasSummary = events.some((event) => event.eventType === "compaction" || /summary|summarize|checkpoint/i.test(event.redactedExcerpt ?? ""));
    if (events.length < 12 || hasSummary) return [];

    return [
      finding({
        id: "context.long_without_summary",
        source: interaction.source,
        interactionIds: [interaction.id],
        title: "Long session without a durable summary",
        explanation: "This session has enough activity that context can become harder to steer, but no summary or checkpoint signal was found.",
        recommendation: "Pause long sessions to ask for a short state summary, decisions made, open questions, and next step.",
        captureModes: [interaction.captureMode],
        evidenceEvent: events.at(-1),
        evidenceEvents: events
      })
    ];
  });
}

function detectRepeatedCorrections(dataset: NormalizedDataset): LensFinding[] {
  return dataset.interactions.flatMap((interaction) => {
    const events = byInteraction(dataset.events, interaction.id);
    const prompts = events.filter((event) => event.eventType === "prompt");
    const corrections = prompts.filter((event) =>
      /\b(not what i meant|actually|instead|you misunderstood|that's wrong|try again|correction|revise)\b/i.test(event.redactedExcerpt ?? "")
    );
    if (corrections.length < 2) return [];

    return [
      finding({
        id: "prompt.repeated_corrections",
        source: interaction.source,
        interactionIds: [interaction.id],
        title: "Repeated corrections suggest the brief needed more framing",
        explanation: "The user had to correct Claude more than once, which can signal that the initial goal, constraints, or preferred output were not clear enough.",
        recommendation: "When a session needs repeated corrections, pause and restate the goal, constraints, examples, and what should change next.",
        captureModes: [interaction.captureMode],
        evidenceEvent: corrections[0],
        evidenceEvents: events
      })
    ];
  });
}

function detectTopicShiftWithoutSummary(dataset: NormalizedDataset): LensFinding[] {
  return dataset.interactions.flatMap((interaction) => {
    const events = byInteraction(dataset.events, interaction.id);
    const prompts = events.filter((event) => event.eventType === "prompt");
    const shift = prompts.find((event) => /\b(new topic|separate question|also can you|switch gears|different task|unrelated)\b/i.test(event.redactedExcerpt ?? ""));
    const hasSummaryNearby = prompts.some((event) => /\b(summary|summarize|checkpoint|where we are)\b/i.test(event.redactedExcerpt ?? ""));
    if (!shift || hasSummaryNearby) return [];

    return [
      finding({
        id: "context.topic_shift_without_summary",
        source: interaction.source,
        interactionIds: [interaction.id],
        title: "Topic shift without a checkpoint",
        explanation: "A new or different task appears in the same interaction without a summary or checkpoint first.",
        recommendation: "Before switching tasks, ask for a quick summary of decisions, open items, and next steps so the old context does not blur the new request.",
        captureModes: [interaction.captureMode],
        evidenceEvent: shift,
        evidenceEvents: events
      })
    ];
  });
}

function detectCompactionWithoutSummary(dataset: NormalizedDataset): LensFinding[] {
  return dataset.interactions.flatMap((interaction) => {
    if (interaction.source !== "code") return [];
    const events = byInteraction(dataset.events, interaction.id);
    const compactions = events.filter((event) => event.eventType === "compaction");
    const weakCompaction = compactions.find((event) => event.metadata?.hasDurableSummary !== true);
    if (!weakCompaction) return [];

    return [
      finding({
        id: "context.compaction_without_summary",
        source: "code",
        interactionIds: [interaction.id],
        title: "Compaction did not include a durable state summary",
        explanation: "A compaction signal was found, but it did not appear to preserve decisions, open questions, and next steps.",
        recommendation: "After compaction, ask Claude to restate the working state: goal, changed files, decisions, open risks, and next action.",
        captureModes: [interaction.captureMode],
        evidenceEvent: weakCompaction,
        evidenceEvents: events
      })
    ];
  });
}

function detectEditsWithoutVerification(dataset: NormalizedDataset): LensFinding[] {
  return dataset.interactions.flatMap((interaction) => {
    if (interaction.source !== "code") return [];
    const events = byInteraction(dataset.events, interaction.id);
    const edited = events.some((event) => ["Edit", "Write", "MultiEdit"].includes(event.toolName ?? ""));
    const verified = events.some((event) => event.toolName === "Bash" && /\b(test|lint|typecheck|tsc|npm run|pnpm|yarn|pytest|cargo test)\b/i.test(event.redactedExcerpt ?? ""));
    if (!edited || verified) return [];

    return [
      finding({
        id: "workflow.edits_without_verification",
        source: "code",
        interactionIds: [interaction.id],
        title: "Edits were made without a verification step",
        explanation: "Claude Code appears to have changed files, but the session does not show a test, lint, typecheck, or inspection command afterward.",
        recommendation: "After implementation work, ask Claude to run the smallest meaningful verification and explain any remaining risk.",
        captureModes: [interaction.captureMode],
        evidenceEvent: events.find((event) => ["Edit", "Write", "MultiEdit"].includes(event.toolName ?? "")),
        evidenceEvents: events
      })
    ];
  });
}

function detectRepeatedPromptPattern(dataset: NormalizedDataset): LensFinding[] {
  const prompts = dataset.events.filter((event) => event.eventType === "prompt" && event.redactedExcerpt);
  const clusters = clusterBySimilarity(prompts);
  if (clusters.length === 0) return [];
  const interactionsById = new Map(dataset.interactions.map((interaction) => [interaction.id, interaction]));

  return clusters.map((cluster) => {
    const events = cluster.events;
    const source = interactionsById.get(events[0].interactionId)?.source ?? "code";
    const captureModes = [
      ...new Set(events.map((event) => interactionsById.get(event.interactionId)?.captureMode).filter(Boolean) as CaptureMode[])
    ];
    return finding({
      id: "harness.repeated_prompt_pattern",
      source,
      interactionIds: [...new Set(events.map((event) => event.interactionId))],
      title: "Repeated request pattern could become a reusable skill",
      explanation: `A similar instruction appears ${events.length} times. Stable repeat work is a good candidate for a Claude skill or project instruction.`,
      recommendation: "Turn the repeated instruction into a short reusable skill or project instruction so future sessions start with the right behavior.",
      captureModes,
      evidenceEvent: events[0],
      evidenceEvents: events,
      keywords: cluster.keywords,
      examples: cluster.examples
    });
  });
}

type PromptCluster = { events: EventRecord[]; keywords: string[]; examples: string[] };

const PROMPT_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "to", "of", "in", "is", "it", "this", "that", "for", "please",
  "can", "you", "i", "we", "my", "me", "with", "on", "be", "do", "get", "so", "as", "at", "if",
  "then", "into", "from", "your", "our", "are", "was", "will", "should", "would", "have", "has",
  // Conversational filler — common in chat turns but never a reusable workflow.
  "yes", "yea", "yeah", "yep", "nope", "ok", "okay", "sure", "thanks", "thank", "lets", "let",
  "like", "just", "also", "more", "most", "what", "about", "think", "see", "look", "want", "need",
  "could", "maybe", "really", "very", "much", "some", "any", "thing", "things", "stuff", "one",
  "ones", "those", "these", "them", "now", "here", "there", "why", "how", "when", "where", "who",
  "which", "dont", "don", "cant", "wont", "well", "good", "great", "nice", "cool", "sounds", "sound",
  "hmm", "let's", "no", "not", "but", "out", "all", "too", "way", "make", "made"
]);

/** Patterns that mark text as injected harness/system content, not a user request. */
const SYSTEM_NOISE = /(local-command-(stdout|stderr|caveat)|command-(name|message|args)|task-notification|system-reminder|scheduled-task|this session is being continued|base directory for this skill|<\/?[a-z][a-z0-9-]*(\s[^>]*)?\/?>)/i;

const MIN_PROMPT_TOKENS = 3;

/** True only for substantive, user-authored prompts worth clustering. */
function isClusterablePrompt(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 15) return false; // too terse to be a workflow
  if (/(https?:\/\/|www\.)/i.test(trimmed)) return false; // pasted links are one-offs
  if (SYSTEM_NOISE.test(trimmed)) return false; // injected command/system wrappers
  return true;
}

/** Salient word set for a prompt: lowercased, de-punctuated, stopwords removed. */
function promptTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !PROMPT_STOPWORDS.has(token))
  );
}

function jaccard(a: Set<string>, b: Set<string>): { score: number; shared: number } {
  if (a.size === 0 || b.size === 0) return { score: 0, shared: 0 };
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  const union = a.size + b.size - shared;
  return { score: union === 0 ? 0 : shared / union, shared };
}

/**
 * Greedily group prompts that look like the same recurring request. Exact
 * wording rarely repeats, so we cluster by token-set overlap (Jaccard) rather
 * than string equality, and keep only clusters seen at least twice.
 */
function clusterBySimilarity(events: EventRecord[]): PromptCluster[] {
  type WorkingCluster = { events: EventRecord[]; tokenSets: Set<string>[]; seed: Set<string> };
  const working: WorkingCluster[] = [];

  for (const event of events) {
    const text = event.redactedExcerpt ?? "";
    if (!isClusterablePrompt(text)) continue;
    const tokens = promptTokens(text);
    if (tokens.size < MIN_PROMPT_TOKENS) continue; // too thin to match meaningfully
    let placed = false;
    for (const cluster of working) {
      const { score, shared } = jaccard(tokens, cluster.seed);
      // Treat as the same workflow only with substantial overlap: at least three
      // shared salient tokens and reasonably similar token sets. Precision over
      // recall — a noisy skills tab is worse than a sparse one.
      if (shared >= 3 && score >= 0.4) {
        cluster.events.push(event);
        cluster.tokenSets.push(tokens);
        placed = true;
        break;
      }
    }
    if (!placed) working.push({ events: [event], tokenSets: [tokens], seed: tokens });
  }

  return working
    .filter((cluster) => cluster.events.length >= 2)
    .map((cluster) => ({
      events: cluster.events,
      keywords: topSharedTokens(cluster.tokenSets, 4),
      examples: dedupeExamples(cluster.events, 3)
    }));
}

/** Tokens shared by at least two cluster members, most frequent first. */
function topSharedTokens(tokenSets: Set<string>[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const set of tokenSets) for (const token of set) counts.set(token, (counts.get(token) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token]) => token);
}

/** Up to `limit` distinct representative excerpts from a cluster. */
function dedupeExamples(events: EventRecord[], limit: number): string[] {
  const seen = new Set<string>();
  const examples: string[] = [];
  for (const event of events) {
    const text = (event.redactedExcerpt ?? "").trim();
    if (!text) continue;
    const key = normalizePrompt(text);
    if (seen.has(key)) continue;
    seen.add(key);
    examples.push(text.length > 200 ? text.slice(0, 200) + "…" : text);
    if (examples.length >= limit) break;
  }
  return examples;
}

function detectProjectInstructionOpportunities(dataset: NormalizedDataset): LensFinding[] {
  const preferencePrompts = dataset.events.filter(
    (event) =>
      event.eventType === "prompt" &&
      /\b(always|prefer|please use|format|tone|style|when you|make sure|remember to)\b/i.test(event.redactedExcerpt ?? "")
  );
  const clusters = clusterBySimilarity(preferencePrompts);
  if (clusters.length === 0) return [];
  const interactionsById = new Map(dataset.interactions.map((interaction) => [interaction.id, interaction]));

  return clusters.map((cluster) => {
    const events = cluster.events;
    const firstInteraction = interactionsById.get(events[0].interactionId);
    const captureModes = [...new Set(events.map((event) => interactionsById.get(event.interactionId)?.captureMode).filter(Boolean) as CaptureMode[])];
    return finding({
      id: "harness.project_instruction_opportunity",
      source: firstInteraction?.source ?? "code",
      interactionIds: [...new Set(events.map((event) => event.interactionId))],
      title: "Repeated preference may belong in project instructions",
      explanation: `A stable preference appears ${events.length} times. Repeating it manually can be replaced with project instructions or a reusable context packet.`,
      recommendation: "Move stable preferences into project instructions: tone, formatting rules, review standards, and recurring constraints.",
      captureModes,
      evidenceEvent: events[0],
      evidenceEvents: events,
      keywords: cluster.keywords,
      examples: cluster.examples
    });
  });
}

function detectCoworkMissingDoneCriteria(dataset: NormalizedDataset): LensFinding[] {
  return dataset.interactions.flatMap((interaction) => {
    if (interaction.source !== "cowork") return [];
    const events = byInteraction(dataset.events, interaction.id);
    const text = events.map((event) => event.redactedExcerpt ?? "").join(" ").toLowerCase();
    const hasCheckpoint = interaction.captureMode === "checkpoint" || events.some((event) => event.eventType === "checkpoint");
    const hasDoneCriteria = /\b(done|acceptance criteria|review criteria|success looks like|handoff|deliverable|expected output)\b/.test(text);
    if (!hasCheckpoint || hasDoneCriteria) return [];

    return [
      finding({
        id: "workflow.cowork_missing_done_criteria",
        source: "cowork",
        interactionIds: [interaction.id],
        title: "Cowork checkpoint does not define done criteria",
        explanation: "This Cowork checkpoint has a task update, but it does not clearly state how the work should be reviewed or considered complete.",
        recommendation: "Add a short done checklist to Cowork tasks: expected output, constraints, review method, and handoff state.",
        captureModes: [interaction.captureMode],
        evidenceEvent: events[0],
        evidenceEvents: events
      })
    ];
  });
}

function detectRepeatedToolFailures(dataset: NormalizedDataset): LensFinding[] {
  return dataset.interactions.flatMap((interaction) => {
    const events = byInteraction(dataset.events, interaction.id);
    const failuresByTool = groupBy(
      events.filter((event) => event.eventType === "tool_result" && event.status === "failed"),
      (event) => event.toolName ?? "tool"
    );
    const repeated = [...failuresByTool.entries()].find(([, items]) => items.length >= 2);
    if (!repeated) return [];

    return [
      finding({
        id: "efficiency.repeated_tool_failure",
        source: interaction.source,
        interactionIds: [interaction.id],
        title: "Repeated failed tool attempts",
        explanation: `The session includes repeated failed ${repeated[0]} result(s), which can burn time and context without adding useful signal.`,
        recommendation: "When a tool fails twice, pause to inspect the error, narrow the command, or choose a different route.",
        captureModes: [interaction.captureMode],
        evidenceEvent: repeated[1][0],
        evidenceEvents: events
      })
    ];
  });
}

function detectRepeatedFileReads(dataset: NormalizedDataset): LensFinding[] {
  return dataset.interactions.flatMap((interaction) => {
    const events = byInteraction(dataset.events, interaction.id);
    const reads = events.filter((event) => event.toolName === "Read" && event.filePaths?.length);
    const byPath = groupBy(reads.flatMap((event) => (event.filePaths ?? []).map((path) => ({ event, path }))), (item) => item.path);
    const repeated = [...byPath.entries()].find(([, values]) => values.length >= 2);
    if (!repeated) return [];

    return [
      finding({
        id: "efficiency.repeated_file_reads",
        source: interaction.source,
        interactionIds: [interaction.id],
        title: "Same file was read repeatedly",
        explanation: "Repeated reads of the same file can signal lost context or inefficient navigation.",
        recommendation: "Ask Claude to keep a short working note of important file facts before rereading the same file again.",
        captureModes: [interaction.captureMode],
        evidenceEvent: repeated[1][0].event,
        evidenceEvents: events
      })
    ];
  });
}

function detectRepeatedBroadSearches(dataset: NormalizedDataset): LensFinding[] {
  return dataset.interactions.flatMap((interaction) => {
    if (interaction.source !== "code") return [];
    const events = byInteraction(dataset.events, interaction.id);
    const broadSearches = events.filter((event) => {
      if (event.toolName !== "Grep" && event.toolName !== "Glob" && event.toolName !== "Bash") return false;
      const text = event.redactedExcerpt ?? "";
      return /\b(rg|grep|find)\b/i.test(text) || /"\*\*\/\*"|"\*"|'\\*'|\.\/\*\*/.test(text);
    });
    if (broadSearches.length < 3) return [];

    return [
      finding({
        id: "efficiency.repeated_broad_search",
        source: "code",
        interactionIds: [interaction.id],
        title: "Repeated broad searches",
        explanation: "The session repeatedly searched broadly, which can add noise and consume context before narrowing the task.",
        recommendation: "After one broad search, narrow by folder, filename, symbol, or a known phrase before searching again.",
        captureModes: [interaction.captureMode],
        evidenceEvent: broadSearches[0],
        evidenceEvents: events
      })
    ];
  });
}

function detectDuplicateToolOutput(dataset: NormalizedDataset): LensFinding[] {
  return dataset.interactions.flatMap((interaction) => {
    if (interaction.source !== "code") return [];
    const events = byInteraction(dataset.events, interaction.id);
    const toolResults = events.filter((event) => event.eventType === "tool_result" && event.contentHash);
    const duplicate = [...groupBy(toolResults, (event) => event.contentHash ?? "").values()].find((items) => items.length >= 2);
    if (!duplicate) return [];

    return [
      finding({
        id: "efficiency.duplicate_tool_output",
        source: "code",
        interactionIds: [interaction.id],
        title: "Duplicate tool output was read more than once",
        explanation: "The same tool output appeared multiple times, which can waste context without adding new information.",
        recommendation: "When output repeats, summarize the useful facts once and move on instead of rereading the same result.",
        captureModes: [interaction.captureMode],
        evidenceEvent: duplicate[0],
        evidenceEvents: events
      })
    ];
  });
}

function detectPermissionDenials(dataset: NormalizedDataset): LensFinding[] {
  return dataset.interactions.flatMap((interaction) => {
    const events = byInteraction(dataset.events, interaction.id);
    const denied = events.filter((event) => event.eventType === "permission" && event.status === "denied");
    if (denied.length === 0) return [];

    return [
      finding({
        id: "privacy.permission_denied",
        source: interaction.source,
        interactionIds: [interaction.id],
        title: "Permission was denied during the session",
        explanation: "A permission denial appeared in the analyzed session. This can be a useful privacy boundary or a sign that the task needs a safer route.",
        recommendation: "When Claude asks for sensitive access, prefer a narrower file, redacted excerpt, or explicit explanation of why access is needed.",
        captureModes: [interaction.captureMode],
        evidenceEvent: denied[0],
        evidenceEvents: events
      })
    ];
  });
}

// Tags that represent real secrets — distinct from [REDACTED_LOCAL_PATH] which is
// ubiquitous in Claude Code sessions and should not tank the privacy score.
const TRUE_SECRET_TAGS = ["[REDACTED_PRIVATE_KEY]", "[REDACTED_SECRET]", "[REDACTED_TOKEN]", "[REDACTED_EMAIL]", "[REDACTED_PRIVATE_URL]"];

function detectSensitiveSignals(dataset: NormalizedDataset): LensFinding[] {
  const sensitiveEvents = dataset.events.filter((event) => {
    const excerpt = event.redactedExcerpt ?? "";
    // A real secret appeared anywhere in this event's content.
    if (TRUE_SECRET_TAGS.some((tag) => excerpt.includes(tag))) return true;
    // Local paths are normal in tool calls/results (Read, Edit, Bash, etc.).
    // Only flag them when they appear in user prompts or Claude responses —
    // that signals actual sensitive path disclosure, not routine file work.
    if (excerpt.includes("[REDACTED_LOCAL_PATH]")) {
      return event.eventType === "prompt" || event.eventType === "response";
    }
    return false;
  });
  const interactionsById = new Map(dataset.interactions.map((interaction) => [interaction.id, interaction]));
  const byInteraction = groupBy(sensitiveEvents, (event) => event.interactionId);
  return [...byInteraction.entries()].slice(0, 5).map(([interactionId, events], index) =>
    finding({
      id: `privacy.sensitive_signal.${index + 1}`,
      source: interactionsById.get(interactionId)?.source ?? "code",
      interactionIds: [interactionId],
      title: "Possible sensitive information was present",
      explanation: `InspectorClaude detected ${events.length} secret-like value, private path, email, private URL, or similar sensitive signal(s) in analyzed metadata or excerpts.`,
      recommendation: "Keep reports metadata-only when possible, review `.env` and secret exposure, and avoid pasting credentials into Claude sessions.",
      captureModes: [interactionsById.get(interactionId)?.captureMode ?? "claude_code_log"],
      evidenceEvent: events.find((event) => event.redactedExcerpt?.includes("[REDACTED_")) ?? events[0]
    })
  );
}

// ---------------------------------------------------------------------------
// Session Hygiene detectors
// ---------------------------------------------------------------------------

function detectMegaSessions(dataset: NormalizedDataset): LensFinding[] {
  const PROMPT_THRESHOLD = 20;
  return dataset.interactions.flatMap((interaction) => {
    const events = byInteraction(dataset.events, interaction.id);
    const promptCount = events.filter((event) => event.eventType === "prompt").length;
    if (promptCount < PROMPT_THRESHOLD) return [];

    return [
      finding({
        id: "session_hygiene.mega_session",
        source: interaction.source,
        interactionIds: [interaction.id],
        title: "Very long session may dilute Claude's context",
        explanation: `This session contains ${promptCount} user turns. Extended sessions increase the chance that early decisions and constraints lose influence over later responses.`,
        recommendation: "Break long sessions into focused segments. End each segment with a short state summary: decisions made, open questions, and next action.",
        captureModes: [interaction.captureMode],
        evidenceEvent: events.at(-1),
        evidenceEvents: events
      })
    ];
  });
}

function detectFrustrationSignals(dataset: NormalizedDataset): LensFinding[] {
  const FRUSTRATION_PATTERN =
    /\b(that'?s (wrong|not right|incorrect|not what i)|no[,!]? (that|you|it'?s)|start over|try again|you'?re not|this is wrong|none of this|forget (that|what|it)|undo (that|this|it)|revert (that|this)|not working|doesn'?t work|still wrong|still (not|broken))\b/i;

  return dataset.interactions.flatMap((interaction) => {
    const events = byInteraction(dataset.events, interaction.id);
    const prompts = events.filter((event) => event.eventType === "prompt");
    const frustrated = prompts.filter((event) => FRUSTRATION_PATTERN.test(event.redactedExcerpt ?? ""));
    if (frustrated.length < 2) return [];

    return [
      finding({
        id: "session_hygiene.frustration_signals",
        source: interaction.source,
        interactionIds: [interaction.id],
        title: "Repeated frustration signals — initial brief may need more structure",
        explanation: `${frustrated.length} prompts in this session contain language suggesting the model is not meeting the user's intent.`,
        recommendation: "When corrections stack up, stop and restate: what you want, what Claude produced, and exactly what should change. A clearer constraint often resolves in one turn what corrections cannot fix in five.",
        captureModes: [interaction.captureMode],
        evidenceEvent: frustrated[0],
        evidenceEvents: events
      })
    ];
  });
}

function detectSpeedAccept(dataset: NormalizedDataset): LensFinding[] {
  const REVIEW_WINDOW_MS = 15_000;
  const MIN_RESPONSE_LENGTH = 200; // chars in redactedExcerpt as proxy for large response
  const MIN_OCCURRENCES = 3;

  return dataset.interactions.flatMap((interaction) => {
    if (interaction.source !== "code") return [];
    const events = byInteraction(dataset.events, interaction.id);
    const conversationEvents = events.filter((event) => event.eventType === "prompt" || event.eventType === "response");
    const quickAccepts: EventRecord[] = [];

    for (let i = 0; i < conversationEvents.length - 1; i++) {
      const response = conversationEvents[i];
      const nextPrompt = conversationEvents[i + 1];
      if (response.eventType !== "response" || nextPrompt.eventType !== "prompt") continue;
      if (!response.timestamp || !nextPrompt.timestamp) continue;
      if ((response.redactedExcerpt?.length ?? 0) < MIN_RESPONSE_LENGTH) continue;
      const gap = Date.parse(nextPrompt.timestamp) - Date.parse(response.timestamp);
      if (gap >= 0 && gap <= REVIEW_WINDOW_MS) quickAccepts.push(response);
    }

    if (quickAccepts.length < MIN_OCCURRENCES) return [];

    return [
      finding({
        id: "session_hygiene.speed_accept",
        source: "code",
        interactionIds: [interaction.id],
        title: "Responses accepted very quickly — review window may be too short",
        explanation: `${quickAccepts.length} large responses were followed by the next message within 15 seconds, suggesting little time for review.`,
        recommendation: "After a large response, pause to check for correctness, edge cases, and security issues before continuing. Fast iteration is fine; fast acceptance of large code blocks is risky.",
        captureModes: [interaction.captureMode],
        evidenceEvent: quickAccepts[0],
        evidenceEvents: events
      })
    ];
  });
}

// ---------------------------------------------------------------------------
// Efficiency detectors (new)
// ---------------------------------------------------------------------------

function detectRunawayAgentLoops(dataset: NormalizedDataset): LensFinding[] {
  const TOOL_CALL_THRESHOLD = 20;
  const FAILURE_THRESHOLD = 3;

  return dataset.interactions.flatMap((interaction) => {
    if (interaction.source !== "code") return [];
    const events = byInteraction(dataset.events, interaction.id);
    const toolCalls = events.filter((event) => event.eventType === "tool_call");
    if (toolCalls.length < TOOL_CALL_THRESHOLD) return [];
    const failures = events.filter((event) => event.eventType === "tool_result" && event.status === "failed");
    if (failures.length < FAILURE_THRESHOLD) return [];

    return [
      finding({
        id: "efficiency.runaway_agent_loops",
        source: "code",
        interactionIds: [interaction.id],
        title: "High tool usage with repeated failures suggests a stuck loop",
        explanation: `This session used ${toolCalls.length} tool calls with ${failures.length} failures. An agent spinning on failing approaches wastes context budget and time.`,
        recommendation: "When a tool fails twice, cancel and rephrase: describe the error precisely, narrow the scope, and try a different approach rather than retrying the same command.",
        captureModes: [interaction.captureMode],
        evidenceEvent: failures[0],
        evidenceEvents: events
      })
    ];
  });
}

function detectMcpToolBloat(dataset: NormalizedDataset): LensFinding[] {
  const DISTINCT_TOOL_THRESHOLD = 15;

  return dataset.interactions.flatMap((interaction) => {
    if (interaction.source !== "code") return [];
    const events = byInteraction(dataset.events, interaction.id);
    const toolNames = new Set(
      events.filter((event) => event.eventType === "tool_call" && event.toolName).map((event) => event.toolName as string)
    );
    if (toolNames.size < DISTINCT_TOOL_THRESHOLD) return [];
    const firstToolCall = events.find((event) => event.eventType === "tool_call");

    return [
      finding({
        id: "efficiency.mcp_tool_bloat",
        source: "code",
        interactionIds: [interaction.id],
        title: "Large number of distinct tools used in one session",
        explanation: `This session invoked ${toolNames.size} distinct tools. Broad tool catalogs inflate the system prompt and can make agent behavior less predictable.`,
        recommendation: "Scope the active toolset to what the task actually needs. Disable rarely-used MCP servers when doing focused work.",
        captureModes: [interaction.captureMode],
        evidenceEvent: firstToolCall,
        evidenceEvents: events
      })
    ];
  });
}

// ---------------------------------------------------------------------------
// AI Harness detectors (new)
// ---------------------------------------------------------------------------

function detectInstructionBloat(dataset: NormalizedDataset): LensFinding[] {
  const BLOAT_BYTES = 4000;
  // Deduplicate by project path — one finding per project, not per session.
  const codeProjects = new Map<string, (typeof dataset.interactions)[number]>();
  for (const interaction of dataset.interactions) {
    if (interaction.source === "code" && interaction.projectPath && interaction.metadata?.harnessScanAvailable === true) {
      codeProjects.set(interaction.projectPath, interaction);
    }
  }

  return [...codeProjects.values()].flatMap((interaction) => {
    const bytes = interaction.metadata?.claudeMdBytes;
    if (typeof bytes !== "number" || bytes < BLOAT_BYTES) return [];

    return [
      finding({
        id: "harness.instruction_bloat",
        source: "code",
        interactionIds: [interaction.id],
        title: "CLAUDE.md is large and inflates token cost on every request",
        explanation: `The project's CLAUDE.md is ${bytes.toLocaleString()} bytes. Large instruction files are prepended to every request, increasing cost even on tasks unrelated to the detailed content.`,
        recommendation: "Keep always-active CLAUDE.md under 4 KB. Move detailed docs, long checklists, and reference examples to separate files and reference them with @file when relevant.",
        captureModes: [interaction.captureMode]
      })
    ];
  });
}

function finding(input: {
  id: string;
  source: Source;
  interactionIds: string[];
  title: string;
  explanation: string;
  recommendation: string;
  captureModes: CaptureMode[];
  evidenceEvent?: EventRecord;
  evidenceEvents?: EventRecord[];
  evidenceNextEvent?: EventRecord;
  keywords?: string[];
  examples?: string[];
}): LensFinding {
  const rule = RULES.find((candidate) => input.id.startsWith(candidate.id));
  const nextEvent =
    input.evidenceNextEvent ??
    (input.evidenceEvent && input.evidenceEvents ? nextEventAfter(input.evidenceEvents, input.evidenceEvent) : undefined);
  return {
    id: `${input.id}.${input.interactionIds.join("-")}`,
    category: rule?.category ?? "efficiency",
    title: input.title,
    severity: rule?.severity ?? "medium",
    confidence: confidenceFor(input, rule),
    source: input.source,
    interactionIds: input.interactionIds,
    captureModes: input.captureModes,
    explanation: input.explanation,
    recommendation: input.recommendation,
    evidence: input.evidenceEvent
      ? [
          {
            id: `${input.id}.evidence`,
            source: input.source,
            captureMode: input.captureModes[0] ?? "claude_code_log",
            interactionId: input.evidenceEvent.interactionId,
            eventId: input.evidenceEvent.id,
            label: evidenceLabel(input.evidenceEvent, input.source, nextEvent),
            excerpt: input.evidenceEvent.redactedExcerpt
          }
        ]
      : undefined,
    ruleId: rule?.id,
    keywords: input.keywords,
    examples: input.examples
  };
}

function confidenceFor(
  input: {
    id: string;
    source: Source;
    interactionIds: string[];
    captureModes: CaptureMode[];
    evidenceEvent?: EventRecord;
  },
  rule: LensRule | undefined
): number {
  let confidence = 0.68;

  if (input.source === "code") confidence += 0.05;
  if (input.captureModes.includes("claude_code_log")) confidence += 0.05;
  if (input.captureModes.includes("checkpoint")) confidence += 0.03;
  if (input.captureModes.includes("manual_import") || input.captureModes.includes("task_summary")) confidence -= 0.03;

  const eventType = input.evidenceEvent?.eventType;
  if (eventType === "tool_call" || eventType === "tool_result" || eventType === "permission" || eventType === "compaction") confidence += 0.07;
  if (eventType === "prompt" || eventType === "response" || eventType === "checkpoint") confidence += 0.03;

  if (rule?.severity === "high") confidence += 0.03;
  if (rule?.severity === "low") confidence -= 0.03;
  if (input.interactionIds.length > 1) confidence += 0.04;
  if (input.captureModes.length > 1) confidence += 0.02;

  if (input.id.startsWith("prompt.vague_initial")) confidence -= 0.06;
  if (input.id.startsWith("context.topic_shift_without_summary")) confidence -= 0.03;
  if (input.id.startsWith("harness.missing_project")) confidence += 0.03;
  if (input.id.startsWith("workflow.edits_without_verification")) confidence += 0.04;
  if (input.id.startsWith("efficiency.repeated_tool_failure")) confidence += 0.08;
  if (input.id.startsWith("efficiency.repeated_file_reads")) confidence += 0.06;
  if (input.id.startsWith("efficiency.duplicate_tool_output")) confidence += 0.07;
  if (input.id.startsWith("privacy.sensitive_signal")) confidence += 0.08;
  if (input.id.startsWith("harness.")) confidence -= 0.02;
  // New rules
  if (input.id.startsWith("efficiency.runaway_agent_loops")) confidence += 0.08;
  if (input.id.startsWith("efficiency.mcp_tool_bloat")) confidence -= 0.03;
  if (input.id.startsWith("harness.instruction_bloat")) confidence += 0.06;
  if (input.id.startsWith("session_hygiene.mega_session")) confidence -= 0.04;
  if (input.id.startsWith("session_hygiene.frustration_signals")) confidence -= 0.03;
  if (input.id.startsWith("session_hygiene.speed_accept")) confidence -= 0.05; // requires timestamps

  return Math.round(Math.max(0.55, Math.min(0.92, confidence)) * 100) / 100;
}

function evidenceLabel(event: EventRecord, source: Source, nextEvent?: EventRecord): string {
  const parts: string[] = [baseEvidenceLabel(event, source)];
  const sessionShort = shortInteractionId(event.interactionId);
  if (sessionShort) parts.push(`session ${sessionShort}`);
  const ts = formatEvidenceTimestamp(event.timestamp);
  if (ts) parts.push(ts);
  const excerptLen = event.redactedExcerpt?.length;
  if (typeof excerptLen === "number" && excerptLen > 0) parts.push(`${excerptLen} chars`);
  return parts.join(" · ");
}

function baseEvidenceLabel(event: EventRecord, source: Source): string {
  if (event.eventType === "prompt") return "User prompt";
  if (event.eventType === "response") return "Claude response";
  if (event.eventType === "tool_call") return event.toolName ? `Tool call: ${event.toolName}` : "Tool call";
  if (event.eventType === "tool_result") return event.toolName ? `Tool result: ${event.toolName}` : "Tool result";
  if (event.eventType === "file_event") return "File activity";
  if (event.eventType === "permission") return "Permission decision";
  if (event.eventType === "compaction") return "Compaction event";
  if (event.eventType === "checkpoint") return "Cowork checkpoint";
  if (source === "code") return "Claude Code log event";
  if (source === "chat") return event.actor === "assistant" ? "Imported Claude response" : "Imported chat message";
  return "Imported Cowork note";
}

function shortInteractionId(id: string): string {
  const trimmed = id.replace(/^(interaction[-_]?|session[-_]?)/i, "");
  const alphanum = trimmed.replace(/[^a-z0-9]/gi, "");
  return (alphanum || id).slice(0, 6);
}

function formatEvidenceTimestamp(ts?: string): string | undefined {
  if (!ts) return undefined;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function describeNextEvent(next?: EventRecord): string | undefined {
  if (!next) return undefined;
  if (next.eventType === "tool_call" || next.eventType === "tool_result") {
    return next.toolName ? `followed by ${next.toolName}` : "followed by tool use";
  }
  if (next.eventType === "prompt") return "followed by user prompt";
  if (next.eventType === "response") return "followed by Claude response";
  if (next.eventType === "permission") return "followed by permission decision";
  if (next.eventType === "compaction") return "followed by compaction";
  if (next.eventType === "checkpoint") return "followed by checkpoint";
  return undefined;
}

function nextEventAfter(events: EventRecord[], target: EventRecord): EventRecord | undefined {
  const idx = events.indexOf(target);
  if (idx < 0) return undefined;
  return events[idx + 1];
}

function byInteraction(events: EventRecord[], interactionId: string): EventRecord[] {
  return events.filter((event) => event.interactionId === interactionId);
}

function normalizePrompt(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(the|a|an|please|can|you|for|this|that)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function groupBy<T>(items: T[], getKey: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function rule(id: string, title: string, category: LensRule["category"], severity: LensRule["severity"], appliesTo: Source[]): LensRule {
  return {
    id,
    title,
    category,
    severity,
    appliesTo,
    description: title,
    evaluate: "implemented_in_code"
  };
}
