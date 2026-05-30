import { CAPABILITY_PROFILES, capabilityLimitations } from "./capabilities.js";
import { evaluateRules } from "./rules.js";
import type {
  ActivityTimeline,
  CapabilityNote,
  CoachingCategory,
  CoachingRecommendation,
  LensDashboardModel,
  LensFinding,
  LensScore,
  NormalizedDataset,
  SkillOpportunity,
  Source,
  SourceSummary
} from "./types.js";

export type DashboardBuildOptions = {
  evidenceMode?: "metadata_only" | "redacted_excerpts";
  dimensions?: CoachingCategory[];
};

const SCORE_AREAS: Array<{ id: CoachingCategory; label: string }> = [
  { id: "prompt_clarity", label: "Prompt Clarity" },
  { id: "context_health", label: "Context Health" },
  { id: "workflow_structure", label: "Workflow Structure" },
  { id: "ai_harness", label: "AI Harness Use" },
  { id: "efficiency", label: "Efficiency" },
  { id: "privacy", label: "Privacy Awareness" },
  { id: "session_hygiene", label: "Session Hygiene" }
];

export function buildDashboardModel(dataset: NormalizedDataset, options: DashboardBuildOptions = {}): LensDashboardModel {
  const evidenceMode = options.evidenceMode ?? "metadata_only";
  const selectedCategories = new Set(options.dimensions ?? SCORE_AREAS.map((area) => area.id));
  const findings = applyEvidenceMode(
    evaluateRules(dataset).filter((finding) => selectedCategories.has(finding.category)),
    evidenceMode
  );
  const scores = SCORE_AREAS.filter((area) => selectedCategories.has(area.id)).map((area) => scoreArea(area.id, area.label, findings, dataset));
  const overallScore = scoreOverall(scores);
  const recommendations = buildRecommendations(findings);
  const skillOpportunities = buildSkillOpportunities(findings);

  return {
    generatedAt: new Date().toISOString(),
    timeRange: dateRange(dataset.interactions.flatMap((interaction) => [interaction.startedAt, interaction.endedAt]).filter(Boolean) as string[]),
    sources: buildSourceSummaries(dataset),
    summary: {
      overallScore,
      headline: headlineFor(overallScore),
      topActions: unique(recommendations.map((recommendation) => recommendation.nextAction)).slice(0, 3)
    },
    scores,
    activity: buildActivity(dataset, findings),
    findings,
    recommendations,
    skillOpportunities,
    harness: buildHarnessSummary(dataset),
    privacy: {
      evidenceMode,
      cacheEnabled: false,
      redactionApplied: true,
      findingCount: findings.filter((finding) => finding.category === "privacy").length,
      exportedThisSession: false,
      localOnly: true,
      notes: [
        "No database is required for this analysis.",
        "Raw transcript content is not stored by default.",
        "Chat and Cowork data require explicit user input."
      ]
    },
    capabilityNotes: buildCapabilityNotes(dataset)
  };
}

function buildHarnessSummary(dataset: NormalizedDataset): LensDashboardModel["harness"] {
  const codeProjects = new Map<string, (typeof dataset.interactions)[number]>();
  for (const interaction of dataset.interactions) {
    if (interaction.source === "code" && interaction.projectPath) codeProjects.set(interaction.projectPath, interaction);
  }
  const projects = [...codeProjects.values()];
  const scanned = projects.filter((interaction) => interaction.metadata?.harnessScanAvailable === true);

  return {
    projectCount: projects.length,
    scannedProjectCount: scanned.length,
    claudeMdProjects: countMetadata(scanned, "hasClaudeMd"),
    settingsProjects: countMetadata(scanned, "hasClaudeSettings"),
    agentProjects: countMetadata(scanned, "hasClaudeAgents"),
    hookProjects: countMetadata(scanned, "hasClaudeHooks"),
    mcpConfigProjects: countMetadata(scanned, "hasMcpConfig"),
    notes:
      scanned.length > 0
        ? ["Project harness assets were checked from local project roots found in Claude Code logs."]
        : ["Project harness assets are unavailable until Claude Code logs include readable project roots."]
  };
}

function countMetadata(interactions: Array<{ metadata?: Record<string, string | number | boolean> }>, key: string): number {
  return interactions.filter((interaction) => interaction.metadata?.[key] === true).length;
}

