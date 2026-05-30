#!/usr/bin/env node
import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { callMcpTool } from "./mcpTools.js";
import { renderMcpAppHtml } from "./mcpAppHtml.js";

const DASHBOARD_URI = "ui://inspectorclaude/dashboard.html";
const PORT = Number(process.env.CLAUDE_LENS_PORT ?? 3765);

// Last parsed dashboard model — persisted across requests so /preview can render
// live data without re-analysis. Markdown is generated lazily on each /preview GET.
let lastDashboardModel: unknown | null = null;

const strOpt = z.string().optional();
const boolOpt = z.boolean().optional();
const strArrOpt = z.array(z.string()).optional();
const timeRangeOpt = z.object({ start: strOpt, end: strOpt }).optional();

function createMcpServer(): McpServer {
  const server = new McpServer({ name: "inspectorclaude", version: "0.1.0" });

  registerAppTool(
    server,
    "show_dashboard",
    {
      description: "Show the InspectorClaude coaching dashboard. Call with NO arguments to automatically read local Claude Code logs from disk — no chat content or other input needed. Only pass source='chat' with messagesOrSummary if you specifically want to analyze chat text. The default behavior (no args) reads Claude Code session logs automatically.",
      inputSchema: {
        source: z.enum(["code", "chat", "cowork", "all"]).optional(),
        timeRange: timeRangeOpt,
        projectPath: strOpt,
        taskId: strOpt,
        messagesOrSummary: strOpt,
        transcriptOrSummary: strOpt,
        dimensions: strArrOpt,
        includeEvidence: boolOpt
      },
      _meta: { ui: { resourceUri: DASHBOARD_URI } }
    },
    async (args) => {
      const result = await callMcpTool("show_dashboard", args as Record<string, unknown>);
      // Store the model so /preview can show live data. Markdown is built lazily
      // on each /preview GET — not here — to avoid doubling every tool call.
      try {
        const text = result.content.find((c: { type: string }) => c.type === "text") as { text: string } | undefined;
        if (text?.text) lastDashboardModel = JSON.parse(text.text);
      } catch {
        // Non-fatal — preview state stays stale rather than crashing the tool response
      }
      return { content: result.content };
    }
  );

  server.registerTool(
    "analyze_code_logs",
    {
      description: "Read Claude Code JSONL logs in read-only mode and return a dashboard model.",
      inputSchema: {
        projectPath: strOpt,
        since: strOpt,
        limit: z.number().optional(),
        dimensions: strArrOpt,
        includeEvidence: boolOpt
      }
    },
    async (args) => {
      const result = await callMcpTool("analyze_code_logs", args as Record<string, unknown>);
      return { content: result.content };
    }
  );

  server.registerTool(
    "analyze_current_chat",
    {
      description: "Analyze explicitly provided current Claude Chat text or summary.",
      inputSchema: {
        title: strOpt,
        messagesOrSummary: z.string(),
        dimensions: strArrOpt,
        includeEvidence: boolOpt
      }
    },
    async (args) => {
      const result = await callMcpTool("analyze_current_chat", args as Record<string, unknown>);
      return { content: result.content };
    }
  );

  server.registerTool(
    "import_transcript",
    {
      description: "Analyze an explicitly imported transcript or summary for Chat, Cowork, or Code.",
      inputSchema: {
        source: z.enum(["chat", "cowork", "code"]),
        title: strOpt,
        transcriptOrSummary: z.string(),
        captureMode: strOpt,
        dimensions: strArrOpt,
        includeEvidence: boolOpt
      }
    },
    async (args) => {
      const result = await callMcpTool("import_transcript", args as Record<string, unknown>);
      return { content: result.content };
    }
  );

  server.registerTool(
    "record_cowork_checkpoint",
    {
      description: "Analyze an explicit Cowork checkpoint without implying automatic Cowork telemetry.",
      inputSchema: {
        taskId: z.string(),
        phase: z.enum(["intake", "planning", "implementation", "review", "handoff", "done"]),
        summary: z.string(),
        artifacts: strArrOpt,
        metrics: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
        dimensions: strArrOpt,
        includeEvidence: boolOpt
      }
    },
    async (args) => {
      const result = await callMcpTool("record_cowork_checkpoint", args as Record<string, unknown>);
      return { content: result.content };
    }
  );

  server.registerTool(
    "get_coaching_report",
    {
      description: "Return a coaching report from an explicitly provided dashboard model.",
      inputSchema: {
        dashboardModel: z.record(z.string(), z.unknown()).optional(),
        source: z.enum(["code", "chat", "cowork", "all"]).optional(),
        timeRange: timeRangeOpt,
        projectPath: strOpt,
        taskId: strOpt,
        dimensions: strArrOpt,
        format: z.enum(["json", "markdown"]).optional(),
        reportType: z.enum(["coaching", "privacy", "skill_opportunity", "session"]).optional(),
        sessionId: strOpt
      }
    },
    async (args) => {
      const result = await callMcpTool("get_coaching_report", args as Record<string, unknown>);
      return { content: result.content };
    }
  );

  server.registerTool(
    "recommend_improvements",
    {
      description: "Return recommendations and skill opportunities from a dashboard model.",
      inputSchema: {
        dashboardModel: z.record(z.string(), z.unknown()).optional(),
        source: z.enum(["code", "chat", "cowork", "all"]).optional(),
        projectPath: strOpt,
        taskId: strOpt,
        dimensions: strArrOpt
      }
    },
    async (args) => {
      const result = await callMcpTool("recommend_improvements", args as Record<string, unknown>);
      return { content: result.content };
    }
  );

  server.registerTool(
    "export_report",
    {
      description: "Export a dashboard model as Markdown or JSON report.",
      inputSchema: {
        dashboardModel: z.record(z.string(), z.unknown()).optional(),
        source: z.enum(["code", "chat", "cowork", "all"]).optional(),
        projectPath: strOpt,
        timeRange: timeRangeOpt,
        taskId: strOpt,
        dimensions: strArrOpt,
        format: z.enum(["markdown", "json"]),
        reportType: z.enum(["coaching", "privacy", "skill_opportunity", "session"]).optional(),
        sessionId: strOpt
      }
    },
    async (args) => {
      const result = await callMcpTool("export_report", args as Record<string, unknown>);
      return { content: result.content };
    }
  );

  registerAppResource(
    server,
    "InspectorClaude Dashboard",
    DASHBOARD_URI,
    { description: "Interactive InspectorClaude coaching dashboard." },
    async () => ({
      contents: [
        {
          uri: DASHBOARD_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: renderMcpAppHtml()
        }
      ]
    })
  );

  return server;
}

