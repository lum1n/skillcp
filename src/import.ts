import path from "node:path";
import { resolveHarnesses, type Harness } from "./harnesses.js";
import { loadManifest, saveManifest } from "./library.js";
import { harnessMcpTargets, readServerMap } from "./mcp-io.js";
import { loadLibraryMcp, saveLibraryMcp } from "./sync.js";
import { addSkillFromDir, findSkills, librarySkillDir, listLibrarySkills } from "./skills.js";
import { readLink, samePath } from "./fsx.js";
import type { McpServerMap, Scope, SkillRecord } from "./types.js";

export type ImportOptions = {
  to?: string[];
  all?: boolean;
  project?: boolean;
  global?: boolean;
  overwrite?: boolean;
  skills?: boolean;
  mcp?: boolean;
};

export type ImportResult = {
  skills: Array<{ name: string; action: "added" | "skipped" | "replaced"; from: string }>;
  mcp: Array<{ name: string; action: "added" | "skipped" | "replaced"; from: string }>;
};

function scopes(options: ImportOptions): Scope[] {
  const out: Scope[] = [];
  if (options.global !== false) out.push("global");
  if (options.project) out.push("project");
  return out.length ? out : ["global"];
}

export function importFromHarnesses(options: ImportOptions = {}): ImportResult {
  const harnesses = resolveHarnesses(options.to, options.all ? "all" : "detected");
  const result: ImportResult = { skills: [], mcp: [] };
  const manifest = loadManifest();
  const librarySkills = new Set(listLibrarySkills().map((skill) => skill.name));
  const mcp = loadLibraryMcp();

  for (const harness of harnesses) {
    for (const scope of scopes(options)) {
      if (options.skills !== false && harness.skills) {
        importSkills(harness, scope, librarySkills, result, options.overwrite);
      }
      if (options.mcp !== false && harness.mcp) {
        importMcp(harness, scope, mcp, result, options.overwrite);
      }
    }
  }

  saveLibraryMcp(mcp);
  for (const skill of result.skills) {
    if (skill.action !== "skipped") manifest.skills[skill.name] = { origin: skill.from };
  }
  for (const server of result.mcp) {
    if (server.action !== "skipped" && !manifest.mcp.includes(server.name)) {
      manifest.mcp.push(server.name);
    }
  }
  saveManifest(manifest);
  return result;
}

function importSkills(
  harness: Harness,
  scope: Scope,
  librarySkills: Set<string>,
  result: ImportResult,
  overwrite?: boolean,
): void {
  const dir = harness.skillsDir(scope);
  if (!dir) return;
  for (const skill of findSkills(dir)) {
    const dest = librarySkillDir(skill.name);
    const real = readLink(skill.dir) ?? skill.dir;
    if (samePath(real, dest) || samePath(skill.dir, dest)) {
      result.skills.push({ name: skill.name, action: "skipped", from: skill.dir });
      continue;
    }
    if (librarySkills.has(skill.name) && !overwrite) {
      result.skills.push({ name: skill.name, action: "skipped", from: skill.dir });
      continue;
    }
    const action = librarySkills.has(skill.name) ? "replaced" : "added";
    addSkillFromDir(skill.dir, skill.dir);
    librarySkills.add(skill.name);
    result.skills.push({ name: skill.name, action, from: skill.dir });
  }
}

function importMcp(
  harness: Harness,
  scope: Scope,
  mcp: McpServerMap,
  result: ImportResult,
  overwrite?: boolean,
): void {
  for (const target of harnessMcpTargets(harness, scope)) {
    const incoming = readServerMap(target.file, target.format);
    for (const [name, server] of Object.entries(incoming)) {
      if (name in mcp && !overwrite) {
        result.mcp.push({ name, action: "skipped", from: target.file });
        continue;
      }
      const action = name in mcp ? "replaced" : "added";
      mcp[name] = server;
      result.mcp.push({ name, action, from: `${harness.id}:${path.basename(target.file)}` });
    }
  }
}

export function summarizeImport(result: ImportResult): string {
  const skillLine = result.skills
    .filter((item) => item.action !== "skipped")
    .map((item) => item.name);
  const mcpLine = result.mcp.filter((item) => item.action !== "skipped").map((item) => item.name);
  return `Imported ${skillLine.length} skills and ${mcpLine.length} MCP servers.`;
}

export type { SkillRecord };