function applyEvidenceMode(findings: LensFinding[], evidenceMode: "metadata_only" | "redacted_excerpts"): LensFinding[] {
  if (evidenceMode === "redacted_excerpts") return findings;
  return findings.map((finding) => ({
    ...finding,
    evidence: finding.evidence?.map((evidence) => ({
      ...evidence,
      excerpt: undefined
    }))
  }));
}

function buildSourceSummaries(dataset: NormalizedDataset): SourceSummary[] {
  const sources: Source[] = ["code", "chat", "cowork"];
  return sources.map((source) => {
    const interactions = dataset.interactions.filter((interaction) => interaction.source === source);
    const events = dataset.events.filter((event) => interactions.some((interaction) => interaction.id === event.interactionId));
    const profile = CAPABILITY_PROFILES[source];
    return {
      source,
      enabled: interactions.length > 0,
      captureModes: [...new Set(interactions.map((interaction) => interaction.captureMode))],
      interactionCount: interactions.length,
      eventCount: events.length,
      dateRange: dateRange(interactions.flatMap((interaction) => [interaction.startedAt, interaction.endedAt]).filter(Boolean) as string[]),
      capabilityProfileId: profile.id,
      limitations: capabilityLimitations(source)
    };
  });
}

function buildActivity(dataset: NormalizedDataset, findings: LensFinding[]): ActivityTimeline {
  return {
    sessions: dataset.interactions.map((interaction) => ({
      interactionId: interaction.id,
      source: interaction.source,
      title: interaction.title,
      startedAt: interaction.startedAt,
      endedAt: interaction.endedAt,
      eventCount: dataset.events.filter((event) => event.interactionId === interaction.id).length,
      findingCount: findings.filter((finding) => finding.interactionIds.includes(interaction.id)).length
    }))
  };
}

function buildCapabilityNotes(dataset: NormalizedDataset): CapabilityNote[] {
  const present = new Set(dataset.interactions.map((interaction) => interaction.source));
  const sources: Source[] = ["code", "chat", "cowork"];
  return sources.flatMap((source) => {
    const profile = CAPABILITY_PROFILES[source];
    const prefix = present.has(source) ? "Analyzed" : "Unavailable";
    return capabilityLimitations(source).map((message, index) => ({
      id: `${profile.id}.note.${index + 1}`,
      source,
      capabilityProfileId: profile.id,
      message: `${prefix}: ${message}`
    }));
  });
}

// Score = BASE_SCORE − penalty, where penalty is normalized to [0, MAX_PENALTY].
// Penalty is the larger of two terms so neither failure mode wins:
//   1. coveragePenalty — scales with how *widespread* findings are. Captures
//      "this happens in lots of sessions" and does not saturate as data grows.
//   2. severityFloor — a cluster of *severe* findings pulls the score down even
//      when it touches only a few sessions. Uses sqrt so large counts don't
//      re-saturate the way the old additive model did.
const BASE_SCORE = 92;
const MAX_PENALTY = 85;
const MAX_SEVERITY_PENALTY = severityPenalty("high");
// severityFloor weights and cap. Cap keeps a narrow-but-severe cluster at worst
// in "needs_attention" (BASE_SCORE − 47 = 45); going "at_risk" requires breadth,
// which only coveragePenalty can supply.
const HIGH_FLOOR = 8;
const MEDIUM_FLOOR = 2.5;
const SEVERITY_FLOOR_CAP = 47;

function scoreArea(category: CoachingCategory, label: string, findings: LensFinding[], dataset: NormalizedDataset): LensScore {
  const hasSource = dataset.interactions.length > 0;
  if (!hasSource) {
    return {
      id: category,
      label,
      value: 0,
      status: "unavailable",
      confidence: 0,
      explanation: "No supported records were available for this score."
    };
  }

  const related = findings.filter((finding) => finding.category === category);
  if (related.length === 0) {
    const value = BASE_SCORE;
    return {
      id: category,
      label,
      value,
      status: statusFor(value),
      confidence: 0.62,
      explanation: "No major deterministic findings were detected from available data."
    };
  }

  const affectedInteractions = new Set(related.flatMap((finding) => finding.interactionIds));
  const total = dataset.interactions.length;
  // Fraction of interactions touched by a finding in this area (0..1).
  const affectedCount = affectedInteractions.size > 0 ? affectedInteractions.size : related.length;
  const coverageRatio = Math.min(1, affectedCount / total);
  // Average severity of this area's findings, normalized so high severity = 1.
  const avgSeverityWeight =
    related.reduce((sum, finding) => sum + severityPenalty(finding.severity), 0) / related.length / MAX_SEVERITY_PENALTY;
  const coveragePenalty = MAX_PENALTY * coverageRatio * avgSeverityWeight;

  const severityCounts = countBySeverity(related);
  const severityFloor = Math.min(
    SEVERITY_FLOOR_CAP,
    HIGH_FLOOR * Math.sqrt(severityCounts.high ?? 0) + MEDIUM_FLOOR * Math.sqrt(severityCounts.medium ?? 0)
  );

  const penalty = Math.round(Math.min(MAX_PENALTY, Math.max(coveragePenalty, severityFloor)));
  const value = Math.max(0, Math.min(100, BASE_SCORE - penalty));
  const pct = Math.round(coverageRatio * 100);
  return {
    id: category,
    label,
    value,
    status: statusFor(value),
    confidence: 0.78,
    explanation: `Affected ${affectedInteractions.size} of ${total} interaction(s) (${pct}%): ${severitySummary(severityCounts)}.`
  };
}