const app = express();
app.use(cors());
app.use(express.json());

// Preview endpoint — open in browser to see the dashboard with live data.
// On first load (no cached model) it auto-analyzes all local sources so the page
// renders immediately rather than waiting for a tool call from Claude.
app.get("/preview", async (_req, res) => {
  res.setHeader("Content-Type", "text/html");

  // Auto-analyze on first visit so the page is immediately useful without
  // needing to run show_dashboard in Claude first.
  if (!lastDashboardModel) {
    try {
      const result = await callMcpTool("show_dashboard", {});
      const text = result.content.find((c: { type: string }) => c.type === "text") as { text: string } | undefined;
      if (text?.text) lastDashboardModel = JSON.parse(text.text);
    } catch {
      // Analysis failed — fall through to the shell below.
    }
  }

  if (!lastDashboardModel) {
    res.send(renderMcpAppHtml());
    return;
  }

  try {
    const rptResult = await callMcpTool("get_coaching_report", { format: "markdown", dashboardModel: lastDashboardModel });
    const rptText = rptResult.content.find((c: { type: string }) => c.type === "text") as { text: string } | undefined;
    res.send(renderMcpAppHtml({ model: lastDashboardModel, reportMd: rptText?.text ?? "" }));
  } catch {
    res.send(renderMcpAppHtml({ model: lastDashboardModel, reportMd: "" }));
  }
});

// Preview JSON endpoint — lets the in-browser preview page re-fetch the dashboard
// model with redacted excerpts included. The browser preview has no Claude host to
// receive postMessage tool calls, so excerpt loading goes through HTTP instead.
app.get("/preview/data", async (req, res) => {
  const includeEvidence = req.query.includeEvidence === "1" || req.query.includeEvidence === "true";
  try {
    const result = await callMcpTool("show_dashboard", includeEvidence ? { includeEvidence: true } : {});
    const text = result.content.find((c: { type: string }) => c.type === "text") as { text: string } | undefined;
    if (text?.text) lastDashboardModel = JSON.parse(text.text);
    let reportMd = "";
    try {
      const rptResult = await callMcpTool("get_coaching_report", { format: "markdown", dashboardModel: lastDashboardModel });
      const rptText = rptResult.content.find((c: { type: string }) => c.type === "text") as { text: string } | undefined;
      reportMd = rptText?.text ?? "";
    } catch {
      // Report generation is best-effort — the model still renders without it.
    }
    res.json({ model: lastDashboardModel, reportMd });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Health-check: Claude.ai connector UI probes GET /mcp to show a green status badge.
// The actual MCP JSON-RPC calls use POST — this GET just confirms the server is reachable.
app.get("/mcp", (_req, res) => {
  res.status(200).json({ status: "ok", server: "inspectorclaude", version: "0.1.0", protocol: "MCP Streamable HTTP" });
});

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer();
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("finish", () => server.close());
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: String(err) });
    }
  }
});

app.listen(PORT, () => {
  console.log(`\nInspectorClaude MCP App server running on http://localhost:${PORT}\n`);
  console.log("Visual dashboard (browser preview):");
  console.log(`  http://localhost:${PORT}/preview`);
  console.log("  → Ask Claude to call show_dashboard first, then open or refresh this URL.\n");
  console.log("MCP connector (tool calls only — App UI rendering pending Anthropic support):");
  console.log(`  1. Open Claude → Settings → Connectors → Add custom connector`);
  console.log(`  2. Enter URL: http://localhost:${PORT}/mcp  (requires HTTPS — use ngrok for Claude.ai)`);
  console.log(`  3. Name it "InspectorClaude"`);
  console.log(`  4. Ask Claude: "Show me my InspectorClaude dashboard"\n`);
});
