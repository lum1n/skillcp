import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { exists, rmrf } from "./fsx.js";
import { addSkillFromDir, findSkills, librarySkillDir, parseSkill, removeLibrarySkill } from "./skills.js";
import { loadLibraryMcp, materializeSkillCopies, saveLibraryMcp, unsyncFromHarnesses } from "./sync.js";
import { loadManifest, saveManifest } from "./library.js";
import type { McpServerConfig, SyncTarget } from "./types.js";

export function packagedSkillDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "skills", "skillcp");
}

export function skillcpMcpCommand(): { command: string; args: string[] } {
  const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
  if (exists(cli)) {
    return { command: process.execPath, args: [cli, "serve"] };
  }
  return { command: "npx", args: ["-y", "skillcp", "serve"] };
}

export function installSelfSkill(): void {
  const source = packagedSkillDir();
  if (!exists(path.join(source, "SKILL.md"))) {
    throw new Error(`Bundled skillcp skill missing at ${source}`);
  }
  addSkillFromDir(source, "bundled");
  const manifest = loadManifest();
  manifest.skills.skillcp = { origin: "bundled" };
  saveManifest(manifest);
}

export function installSelfMcp(): void {
  const mcp = loadLibraryMcp();
  const launch = skillcpMcpCommand();
  mcp.skillcp = {
    type: "stdio",
    command: launch.command,
    args: launch.args,
  };
  saveLibraryMcp(mcp);
  const manifest = loadManifest();
  if (!manifest.mcp.includes("skillcp")) manifest.mcp.push("skillcp");
  saveManifest(manifest);
}

export function addMcp(name: string, server: McpServerConfig): void {
  const mcp = loadLibraryMcp();
  mcp[name] = server;
  saveLibraryMcp(mcp);
  const manifest = loadManifest();
  if (!manifest.mcp.includes(name)) manifest.mcp.push(name);
  saveManifest(manifest);
}

export type RemoveOptions = {
  keep?: boolean;
  project?: boolean;
};

export function uninstallSkill(
  name: string,
  options: RemoveOptions = {},
): { removed: boolean; targets: SyncTarget[] } {
  if (!exists(librarySkillDir(name))) return { removed: false, targets: [] };
  const targets = options.keep
    ? materializeSkillCopies(name, { project: options.project })
    : unsyncFromHarnesses({ skills: [name], project: options.project });
  return { removed: removeLibrarySkill(name), targets };
}

export function removeMcp(name: string, options: RemoveOptions = {}): boolean {
  const mcp = loadLibraryMcp();
  if (!(name in mcp)) return false;
  delete mcp[name];
  saveLibraryMcp(mcp);
  const manifest = loadManifest();
  if (options.keep) {
    manifest.mcp = manifest.mcp.filter((item) => item !== name);
    saveManifest(manifest);
    return true;
  }
  if (!manifest.mcp.includes(name)) manifest.mcp.push(name);
  saveManifest(manifest);
  unsyncFromHarnesses({ mcp: [name], project: options.project });
  return true;
}

export function addSkillSource(source: string, subpath?: string): Array<{ name: string; dir: string }> {
  if (isGitSource(source)) {
    return addFromGit(source, subpath);
  }
  const resolved = path.resolve(source);
  const target = subpath ? path.join(resolved, subpath) : resolved;
  if (parseSkill(target)) {
    const skill = addSkillFromDir(target, target);
    rememberSkill(skill.name, target);
    return [{ name: skill.name, dir: skill.dir }];
  }
  const found = findSkills(target);
  if (!found.length) {
    throw new Error(`No SKILL.md found in ${target}`);
  }
  return found.map((skill) => {
    const added = addSkillFromDir(skill.dir, skill.dir);
    rememberSkill(added.name, skill.dir);
    return { name: added.name, dir: added.dir };
  });
}

function rememberSkill(name: string, origin: string): void {
  const manifest = loadManifest();
  manifest.skills[name] = { origin };
  saveManifest(manifest);
}

function isGitSource(source: string): boolean {
  if (exists(source)) return false;
  return (
    source.startsWith("git@") ||
    source.endsWith(".git") ||
    /^https?:\/\//.test(source) ||
    /^[\w.-]+\/[\w.-]+$/.test(source)
  );
}

function addFromGit(source: string, subpath?: string): Array<{ name: string; dir: string }> {
  const url = /^[\w.-]+\/[\w.-]+$/.test(source) ? `https://github.com/${source}.git` : source;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skillcp-"));
  try {
    const result = spawnSync("git", ["clone", "--depth", "1", url, tmp], {
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || `git clone failed for ${url}`);
    }
    const root = subpath ? path.join(tmp, subpath) : tmp;
    return addSkillSource(root);
  } finally {
    rmrf(tmp);
  }
}