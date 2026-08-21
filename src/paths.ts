import os from "node:os";
import path from "node:path";

export function homeDir(): string {
  return process.env.SKILLCP_HOME || os.homedir();
}

export function projectDir(): string {
  return process.env.SKILLCP_PROJECT || process.cwd();
}

export function libraryDir(): string {
  return process.env.SKILLCP_DIR || path.join(homeDir(), ".skillcp");
}

export function xdgConfig(): string {
  return process.env.XDG_CONFIG_HOME || path.join(homeDir(), ".config");
}

export function appData(...segments: string[]): string {
  if (process.platform === "win32") {
    const root = process.env.APPDATA || path.join(homeDir(), "AppData", "Roaming");
    return path.join(root, ...segments);
  }
  if (process.platform === "darwin") {
    return path.join(homeDir(), "Library", "Application Support", ...segments);
  }
  return path.join(xdgConfig(), ...segments);
}

export function expandHome(p: string): string {
  if (p === "~") return homeDir();
  if (p.startsWith("~/")) return path.join(homeDir(), p.slice(2));
  return p;
}
