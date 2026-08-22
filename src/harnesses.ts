import path from "node:path";
import { appData, homeDir, projectDir, xdgConfig } from "./paths.js";
import { exists, isDir, which } from "./fsx.js";
import type { Scope } from "./types.js";

export type McpFormat =
  | "mcpServers"
  | "vscode-servers"
  | "claude-json"
  | "gemini-settings"
  | "opencode"
  | "codex-toml";

export type Harness = {
  id: string;
  name: string;
  skills: boolean;
  mcp: boolean;
  /** Other harness ids whose skill folders this host also scans. */
  alsoLoads?: readonly string[];
  detect: () => boolean;
  skillsDir: (scope: Scope) => string | undefined;
  mcpFile: (scope: Scope) => string | undefined;
  mcpFormat: (scope: Scope) => McpFormat | undefined;
};

function cursorDir(): string {
  return path.join(homeDir(), ".cursor");
}

function claudeDir(): string {
  return path.join(homeDir(), ".claude");
}

function copilotDir(): string {
  return path.join(homeDir(), ".copilot");
}

function windsurfDir(): string {
  return path.join(homeDir(), ".windsurf");
}

function codeiumWindsurfDir(): string {
  return path.join(homeDir(), ".codeium", "windsurf");
}

function codexDir(): string {
  return path.join(homeDir(), ".codex");
}

function geminiDir(): string {
  return path.join(homeDir(), ".gemini");
}

function opencodeDir(): string {
  return path.join(xdgConfig(), "opencode");
}

function clineDir(): string {
  return path.join(homeDir(), ".cline");
}

function agentsDir(): string {
  return path.join(homeDir(), ".agents");
}

function piAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || path.join(homeDir(), ".pi", "agent");
}

function vscodeUserMcp(): string {
  return appData("Code", "User", "mcp.json");
}

