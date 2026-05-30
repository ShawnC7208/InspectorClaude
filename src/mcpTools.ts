import { buildDashboardModel } from "./analyzer.js";
import { datasetForAllSources, DEFAULT_CLAUDE_CODE_LOG_PATH } from "./analyzeAll.js";
import { filterDataset, mergeDatasets } from "./dataset.js";
import { codeDatasetFromPath } from "./localFiles.js";
import { analyzeCurrentChatInput, importTranscriptInput, recordCoworkCheckpointInput } from "./parsers/explicitInputs.js";
import {
  buildCoachingReport,
  buildLensReport,
  buildPrivacyReport,
  buildSkillOpportunityReport,
  exportReportJson,
  exportReportMarkdown
} from "./reports.js";
import type { CaptureMode, CoachingCategory, LensDashboardModel, LensReport, NormalizedDataset, Source } from "./types.js";

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
};

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

export type McpToolResult = {
  content: Array<{
    type: "text";
    text: string;
  }>;
  structuredContent?: unknown;
};

type JsonObject = Record<string, unknown>;

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "show_dashboard",
    description: "Build a InspectorClaude dashboard model from supported local or explicit sources.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["code", "chat", "cowork", "all"] },
        timeRange: { type: "object", properties: { start: { type: "string" }, end: { type: "string" } } },
        projectPath: { type: "string", description: "Claude Code JSONL file or directory path." },
        taskId: { type: "string" },
        messagesOrSummary: { type: "string", description: "Explicit Claude Chat text when source is chat." },
        transcriptOrSummary: { type: "string", description: "Explicit Cowork summary when source is cowork." },
        dimensions: { type: "array", items: { type: "string" } },
        includeEvidence: { type: "boolean" }
      }
    }
  },
  {
    name: "analyze_code_logs",
    description: "Read Claude Code JSONL logs in read-only mode and return a dashboard model.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string" },
        since: { type: "string" },
        limit: { type: "number" },
        dimensions: { type: "array", items: { type: "string" } },
        includeEvidence: { type: "boolean" }
      }
    }
  },
  {
    name: "analyze_current_chat",
    description: "Analyze explicitly provided current Claude Chat text or summary.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        messagesOrSummary: { type: "string" },
        dimensions: { type: "array", items: { type: "string" } },
        includeEvidence: { type: "boolean" }
      },
      required: ["messagesOrSummary"]
    }
  },
  {
    name: "import_transcript",
    description: "Analyze an explicitly imported transcript or summary for Chat, Cowork, or Code.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["chat", "cowork", "code"] },
        title: { type: "string" },
        transcriptOrSummary: { type: "string" },
        captureMode: { type: "string" },
        dimensions: { type: "array", items: { type: "string" } },
        includeEvidence: { type: "boolean" }
      },
      required: ["source", "transcriptOrSummary"]
    }
  },
  {
    name: "record_cowork_checkpoint",
    description: "Analyze an explicit Cowork checkpoint without implying automatic Cowork telemetry.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        phase: { type: "string", enum: ["intake", "planning", "implementation", "review", "handoff", "done"] },
        summary: { type: "string" },
        artifacts: { type: "array", items: { type: "string" } },
        metrics: { type: "object" },
        dimensions: { type: "array", items: { type: "string" } },
        includeEvidence: { type: "boolean" }
      },
      required: ["taskId", "phase", "summary"]
    }
  },
  {
    name: "get_coaching_report",
    description: "Return a coaching report from an explicitly provided dashboard model.",
    inputSchema: {
      type: "object",
      properties: {
        dashboardModel: { type: "object" },
        source: { type: "string", enum: ["code", "chat", "cowork", "all"] },
        sources: { type: "array", items: { type: "string" } },
        timeRange: { type: "object", properties: { start: { type: "string" }, end: { type: "string" } } },
        projectPath: { type: "string" },
        taskId: { type: "string" },
        dimensions: { type: "array", items: { type: "string" } },
        format: { type: "string", enum: ["json", "markdown"] },
        reportType: { type: "string", enum: ["coaching", "privacy", "skill_opportunity", "session"] },
        sessionId: { type: "string" }
      }
    }
  },
  {
    name: "recommend_improvements",
    description: "Return recommendations and skill opportunities from a dashboard model.",
    inputSchema: {
      type: "object",
      properties: {
        dashboardModel: { type: "object" },
        source: { type: "string", enum: ["code", "chat", "cowork", "all"] },
        projectPath: { type: "string" },
        taskId: { type: "string" },
        dimensions: { type: "array", items: { type: "string" } }
      }
    }
  },
  {
    name: "export_report",
    description: "Export a dashboard model as Markdown or JSON report.",
    inputSchema: {
      type: "object",
      properties: {
        dashboardModel: { type: "object" },
        source: { type: "string", enum: ["code", "chat", "cowork", "all"] },
        projectPath: { type: "string" },
        timeRange: { type: "object", properties: { start: { type: "string" }, end: { type: "string" } } },
        taskId: { type: "string" },
        dimensions: { type: "array", items: { type: "string" } },
        format: { type: "string", enum: ["markdown", "json"] },
        reportType: { type: "string", enum: ["coaching", "privacy", "skill_opportunity", "session"] },
        sessionId: { type: "string" }
      },
      required: ["format"]
    }
  }
];