// Count findings by severity, e.g. { high: 13, medium: 17 }.
function countBySeverity(findings: LensFinding[]): Partial<Record<LensFinding["severity"], number>> {
  const counts: Partial<Record<LensFinding["severity"], number>> = {};
  for (const finding of findings) {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
  }
  return counts;
}

// Render a severity breakdown highest-first, e.g. "13 high, 17 medium severity".
function severitySummary(counts: Partial<Record<LensFinding["severity"], number>>): string {
  const order: LensFinding["severity"][] = ["high", "medium", "low", "info"];
  const parts = order.filter((severity) => counts[severity]).map((severity) => `${counts[severity]} ${severity}`);
  return parts.length > 0 ? `${parts.join(", ")} severity` : "no graded findings";
}

function scoreOverall(scores: LensScore[]): LensScore {
  const available = scores.filter((score) => score.status !== "unavailable");
  if (available.length === 0) {
    return {
      id: "overall",
      label: "Overall Practice Quality",
      value: 0,
      status: "unavailable",
      confidence: 0,
      explanation: "No supported records were available."
    };
  }

  const value = Math.round(available.reduce((sum, score) => sum + score.value, 0) / available.length);
  return {
    id: "overall",
    label: "Overall Practice Quality",
    value,
    status: statusFor(value),
    confidence: Math.min(...available.map((score) => score.confidence)),
    explanation: "Average of available coaching score areas."
  };
}

