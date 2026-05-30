import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { callMcpTool, MCP_TOOLS } from "../src/mcpTools.js";

type JsonRpcResponse = {
  id: number;
  result?: unknown;
  error?: { message: string };
};

test("MCP tool list includes V1 tool names", () => {
  const names = MCP_TOOLS.map((tool) => tool.name);

  assert.deepEqual(
    [
      "show_dashboard",
      "analyze_code_logs",
      "analyze_current_chat",
      "import_transcript",
      "record_cowork_checkpoint",
      "get_coaching_report",
      "recommend_improvements",
      "export_report"
    ].every((name) => names.includes(name)),
    true
  );
});

test("MCP schemas expose V1 contract filters and checkpoint fields", () => {
  const analyzeCode = MCP_TOOLS.find((tool) => tool.name === "analyze_code_logs");
  const checkpoint = MCP_TOOLS.find((tool) => tool.name === "record_cowork_checkpoint");
  const report = MCP_TOOLS.find((tool) => tool.name === "get_coaching_report");

  assert.ok(JSON.stringify(analyzeCode?.inputSchema).includes("since"));
  assert.ok(JSON.stringify(analyzeCode?.inputSchema).includes("limit"));
  assert.ok(JSON.stringify(analyzeCode?.inputSchema).includes("dimensions"));
  assert.ok(JSON.stringify(checkpoint?.inputSchema).includes("artifacts"));
  assert.ok(JSON.stringify(checkpoint?.inputSchema).includes("metrics"));
  assert.equal(report?.inputSchema.required?.includes("dashboardModel") ?? false, false);
});

test("MCP analyze_current_chat returns metadata-only dashboard structured content", async () => {
  const result = await callMcpTool("analyze_current_chat", {
    messagesOrSummary: "Help improve this launch plan. Email me@example.com."
  });
  const model = result.structuredContent as {
    privacy: { evidenceMode: string };
    sources: Array<{ source: string; enabled: boolean }>;
    findings: Array<{ category: string; evidence?: Array<{ excerpt?: string }> }>;
  };

  assert.equal(model.privacy.evidenceMode, "metadata_only");
  assert.equal(model.sources.find((source) => source.source === "chat")?.enabled, true);
  assert.ok(model.findings.some((finding) => finding.category === "privacy"));
  assert.equal(model.findings.some((finding) => finding.evidence?.some((evidence) => evidence.excerpt)), false);
});

test("MCP analyze_code_logs applies limit and dimension filters", async () => {
  const result = await callMcpTool("analyze_code_logs", {
    projectPath: "fixtures/claude-code-sample.jsonl,fixtures/claude-code-context-harness.jsonl",
    limit: 1,
    dimensions: ["privacy"]
  });
  const model = result.structuredContent as {
    scores: Array<{ id: string }>;
    findings: Array<{ category: string }>;
    activity: { sessions: Array<{ interactionId: string }> };
  };

  assert.equal(model.activity.sessions.length, 1);
  assert.deepEqual(model.scores.map((score) => score.id), ["privacy"]);
  assert.equal(model.findings.every((finding) => finding.category === "privacy"), true);
});

test("MCP report tools can build from explicit source inputs without a dashboardModel", async () => {
  const result = await callMcpTool("get_coaching_report", {
    source: "chat",
    messagesOrSummary: "Help improve this launch plan for executives.",
    dimensions: ["prompt_clarity"],
    format: "json"
  });
  const report = result.structuredContent as {
    reportType: string;
    dashboardModel: { sources: Array<{ source: string; enabled: boolean }>; scores: Array<{ id: string }> };
  };

  assert.equal(report.reportType, "coaching");
  assert.equal(report.dashboardModel.sources.find((source) => source.source === "chat")?.enabled, true);
  assert.deepEqual(report.dashboardModel.scores.map((score) => score.id), ["prompt_clarity"]);
});

test("MCP export_report returns Markdown from dashboard model", async () => {
  const dashboard = await callMcpTool("analyze_code_logs", {
    projectPath: "fixtures/claude-code-sample.jsonl"
  });
  const report = await callMcpTool("export_report", {
    dashboardModel: dashboard.structuredContent,
    format: "markdown"
  });

  assert.ok(report.content[0].text.includes("# InspectorClaude Coaching Report"));
  assert.ok(report.content[0].text.includes("Evidence mode: metadata only"));
});

test("MCP show_dashboard source all combines provided source inputs", async () => {
  const result = await callMcpTool("show_dashboard", {
    source: "all",
    projectPath: "fixtures/claude-code-sample.jsonl",
    messagesOrSummary: "Help improve this",
    transcriptOrSummary: "Claude should review the launch materials."
  });
  const model = result.structuredContent as {
    sources: Array<{ source: string; enabled: boolean }>;
  };

  assert.equal(model.sources.find((source) => source.source === "code")?.enabled, true);
  assert.equal(model.sources.find((source) => source.source === "chat")?.enabled, true);
  assert.equal(model.sources.find((source) => source.source === "cowork")?.enabled, true);
});

