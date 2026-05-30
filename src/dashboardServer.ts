#!/usr/bin/env node
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { datasetForAllSources, ensureDefaultImportFolders } from "./analyzeAll.js";
import { buildDashboardModel } from "./analyzer.js";
import { renderDashboardHtml } from "./dashboardHtml.js";

const DEFAULT_PORT = 8765;

async function main(argv: string[]): Promise<void> {
  const port = Number.parseInt(option(argv, "--port") ?? String(DEFAULT_PORT), 10);
  const analyzeToken = randomBytes(24).toString("hex");
  await ensureDefaultImportFolders();
  let html = await renderAnalyzeAll(analyzeToken);

  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && (request.url === "/" || request.url === "/inspectorclaude-dashboard.html")) {
        write(response, 200, "text/html; charset=utf-8", html);
        return;
      }

      if (request.method === "POST" && request.url === "/api/analyze-all") {
        if (!validAnalyzeRequest(request, analyzeToken)) {
          write(response, 403, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: "Analyze All request was rejected." }));
          return;
        }
        html = await renderAnalyzeAll(analyzeToken);
        write(response, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, refreshedAt: new Date().toISOString() }));
        return;
      }

      write(response, 404, "text/plain; charset=utf-8", "Not found");
    } catch (error) {
      write(response, 500, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
  });

  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`InspectorClaude dashboard server running at http://127.0.0.1:${port}/inspectorclaude-dashboard.html\n`);
  });
}

async function renderAnalyzeAll(analyzeToken: string): Promise<string> {
  const model = buildDashboardModel(await datasetForAllSources());
  return renderDashboardHtml(model, { title: "InspectorClaude", analyzeToken });
}

function validAnalyzeRequest(request: IncomingMessage, analyzeToken: string): boolean {
  const token = request.headers["x-inspectorclaude-token"];
  if (typeof token !== "string") return false;
  const expected = Buffer.from(analyzeToken);
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function write(response: ServerResponse, statusCode: number, contentType: string, body: string): void {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  response.end(body);
}

function option(argv: string[], key: string): string | undefined {
  const index = argv.indexOf(key);
  if (index === -1) return undefined;
  return argv[index + 1];
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
