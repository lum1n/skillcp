import path from "node:path";
import { libraryDir } from "./paths.js";
import { ensureDir, exists, readJsonc, writeJson } from "./fsx.js";
import type { LibraryConfig, Manifest, SkillStrategy } from "./types.js";

const DEFAULT_CONFIG: LibraryConfig = {
  skillStrategy: "symlink",
};

const EMPTY_MANIFEST: Manifest = {
  skills: {},
  mcp: [],
};

export function libraryRoot(): string {
  return libraryDir();
}

export function skillsRoot(): string {
  return path.join(libraryRoot(), "skills");
}

export function mcpFile(): string {
  return path.join(libraryRoot(), "mcp.json");
}

export function configFile(): string {
  return path.join(libraryRoot(), "config.json");
}

export function manifestFile(): string {
  return path.join(libraryRoot(), "manifest.json");
}

export function backupRoot(): string {
  return path.join(libraryRoot(), "backups");
}

export function isInitialized(): boolean {
  return exists(configFile());
}

export function initLibrary(): void {
  ensureDir(skillsRoot());
  if (!exists(configFile())) writeJson(configFile(), DEFAULT_CONFIG);
  if (!exists(mcpFile())) writeJson(mcpFile(), { mcpServers: {} });
  if (!exists(manifestFile())) writeJson(manifestFile(), EMPTY_MANIFEST);
}

export function loadConfig(): LibraryConfig {
  const raw = readJsonc<LibraryConfig>(configFile());
  return { ...DEFAULT_CONFIG, ...raw };
}

export function saveConfig(config: LibraryConfig): void {
  writeJson(configFile(), config);
}

export function loadManifest(): Manifest {
  const raw = readJsonc<Manifest>(manifestFile());
  if (!raw) return { skills: {}, mcp: [] };
  return {
    skills: raw.skills ?? {},
    mcp: Array.isArray(raw.mcp) ? raw.mcp : [],
  };
}

export function saveManifest(manifest: Manifest): void {
  writeJson(manifestFile(), manifest);
}

export function skillStrategy(): SkillStrategy {
  return loadConfig().skillStrategy ?? "symlink";
}