export async function callMcpTool(name: string, args: JsonObject = {}): Promise<McpToolResult> {
  if (name === "show_dashboard") {
    return dashboardResult(await dashboardForArgs(args));
  }

  if (name === "analyze_code_logs") {
    return dashboardResult(buildDashboardModel(await codeDatasetFromArgs(args), dashboardOptions(args)));
  }

  if (name === "analyze_current_chat") {
    const model = buildDashboardModel(
      analyzeCurrentChatInput({
        title: stringField(args.title),
        messagesOrSummary: requiredString(args, "messagesOrSummary")
      }),
      dashboardOptions(args)
    );
    return dashboardResult(model);
  }

  if (name === "import_transcript") {
    const model = buildDashboardModel(
      importTranscriptInput({
        source: sourceField(requiredString(args, "source")),
        title: stringField(args.title),
        transcriptOrSummary: requiredString(args, "transcriptOrSummary"),
        captureMode: stringField(args.captureMode) as CaptureMode | undefined
      }),
      dashboardOptions(args)
    );
    return dashboardResult(model);
  }

  if (name === "record_cowork_checkpoint") {
    const model = buildDashboardModel(
      recordCoworkCheckpointInput({
        taskId: requiredString(args, "taskId"),
        phase: coworkPhase(requiredString(args, "phase")),
        summary: requiredString(args, "summary"),
        artifacts: stringArrayField(args.artifacts),
        metrics: recordField(args.metrics)
      }),
      dashboardOptions(args)
    );
    return dashboardResult(model);
  }

  if (name === "get_coaching_report" || name === "export_report") {
    const model = await dashboardModelFromArgs(args);
    const report = reportForType(model, reportType(args), stringField(args.sessionId));
    const format = stringField(args.format) ?? "json";
    if (format === "markdown") return textResult(exportReportMarkdown(report), report);
    if (format === "json") return textResult(exportReportJson(report), report);
    throw new Error(`Unsupported report format: ${format}`);
  }

  if (name === "recommend_improvements") {
    const model = await dashboardModelFromArgs(args);
    const payload = {
      recommendations: model.recommendations,
      skillOpportunities: model.skillOpportunities,
      capabilityNotes: model.capabilityNotes
    };
    return textResult(JSON.stringify(payload, null, 2), payload);
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function dashboardForArgs(args: JsonObject): Promise<LensDashboardModel> {
  const source = stringField(args.source) ?? sourceFromSources(args.sources) ?? "all";
  if (source === "all") {
    const datasets: NormalizedDataset[] = [];
    const projectPath = stringField(args.projectPath);
    const messagesOrSummary = stringField(args.messagesOrSummary);
    const transcriptOrSummary = stringField(args.transcriptOrSummary);
    if (projectPath) datasets.push(await codeDatasetFromPath(projectPath));
    if (messagesOrSummary) datasets.push(analyzeCurrentChatInput({ messagesOrSummary }));
    if (transcriptOrSummary) datasets.push(importTranscriptInput({ source: "cowork", transcriptOrSummary, captureMode: "task_summary" }));
    const dataset = datasets.length > 0 ? mergeDatasets(datasets) : await datasetForAllSources();
    return buildDashboardModel(filterDataset(dataset, datasetFilterOptions(args)), dashboardOptions(args));
  }
  if (source === "chat") {
    return buildDashboardModel(
      filterDataset(
        analyzeCurrentChatInput({
          messagesOrSummary: requiredString(args, "messagesOrSummary")
        }),
        datasetFilterOptions(args)
      ),
      dashboardOptions(args)
    );
  }
  if (source === "cowork") {
    return buildDashboardModel(
      filterDataset(
        importTranscriptInput({
          source: "cowork",
          transcriptOrSummary: requiredString(args, "transcriptOrSummary"),
          captureMode: "task_summary"
        }),
        datasetFilterOptions(args)
      ),
      dashboardOptions(args)
    );
  }
  return buildDashboardModel(await codeDatasetFromArgs(args), dashboardOptions(args));
}

async function codeDatasetFromArgs(args: JsonObject): Promise<NormalizedDataset> {
  const projectPath = stringField(args.projectPath) ?? DEFAULT_CLAUDE_CODE_LOG_PATH;
  const dataset = await codeDatasetFromPath(projectPath);
  return filterDataset(dataset, datasetFilterOptions(args));
}

async function dashboardModelFromArgs(args: JsonObject): Promise<LensDashboardModel> {
  if (args.dashboardModel !== undefined) return dashboardModelField(args.dashboardModel);
  return dashboardForArgs(args);
}

function reportForType(model: LensDashboardModel, reportTypeValue: LensReport["reportType"], sessionId?: string): LensReport {
  if (reportTypeValue === "privacy") return buildPrivacyReport(model);
  if (reportTypeValue === "skill_opportunity") return buildSkillOpportunityReport(model);
  if (reportTypeValue === "session") {
    if (!sessionId) throw new Error("sessionId is required for session reports");
    return buildLensReport(model, { reportType: "session", sessionId });
  }
  return buildCoachingReport(model);
}

function dashboardResult(model: LensDashboardModel): McpToolResult {
  return textResult(JSON.stringify(model, null, 2), model);
}

function textResult(text: string, structuredContent?: unknown): McpToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent
  };
}

