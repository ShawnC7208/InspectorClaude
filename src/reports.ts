import type { CoachingCategory, LensDashboardModel, LensFinding, LensReport } from "./types.js";

export type ReportBuildOptions = {
  reportType?: LensReport["reportType"];
  includeDashboardModel?: boolean;
  dimensions?: CoachingCategory[];
  sessionId?: string;
};

const REPORT_VERSION = "0.1";

export function buildLensReport(model: LensDashboardModel, options: ReportBuildOptions = {}): LensReport {
  const reportType = options.reportType ?? "coaching";
  const findings = selectFindings(model.findings, options);
  const findingIds = new Set(findings.map((finding) => finding.id));
  const recommendations = model.recommendations.filter((recommendation) =>
    recommendation.relatedFindingIds.some((id) => findingIds.has(id))
  );

  return {
    version: REPORT_VERSION,
    generatedAt: model.generatedAt,
    reportType,
    dashboardModel: (options.includeDashboardModel ?? reportType === "coaching") ? model : undefined,
    summary: reportSummary(model, reportType, findings),
    findings,
    recommendations,
    sourceLimitations: model.capabilityNotes
  };
}

export function buildCoachingReport(model: LensDashboardModel): LensReport {
  return buildLensReport(model, { reportType: "coaching", includeDashboardModel: true });
}

export function buildSessionReport(model: LensDashboardModel, sessionId: string): LensReport {
  return buildLensReport(model, { reportType: "session", sessionId });
}

export function buildSkillOpportunityReport(model: LensDashboardModel): LensReport {
  return buildLensReport(model, { reportType: "skill_opportunity", dimensions: ["ai_harness"] });
}

export function buildPrivacyReport(model: LensDashboardModel): LensReport {
  return buildLensReport(model, { reportType: "privacy", dimensions: ["privacy"] });
}

