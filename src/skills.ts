import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { copyDir, ensureDir, exists, isDir, listDirs, readText, writeText } from "./fsx.js";
import { loadManifest, saveManifest, skillsRoot } from "./library.js";
import type { SkillRecord } from "./types.js";

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseSkill(dir: string): SkillRecord | undefined {
  const skillFile = path.join(dir, "SKILL.md");
  if (!exists(skillFile)) return undefined;
  const text = readText(skillFile);
  if (text === undefined) return undefined;
  const parsed = matter(text);
  const folder = path.basename(dir);
  const name =
    typeof parsed.data.name === "string" && parsed.data.name.trim()
      ? parsed.data.name.trim()
      : folder;
  const description =
    typeof parsed.data.description === "string" ? parsed.data.description.trim() : "";
  return { name, description, dir };
}

export function validateSkillName(name: string): string[] {
  const errors: string[] = [];
  if (name.length < 1 || name.length > 64) errors.push("name must be 1-64 characters");
  if (!NAME_RE.test(name)) {
    errors.push("name must be lowercase letters, numbers, and single hyphens");
  }
  return errors;
}

export function findSkills(root: string): SkillRecord[] {
  if (!isDir(root)) return [];
  const found: SkillRecord[] = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    if (!current) break;
    if (exists(path.join(current, "SKILL.md"))) {
      const skill = parseSkill(current);
      if (skill) found.push(skill);
      continue;
    }
    for (const child of listDirs(current)) stack.push(child);
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

export function listLibrarySkills(): SkillRecord[] {
  return findSkills(skillsRoot());
}

export function librarySkillDir(name: string): string {
  return path.join(skillsRoot(), name);
}

export function addSkillFromDir(source: string, origin?: string): SkillRecord {
  const skill = parseSkill(source);
  if (!skill) {
    throw new Error(`No SKILL.md found in ${source}`);
  }
  const errors = validateSkillName(skill.name);
  if (errors.length) {
    throw new Error(`Invalid skill name "${skill.name}": ${errors.join("; ")}`);
  }
  const dest = librarySkillDir(skill.name);
  if (exists(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  copyDir(source, dest);
  return { ...parseSkill(dest)!, origin };
}

export function removeLibrarySkill(name: string): boolean {
  const dest = librarySkillDir(name);
  if (!exists(dest)) return false;
  fs.rmSync(dest, { recursive: true, force: true });
  const manifest = loadManifest();
  delete manifest.skills[name];
  saveManifest(manifest);
  return true;
}

export function readSkillMarkdown(name: string): string | undefined {
  return readText(path.join(librarySkillDir(name), "SKILL.md"));
}

export function skillBody(markdown: string): string {
  return matter(markdown).content.replace(/^\s+/, "").replace(/\s+$/, "");
}

export function writeLibrarySkill(name: string, description: string, body: string): SkillRecord {
  const errors = validateSkillName(name);
  if (errors.length) {
    throw new Error(`Invalid skill name "${name}": ${errors.join("; ")}`);
  }
  const desc = description.trim();
  if (!desc) throw new Error("description is required");
  if (desc.length > 1024) throw new Error("description must be at most 1024 characters");
  const dest = librarySkillDir(name);
  ensureDir(dest);
  const markdown = `---\nname: ${name}\ndescription: ${JSON.stringify(desc)}\n---\n\n${body.trim()}\n`;
  writeText(path.join(dest, "SKILL.md"), markdown);
  const record = parseSkill(dest);
  if (!record) throw new Error(`Failed to write skill "${name}"`);
  const manifest = loadManifest();
  manifest.skills[name] = manifest.skills[name] ?? { origin: "web" };
  saveManifest(manifest);
  return record;
}
