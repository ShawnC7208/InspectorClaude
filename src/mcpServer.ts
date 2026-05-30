#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { emptyDashboardModel, renderDashboardHtml } from "./dashboardHtml.js";
import { callMcpTool, MCP_TOOLS } from "./mcpTools.js";
import type { LensDashboardModel } from "./types.js";

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

const SERVER_INFO = {
  name: "inspectorclaude",
  version: "0.1.0"
};

let inputBuffer = "";
let lastDashboardModel: LensDashboardModel | undefined;
let outputMode: "framed" | "line" = "framed";

trace("start");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  trace(`stdin ${JSON.stringify(chunk)}`);
  inputBuffer += chunk;
  void drainInput();
});

async function drainInput(): Promise<void> {
  while (true) {
    const message = nextMessage();
    if (!message) return;
    await handleMessage(message);
  }
}

async function handleMessage(message: string): Promise<void> {
  trace(`message ${message}`);
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(message) as JsonRpcRequest;
  } catch {
    writeResponse(null, undefined, { code: -32700, message: "Parse error" });
    return;
  }

  try {
    const result = await handleRequest(request);
    if (request.id !== undefined) writeResponse(request.id, result);
  } catch (error) {
    if (request.id !== undefined) {
      writeResponse(request.id, undefined, {
        code: -32000,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

async function handleRequest(request: JsonRpcRequest): Promise<unknown> {
  if (request.method === "initialize") {
    return {
      protocolVersion: initializeProtocolVersion(request.params),
      capabilities: {
        tools: {},
        resources: {}
      },
      serverInfo: SERVER_INFO
    };
  }

  if (request.method === "ping") {
    return {};
  }

  if (request.method === "tools/list") {
    return { tools: MCP_TOOLS };
  }

  if (request.method === "tools/call") {
    const params = request.params ?? {};
    const name = typeof params.name === "string" ? params.name : undefined;
    if (!name) throw new Error("tools/call requires params.name");
    const args = isObject(params.arguments) ? params.arguments : {};
    const result = await callMcpTool(name, args);
    if (isDashboardModel(result.structuredContent)) lastDashboardModel = result.structuredContent;
    return result;
  }

  if (request.method === "resources/list") {
    return {
      resources: [
        {
          uri: "inspectorclaude://dashboard",
          name: "InspectorClaude dashboard",
          description: "Local-first visual coaching dashboard rendered from the latest LensDashboardModel in this MCP session.",
          mimeType: "text/html"
        }
      ]
    };
  }

  if (request.method === "resources/read") {
    const uri = typeof request.params?.uri === "string" ? request.params.uri : undefined;
    if (uri !== "inspectorclaude://dashboard") throw new Error(`Unknown resource: ${uri ?? "(missing)"}`);
    return {
      contents: [
        {
          uri,
          mimeType: "text/html",
          text: renderDashboardHtml(lastDashboardModel ?? emptyDashboardModel(), {
            title: "InspectorClaude Dashboard"
          })
        }
      ]
    };
  }

  if (request.method === "notifications/initialized") {
    return {};
  }

  throw new Error(`Unsupported method: ${request.method ?? "(missing)"}`);
}

function initializeProtocolVersion(params: Record<string, unknown> | undefined): string {
  return typeof params?.protocolVersion === "string" ? params.protocolVersion : "2024-11-05";
}

function writeResponse(id: string | number | null, result?: unknown, error?: { code: number; message: string }): void {
  const response = error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result };
  const body = JSON.stringify(response);
  trace(`response ${body}`);
  if (outputMode === "line") {
    process.stdout.write(`${body}\n`);
    return;
  }
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function trace(message: string): void {
  if (!process.env.CLAUDE_LENS_MCP_TRACE) return;
  try {
    appendFileSync(process.env.CLAUDE_LENS_MCP_TRACE, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    // Tracing is best-effort and must never affect MCP behavior.
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDashboardModel(value: unknown): value is LensDashboardModel {
  return isObject(value) && typeof value.generatedAt === "string" && Array.isArray(value.sources) && isObject(value.privacy);
}

function nextMessage(): string | undefined {
  const trimmed = inputBuffer.trimStart();
  if (trimmed.length !== inputBuffer.length) inputBuffer = trimmed;
  if (!inputBuffer) return undefined;

  if (inputBuffer.toLowerCase().startsWith("content-length:")) {
    const headerEnd = inputBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return undefined;
    const header = inputBuffer.slice(0, headerEnd);
    const lengthMatch = header.match(/content-length:\s*(\d+)/i);
    if (!lengthMatch) {
      inputBuffer = inputBuffer.slice(headerEnd + 4);
      return "";
    }
    const length = Number.parseInt(lengthMatch[1], 10);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (inputBuffer.length < bodyEnd) return undefined;
    const body = inputBuffer.slice(bodyStart, bodyEnd);
    inputBuffer = inputBuffer.slice(bodyEnd);
    outputMode = "framed";
    return body;
  }

  const newlineIndex = inputBuffer.indexOf("\n");
  if (newlineIndex === -1) {
    if (inputBuffer.trimStart().startsWith("{")) {
      try {
        const body = inputBuffer.trim();
        JSON.parse(body);
        inputBuffer = "";
        outputMode = "line";
        return body;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
  const line = inputBuffer.slice(0, newlineIndex).trim();
  inputBuffer = inputBuffer.slice(newlineIndex + 1);
  outputMode = "line";
  return line || undefined;
}