export function exportReportJson(report: LensReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function exportReportMarkdown(report: LensReport): string {
  const model = report.dashboardModel;
  const evidenceMode = model?.privacy.evidenceMode ?? evidenceModeFromFindings(report.findings);
  const sources = model?.sources.filter((source) => source.enabled).map((source) => sourceName(source.source)).join(", ") || "Selected sources";

  return [
    "# InspectorClaude Coaching Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Report type: ${titleCase(report.reportType)}`,
    `Sources: ${sources}`,
    `Evidence mode: ${evidenceMode === "metadata_only" ? "metadata only" : "redacted excerpts"}`,
    "",
    "## Summary",
    "",
    report.summary,
    "",
    ...scoreSection(model),
    ...findingsSection(report.findings),
    ...recommendationsSection(report.recommendations),
    ...skillSection(model),
    ...privacySection(model),
    ...limitationsSection(report.sourceLimitations)
  ].join("\n");
}

function selectFindings(findings: LensFinding[], options: ReportBuildOptions): LensFinding[] {
  return findings.filter((finding) => {
    if (options.sessionId && !finding.interactionIds.includes(options.sessionId)) return false;
    if (options.dimensions && !options.dimensions.includes(finding.category)) return false;
    return true;
  });
}

function reportSummary(model: LensDashboardModel, reportType: LensReport["reportType"], findings: LensFinding[]): string {
  if (reportType === "privacy") {
    return `Privacy review found ${findings.length} privacy finding(s). ${model.privacy.redactionApplied ? "Redaction was applied before report generation." : "Redaction status is unavailable."}`;
  }
  if (reportType === "skill_opportunity") {
    return `Skill and harness review found ${model.skillOpportunities.length} reusable workflow opportunity/opportunities.`;
  }
  if (reportType === "session") {
    return `Session report includes ${findings.length} finding(s) from the selected interaction.`;
  }
  return `${model.summary.headline} Overall score: ${model.summary.overallScore.value} (${model.summary.overallScore.status}).`;
}

function scoreSection(model: LensDashboardModel | undefined): string[] {
  if (!model) return [];
  return [
    "## Scores",
    "",
    "| Area | Status | Notes |",
    "| --- | --- | --- |",
    ...model.scores.map((score) => `| ${score.label} | ${score.status} | ${escapeTable(score.explanation)} |`),
    ""
  ];
}

function findingsSection(findings: LensFinding[]): string[] {
  if (findings.length === 0) {
    return ["## Top Findings", "", "No findings matched this report scope.", ""];
  }

  return [
    "## Top Findings",
    "",
    ...findings.flatMap((finding) => [
      `### ${finding.title}`,
      "",
      `Severity: ${titleCase(finding.severity)}`,
      `Confidence: ${finding.confidence.toFixed(2)}`,
      `Source: ${sourceName(finding.source)}`,
      `Capture mode: ${finding.captureModes.join(", ")}`,
      "",
      "What happened:",
      finding.explanation,
      "",
      "Try this next:",
      finding.recommendation,
      "",
      ...evidenceLines(finding),
      ""
    ])
  ];
}

function recommendationsSection(recommendations: LensReport["recommendations"]): string[] {
  if (recommendations.length === 0) return ["## Recommended Actions", "", "No recommendations matched this report scope.", ""];

  return [
    "## Recommended Actions",
    "",
    ...recommendations.map(
      (recommendation) =>
        `- ${recommendation.title} (${recommendation.impact} impact, ${recommendation.effort} effort): ${recommendation.nextAction}`
    ),
    ""
  ];
}

function skillSection(model: LensDashboardModel | undefined): string[] {
  if (!model || model.skillOpportunities.length === 0) return ["## Skill and Harness Opportunities", "", "No skill opportunities were detected in this report scope.", ""];
  return [
    "## Skill and Harness Opportunities",
    "",
    ...model.skillOpportunities.map(
      (skill) => {
        const example = skill.examples.length ? ` e.g. "${skill.examples[0]}"` : "";
        return `- ${skill.suggestedName} (${sourceName(skill.surface)}, ${skill.occurrenceCount}×, ${skill.impact} impact): ${skill.problem} Draft behavior: ${skill.draftBehavior}${example}`;
      }
    ),
    ""
  ];
}

function privacySection(model: LensDashboardModel | undefined): string[] {
  if (!model) return [];
  return [
    "## Privacy Notes",
    "",
    `Evidence mode: ${model.privacy.evidenceMode === "metadata_only" ? "metadata only" : "redacted excerpts"}`,
    `Cache enabled: ${model.privacy.cacheEnabled ? "yes" : "no"}`,
    `Local only: ${model.privacy.localOnly ? "yes" : "no"}`,
    `Export history: ${model.privacy.exportedThisSession ? "exported in current session" : "not stored in on-demand mode"}`,
    `Outbound AI: ${model.privacy.localOnly ? "none" : "review optional outbound settings"}`,
    `Privacy findings: ${model.privacy.findingCount}`,
    ...model.privacy.notes.map((note) => `- ${note}`),
    ""
  ];
}

function limitationsSection(notes: LensReport["sourceLimitations"]): string[] {
  return [
    "## Source Limitations",
    "",
    ...notes.map((note) => `- ${sourceName(note.source)}: ${note.message}`),
    ""
  ];
}

function evidenceLines(finding: LensFinding): string[] {
  const excerpts = finding.evidence?.filter((evidence) => evidence.excerpt).map((evidence) => `Evidence: ${evidence.excerpt}`) ?? [];
  if (excerpts.length === 0) return ["Evidence: metadata only"];
  return excerpts;
}

function evidenceModeFromFindings(findings: LensFinding[]): "metadata_only" | "redacted_excerpts" {
  return findings.some((finding) => finding.evidence?.some((evidence) => evidence.excerpt)) ? "redacted_excerpts" : "metadata_only";
}

function sourceName(source: string): string {
  if (source === "code") return "Claude Code";
  if (source === "chat") return "Claude Chat";
  if (source === "cowork") return "Claude Cowork";
  return "All sources";
}

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|");
}