test("MCP session reports require sessionId and scope findings when provided", async () => {
  const dashboard = await callMcpTool("analyze_code_logs", {
    projectPath: "fixtures/claude-code-sample.jsonl"
  });
  const model = dashboard.structuredContent as {
    activity: { sessions: Array<{ interactionId: string }> };
  };
  const sessionId = model.activity.sessions[0].interactionId;

  await assert.rejects(
    callMcpTool("export_report", {
      dashboardModel: dashboard.structuredContent,
      format: "json",
      reportType: "session"
    }),
    /sessionId is required/
  );

  const report = await callMcpTool("export_report", {
    dashboardModel: dashboard.structuredContent,
    format: "json",
    reportType: "session",
    sessionId
  });
  const parsed = JSON.parse(report.content[0].text);
  assert.equal(parsed.findings.every((finding: { interactionIds: string[] }) => finding.interactionIds.includes(sessionId)), true);
});

test("stdio MCP server initializes, lists tools, and calls analyze_code_logs", async () => {
  const { server, framedResponses } = spawnMcpServer();
  try {
    server.stdin.write(frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
    server.stdin.write(frame({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
    server.stdin.write(frame({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "analyze_code_logs", arguments: { projectPath: "fixtures/claude-code-sample.jsonl" } }
    }));
    // analyze_code_logs does real I/O through a cold-started server process — needs more time
    await waitFor(() => framedResponses.length >= 3, 5000);
    assert.equal(framedResponses[0].id, 1);
    assert.ok(JSON.stringify(framedResponses[1].result).includes("analyze_code_logs"));
    assert.ok(JSON.stringify(framedResponses[2].result).includes("metadata_only"));
  } finally {
    server.kill();
  }
});

test("stdio MCP server echoes Claude Code initialize protocol version", async () => {
  const { server, framedResponses } = spawnMcpServer();
  try {
    server.stdin.write(frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } }));
    await waitFor(() => framedResponses.length >= 1);
    const result = framedResponses[0].result as { protocolVersion?: string };
    assert.equal(result.protocolVersion, "2025-11-25");
  } finally {
    server.kill();
  }
});

test("stdio MCP server responds to health-check ping", async () => {
  const { server, framedResponses } = spawnMcpServer();
  try {
    server.stdin.write(frame({ jsonrpc: "2.0", id: 1, method: "ping", params: {} }));
    await waitFor(() => framedResponses.length >= 1);
    assert.equal(framedResponses[0].id, 1);
    assert.deepEqual(framedResponses[0].result, {});
  } finally {
    server.kill();
  }
});

test("stdio MCP server accepts unframed JSON-RPC without trailing newline", async () => {
  const { server, lineResponses } = spawnMcpServer();
  try {
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
    await waitFor(() => lineResponses.length >= 1);
    assert.equal(lineResponses[0].id, 1);
    assert.ok(JSON.stringify(lineResponses[0].result).includes("inspectorclaude"));
  } finally {
    server.kill();
  }
});

test("stdio MCP server reads advertised dashboard resource", async () => {
  const { server, framedResponses } = spawnMcpServer();
  try {
    server.stdin.write(frame({ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "inspectorclaude://dashboard" } }));
    await waitFor(() => framedResponses.length >= 1);
    const payload = JSON.stringify(framedResponses[0].result);
    assert.ok(payload.includes("text/html"));
    assert.ok(payload.includes("InspectorClaude"));
    assert.ok(payload.includes("data-view=\\\"overview\\\""));
  } finally {
    server.kill();
  }
});

function spawnMcpServer() {
  const server = spawn("node", ["dist/src/mcpServer.js"], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
  const framedResponses: JsonRpcResponse[] = [];
  const lineResponses: JsonRpcResponse[] = [];
  // Use raw Buffers so .length is always byte count, matching Content-Length headers.
  let framedBuffer = Buffer.alloc(0);
  let lineBuffer = Buffer.alloc(0);

  server.stdout.on("data", (chunk: Buffer) => {
    framedBuffer = Buffer.concat([framedBuffer, chunk]);
    let response: JsonRpcResponse | undefined;
    while ((response = takeFramed()) !== undefined) framedResponses.push(response);

    lineBuffer = Buffer.concat([lineBuffer, chunk]);
    let lineResponse: JsonRpcResponse | undefined;
    while ((lineResponse = takeLine()) !== undefined) lineResponses.push(lineResponse);
  });

  function takeFramed(): JsonRpcResponse | undefined {
    const sep = framedBuffer.indexOf("\r\n\r\n");
    if (sep === -1) return undefined;
    const header = framedBuffer.slice(0, sep).toString("utf8");
    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!lengthMatch) return undefined;
    const length = Number.parseInt(lengthMatch[1], 10);
    const bodyStart = sep + 4;
    if (framedBuffer.length < bodyStart + length) return undefined;
    const body = framedBuffer.slice(bodyStart, bodyStart + length).toString("utf8");
    framedBuffer = framedBuffer.slice(bodyStart + length);
    return JSON.parse(body) as JsonRpcResponse;
  }

  function takeLine(): JsonRpcResponse | undefined {
    const nl = lineBuffer.indexOf("\n");
    if (nl === -1) return undefined;
    const line = lineBuffer.slice(0, nl).toString("utf8").trim();
    lineBuffer = lineBuffer.slice(nl + 1);
    if (!line.startsWith("{")) return undefined;
    try { return JSON.parse(line) as JsonRpcResponse; } catch { return undefined; }
  }

  return { server, framedResponses, lineResponses };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for MCP server response");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function frame(message: unknown): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}
