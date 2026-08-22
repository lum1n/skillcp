import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function packageVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const file of [path.join(here, "..", "package.json"), path.join(here, "package.json")]) {
    try {
      const raw = fs.readFileSync(file, "utf8");
      const version = (JSON.parse(raw) as { version?: string }).version;
      if (version) return version;
    } catch {
      // try the next candidate
    }
  }
  return "0.0.0";
}