function buildRecommendations(findings: LensFinding[]): CoachingRecommendation[] {
  const seen = new Set<string>();
  return findings
    .slice()
    .sort((left, right) => severityPenalty(right.severity) - severityPenalty(left.severity) || right.confidence - left.confidence)
    .flatMap((finding) => {
      const key = `${finding.category}:${finding.recommendation}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          id: `rec.${finding.id}`,
          title: finding.title,
          category: finding.category,
          surface: finding.source,
          impact: finding.severity === "high" ? "high" : finding.severity === "medium" ? "medium" : "low",
          effort: finding.category === "privacy" ? "medium" : "low",
          confidence: finding.confidence,
          explanation: finding.explanation,
          nextAction: finding.recommendation,
          relatedFindingIds: findings.filter((candidate) => candidate.category === finding.category && candidate.recommendation === finding.recommendation).map((candidate) => candidate.id)
        }
      ];
    });
}

// Harness findings where the recommended action is "remove/trim" rather than "create a skill"
const SKILL_OPPORTUNITY_EXCLUDED_RULES = new Set(["harness.instruction_bloat", "harness.missing_project_harness_assets"]);

function buildSkillOpportunities(findings: LensFinding[]): SkillOpportunity[] {
  const eligible = findings.filter(
    (finding) => finding.category === "ai_harness" && !SKILL_OPPORTUNITY_EXCLUDED_RULES.has(finding.ruleId ?? "")
  );

  // Content clusters (repeated prompts / preferences) are distinct per finding —
  // each one is a different recurring workflow. Structural gaps (e.g. a missing
  // CLAUDE.md found across several project roots) collapse into one opportunity.
  const groups = new Map<string, LensFinding[]>();
  for (const finding of eligible) {
    const kind = skillKindFor(finding.id);
    const key = kind === "repeated_prompt" || kind === "preference" ? finding.id : skillProfileFor(finding.id).suggestedName;
    const bucket = groups.get(key);
    if (bucket) bucket.push(finding);
    else groups.set(key, [finding]);
  }

  const opportunities = [...groups.values()].map((group) => {
    const primary = group[0];
    const kind = skillKindFor(primary.id);
    const profile = skillProfileFor(primary.id);
    const keywords = primary.keywords ?? [];
    const examples = primary.examples ?? [];
    const surfaces = Array.from(new Set(group.map((f) => f.source))).sort() as SkillOpportunity["surfaces"];
    // For repeated work, count distinct sessions it showed up in; for structural
    // gaps, count how many findings rolled up. Either way it is the strength signal.
    const occurrenceCount =
      kind === "repeated_prompt" || kind === "preference"
        ? Math.max(group.reduce((total, f) => total + f.interactionIds.length, 0), 2)
        : group.length;
    const suggestedName = nameForOpportunity(kind, keywords, profile.suggestedName);
    const impact: SkillOpportunity["impact"] = occurrenceCount >= 3 ? "high" : occurrenceCount === 2 ? "medium" : "low";
    return {
      id: `skill.${suggestedName}.${primary.id}`,
      suggestedName,
      surface: surfaces.length === 1 ? surfaces[0] : "all",
      surfaces,
      occurrenceCount,
      kind,
      keywords,
      examples,
      problem: profile.problem,
      evidenceSummary: primary.explanation,
      draftBehavior: profile.draftBehavior,
      impact,
      scaffold: buildSkillScaffold(kind, suggestedName, keywords, examples),
      draftPrompt: buildSkillDraftPrompt(kind, suggestedName, keywords, examples, occurrenceCount, profile),
      relatedFindingIds: group.map((f) => f.id)
    } satisfies SkillOpportunity;
  });

  // Strongest signals first, and keep the tab focused — a short list of the
  // most-repeated patterns is more useful than an exhaustive dump.
  return opportunities.sort((a, b) => b.occurrenceCount - a.occurrenceCount).slice(0, MAX_SKILL_OPPORTUNITIES);
}

const MAX_SKILL_OPPORTUNITIES = 8;

function skillKindFor(findingId: string): SkillOpportunity["kind"] {
  if (findingId.startsWith("harness.repeated_prompt_pattern")) return "repeated_prompt";
  if (findingId.startsWith("harness.project_instruction_opportunity")) return "preference";
  if (findingId.startsWith("harness.missing_project_instructions")) return "missing_instructions";
  return "workflow";
}

/** Derive a kebab-case skill name from cluster keywords, falling back to the canned name. */
function nameForOpportunity(kind: SkillOpportunity["kind"], keywords: string[], fallback: string): string {
  if ((kind === "repeated_prompt" || kind === "preference") && keywords.length > 0) {
    const suffix = kind === "preference" ? "preference" : "skill";
    const slug = keywords
      .slice(0, 3)
      .filter((k) => k !== suffix) // avoid e.g. "base-directory-skill-skill"
      .join("-")
      .replace(/[^a-z0-9-]/g, "");
    if (slug.length >= 3) return `${slug}-${suffix}`;
  }
  return fallback;
}

/** Local, deterministic paste-ready starter (option B). */
function buildSkillScaffold(kind: SkillOpportunity["kind"], name: string, keywords: string[], examples: string[]): string {
  if (kind === "missing_instructions") {
    return [
      "# Project: <name>",
      "",
      "## Goal",
      "<what this project does and who it serves>",
      "",
      "## Key locations",
      "- Source: <dir>",
      "- Tests: <dir>",
      "",
      "## Commands",
      "- Build: <cmd>",
      "- Test: <cmd>",
      "- Lint/Typecheck: <cmd>",
      "",
      "## Conventions",
      "- <coding conventions, naming, formatting>",
      "",
      "## Review checklist",
      "- <what to verify before calling work done>"
    ].join("\n");
  }
  const focus = keywords.length ? keywords.join(", ") : "the repeated task";
  const exampleLines = examples.length ? examples.map((ex) => `- ${ex}`).join("\n") : "- <paste a representative request>";
  if (kind === "preference") {
    return [
      "## Conventions (add to CLAUDE.md)",
      "",
      `<!-- Recurring preference about: ${focus} -->`,
      "- <state the preference once, e.g. tone, format, or review standard>",
      "",
      "Observed in requests like:",
      exampleLines
    ].join("\n");
  }
  // repeated_prompt / workflow → a slash-command / skill stub.
  return [
    "---",
    `name: ${name}`,
    `description: Reusable workflow for ${focus}.`,
    "---",
    "",
    `# ${name}`,
    "",
    "## When to use",
    `When the request involves: ${focus}.`,
    "",
    "## Steps",
    "1. <stable first step>",
    "2. <stable second step>",
    "3. <expected output / verification>",
    "",
    "## Example requests this replaces",
    exampleLines
  ].join("\n");
}

/** A complete prompt the user (or recommend_improvements) hands to Claude to author the skill (option C). */
function buildSkillDraftPrompt(
  kind: SkillOpportunity["kind"],
  name: string,
  keywords: string[],
  examples: string[],
  occurrenceCount: number,
  profile: { problem: string; draftBehavior: string }
): string {
  const focus = keywords.length ? keywords.join(", ") : "a recurring task";
  const exampleBlock = examples.length
    ? examples.map((ex, i) => `${i + 1}. ${ex}`).join("\n")
    : "(no captured examples — infer from the problem statement above)";

  if (kind === "missing_instructions") {
    return [
      "You are helping me set up project instructions for Claude Code.",
      `Context: ${profile.problem}`,
      "",
      "Write a complete CLAUDE.md for this project. Inspect the repository first, then fill in:",
      "project goal, key file locations, build/test/lint commands, coding conventions, and a review checklist.",
      "Output only the CLAUDE.md contents in a code block."
    ].join("\n");
  }

  const asset = kind === "preference" ? "a CLAUDE.md 'Conventions' section" : `a reusable Claude skill named "${name}"`;
  return [
    `I keep making similar requests (${occurrenceCount}× so far) centered on: ${focus}.`,
    `Context: ${profile.problem}`,
    "",
    "Representative requests:",
    exampleBlock,
    "",
    `Draft ${asset} that captures this so I don't have to re-specify it each time.`,
    kind === "preference"
      ? "State the stable preference clearly and concisely. Output only the snippet to paste into CLAUDE.md."
      : "Include: a name, a one-line description, when-to-use criteria, the stable steps, and the expected output. Output the full SKILL.md in a code block."
  ].join("\n");
}

function skillProfileFor(findingId: string): { suggestedName: string; problem: string; draftBehavior: string } {
  if (findingId.startsWith("harness.repeated_prompt_pattern")) {
    return {
      suggestedName: "repeat-prompt-skill",
      problem: "A similar request is being typed from scratch in multiple sessions.",
      draftBehavior: "Encode the repeating goal, key constraints, and expected output format as a reusable slash command or project instruction."
    };
  }
  if (findingId.startsWith("harness.project_instruction_opportunity")) {
    return {
      suggestedName: "project-prefs-packet",
      problem: "A stable preference (tone, format, style) is being restated in each session instead of living in project instructions.",
      draftBehavior: "Move the repeating preference into CLAUDE.md under a 'Conventions' or 'Preferences' section so every session inherits it automatically."
    };
  }
  if (findingId.startsWith("harness.missing_project_instructions")) {
    return {
      suggestedName: "bootstrap-claude-md",
      problem: "The project lacks a CLAUDE.md, so Claude starts each session with no project-specific context.",
      draftBehavior: "Add a CLAUDE.md with: project goal, key file locations, build/test commands, coding conventions, and a review checklist."
    };
  }
  return {
    suggestedName: "repeat-workflow-skill",
    problem: "A repeated workflow step could be captured as a reusable skill or project instruction.",
    draftBehavior: "Identify the stable inputs, steps, and expected outputs, then encode them as a project instruction or slash command."
  };
}

function dateRange(dates: string[]): { start?: string; end?: string } | undefined {
  if (dates.length === 0) return undefined;
  const sorted = dates.slice().sort();
  return { start: sorted[0], end: sorted.at(-1) };
}

function headlineFor(score: LensScore): string {
  if (score.status === "excellent") return "Your available Claude sessions look well structured.";
  if (score.status === "healthy") return "Your available Claude sessions look mostly healthy, with a few coaching opportunities.";
  if (score.status === "needs_attention") return "A few repeated patterns are likely reducing Claude's usefulness.";
  if (score.status === "at_risk") return "Several patterns may be causing confusion, rework, or privacy exposure.";
  return "Import or analyze supported activity to see coaching guidance.";
}

function severityPenalty(severity: LensFinding["severity"]): number {
  if (severity === "high") return 28;
  if (severity === "medium") return 16;
  if (severity === "low") return 8;
  return 3;
}

function statusFor(value: number): LensScore["status"] {
  if (value >= 85) return "excellent";
  if (value >= 70) return "healthy";
  if (value >= 45) return "needs_attention";
  return "at_risk";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
