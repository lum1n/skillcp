#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist", "cli.js");
const src = join(root, "src", "cli.ts");
const command = existsSync(dist) ? process.execPath : "npx";
const args = existsSync(dist) ? [dist, "serve"] : ["tsx", src, "serve"];
const child = spawn(command, args, { stdio: "inherit", cwd: root });
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
