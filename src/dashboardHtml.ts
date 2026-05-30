import { buildCoachingReport, exportReportJson, exportReportMarkdown } from "./reports.js";
import type { LensDashboardModel, LensFinding, LensScore, RedactedEvidence, Source } from "./types.js";

type FindingGroup = { key: string; items: LensFinding[] };

export type DashboardHtmlOptions = {
  title?: string;
  analyzeToken?: string;
};

const VIEW_LABELS = [
  ["overview", "Overview"],
  ["activity", "Activity"],
  ["patterns", "Anti-Patterns"],
  ["context", "Context Health"],
  ["harness", "AI Harness"],
  ["skills", "Skills"],
  ["privacy", "Privacy"],
  ["reports", "Reports"]
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  prompt_clarity: "Prompt clarity",
  context_health: "Context health",
  workflow_structure: "Workflow structure",
  ai_harness: "AI harness",
  efficiency: "Efficiency",
  privacy: "Privacy"
};

const SCORE_ORDER = ["prompt_clarity", "context_health", "workflow_structure", "ai_harness", "efficiency", "privacy"];

export function renderDashboardHtml(model: LensDashboardModel, options: DashboardHtmlOptions = {}): string {
  const title = options.title ?? "InspectorClaude";
  const report = buildCoachingReport(model);
  const reportMarkdown = exportReportMarkdown(report);
  const reportJson = exportReportJson(report);
  const topGroups = rankFindingGroups(groupFindingsByRule(model.findings)).slice(0, 3);
  const topRecommendations = model.recommendations.slice(0, 3);
  const contextFindings = model.findings.filter((finding) => finding.category === "context_health");
  const harnessFindings = model.findings.filter((finding) => finding.category === "ai_harness");
  const patternCategories = groupFindingsByCategory(model.findings);
  const findingsByInteraction = groupFindingsByInteraction(model.findings);
  const analyzeToken = options.analyzeToken ?? "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>${dashboardCss()}</style>
</head>
<body>
  <main class="app-shell">
    <aside class="sidebar" aria-label="Dashboard views">
      <div class="brand">
        <div class="brand-wordmark" aria-hidden="true">
          <span class="brand-mark">🔍</span><span class="brand-inspector">Inspector</span><span class="brand-claude">Claude</span>
        </div>
        <div class="brand-subtitle">Local chat analysis dashboard</div>
      </div>
      <nav class="nav-tabs">
        ${VIEW_LABELS.map(([id, label]) => `<button class="nav-tab" data-view-target="${id}" type="button">${escapeHtml(label)}</button>`).join("")}
      </nav>
      <div class="privacy-pill">${model.privacy.localOnly ? "Local only" : "Review storage"} - ${evidenceLabel(model.privacy.evidenceMode)}</div>
    </aside>

    <section class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">Generated ${formatDate(model.generatedAt)}</p>
          <h1>${escapeHtml(model.summary.headline)}</h1>
        </div>
        <div class="overall-score" aria-label="Overall practice score">
          <span>${formatScore(model.summary.overallScore)}</span>
          <small>${escapeHtml(model.summary.overallScore.status.replaceAll("_", " "))}</small>
        </div>
        <div class="topbar-actions">
          <button class="primary-button" data-analyze-all type="button">Analyze All</button>
          <span class="analyze-status" aria-live="polite"></span>
        </div>
      </header>

      <section class="view" data-view="overview">
        <div class="section-head">
          <h2>Overview</h2>
          <p>Practice quality, source coverage, and the next few improvements worth your attention.</p>
        </div>
        <div class="score-grid">
          ${scoreCards(model.scores)}
        </div>
        <div class="two-column">
          <section class="panel">
            <div class="panel-head"><h3>Top Findings</h3><span>${topGroups.length || "None"}</span></div>
            ${topGroups.length ? topGroups.map(findingGroupCard).join("") : emptyState("No major coaching findings in this model.")}
          </section>
          <section class="panel">
            <div class="panel-head"><h3>Recommended Actions</h3><span>${topRecommendations.length || "None"}</span></div>
            ${topRecommendations.length ? topRecommendations.map((rec) => `
              <article class="action-row">
                <strong>${escapeHtml(rec.title)}</strong>
                <p>${escapeHtml(rec.nextAction)}</p>
                <span>${escapeHtml(rec.impact)} impact - ${escapeHtml(rec.effort)} effort</span>
              </article>`).join("") : emptyState("No recommendations yet. Add more explicit Claude activity to get coaching.")}
          </section>
        </div>
        <div class="two-column">
          <section class="panel">
            <div class="panel-head"><h3>Source Coverage</h3><span>${enabledSourceCount(model)} of 3</span></div>
            ${model.sources.map(sourceRow).join("")}
          </section>
          <section class="panel">
            <div class="panel-head"><h3>Recent Activity</h3><span>${model.activity.sessions.length} sessions</span></div>
            ${activityBars(model)}
          </section>
        </div>
      </section>

      <section class="view" data-view="activity">
        <div class="section-head">
          <h2>Activity</h2>
          <p>Analyzed sessions by surface. Duration, model cost, and hidden history metrics stay unavailable when the source cannot support them.</p>
        </div>
        <div class="filter-row" aria-label="Activity filters">
          ${activityFilterButtons(model)}
        </div>
        ${activityImportHelp()}
        <section class="panel timeline-panel">
          ${model.activity.sessions.length ? model.activity.sessions.map((session) => sessionRow(session, findingsByInteraction.get(session.interactionId) ?? [])).join("") : emptyState("No sessions available. Analyze Code logs or import Chat/Cowork summaries to populate this view.")}
          <div class="empty-state filter-empty" data-filter-empty hidden>No sessions match this source filter.</div>
        </section>
      </section>

      <section class="view" data-view="patterns">
        <div class="section-head">
          <h2>Anti-Patterns</h2>
          <p>Constructive patterns to improve, grouped by coaching area.</p>
        </div>
        ${patternCategories.length ? patternCategories.map(([category, findings]) => `
          <section class="panel">
            <div class="panel-head"><h3>${escapeHtml(CATEGORY_LABELS[category] ?? category)}</h3><span>${findings.length}</span></div>
            ${renderFindings(findings)}
          </section>`).join("") : emptyState("No anti-patterns detected yet.")}
      </section>

      <section class="view" data-view="context">
        <div class="section-head">
          <h2>Context Health</h2>
          <p>Signals about overloaded sessions, restarts, summaries, compactions, and topic drift.</p>
        </div>
        <div class="two-column">
          <section class="panel score-focus">${scoreFocus(model.scores.find((score) => score.id === "context_health"))}</section>
          <section class="panel">${metricList([
            ["Long sessions", unavailableMetric("session duration")],
            ["Compactions", countFindings(model, "context", "compaction")],
            ["Topic drift", countFindings(model, "context", "topic")],
            ["Summary opportunities", countFindings(model, "context", "summary")]
          ])}</section>
        </div>
        <section class="panel">
          <div class="panel-head"><h3>Context Findings</h3><span>${contextFindings.length || "None"}</span></div>
          ${contextFindings.length ? renderFindings(contextFindings) : emptyState("No context-health findings yet.")}
        </section>
      </section>

      <section class="view" data-view="harness">
        <div class="section-head">
          <h2>AI Harness</h2>
          <p>Reusable ways to make Claude better at repeated work.</p>
        </div>
        <div class="two-column">
          <section class="panel score-focus">${scoreFocus(model.scores.find((score) => score.id === "ai_harness"))}</section>
          <section class="panel">${harnessInventory(model)}</section>
        </div>
        <section class="panel">
          <div class="panel-head"><h3>Harness Suggestions</h3><span>${harnessFindings.length || "None"}</span></div>
          ${harnessFindings.length ? renderFindings(harnessFindings) : emptyState("No AI harness findings yet.")}
        </section>
      </section>

      <section class="view" data-view="skills">
        <div class="section-head">
          <h2>Skills</h2>
          <p>Repeated workflows that could become reusable Claude skills or instructions.</p>
        </div>
        <section class="panel">
          ${model.skillOpportunities.length ? model.skillOpportunities.map((skill) => `
            <article class="skill-card">
              <div>
                ${(skill.surfaces && skill.surfaces.length ? skill.surfaces : [skill.surface]).map((s) => `<span class="source-badge">${escapeHtml(s)}</span>`).join(" ")}
                <h3>${escapeHtml(skill.suggestedName)}</h3>
                ${skill.keywords && skill.keywords.length ? `<div class="keyword-row">${skill.keywords.map((k) => `<span class="keyword-tag">${escapeHtml(k)}</span>`).join("")}</div>` : ""}
                <p>${escapeHtml(skill.problem)}</p>
                ${(skill.scaffold || skill.draftPrompt) ? `<div class="skill-actions">${skill.scaffold ? `<button class="secondary-button" type="button" data-copy-text="${escapeHtml(skill.scaffold)}" data-copy-label="Copy starter">Copy starter</button>` : ""}${skill.draftPrompt ? `<button class="secondary-button" type="button" data-copy-text="${escapeHtml(skill.draftPrompt)}" data-copy-label="Copy drafting prompt">Copy drafting prompt</button>` : ""}</div>` : ""}
              </div>
              <dl>
                <dt>Occurrences</dt><dd>${skill.occurrenceCount} ${skill.occurrenceCount === 1 ? "occurrence" : "occurrences"}</dd>
                ${skill.examples && skill.examples.length ? `<dt>Repeated work</dt><dd><ul class="skill-examples">${skill.examples.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul></dd>` : ""}
                <dt>Draft behavior</dt><dd>${escapeHtml(skill.draftBehavior)}</dd>
                <dt>Impact</dt><dd>${escapeHtml(skill.impact)}</dd>
              </dl>
            </article>`).join("") : emptyState("No skill opportunities yet. Lens waits for repeated patterns before suggesting reusable assets.")}
        </section>
      </section>

      <section class="view" data-view="privacy">
        <div class="section-head">
          <h2>Privacy</h2>
          <p>What InspectorClaude analyzed, what it stored, and what evidence mode is active.</p>
        </div>
        <div class="two-column">
          <section class="panel">${metricList([
            ["Storage", model.privacy.cacheEnabled ? "Cache enabled" : "No cache enabled"],
            ["Evidence", evidenceLabel(model.privacy.evidenceMode)],
            ["Redaction", model.privacy.redactionApplied ? "Applied before display/export" : "Not applied"],
            ["Exports this session", model.privacy.exportedThisSession ? "Yes" : "No"],
            ["Export history", "Not stored in on-demand mode"],
            ["Outbound AI", model.privacy.localOnly ? "None - local analysis only" : "Review optional outbound settings"]
          ])}</section>
          <section class="panel">
            <div class="panel-head"><h3>Capability Notes</h3><span>${model.capabilityNotes.length}</span></div>
            ${model.capabilityNotes.map((note) => `<p class="note-line"><strong>${escapeHtml(note.source)}</strong> ${escapeHtml(note.message)}</p>`).join("")}
          </section>
        </div>
        <section class="panel">
          <div class="panel-head"><h3>Privacy Notes</h3><span>${model.privacy.findingCount} findings</span></div>
          ${model.privacy.notes.map((note) => `<p class="note-line">${escapeHtml(note)}</p>`).join("")}
        </section>
      </section>

      <section class="view" data-view="reports">
        <div class="section-head">
          <h2>Reports</h2>
          <p>Portable coaching summaries for pasting into Claude Chat, Cowork, or another review process.</p>
        </div>
        <div class="report-actions">
          <button class="primary-button" data-copy-report="markdown" type="button">Copy Markdown</button>
          <button class="secondary-button" data-copy-report="json" type="button">Copy JSON</button>
          <span class="copy-status" aria-live="polite"></span>
        </div>
        <section class="panel report-preview">
          <pre id="report-preview">${escapeHtml(reportMarkdown)}</pre>
        </section>
      </section>
    </section>
  </main>
  <script type="application/json" id="lens-dashboard-model">${safeJson(model)}</script>
  <script type="application/json" id="lens-report-json">${safeJson(JSON.parse(reportJson))}</script>
  <script type="application/json" id="lens-report-markdown">${safeJson(reportMarkdown)}</script>
  <script type="application/json" id="lens-analyze-token">${safeJson(analyzeToken)}</script>
  <script>${dashboardClientJs()}</script>
</body>
</html>`;
}

export function emptyDashboardModel(generatedAt = new Date().toISOString()): LensDashboardModel {
  const unavailableScores: LensScore[] = SCORE_ORDER.map((id) => ({
    id,
    label: CATEGORY_LABELS[id] ?? id,
    value: 0,
    status: "unavailable",
    confidence: 0,
    explanation: "Unavailable until supported local or explicit input is analyzed."
  }));

  return {
    generatedAt,
    sources: (["chat", "cowork", "code"] as Source[]).map((source) => ({
      source,
      enabled: false,
      captureModes: [],
      interactionCount: 0,
      eventCount: 0,
      capabilityProfileId: `${source}.unavailable`,
      limitations: ["No data has been explicitly analyzed for this source in the current session."]
    })),
    summary: {
      overallScore: {
        id: "overall",
        label: "Overall practice",
        value: 0,
        status: "unavailable",
        confidence: 0,
        explanation: "Analyze Claude Code logs or import explicit Chat/Cowork content to build a dashboard."
      },
      headline: "InspectorClaude is ready for local analysis",
      topActions: ["Analyze Claude Code logs", "Import an explicit Chat transcript or summary", "Record a Cowork checkpoint"]
    },
    scores: unavailableScores,
    activity: { sessions: [] },
    findings: [],
    recommendations: [],
    skillOpportunities: [],
    harness: {
      projectCount: 0,
      scannedProjectCount: 0,
      claudeMdProjects: 0,
      settingsProjects: 0,
      agentProjects: 0,
      hookProjects: 0,
      mcpConfigProjects: 0,
      notes: ["Project harness assets are unavailable until Claude Code logs include readable project roots."]
    },
    privacy: {
      evidenceMode: "metadata_only",
      cacheEnabled: false,
      redactionApplied: true,
      findingCount: 0,
      exportedThisSession: false,
      localOnly: true,
      notes: ["No cloud sync or telemetry is enabled by default.", "Chat and Cowork analysis require explicit user-provided input."]
    },
    capabilityNotes: [
      {
        id: "empty.local-first",
        source: "chat",
        capabilityProfileId: "chat.unavailable",
        message: "InspectorClaude does not scrape hidden Claude app data."
      }
    ]
  };
}

function scoreCards(scores: LensScore[]): string {
  const ordered = SCORE_ORDER.map((id) => scores.find((score) => score.id === id)).filter((score): score is LensScore => Boolean(score));
  return ordered.map((score) => `
    <article class="score-card ${score.status}">
      <div class="score-ring" style="--score:${score.status === "unavailable" ? 0 : score.value}">
        <span>${score.status === "unavailable" ? "N/A" : score.value}</span>
      </div>
      <div>
        <h3>${escapeHtml(score.label)}</h3>
        <p>${escapeHtml(score.explanation)}</p>
      </div>
    </article>`).join("");
}

function findingGroupCard(group: FindingGroup): string {
  const items = rankFindings(group.items);
  const head = items[0];
  const sessionCount = new Set(group.items.flatMap((finding) => finding.interactionIds)).size;
  const maxConfidence = Math.max(...group.items.map((finding) => finding.confidence));
  const topSeverity = headSeverity(group.items);
  const sessionBadge = sessionCount > 1 ? `<span class="session-count">${sessionCount} sessions</span>` : "";
  const evidenceList: RedactedEvidence[] = items.flatMap((finding) => finding.evidence ?? []);
  const evidenceSummary = sessionCount > 1 ? `Evidence from ${sessionCount} sessions` : "Evidence";
  return `<article class="finding-card" data-source="${escapeHtml(head.source)}" data-severity="${escapeHtml(topSeverity)}">
    <div class="finding-topline">
      <span class="severity ${escapeHtml(topSeverity)}">${escapeHtml(topSeverity)}</span>
      ${sessionBadge}
      <span>${Math.round(maxConfidence * 100)}% confidence</span>
    </div>
    <h3>${escapeHtml(head.title)}</h3>
    <p>${escapeHtml(head.explanation)}</p>
    <div class="next-action">${escapeHtml(head.recommendation)}</div>
    ${evidenceList.length ? `<div class="evidence-section"><div class="evidence-header">${escapeHtml(evidenceSummary)}</div><div class="evidence-list">${evidenceList.map((evidence) => `<details class="evidence-detail"><summary>${escapeHtml(evidence.label)}</summary>${evidence.excerpt ? `<blockquote class="evidence-excerpt-block">${escapeHtml(evidence.excerpt)}</blockquote>` : `<p class="no-excerpt-hint">Prompt text not loaded. <button class="link-btn" data-load-excerpts type="button">Load prompt excerpts</button></p>`}</details>`).join("")}</div></div>` : ""}
  </article>`;
}

function renderFindings(findings: LensFinding[]): string {
  return rankFindingGroups(groupFindingsByRule(findings)).map(findingGroupCard).join("");
}

// Map each interaction (session) to the findings that touch it, matching the
// per-session findingCount computed in buildActivity.
function groupFindingsByInteraction(findings: LensFinding[]): Map<string, LensFinding[]> {
  const groups = new Map<string, LensFinding[]>();
  for (const finding of findings) {
    for (const interactionId of finding.interactionIds) {
      groups.set(interactionId, [...(groups.get(interactionId) ?? []), finding]);
    }
  }
  return groups;
}

function groupFindingsByRule(findings: LensFinding[]): FindingGroup[] {
  const groups = new Map<string, LensFinding[]>();
  for (const finding of findings) {
    const key = finding.ruleId ?? finding.title;
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  return [...groups.entries()].map(([key, items]) => ({ key, items }));
}

function headSeverity(items: LensFinding[]): LensFinding["severity"] {
  let best: LensFinding["severity"] = "info";
  for (const item of items) {
    if (severityRank(item.severity) > severityRank(best)) best = item.severity;
  }
  return best;
}

function rankFindingGroups(groups: FindingGroup[]): FindingGroup[] {
  return groups.slice().sort((left, right) => {
    const severityDelta = severityRank(headSeverity(right.items)) - severityRank(headSeverity(left.items));
    if (severityDelta !== 0) return severityDelta;
    const confidenceDelta =
      Math.max(...right.items.map((finding) => finding.confidence)) -
      Math.max(...left.items.map((finding) => finding.confidence));
    if (confidenceDelta !== 0) return confidenceDelta;
    return right.items.length - left.items.length;
  });
}

function rankFindings(findings: LensFinding[]): LensFinding[] {
  return findings.slice().sort((left, right) => {
    const severityDelta = severityRank(right.severity) - severityRank(left.severity);
    if (severityDelta !== 0) return severityDelta;
    const confidenceDelta = right.confidence - left.confidence;
    if (confidenceDelta !== 0) return confidenceDelta;
    return right.interactionIds.length - left.interactionIds.length;
  });
}

function severityRank(severity: LensFinding["severity"]): number {
  if (severity === "high") return 4;
  if (severity === "medium") return 3;
  if (severity === "low") return 2;
  return 1;
}

function sourceRow(source: LensDashboardModel["sources"][number]): string {
  const status = source.enabled ? "Analyzed" : "Unavailable";
  const modes = source.captureModes.length ? source.captureModes.map(captureModeLabel).join(", ") : "No supported data found";
  return `<article class="source-row ${source.enabled ? "enabled" : "disabled"}">
    <div><strong>${escapeHtml(sourceLabel(source.source))}</strong><span>${escapeHtml(modes)}</span></div>
    <span>${escapeHtml(status)}</span>
    ${source.limitations.length ? `<ul>${source.limitations.map((limitation) => `<li>${escapeHtml(limitation)}</li>`).join("")}</ul>` : ""}
  </article>`;
}

function sourceLabel(source: Source): string {
  if (source === "code") return "Claude Code";
  if (source === "chat") return "Claude Chat";
  return "Claude Cowork";
}

function captureModeLabel(mode: string): string {
  const labels: Record<string, string> = {
    claude_code_log: "Local JSONL session logs",
    current_chat_input: "Current chat input",
    manual_import: "Manual import",
    checkpoint: "Checkpoint",
    task_summary: "Task summary",
    artifact_summary: "Artifact summary",
    report_import: "Report import"
  };
  return labels[mode] ?? mode.replaceAll("_", " ");
}

function activityBars(model: LensDashboardModel): string {
  const sessions = model.activity.sessions.slice(-12);
  if (!sessions.length) return emptyState("No activity to chart yet.");
  const maxEvents = Math.max(...sessions.map((session) => session.eventCount), 1);
  return `<div class="sparkline" aria-label="Recent activity chart">
    ${sessions.map((session) => `<span title="${escapeHtml(session.title ?? session.interactionId)}" style="height:${Math.max(12, Math.round((session.eventCount / maxEvents) * 72))}px"></span>`).join("")}
  </div>`;
}

function activityFilterButtons(model: LensDashboardModel): string {
  const counts = activitySourceCounts(model);
  const total = model.activity.sessions.length;
  return (["all", "chat", "cowork", "code"] as const)
    .map((source) => {
      const count = source === "all" ? total : counts[source];
      const label = source === "all" ? "All" : source[0].toUpperCase() + source.slice(1);
      return `<button class="filter-button" data-source-filter="${source}" type="button">${escapeHtml(label)} <span>${count}</span></button>`;
    })
    .join("");
}

function activityImportHelp(): string {
  return `<details class="help-panel">
    <summary><span class="help-icon" aria-hidden="true">＋</span>How to add Claude Chat &amp; Cowork sessions</summary>
    <div class="help-body">
      <p>Chat and Cowork activity is never read automatically. Add it yourself, then click <strong>Analyze All</strong> at the top to re-scan.</p>
      <h4>Option 1 — claude.ai data export (recommended)</h4>
      <ol>
        <li>In Claude, open <strong>Settings → Privacy → Export data</strong> and request your export. Anthropic emails you a download link (it can take a little while to arrive).</li>
        <li>Download it and leave it in your <strong>Downloads</strong> folder. InspectorClaude auto-detects an exported folder named like <code>data-…-batch-1</code>, or a zip named like <code>claude-export-….zip</code>.</li>
        <li>Click <strong>Analyze All</strong>.</li>
      </ol>
      <h4>Option 2 — drop in transcripts or summaries manually</h4>
      <ul>
        <li>Save Chat transcripts or summaries (<code>.md</code>, <code>.txt</code>, or <code>.json</code>) into <code>~/.inspectorclaude/imports/chat/</code></li>
        <li>Save Cowork checkpoints, transcripts, or summaries into <code>~/.inspectorclaude/imports/cowork/</code></li>
        <li>Click <strong>Analyze All</strong>.</li>
      </ul>
      <p class="help-note">Everything stays on your machine — InspectorClaude reads only the export and import folders above, never hidden Claude app databases.</p>
    </div>
  </details>`;
}

function activitySourceCounts(model: LensDashboardModel): Record<Source, number> {
  return model.activity.sessions.reduce<Record<Source, number>>(
    (counts, session) => {
      counts[session.source] += 1;
      return counts;
    },
    { chat: 0, cowork: 0, code: 0 }
  );
}

function sessionRow(session: LensDashboardModel["activity"]["sessions"][number], findings: LensFinding[]): string {
  const highUsageBadge = session.highUsage ? ` <span class="flag-badge" title="Unusually high token usage vs. your other sessions">high usage</span>` : "";
  const header = `<div>
      <span class="source-badge">${escapeHtml(session.source)}</span>
      <strong>${escapeHtml(session.title ?? session.interactionId)}</strong>${highUsageBadge}
      <p>${formatDate(session.startedAt)}${session.endedAt ? ` to ${formatDate(session.endedAt)}` : ""}</p>
    </div>
    <dl>
      <dt>Events</dt><dd>${session.eventCount}</dd>
      <dt>Findings</dt><dd>${session.findingCount}</dd>
      <dt>Tokens</dt><dd>${sessionTokens(session)}</dd>
      <dt>Cache hit</dt><dd>${sessionCacheHit(session)}</dd>
      <dt>Duration</dt><dd>${sessionDuration(session.startedAt, session.endedAt)}</dd>
    </dl>`;

  // Sessions with no findings stay a plain, inert card.
  if (findings.length === 0) {
    return `<article class="session-row" data-session-source="${escapeHtml(session.source)}">${header}</article>`;
  }

  // Otherwise the whole row is a click-to-expand disclosure listing this
  // session's findings, scoped to this session's evidence.
  const items = rankFindings(findings).map((finding) => sessionFindingItem(finding, session.interactionId)).join("");
  return `<details class="session-row session-row--expandable" data-session-source="${escapeHtml(session.source)}">
    <summary class="session-summary">${header}</summary>
    <div class="session-findings">
      <div class="session-findings-head">Findings in this session</div>
      ${items}
    </div>
  </details>`;
}

function sessionFindingItem(finding: LensFinding, interactionId: string): string {
  const evidence = (finding.evidence ?? []).filter((item) => item.interactionId === interactionId);
  const evidenceBlock = evidence.length
    ? `<div class="evidence-list">${evidence
        .map(
          (item) =>
            `<details class="evidence-detail"><summary>${escapeHtml(item.label)}</summary>${
              item.excerpt
                ? `<blockquote class="evidence-excerpt-block">${escapeHtml(item.excerpt)}</blockquote>`
                : `<p class="no-excerpt-hint">Prompt text not loaded. <button class="link-btn" data-load-excerpts type="button">Load prompt excerpts</button></p>`
            }</details>`
        )
        .join("")}</div>`
    : "";
  return `<div class="session-finding" data-severity="${escapeHtml(finding.severity)}">
    <div class="finding-topline">
      <span class="severity ${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span>
      <span>${escapeHtml(CATEGORY_LABELS[finding.category] ?? finding.category)}</span>
      <span>${Math.round(finding.confidence * 100)}% confidence</span>
    </div>
    <h4>${escapeHtml(finding.title)}</h4>
    <p>${escapeHtml(finding.explanation)}</p>
    <div class="next-action">${escapeHtml(finding.recommendation)}</div>
    ${evidenceBlock}
  </div>`;
}

function sessionTokens(session: LensDashboardModel["activity"]["sessions"][number]): string {
  if (session.totalTokens == null || session.tokenSource === "none") {
    return unavailableMetric("not available from this source");
  }
  const formatted = formatTokenCount(session.totalTokens);
  return session.tokenSource === "estimated" ? `~${formatted} <span class="metric-note">est.</span>` : formatted;
}

function sessionCacheHit(session: LensDashboardModel["activity"]["sessions"][number]): string {
  // Cache hit is only meaningful for exact (Claude Code) usage.
  if (session.tokenSource !== "exact" || session.cacheHitRatio == null) {
    return unavailableMetric("Claude Code only");
  }
  return `${Math.round(session.cacheHitRatio * 100)}%`;
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function sessionDuration(startedAt: string | undefined, endedAt: string | undefined): string {
  if (!startedAt || !endedAt) return unavailableMetric("not available from this source");
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return unavailableMetric("not available from this source");
  const minutes = Math.round((end - start) / 60000);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function scoreFocus(score: LensScore | undefined): string {
  if (!score) return emptyState("Score unavailable.");
  return `<div class="large-score">${score.status === "unavailable" ? "N/A" : score.value}</div>
    <h3>${escapeHtml(score.label)}</h3>
    <p>${escapeHtml(score.explanation)}</p>`;
}

function harnessInventory(model: LensDashboardModel): string {
  const harness = model.harness;
  if (!harness || harness.scannedProjectCount === 0) {
    return metricList([
      ["Project roots", unsupportedMetric("not available from analyzed inputs")],
      ["CLAUDE.md", unsupportedMetric("project root scan unavailable")],
      ["Claude settings", unsupportedMetric("project root scan unavailable")],
      ["Skills", model.skillOpportunities.length ? `${model.skillOpportunities.length} opportunity found` : "No opportunity yet"],
      ["Hooks", unsupportedMetric("project root scan unavailable")],
      ["Agents", unsupportedMetric("project root scan unavailable")],
      ["MCP config", unsupportedMetric("project root scan unavailable")]
    ]);
  }

  return metricList([
    ["Project roots scanned", `${harness.scannedProjectCount} of ${Math.max(harness.projectCount, harness.scannedProjectCount)}`],
    ["CLAUDE.md", projectCountLabel(harness.claudeMdProjects, harness.scannedProjectCount)],
    ["Claude settings", projectCountLabel(harness.settingsProjects, harness.scannedProjectCount)],
    ["Skills", model.skillOpportunities.length ? `${model.skillOpportunities.length} opportunity found` : "No repeated skill opportunity yet"],
    ["Hooks", projectCountLabel(harness.hookProjects, harness.scannedProjectCount)],
    ["Agents", projectCountLabel(harness.agentProjects, harness.scannedProjectCount)],
    ["MCP config", projectCountLabel(harness.mcpConfigProjects, harness.scannedProjectCount)]
  ]);
}

function projectCountLabel(count: number, total: number): string {
  if (count === 0) return "None detected";
  if (count === total) return `Detected in all ${total}`;
  return `Detected in ${count} of ${total}`;
}

function metricList(items: Array<[string, string]>): string {
  return `<dl class="metric-list">${items.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
}

function groupFindingsByCategory(findings: LensFinding[]): Array<[string, LensFinding[]]> {
  const groups = new Map<string, LensFinding[]>();
  for (const finding of findings) {
    const list = groups.get(finding.category) ?? [];
    list.push(finding);
    groups.set(finding.category, list);
  }
  return Array.from(groups.entries());
}

function countFindings(model: LensDashboardModel, categoryContains: string, titleContains: string): string {
  const count = model.findings.filter(
    (finding) => finding.category.includes(categoryContains) && `${finding.title} ${finding.explanation}`.toLowerCase().includes(titleContains)
  ).length;
  return count ? String(count) : "None detected";
}

function enabledSourceCount(model: LensDashboardModel): number {
  return model.sources.filter((source) => source.enabled).length;
}

function evidenceLabel(mode: LensDashboardModel["privacy"]["evidenceMode"]): string {
  return mode === "redacted_excerpts" ? "Redacted excerpts" : "Metadata only";
}

function unsupportedMetric(reason: string): string {
  return `<span class="unavailable">Unavailable: ${escapeHtml(reason)}</span>`;
}

function unavailableMetric(reason: string): string {
  return `<span class="unavailable">Unavailable: ${escapeHtml(reason)}</span>`;
}

function emptyState(message: string): string {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function formatScore(score: LensScore): string {
  return score.status === "unavailable" ? "N/A" : String(score.value);
}

function formatDate(value: string | undefined): string {
  if (!value) return "date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(value: string | number | boolean): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dashboardClientJs(): string {
  return `
const tabs = Array.from(document.querySelectorAll("[data-view-target]"));
const views = Array.from(document.querySelectorAll("[data-view]"));
const filters = Array.from(document.querySelectorAll("[data-source-filter]"));
function showView(id) {
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.viewTarget === id));
  views.forEach((view) => view.classList.toggle("active", view.dataset.view === id));
}
tabs.forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.viewTarget)));
showView("overview");
filters.forEach((button) => button.addEventListener("click", () => {
  const source = button.dataset.sourceFilter;
  filters.forEach((filter) => filter.classList.toggle("active", filter === button));
  let visibleCount = 0;
  document.querySelectorAll("[data-session-source]").forEach((row) => {
    const visible = source === "all" || row.dataset.sessionSource === source;
    row.hidden = !visible;
    if (visible) visibleCount += 1;
  });
  const empty = document.querySelector("[data-filter-empty]");
  if (empty) {
    empty.hidden = visibleCount > 0;
    if (source === "chat") {
      empty.textContent = "No supported Chat logs were found. Analyze All checks supported JSONL sessions under ~/.claude and explicit Chat exports/imports.";
    } else if (source === "cowork") {
      empty.textContent = "No supported Cowork logs were found. Analyze All checks supported local Cowork sessions and explicit Cowork exports/imports.";
    } else {
      empty.textContent = source === "all" ? "No sessions available." : \`No \${source} sessions are present in this dashboard.\`;
    }
  }
}));
filters[0]?.classList.add("active");
const reportMarkdown = JSON.parse(document.getElementById("lens-report-markdown")?.textContent ?? JSON.stringify(""));
const reportJson = document.getElementById("lens-report-json")?.textContent ?? "{}";
document.querySelector("[data-copy-report='markdown']")?.addEventListener("click", () => copyReport(reportMarkdown));
document.querySelector("[data-copy-report='json']")?.addEventListener("click", () => copyReport(reportJson));
document.addEventListener("click", (e) => {
  const button = e.target?.closest("[data-copy-text]");
  if (!button) return;
  const text = button.getAttribute("data-copy-text");
  if (text == null) return;
  const label = button.getAttribute("data-copy-label") ?? button.textContent;
  copyReport(text);
  button.textContent = "Copied";
  setTimeout(() => { button.textContent = label; }, 1200);
});
document.addEventListener("click", async (e) => {
  if (!e.target?.closest("[data-load-excerpts]")) return;
  const status = document.querySelector(".analyze-status");
  const detail = e.target?.closest("details");
  try {
    if (status) status.textContent = "Loading prompt excerpts...";
    const token = JSON.parse(document.getElementById("lens-analyze-token")?.textContent ?? JSON.stringify(""));
    const response = await fetch("/api/analyze-all?includeEvidence=1", { method: "POST", headers: { "x-inspectorclaude-token": token } });
    if (!response.ok) throw new Error("needs server");
    window.location.reload();
  } catch {
    if (status) status.textContent = "Start the Lens server to load excerpts, or re-run with --evidence-mode redacted_excerpts.";
    if (detail) detail.open = false;
  }
});
document.querySelector("[data-analyze-all]")?.addEventListener("click", async () => {
  const button = document.querySelector("[data-analyze-all]");
  const status = document.querySelector(".analyze-status");
  if (button) button.disabled = true;
  if (status) status.textContent = "Analyzing local sources...";
  try {
    const token = JSON.parse(document.getElementById("lens-analyze-token")?.textContent ?? JSON.stringify(""));
    const response = await fetch("/api/analyze-all", { method: "POST", headers: { "x-inspectorclaude-token": token } });
    if (!response.ok) throw new Error("Analyze All is unavailable from this dashboard host.");
    if (status) status.textContent = "Refreshing dashboard...";
    window.location.reload();
  } catch {
    if (status) status.textContent = "Start the Lens dashboard server to use this button.";
    if (button) button.disabled = false;
  }
});
async function copyReport(text) {
  const status = document.querySelector(".copy-status");
  try {
    await navigator.clipboard.writeText(text);
    if (status) status.textContent = "Copied";
  } catch {
    if (status) status.textContent = "Copy unavailable in this host";
  }
}`;
}

export function dashboardCss(): string {
  return `
:root {
  color-scheme: light;
  --bg: #f6f4ef;
  --surface: #fffefa;
  --surface-2: #ece7df;
  --ink: #22201c;
  --muted: #6f6a61;
  --line: #ddd0bd;
  --accent: #c25a2d;
  --accent-2: #22736b;
  --font-sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-serif: "Source Serif 4", ui-serif, Georgia, "Times New Roman", serif;
  --warning: #b66b00;
  --danger: #a43d3d;
  --good: #2f7d46;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--font-sans); }
button, pre { font: inherit; }
.app-shell { min-height: 100vh; display: grid; grid-template-columns: 248px minmax(0, 1fr); }
.sidebar { border-right: 1px solid var(--line); padding: 20px 14px; background: #faf8f3; position: sticky; top: 0; height: 100vh; }
.brand { display: grid; gap: 4px; margin-bottom: 22px; }
.brand-wordmark {
  font-family: var(--font-serif);
  font-size: 22px;
  line-height: 1;
  letter-spacing: -0.01em;
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}
.brand-mark      { font-size: 0.85em; }
.brand-inspector { color: var(--accent); font-weight: 600; }
.brand-claude    { color: var(--ink); font-weight: 600; }
.brand-subtitle, .eyebrow, .panel p, .source-row span, .session-row p, .finding-topline, .action-row span, .note-line { color: var(--muted); }
.nav-tabs { display: grid; gap: 4px; }
.nav-tab, .filter-button, .primary-button, .secondary-button { border: 1px solid transparent; background: transparent; color: var(--ink); text-align: left; border-radius: 7px; padding: 9px 10px; cursor: pointer; }
.nav-tab:hover, .nav-tab.active, .filter-button.active { background: var(--surface-2); border-color: var(--line); }
.privacy-pill { margin-top: 18px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; color: var(--muted); font-size: 13px; }
.workspace { padding: 24px; max-width: 1320px; width: 100%; }
.topbar { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 18px; align-items: start; margin-bottom: 20px; }
.topbar h1 { margin: 4px 0 0; font-size: 32px; line-height: 1.1; letter-spacing: -0.005em; font-family: var(--font-serif); font-weight: 600; }
.section-head h2,
.panel h3,
.finding-card h3,
.score-card h3,
.skill-card h3 {
  font-family: var(--font-serif);
  font-weight: 600;
  letter-spacing: -0.005em;
}
.eyebrow { margin: 0; font-size: 13px; text-transform: uppercase; }
.overall-score { min-width: 126px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 14px; text-align: center; }
.overall-score span { display: block; font-size: 34px; font-weight: 800; }
.overall-score small { color: var(--muted); text-transform: capitalize; }
.topbar-actions { display: grid; gap: 8px; justify-items: end; min-width: 132px; }
.analyze-status { color: var(--muted); font-size: 12px; min-height: 18px; text-align: right; }
.primary-button:disabled { opacity: .62; cursor: progress; }
.view { display: none; }
.view.active { display: grid; gap: 16px; }
.section-head h2, .panel h3, .skill-card h3 { margin: 0; }
.section-head p { margin: 5px 0 0; color: var(--muted); max-width: 760px; }
.score-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.score-card, .panel, .finding-card, .action-row, .source-row, .session-row, .skill-card { border: 1px solid var(--line); background: var(--surface); border-radius: 8px; }
.score-card { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 14px; padding: 14px; min-height: 132px; }
.score-card h3, .finding-card h3 { font-size: 16px; margin: 0 0 6px; }
.score-card p, .finding-card p, .action-row p, .skill-card p { margin: 0; line-height: 1.45; }
.score-ring {
  width: 68px; height: 68px;
  border-radius: 999px;
  display: grid; place-items: center;
  background: conic-gradient(var(--accent) calc(var(--score) * 1%), #d0c2a8 0);
}
.score-ring span {
  width: 46px; height: 46px;
  border-radius: 999px;
  display: grid; place-items: center;
  background: var(--surface);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  font-size: 18px;
}
.score-card.unavailable .score-ring { background: #d0c2a8; }
.two-column { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.panel { padding: 14px; min-width: 0; }
.panel-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 12px; }
.panel-head span { color: var(--muted); font-size: 13px; }
.finding-card, .action-row, .source-row, .session-row, .skill-card { padding: 12px; margin-top: 10px; }
.finding-topline { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; margin-bottom: 8px; }
.severity, .source-badge { display: inline-flex; align-items: center; height: 22px; border-radius: 999px; padding: 0 8px; background: var(--surface-2); font-size: 12px; text-transform: capitalize; }
.severity.high { color: var(--danger); }
.severity.medium { color: var(--warning); }
.severity.low, .severity.info { color: var(--accent); }
.flag-badge { display: inline-flex; align-items: center; height: 20px; border-radius: 999px; padding: 0 8px; font-size: 11px; font-weight: 600; color: var(--warning); background: color-mix(in srgb, var(--warning) 16%, transparent); text-transform: uppercase; letter-spacing: 0.03em; }
.metric-note { font-size: 11px; color: var(--muted); }
.session-count { display: inline-flex; align-items: center; height: 22px; border-radius: 999px; padding: 0 8px; background: var(--surface-2); font-size: 12px; color: var(--muted); }
.next-action { margin-top: 10px; padding: 10px; border-left: 3px solid var(--accent); background: #fbeee5; color: #5a2c10; }
.evidence-section { margin-top: 12px; }
.evidence-header { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
.evidence-list { display: flex; flex-direction: column; gap: 1px; }
.evidence-detail { margin: 0; }
.evidence-detail > summary { cursor: pointer; list-style: none; font-size: 13px; color: var(--muted); padding: 4px 6px 4px 0; display: flex; align-items: center; }
.evidence-detail > summary::-webkit-details-marker { display: none; }
.evidence-detail > summary::before { content: "›"; display: inline-block; width: 16px; font-size: 14px; transition: transform 0.1s; flex-shrink: 0; }
.evidence-detail[open] > summary::before { transform: rotate(90deg); }
.evidence-detail > summary:hover { color: var(--ink); }
.evidence-excerpt-block { margin: 4px 0 8px 20px; padding: 8px 12px; background: var(--surface-2); border-left: 3px solid var(--accent); border-radius: 0 4px 4px 0; font-size: 13px; color: var(--ink); font-style: italic; line-height: 1.5; }
.no-excerpt-hint { margin: 4px 0 8px 20px; font-size: 12px; color: var(--muted); }
.link-btn { background: none; border: none; cursor: pointer; color: var(--accent); text-decoration: underline; font-size: inherit; padding: 0; font-family: inherit; }
.source-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.source-row ul { grid-column: 1 / -1; margin: 0; padding-left: 18px; color: var(--muted); line-height: 1.4; }
.source-row.disabled { opacity: .72; }
.sparkline { height: 86px; display: flex; gap: 7px; align-items: end; padding: 8px; border: 1px solid var(--line); border-radius: 8px; background: #f7f3eb; }
.sparkline span { flex: 1; min-width: 8px; border-radius: 4px 4px 0 0; background: var(--accent); }
.filter-row, .report-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.filter-button, .secondary-button { border-color: var(--line); background: var(--surface); text-align: center; }
.primary-button { background: var(--accent); color: white; text-align: center; }
.help-panel { border: 1px solid var(--line); background: var(--surface); border-radius: 8px; margin-bottom: 10px; }
.help-panel > summary { cursor: pointer; list-style: none; padding: 12px 14px; font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 8px; }
.help-panel > summary::-webkit-details-marker { display: none; }
.help-panel .help-icon { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; color: var(--accent); font-weight: 700; transition: transform 0.12s; }
.help-panel[open] > summary .help-icon { transform: rotate(45deg); }
.help-panel .help-body { padding: 0 16px 14px; border-top: 1px solid var(--line); }
.help-panel h4 { margin: 14px 0 6px; font-size: 13px; }
.help-panel p { margin: 12px 0 0; color: var(--muted); line-height: 1.5; }
.help-panel ol, .help-panel ul { margin: 0; padding-left: 20px; display: grid; gap: 6px; }
.help-panel li { line-height: 1.5; }
.help-panel code { background: var(--surface-2); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.help-panel .help-note { font-size: 13px; font-style: italic; }
.timeline-panel { display: grid; gap: 10px; }
.session-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; margin-top: 0; }
.session-row dl, .metric-list { display: grid; grid-template-columns: repeat(3, auto); gap: 8px 14px; margin: 0; }
.session-row dl { grid-auto-flow: column; grid-template-rows: auto auto; }
.session-row dt, .metric-list dt { color: var(--muted); font-size: 12px; }
.session-row dd, .metric-list dd { margin: 0; font-weight: 650; }
.session-row--expandable { display: block; padding: 0; }
.session-summary { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: start; list-style: none; cursor: pointer; padding: 12px 34px 12px 12px; border-radius: 8px; }
.session-summary::-webkit-details-marker { display: none; }
.session-summary::after { content: "›"; position: absolute; right: 14px; top: 12px; color: var(--muted); font-size: 18px; line-height: 1; transition: transform 0.12s; }
.session-row--expandable[open] > .session-summary::after { transform: rotate(90deg); }
.session-summary:hover { background: var(--surface-2); }
.session-findings { padding: 0 12px 12px; display: grid; gap: 10px; }
.session-findings-head { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
.session-finding { border: 1px solid var(--line); border-radius: 8px; padding: 12px; background: var(--surface-2); }
.session-finding h4 { margin: 8px 0 4px; font-size: 15px; }
.session-finding p { margin: 0; color: var(--muted); line-height: 1.45; }
.session-finding .evidence-list { margin-top: 8px; }
.metric-list { grid-template-columns: 1fr; }
.metric-list div { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.large-score { font-size: 56px; line-height: 1; font-weight: 850; color: var(--accent); }
.skill-card { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: 18px; margin-top: 0; }
.skill-card dl { margin: 0; display: grid; gap: 8px; }
.skill-card dt { color: var(--muted); font-size: 12px; }
.skill-card dd { margin: 0; }
.keyword-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.keyword-tag { font-size: 12px; color: var(--muted); background: var(--surface-2); border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px; }
.skill-examples { margin: 4px 0 0; padding-left: 18px; display: grid; gap: 4px; }
.skill-examples li { line-height: 1.4; }
.skill-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.skill-actions .secondary-button { font-size: 13px; padding: 6px 10px; }
.empty-state {
  color: var(--muted);
  background: #f1ecdf;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 14px 16px;
  font-size: 14px;
  line-height: 1.45;
}
.unavailable {
  display: inline-block;
  color: var(--muted);
  background: #f1ecdf;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 13px;
}
.note-line { margin: 8px 0; line-height: 1.45; }
.report-preview pre { white-space: pre-wrap; overflow: auto; max-height: 560px; margin: 0; line-height: 1.45; color: #2f2b25; }
.copy-status { color: var(--muted); min-height: 20px; }
@media (max-width: 900px) {
  .app-shell { grid-template-columns: 1fr; }
  .sidebar { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
  .nav-tabs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .topbar, .two-column, .skill-card { grid-template-columns: 1fr; display: grid; }
  .topbar-actions { justify-items: stretch; }
  .score-grid { grid-template-columns: 1fr; }
  .workspace { padding: 16px; }
  .session-row, .session-summary { grid-template-columns: 1fr; }
}
.nav-tab,
.filter-button,
.primary-button,
.secondary-button,
.score-card,
.finding-card,
.action-row,
.source-row,
.session-row {
  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease, opacity 150ms ease;
}
.view.active {
  animation: cl-fade-in 180ms ease both;
}
@keyframes cl-fade-in {
  from { opacity: 0; transform: translateY(2px); }
  to   { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .nav-tab, .filter-button, .primary-button, .secondary-button,
  .score-card, .finding-card, .action-row, .source-row, .session-row {
    transition: none;
  }
  .view.active { animation: none; }
}
`;
}