function dashboardOptions(args: JsonObject): { evidenceMode: "metadata_only" | "redacted_excerpts"; dimensions?: CoachingCategory[] } {
  return {
    evidenceMode: args.includeEvidence === true ? "redacted_excerpts" : "metadata_only",
    dimensions: dimensionsField(args.dimensions)
  };
}

function dashboardModelField(value: unknown): LensDashboardModel {
  if (!isObject(value)) throw new Error("dashboardModel must be an object");
  return value as LensDashboardModel;
}

function reportType(args: JsonObject): LensReport["reportType"] {
  const value = stringField(args.reportType) ?? "coaching";
  if (value === "coaching" || value === "session" || value === "skill_opportunity" || value === "privacy") return value;
  throw new Error(`Unsupported reportType: ${value}`);
}

function requiredString(args: JsonObject, key: string): string {
  const value = stringField(args[key]);
  if (!value) throw new Error(`Missing required argument: ${key}`);
  return value;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function stringArrayField(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return strings.length > 0 ? strings : undefined;
}

function recordField(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!isObject(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string | number | boolean] => {
    const candidate = entry[1];
    return typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "boolean";
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function dimensionsField(value: unknown): CoachingCategory[] | undefined {
  const values = stringArrayField(value);
  if (!values) return undefined;
  const dimensions = values.filter((item): item is CoachingCategory =>
    item === "prompt_clarity" ||
    item === "context_health" ||
    item === "workflow_structure" ||
    item === "ai_harness" ||
    item === "efficiency" ||
    item === "privacy"
  );
  return dimensions.length > 0 ? dimensions : undefined;
}

function sourceFromSources(value: unknown): Source | "all" | undefined {
  const values = stringArrayField(value);
  if (!values) return undefined;
  if (values.length > 1) return "all";
  const [source] = values;
  return source === "chat" || source === "cowork" || source === "code" ? source : undefined;
}

function datasetFilterOptions(args: JsonObject): Parameters<typeof filterDataset>[1] {
  return {
    timeRange: timeRangeField(args.timeRange),
    since: stringField(args.since),
    limit: numberField(args.limit),
    taskId: stringField(args.taskId)
  };
}

function timeRangeField(value: unknown): { start?: string; end?: string } | undefined {
  if (!isObject(value)) return undefined;
  const start = stringField(value.start);
  const end = stringField(value.end);
  return start || end ? { start, end } : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sourceField(value: string): Source {
  if (value === "chat" || value === "cowork" || value === "code") return value;
  throw new Error(`Unsupported source: ${value}`);
}

function coworkPhase(value: string): "intake" | "planning" | "implementation" | "review" | "handoff" | "done" {
  if (value === "intake" || value === "planning" || value === "implementation" || value === "review" || value === "handoff" || value === "done") return value;
  throw new Error(`Unsupported Cowork phase: ${value}`);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
