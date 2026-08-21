import fs from "node:fs";
import path from "node:path";
import { HARNESSES, resolveHarnesses, type Harness } from "./harnesses.js";
import {
  copyDir,
  ensureDir,
  exists,
  lexists,
  listDirs,
  readJsonc,
  readLink,
  rmrf,
  samePath,
  writeJson,
} from "./fsx.js";
import { loadManifest, mcpFile as libraryMcpFile, saveManifest, skillStrategy, skillsRoot } from "./library.js";
import { harnessMcpTargets, writeServerMap } from "./mcp-io.js";
import { extractMap } from "./mcp-format.js";
import { listLibrarySkills } from "./skills.js";
import type { McpServerMap, Scope, SyncTarget } from "./types.js";

export type SyncOptions = {
  to?: string[];
  all?: boolean;
  project?: boolean;
  global?: boolean;
  dryRun?: boolean;
  force?: boolean;
  prune?: boolean;
  skills?: boolean;
  mcp?: boolean;
};

export type UnsyncOptions = {
  skills?: string[];
  mcp?: string[];
  to?: string[];
  all?: boolean;
  project?: boolean;
  dryRun?: boolean;
};

function scopes(options: SyncOptions): Scope[] {
  const wantGlobal = options.global !== false;
  const wantProject = Boolean(options.project);
  if (!wantGlobal && !wantProject) return ["global"];
  const out: Scope[] = [];
  if (wantGlobal) out.push("global");
  if (wantProject) out.push("project");
  return out;
}

function linkSkill(src: string, dest: string, force: boolean, dryRun: boolean): SyncTarget["action"] {
  const current = readLink(dest);
  if (current && samePath(current, src)) return "unchanged";
  if (lexists(dest) && !force && !current) return "skip";
  if (dryRun) return "link";
  if (lexists(dest)) rmrf(dest);
  ensureDir(path.dirname(dest));
  const type = process.platform === "win32" ? "junction" : "dir";
  try {
    fs.symlinkSync(src, dest, type);
    return "link";
  } catch {
    copyDir(src, dest);
    return "copy";
  }
}

function isLibrarySkillLink(dest: string, name: string): boolean {
  const target = readLink(dest);
  if (!target) return false;
  return samePath(target, path.join(skillsRoot(), name));
}

function removeSkillDest(dest: string, dryRun: boolean): SyncTarget["action"] {
  if (!lexists(dest)) return "unchanged";
  if (dryRun) return "remove";
  rmrf(dest);
  return "remove";
}

function copySkill(src: string, dest: string, force: boolean, dryRun: boolean): SyncTarget["action"] {
  if (lexists(dest) && !force) {
    const current = readLink(dest);
    if (current && samePath(current, src)) {
      if (dryRun) return "copy";
      rmrf(dest);
    } else if (!current) {
      return "skip";
    }
  }
  if (dryRun) return "copy";
  if (lexists(dest)) rmrf(dest);
  copyDir(src, dest);
  return "copy";
}

export function loadLibraryMcp(): McpServerMap {
  return extractMap(readJsonc(libraryMcpFile()) ?? { mcpServers: {} }, "mcpServers");
}

export function saveLibraryMcp(map: McpServerMap): void {
  writeJson(libraryMcpFile(), { mcpServers: map });
}

