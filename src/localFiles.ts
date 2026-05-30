import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseClaudeCodeJsonlFiles } from "./parsers/claudeCodeJsonl.js";
import type { NormalizedDataset } from "./types.js";

export async function codeDatasetFromPath(pathValue: string): Promise<NormalizedDataset> {
  const paths = pathValue.split(",").map((path) => path.trim()).filter(Boolean);
  const files = (await Promise.all(paths.map((path) => jsonlFiles(resolve(path))))).flat();
  if (files.length === 0) {
    throw new Error(`No .jsonl files found at ${pathValue}`);
  }
  return attachProjectHarnessMetadata(await parseClaudeCodeJsonlFiles(files));
}

export async function jsonlFiles(path: string): Promise<string[]> {
  const info = await stat(path);
  if (info.isFile()) return path.endsWith(".jsonl") ? [path] : [];
  if (!info.isDirectory()) return [];

  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) return jsonlFiles(child);
      return Promise.resolve(entry.isFile() && entry.name.endsWith(".jsonl") ? [child] : []);
    })
  );
  return nested.flat().sort();
}

export async function attachProjectHarnessMetadata(dataset: NormalizedDataset): Promise<NormalizedDataset> {
  const scanned = new Map<string, Record<string, string | number | boolean>>();
  const interactions = await Promise.all(
    dataset.interactions.map(async (interaction) => {
      if (interaction.source !== "code" || !interaction.projectPath) return interaction;
      const projectPath = resolve(interaction.projectPath);
      if (!scanned.has(projectPath)) scanned.set(projectPath, await projectHarnessMetadata(projectPath));
      const metadata = scanned.get(projectPath) ?? { harnessScanAvailable: false };
      return {
        ...interaction,
        projectPath,
        metadata: {
          ...interaction.metadata,
          ...metadata
        }
      };
    })
  );

  return { ...dataset, interactions };
}

async function projectHarnessMetadata(projectPath: string): Promise<Record<string, string | number | boolean>> {
  const info = await safeStat(projectPath);
  if (!info?.isDirectory()) return { harnessScanAvailable: false };

  const claudeDir = join(projectPath, ".claude");
  const settings = await exists(join(claudeDir, "settings.json"));
  const agents = await hasDirectoryEntries(join(claudeDir, "agents"));
  const hooks = await hasDirectoryEntries(join(claudeDir, "hooks"));

  // Stat CLAUDE.md (try both cases) once so we get both existence and byte size.
  const claudeMdStat = (await safeStat(join(projectPath, "CLAUDE.md"))) ?? (await safeStat(join(projectPath, "claude.md")));
  const hasClaudeMd = Boolean(claudeMdStat?.isFile());
  const claudeMdBytes = hasClaudeMd ? Number(claudeMdStat?.size ?? 0) : 0;

  return {
    harnessScanAvailable: true,
    hasClaudeMd,
    claudeMdBytes,
    hasClaudeSettings: settings,
    hasClaudeAgents: agents,
    hasClaudeHooks: hooks,
    hasMcpConfig: (await exists(join(projectPath, ".mcp.json"))) || (await exists(join(projectPath, "mcp.json")))
  };
}

async function exists(path: string): Promise<boolean> {
  return Boolean(await safeStat(path));
}

async function hasDirectoryEntries(path: string): Promise<boolean> {
  const info = await safeStat(path);
  if (!info?.isDirectory()) return false;
  try {
    return (await readdir(path)).length > 0;
  } catch {
    return false;
  }
}

async function safeStat(path: string): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}
