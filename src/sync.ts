import fs from "node:fs";
import path from "node:path";
import { HARNESSES, resolveHarnesses, type Harness } from "./harnesses.js";
import { copyDir, ensureDir, exists, readJsonc, readLink, rmrf, samePath, writeJson } from "./fsx.js";
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
  if (exists(dest) && !force && !current) return "skip";
  if (dryRun) return "link";
  if (exists(dest)) rmrf(dest);
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

function copySkill(src: string, dest: string, force: boolean, dryRun: boolean): SyncTarget["action"] {
  if (exists(dest) && !force) {
    const current = readLink(dest);
    if (current && samePath(current, src)) {
      if (dryRun) return "copy";
      rmrf(dest);
    } else if (!current) {
      return "skip";
    }
  }
  if (dryRun) return "copy";
  if (exists(dest)) rmrf(dest);
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
        }
      }

      if (doMcp && harness.mcp) {
        const prune = options.prune
          ? managedMcp.filter((name) => !(name in mcp))
          : undefined;
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