function claudeDesktopMcp(): string {
  if (process.platform === "darwin") {
    return path.join(homeDir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (process.platform === "win32") {
    return path.join(appData("Claude"), "claude_desktop_config.json");
  }
  return path.join(xdgConfig(), "Claude", "claude_desktop_config.json");
}

export const HARNESSES: Harness[] = [
  {
    id: "cursor",
    name: "Cursor",
    skills: true,
    mcp: true,
    alsoLoads: ["claude", "codex", "agents"],
    detect: () => isDir(cursorDir()) || which("cursor") || which("cursor-agent"),
    skillsDir: (scope) =>
      scope === "global" ? path.join(cursorDir(), "skills") : path.join(projectDir(), ".cursor", "skills"),
    mcpFile: (scope) =>
      scope === "global" ? path.join(cursorDir(), "mcp.json") : path.join(projectDir(), ".cursor", "mcp.json"),
    mcpFormat: () => "mcpServers",
  },
  {
    id: "claude",
    name: "Claude Code",
    skills: true,
    mcp: true,
    detect: () => isDir(claudeDir()) || exists(path.join(homeDir(), ".claude.json")) || which("claude"),
    skillsDir: (scope) =>
      scope === "global" ? path.join(claudeDir(), "skills") : path.join(projectDir(), ".claude", "skills"),
    mcpFile: (scope) =>
      scope === "global" ? path.join(homeDir(), ".claude.json") : path.join(projectDir(), ".mcp.json"),
    mcpFormat: () => "claude-json",
  },
  {
    id: "copilot",
    name: "GitHub Copilot / VS Code",
    skills: true,
    mcp: true,
    alsoLoads: ["claude", "agents"],
    detect: () => isDir(copilotDir()) || exists(vscodeUserMcp()),
    skillsDir: (scope) =>
      scope === "global" ? path.join(copilotDir(), "skills") : path.join(projectDir(), ".github", "skills"),
    mcpFile: (scope) =>
      scope === "global" ? path.join(copilotDir(), "mcp-config.json") : path.join(projectDir(), ".vscode", "mcp.json"),
    mcpFormat: (scope) => (scope === "global" ? "mcpServers" : "vscode-servers"),
  },
  {
    id: "windsurf",
    name: "Windsurf",
    skills: true,
    mcp: true,
    detect: () => isDir(windsurfDir()) || isDir(codeiumWindsurfDir()) || which("windsurf"),
    skillsDir: (scope) =>
      scope === "global" ? path.join(windsurfDir(), "skills") : path.join(projectDir(), ".windsurf", "skills"),
    mcpFile: (scope) =>
      scope === "global"
        ? path.join(codeiumWindsurfDir(), "mcp_config.json")
        : path.join(projectDir(), ".windsurf", "mcp.json"),
    mcpFormat: () => "mcpServers",
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    skills: true,
    mcp: true,
    alsoLoads: ["agents"],
    detect: () => isDir(codexDir()) || which("codex"),
    skillsDir: (scope) =>
      scope === "global" ? path.join(codexDir(), "skills") : path.join(projectDir(), ".codex", "skills"),
    mcpFile: (scope) =>
      scope === "global" ? path.join(codexDir(), "config.toml") : path.join(projectDir(), ".codex", "config.toml"),
    mcpFormat: () => "codex-toml",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    skills: true,
    mcp: true,
    alsoLoads: ["agents"],
    detect: () => isDir(geminiDir()) || which("gemini"),
    skillsDir: (scope) =>
      scope === "global" ? path.join(geminiDir(), "skills") : path.join(projectDir(), ".gemini", "skills"),
    mcpFile: (scope) =>
      scope === "global"
        ? path.join(geminiDir(), "settings.json")
        : path.join(projectDir(), ".gemini", "settings.json"),
    mcpFormat: () => "gemini-settings",
  },
  {
    id: "opencode",
    name: "OpenCode",
    skills: true,
    mcp: true,
    detect: () => isDir(opencodeDir()) || which("opencode"),
    skillsDir: (scope) =>
      scope === "global"
        ? path.join(opencodeDir(), "skills")
        : path.join(projectDir(), ".opencode", "skills"),
    mcpFile: (scope) =>
      scope === "global"
        ? path.join(opencodeDir(), "opencode.json")
        : path.join(projectDir(), "opencode.json"),
    mcpFormat: () => "opencode",
  },
  {
    id: "cline",
    name: "Cline",
    skills: false,
    mcp: true,
    detect: () => isDir(clineDir()) || which("cline"),
    skillsDir: () => undefined,
    mcpFile: (scope) => (scope === "global" ? path.join(clineDir(), "mcp.json") : undefined),
    mcpFormat: () => "mcpServers",
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    skills: false,
    mcp: true,
    detect: () => exists(claudeDesktopMcp()) || isDir(path.dirname(claudeDesktopMcp())),
    skillsDir: () => undefined,
    mcpFile: (scope) => (scope === "global" ? claudeDesktopMcp() : undefined),
    mcpFormat: () => "mcpServers",
  },
  {
    id: "agents",
    name: "Generic .agents",
    skills: true,
    mcp: false,
    detect: () => isDir(agentsDir()) || isDir(path.join(projectDir(), ".agents")),
    skillsDir: (scope) =>
      scope === "global" ? path.join(agentsDir(), "skills") : path.join(projectDir(), ".agents", "skills"),
    mcpFile: () => undefined,
    mcpFormat: () => undefined,
  },
  {
    id: "pi",
    name: "Pi",
    skills: true,
    mcp: true,
    alsoLoads: ["agents"],
    detect: () => isDir(piAgentDir()) || isDir(path.join(homeDir(), ".pi")),
    skillsDir: (scope) =>
      scope === "global"
        ? path.join(piAgentDir(), "skills")
        : path.join(projectDir(), ".pi", "skills"),
    mcpFile: (scope) =>
      scope === "global"
        ? path.join(piAgentDir(), "mcp.json")
        : path.join(projectDir(), ".pi", "mcp.json"),
    mcpFormat: () => "mcpServers",
  },
];

export function harnessById(id: string): Harness | undefined {
  const needle = id.toLowerCase();
  return HARNESSES.find((harness) => harness.id === needle || harness.name.toLowerCase() === needle);
}

export function detectHarnesses(): Harness[] {
  return HARNESSES.filter((harness) => harness.detect());
}

export function asHarnessIds(value: string[] | string | undefined): string[] | undefined {
  if (value == null || value === "") return undefined;
  const list = Array.isArray(value) ? value : [value];
  const out = list
    .flatMap((item) => String(item).split(/[,\s]+/))
    .map((item) => item.trim())
    .filter(Boolean);
  return out.length ? out : undefined;
}

export function resolveHarnesses(ids: string[] | string | undefined, fallback: "detected" | "all"): Harness[] {
  const wanted = asHarnessIds(ids);
  if (wanted?.length) {
    return wanted.map((id) => {
      const harness = harnessById(id);
      if (!harness) {
        throw new Error(`Unknown harness "${id}". Supported: ${HARNESSES.map((item) => item.id).join(", ")}`);
      }
      return harness;
    });
  }
  if (fallback === "all") return [...HARNESSES];
  return detectHarnesses();
}

export function skillViewIds(id: string): string[] {
  const harness = harnessById(id);
  return [id, ...(harness?.alsoLoads ?? [])];
}

export function seesSkillDir(viewerId: string, destId: string): boolean {
  return skillViewIds(viewerId).includes(destId);
}

function requiredSkillViewers(destIds: string[]): string[] {
  const products = destIds.filter((id) => id !== "agents");
  return products.length ? products : destIds;
}

/**
 * Choose the fewest skill folders that still reach every product harness.
 * Shared dumps like `.agents` are used only when they do not make another
 * host see the same Skillcp skill twice.
 */
export function pickSkillWriteIds(ids: string[]): string[] {
  const dests = [...new Set(ids)].filter((id) => harnessById(id)?.skills);
  const required = requiredSkillViewers(dests);
  if (!dests.length) return [];
  if (!required.length) return dests;

  let best: string[] | undefined;
  let bestDups = Infinity;
  let bestWrites = Infinity;
  let bestKey = "";

  const n = dests.length;
  const limit = 1 << n;
  for (let mask = 1; mask < limit; mask++) {
    const writes: string[] = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) writes.push(dests[i]!);
    }
    let uncovered = 0;
    let dups = 0;
    for (const viewer of required) {
      let seen = 0;
      for (const dest of writes) {
        if (seesSkillDir(viewer, dest)) seen += 1;
      }
      if (seen === 0) uncovered += 1;
      if (seen > 1) dups += seen - 1;
    }
    if (uncovered) continue;
    const key = writes.slice().sort().join(",");
    if (dups < bestDups || (dups === bestDups && writes.length < bestWrites) || (dups === bestDups && writes.length === bestWrites && key < bestKey)) {
      best = writes;
      bestDups = dups;
      bestWrites = writes.length;
      bestKey = key;
    }
  }

  return best ?? dests;
}

export function coveredByIds(viewerId: string, writeIds: readonly string[]): string[] {
  return writeIds.filter((dest) => seesSkillDir(viewerId, dest));
}

export function vscodeGlobalMcpFile(): string {
  return vscodeUserMcp();
}

export function extraCopilotProjectMcp(): string {
  return path.join(projectDir(), ".github", "copilot", "mcp.json");
}
