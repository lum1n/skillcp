import fs from "node:fs";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

export type JsonObject = Record<string, unknown>;

export function exists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function lexists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

export function writeText(file: string, contents: string): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, contents.endsWith("\n") ? contents : `${contents}\n`);
}

export function readJsonc<T = JsonObject>(file: string): T | undefined {
  const text = readText(file);
  if (text === undefined || text.trim() === "") return undefined;
  return parseJsonc(text) as T;
}

export function writeJson(file: string, value: unknown): void {
  writeText(file, JSON.stringify(value, null, 2));
}

export function readToml<T = JsonObject>(file: string): T | undefined {
  const text = readText(file);
  if (text === undefined || text.trim() === "") return undefined;
  return parseToml(text) as T;
}

export function writeToml(file: string, value: JsonObject): void {
  writeText(file, stringifyToml(value));
}

export function backupFile(file: string, backupDir: string): string | undefined {
  if (!exists(file)) return undefined;
  ensureDir(backupDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(backupDir, `${stamp}-${path.basename(file)}`);
  fs.copyFileSync(file, dest);
  return dest;
}

export function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function readLink(p: string): string | undefined {
  try {
    const stat = fs.lstatSync(p);
    if (!stat.isSymbolicLink()) return undefined;
    const target = fs.readlinkSync(p);
    return path.resolve(path.dirname(p), target);
  } catch {
    return undefined;
  }
}

export function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

export function copyDir(src: string, dest: string): void {
  fs.cpSync(src, dest, { recursive: true, force: true });
}

export function rmrf(p: string): void {
  fs.rmSync(p, { recursive: true, force: true });
}

export function listDirs(dir: string): string[] {
  if (!isDir(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => path.join(dir, entry.name));
}

export function which(bin: string): boolean {
  const pathEnv = process.env.PATH || "";
  const ext = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of pathEnv.split(path.delimiter)) {
    for (const suffix of ext) {
      if (exists(path.join(dir, bin + suffix))) return true;
    }
  }
  return false;
}
