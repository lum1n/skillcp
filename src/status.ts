import { HARNESSES, detectHarnesses, harnessById, resolveHarnesses, skillViewIds } from "./harnesses.js";
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
        skillMatches = 0;
        for (const name of skillNames) {
          const hits = skillLocations(harness.id, name, scope);
          if (hits.linked.length || hits.unmanaged.length) skillMatches += 1;
          if (!hits.linked.length && hits.unmanaged.length) {
            notes.push(`skill ${name} exists but is not a skillcp link`);
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

  const skillNames = listLibrarySkills().map((skill) => skill.name);
  for (const row of report.harnesses) {
    if (!ids.has(row.id) || !row.detected || !row.skills) continue;
    const duped = skillNames.filter((name) => skillLocations(row.id, name, "global").linked.length > 1);
    if (!duped.length) continue;
    const folders = [...new Set(duped.flatMap((name) => skillLocations(row.id, name, "global").linked))];
    issues.push(
      `${row.name} would see ${duped.length} skill${duped.length === 1 ? "" : "s"} more than once (${folders.join(", ")}). Run \`skillcp sync\` to keep one copy.`,
    );
  }

  return issues;
}

function skillLocations(
  harnessId: string,
  name: string,
  scope: Scope,
): { linked: string[]; unmanaged: string[] } {
  const linked: string[] = [];
  const unmanaged: string[] = [];
  for (const id of skillViewIds(harnessId)) {
    const other = harnessById(id);
    const dir = other?.skillsDir(scope);
    if (!dir) continue;
    const dest = path.join(dir, name);
    const target = readLink(dest);
    if (target && samePath(target, path.join(skillsRoot(), name))) {
      linked.push(id);
    } else if (exists(dest)) {
      unmanaged.push(id);
    }
  }
  return { linked, unmanaged };
}
