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
        let unmanaged = 0;
        for (const name of skillNames) {
          const hits = skillLocations(harness.id, name, scope);
          if (hits.linked.length || hits.unmanaged.length) skillMatches += 1;
          if (!hits.linked.length && hits.unmanaged.length) unmanaged += 1;
        }
        if (unmanaged) {
          notes.push(
            `${unmanaged} skill${unmanaged === 1 ? " is" : "s are"} existing folders, not Skillcp links`,
          );
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

export type DoctorFinding = {
  kind: "unmanaged-skills" | "missing-skills" | "missing-mcp" | "duplicates" | "self-mcp" | "uninit";
  level: "info" | "warn";
  title: string;
  detail?: string;
  names?: string[];
  harness?: string;
  action?: string;
};

export function compactList(names: string[], max = 6): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} +${names.length - max} more`;
}

export function formatFinding(item: DoctorFinding): string {
  const names = item.names?.length ? ` (${compactList(item.names)})` : "";
  const detail = item.detail ? ` ${item.detail}` : "";
  const action = item.action ? ` ${item.action}` : "";
  return `${item.title}${names}.${detail}${action}`.replace(/\.\s*\./g, ".").replace(/\s{2,}/g, " ").trim();
}

export function doctorReport(to?: string[], scope: Scope = "global"): DoctorFinding[] {
  if (!isInitialized()) {
    return [{ kind: "uninit", level: "warn", title: "Library is not initialized", action: "Run `skillcp init`." }];
  }

  const report = statusReport(scope);
  const harnesses = to?.length ? resolveHarnesses(to, "all") : resolveHarnesses(undefined, "detected");
  const ids = new Set(harnesses.map((item) => item.id));
  const skillNames = listLibrarySkills().map((skill) => skill.name);
  const findings: DoctorFinding[] = [];
  const unmanagedHosts: string[] = [];
  const unmanagedNames = new Set<string>();

  for (const row of report.harnesses) {
    if (!ids.has(row.id) || !row.detected) continue;

    if (row.skills && row.skillTotal) {
      const unmanaged: string[] = [];
      let present = 0;
      for (const name of skillNames) {
        const hits = skillLocations(row.id, name, scope);
        if (hits.linked.length || hits.unmanaged.length) present += 1;
        if (!hits.linked.length && hits.unmanaged.length) unmanaged.push(name);
      }
      if (unmanaged.length) {
        unmanagedHosts.push(row.name);
        for (const name of unmanaged) unmanagedNames.add(name);
      }
      const missing = row.skillTotal - present;
      if (missing > 0) {
        findings.push({
          kind: "missing-skills",
          level: "warn",
          title: `${row.name} is missing ${missing} of ${row.skillTotal} library skills`,
          harness: row.id,
          action: `Run \`skillcp sync --to ${row.id}\`.`,
        });
      }
    }

    if (row.mcp && row.mcpTotal && row.mcpMatches !== row.mcpTotal) {
      findings.push({
        kind: "missing-mcp",
        level: "warn",
        title: `${row.name} has ${row.mcpMatches ?? 0} of ${row.mcpTotal} MCP servers`,
        harness: row.id,
        action: `Run \`skillcp sync --to ${row.id}\`.`,
      });
    }
  }

  if (unmanagedNames.size) {
    findings.unshift({
      kind: "unmanaged-skills",
      level: "info",
      title: `${unmanagedNames.size} skill${unmanagedNames.size === 1 ? " is an existing folder" : "s are existing folders"}, not Skillcp links`,
      detail: `Seen by ${unmanagedHosts.join(", ")}. Import copies into the library and leaves the originals. Sync replaces those folders with links.`,
      names: [...unmanagedNames].sort(),
      action: "Sync to replace those copies with Skillcp links.",
    });
  }

  const manifest = loadManifest();
  if (!manifest.mcp.includes("skillcp")) {
    findings.push({
      kind: "self-mcp",
      level: "info",
      title: "Skillcp is not installed as an MCP server",
      action: "Run `skillcp install` so harnesses can manage the library.",
    });
  }

  for (const row of report.harnesses) {
    if (!ids.has(row.id) || !row.detected || !row.skills) continue;
    const duped = skillNames.filter((name) => skillLocations(row.id, name, scope).linked.length > 1);
    if (!duped.length) continue;
    const folders = [...new Set(duped.flatMap((name) => skillLocations(row.id, name, scope).linked))];
    const leftover = folders.includes(row.id);
    const labels = folders
      .filter((id) => id !== row.id)
      .map((id) => harnessById(id)?.name ?? id);
    if (!leftover && labels.length) {
      findings.push({
        kind: "duplicates",
        level: "info",
        title: `${row.name} also loads ${joinNames(labels)}`,
        detail: `Those products each need their own folder, so ${row.name} will list both copies. Sync cannot fold them into one place.`,
        harness: row.id,
      });
      continue;
    }
    findings.push({
      kind: "duplicates",
      level: "warn",
      title: `${row.name} would see ${duped.length} skill${duped.length === 1 ? "" : "s"} more than once`,
      names: folders,
      harness: row.id,
      action: "Run `skillcp sync` to keep one copy.",
    });
  }

  return findings;
}

export function doctor(to?: string[]): string[] {
  return doctorReport(to).map(formatFinding);
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
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