export function syncAll(options: SyncOptions = {}): SyncTarget[] {
  const harnesses = resolveHarnesses(options.to, options.all ? "all" : "detected");
  const doSkills = options.skills !== false;
  const doMcp = options.mcp !== false;
  const targets: SyncTarget[] = [];
  const strategy = skillStrategy();
  const skills = listLibrarySkills();
  const mcp = loadLibraryMcp();
  const manifest = loadManifest();
  const managedMcp = manifest.mcp.length ? manifest.mcp : Object.keys(mcp);

  for (const harness of harnesses) {
    for (const scope of scopes(options)) {
      if (doSkills && harness.skills) {
        const dir = harness.skillsDir(scope);
        if (dir) {
          const libraryNames = new Set(skills.map((skill) => skill.name));
          for (const skill of skills) {
            const dest = path.join(dir, skill.name);
            const src = path.join(skillsRoot(), skill.name);
            let action: SyncTarget["action"] = "skip";
            let detail: string | undefined;
            try {
              action =
                strategy === "copy"
                  ? copySkill(src, dest, Boolean(options.force), Boolean(options.dryRun))
                  : linkSkill(src, dest, Boolean(options.force), Boolean(options.dryRun));
              if (action === "skip") detail = "existing files, pass --force to replace";
            } catch (error) {
              action = "skip";
              detail = error instanceof Error ? error.message : String(error);
            }
            targets.push({ harness: harness.id, kind: "skills", scope, path: dest, action, detail });
          }
          for (const dest of listDirs(dir)) {
            const name = path.basename(dest);
            if (libraryNames.has(name) || !isLibrarySkillLink(dest, name)) continue;
            const action = removeSkillDest(dest, Boolean(options.dryRun));
            targets.push({
              harness: harness.id,
              kind: "skills",
              scope,
              path: dest,
              action,
              detail: "orphan skillcp link",
            });
          }
        }
      }

      if (doMcp && harness.mcp) {
        const prune = managedMcp.filter((name) => !(name in mcp));
        for (const target of harnessMcpTargets(harness, scope)) {
          const result = writeServerMap(target.file, target.format, mcp, {
            prune,
            dryRun: options.dryRun,
          });
          targets.push({
            harness: harness.id,
            kind: "mcp",
            scope,
            path: target.file,
            action: result.changed ? "write" : "unchanged",
            detail: `${Object.keys(mcp).length} servers`,
          });
        }
      }
    }
  }

  if (!options.dryRun) {
    const next = loadManifest();
    for (const skill of skills) {
      next.skills[skill.name] = next.skills[skill.name] ?? {};
    }
    next.mcp = Array.from(new Set([...next.mcp, ...Object.keys(mcp)]));
    saveManifest(next);
  }

  return targets;
}

export function unsyncFromHarnesses(options: UnsyncOptions = {}): SyncTarget[] {
  const skillNames = options.skills ?? [];
  const mcpNames = options.mcp ?? [];
  if (!skillNames.length && !mcpNames.length) return [];

  const harnesses = resolveHarnesses(options.to, options.all ? "all" : "detected");
  const library = loadLibraryMcp();
  const targets: SyncTarget[] = [];
  const dryRun = Boolean(options.dryRun);

  for (const harness of harnesses) {
    for (const scope of scopes({ project: options.project })) {
      if (skillNames.length && harness.skills) {
        const dir = harness.skillsDir(scope);
        if (dir) {
          for (const name of skillNames) {
            const dest = path.join(dir, name);
            const action = removeSkillDest(dest, dryRun);
            targets.push({
              harness: harness.id,
              kind: "skills",
              scope,
              path: dest,
              action,
              detail: action === "remove" ? "unsynced" : undefined,
            });
          }
        }
      }

      if (mcpNames.length && harness.mcp) {
        for (const target of harnessMcpTargets(harness, scope)) {
          if (!exists(target.file)) {
            targets.push({
              harness: harness.id,
              kind: "mcp",
              scope,
              path: target.file,
              action: "unchanged",
            });
            continue;
          }
          const result = writeServerMap(target.file, target.format, library, {
            prune: mcpNames,
            dryRun,
          });
          targets.push({
            harness: harness.id,
            kind: "mcp",
            scope,
            path: target.file,
            action: result.changed ? "remove" : "unchanged",
            detail: mcpNames.join(", "),
          });
        }
      }
    }
  }

  return targets;
}

export function materializeSkillCopies(
  name: string,
  options: { to?: string[]; all?: boolean; project?: boolean; dryRun?: boolean } = {},
): SyncTarget[] {
  const src = path.join(skillsRoot(), name);
  if (!exists(src)) return [];
  const harnesses = resolveHarnesses(options.to, options.all ? "all" : "detected");
  const targets: SyncTarget[] = [];
  const dryRun = Boolean(options.dryRun);

  for (const harness of harnesses) {
    if (!harness.skills) continue;
    for (const scope of scopes({ project: options.project })) {
      const dir = harness.skillsDir(scope);
      if (!dir) continue;
      const dest = path.join(dir, name);
      if (!isLibrarySkillLink(dest, name)) {
        targets.push({ harness: harness.id, kind: "skills", scope, path: dest, action: "unchanged" });
        continue;
      }
      if (!dryRun) {
        rmrf(dest);
        copyDir(src, dest);
      }
      targets.push({
        harness: harness.id,
        kind: "skills",
        scope,
        path: dest,
        action: "copy",
        detail: "kept as a local copy",
      });
    }
  }

  return targets;
}

export function supportedHarnessIds(): string[] {
  return HARNESSES.map((harness) => harness.id);
}

export function describeHarness(harness: Harness, scope: Scope = "global"): {
  skillsDir?: string;
  mcpFile?: string;
  detected: boolean;
} {
  return {
    skillsDir: harness.skillsDir(scope),
    mcpFile: harness.mcpFile(scope),
    detected: harness.detect(),
  };
}
