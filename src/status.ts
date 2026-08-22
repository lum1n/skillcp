import { HARNESSES, detectHarnesses, resolveHarnesses } from "./harnesses.js";
import { isInitialized, libraryRoot, loadManifest } from "./library.js";
import { exists, readLink, samePath } from "./fsx.js";
import { harnessMcpTargets, readServerMap } from "./mcp-io.js";
import { loadLibraryMcp } from "./sync.js";
import { listLibrarySkills } from "./skills.js";
import { skillsRoot } from "./library.js";
import path from "node:path";
import type { Scope } from "./types.js";

export type StatusReport = {
  library: string;
  initialized: boolean;
  skills: number;
  mcp: number;
  harnesses: Array<{
    id: string;
    name: string;
    detected: boolean;
    skills: boolean;
    mcp: boolean;
    skillMatches?: number;
    skillTotal?: number;
    mcpMatches?: number;
    mcpTotal?: number;
    notes: string[];
  }>;
};

export function statusReport(scope: Scope = "global"): StatusReport {
  const skills = isInitialized() ? listLibrarySkills() : [];
  const mcp = isInitialized() ? loadLibraryMcp() : {};
  const detected = new Set(detectHarnesses().map((item) => item.id));
  const skillNames = skills.map((skill) => skill.name);

  return {
    library: libraryRoot(),
    initialized: isInitialized(),
    skills: skills.length,
    mcp: Object.keys(mcp).length,
    harnesses: HARNESSES.map((harness) => {
      const notes: string[] = [];
      let skillMatches: number | undefined;
      let mcpMatches: number | undefined;
      if (harness.skills) {
        const dir = harness.skillsDir(scope);
        skillMatches = 0;
        if (dir) {
          for (const name of skillNames) {
            const dest = path.join(dir, name);
            const linked = readLink(dest);
            if (linked && samePath(linked, path.join(skillsRoot(), name))) {
              skillMatches += 1;
            } else if (exists(dest)) {
              skillMatches += 1;
              notes.push(`skill ${name} exists but is not a skillcp link`);
            }
          }
        }
      }
      if (harness.mcp) {
        mcpMatches = 0;
        const targets = harnessMcpTargets(harness, scope);
        const primary = targets[0];
        if (primary && exists(primary.file)) {
          const present = readServerMap(primary.file, primary.format);
          mcpMatches = Object.keys(mcp).filter((name) => name in present).length;
        }
      }
      return {
        id: harness.id,
        name: harness.name,
        detected: detected.has(harness.id),
        skills: harness.skills,
        mcp: harness.mcp,
        skillMatches,
        skillTotal: harness.skills ? skillNames.length : undefined,
        mcpMatches,
        mcpTotal: harness.mcp ? Object.keys(mcp).length : undefined,
        notes,
      };
    }),
  };
}

export function doctor(to?: string[]): string[] {
  const issues: string[] = [];
  if (!isInitialized()) {
    issues.push("Library is not initialized. Run `skillcp init`.");
    return issues;
  }
  const report = statusReport();
  const harnesses = to?.length ? resolveHarnesses(to, "all") : detectHarnesses();
  const ids = new Set(harnesses.map((item) => item.id));
  for (const row of report.harnesses) {
    if (!ids.has(row.id) || !row.detected) continue;
    if (row.skills && row.skillTotal && row.skillMatches !== row.skillTotal) {
      issues.push(
        `${row.name}: ${row.skillMatches}/${row.skillTotal} skills synced. Run \`skillcp sync --to ${row.id}\`.`,
      );
    }
    if (row.mcp && row.mcpTotal && row.mcpMatches !== row.mcpTotal) {
      issues.push(
        `${row.name}: ${row.mcpMatches}/${row.mcpTotal} MCP servers synced. Run \`skillcp sync --to ${row.id}\`.`,
      );
    }
    issues.push(...row.notes.map((note) => `${row.name}: ${note}`));
  }
  const manifest = loadManifest();
  if (!manifest.mcp.includes("skillcp")) {
    issues.push("Skillcp is not installed as an MCP server. Run `skillcp install` so harnesses can manage the library.");
  }

  const detectedIds = new Set(
    report.harnesses.filter((row) => row.detected && ids.has(row.id)).map((row) => row.id),
  );
  const overlaps: Array<[string, string[], string]> = [
    ["cursor", ["claude", "codex", "agents"], "Cursor also loads Claude Code, Codex, and .agents skill folders"],
    ["copilot", ["claude", "agents"], "GitHub Copilot / VS Code also loads Claude Code and .agents skill folders"],
    ["gemini", ["agents"], "Gemini CLI also loads .agents skill folders"],
    ["pi", ["agents"], "Pi also loads .agents skill folders"],
  ];
  for (const [id, others, message] of overlaps) {
    if (!detectedIds.has(id)) continue;
    const hit = others.filter((other) => detectedIds.has(other));
    if (hit.length) {
      issues.push(`${message}, so the same Skillcp skill may appear more than once.`);
    }
  }

  return issues;
}
