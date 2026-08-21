#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { HARNESSES } from "./harnesses.js";
import { importFromHarnesses } from "./import.js";
import { addMcp, addSkillSource, installSelfMcp, installSelfSkill, removeMcp } from "./install.js";
import { initLibrary, isInitialized, libraryRoot } from "./library.js";
import { parseServerInput } from "./mcp-io.js";
import { doctor, statusReport } from "./status.js";
import { listLibrarySkills, parseSkill, removeLibrarySkill, librarySkillDir } from "./skills.js";
import { loadLibraryMcp, syncAll } from "./sync.js";
import type { McpServerConfig } from "./types.js";

const program = new Command();

program
  .name("skillcp")
  .description("Organize Agent Skills and MCP servers once, then sync them to every major AI coding harness.")
  .version("0.1.0");

program
  .command("init")
  .description("Create the ~/.skillcp library")
  .option("--import", "Import existing skills and MCP configs from detected harnesses")
  .option("--install", "Register Skillcp as a skill and MCP server")
  .option("--sync", "Sync the library out to detected harnesses")
  .option("--project", "Also import/sync project-scoped files")
  .action((opts) => {
    initLibrary();
    console.log(`Initialized library at ${libraryRoot()}`);
    if (opts.import) {
      const result = importFromHarnesses({ project: Boolean(opts.project) });
      printImport(result);
    }
    if (opts.install) {
      installSelfSkill();
      installSelfMcp();
      console.log("Registered Skillcp as a library skill and MCP server.");
    }
    if (opts.sync) {
      printTargets(syncAll({ project: Boolean(opts.project) }));
    } else {
      console.log("Next: skillcp import   # collect what you already have");
      console.log("      skillcp sync     # publish the library to every harness");
    }
  });

program
  .command("status")
  .description("Show the library and how it maps onto each harness")
  .option("--project", "Check project-scoped paths instead of user-global")
  .action((opts) => {
    ensureInit();
    const report = statusReport(opts.project ? "project" : "global");
    console.log(`Library: ${report.library}`);
    console.log(`Skills:  ${report.skills}`);
    console.log(`MCP:     ${report.mcp} servers`);
    console.log("");
    console.log(pad("Harness", 16), pad("Status", 12), pad("Skills", 10), pad("MCP", 10));
    for (const row of report.harnesses) {
      const skills = row.skills ? `${row.skillMatches ?? 0}/${row.skillTotal ?? 0}` : "—";
      const mcp = row.mcp ? `${row.mcpMatches ?? 0}/${row.mcpTotal ?? 0}` : "—";
      console.log(
        pad(row.id, 16),
        pad(row.detected ? "detected" : "absent", 12),
        pad(skills, 10),
        pad(mcp, 10),
      );
    }
  });

program
  .command("doctor")
  .description("Report drift between the library and harnesses")
  .option("--to <harness>", "Target harness (repeatable or comma-separated)", collectHarness, [] as string[])
  .action((opts) => {
    const issues = doctor(opts.to);
    if (!issues.length) {
      console.log("All detected harnesses match the Skillcp library.");
      return;
    }
    for (const issue of issues) console.log(`- ${issue}`);
    process.exitCode = 1;
  });

program
  .command("harnesses")
  .description("List supported harnesses and their paths")
  .option("--project", "Show project-scoped paths")
  .action((opts) => {
    const scope = opts.project ? "project" : "global";
    for (const harness of HARNESSES) {
      console.log(`${harness.id.padEnd(16)} ${harness.name}`);
      console.log(`  detected  ${harness.detect() ? "yes" : "no"}`);
      console.log(`  skills    ${harness.skillsDir(scope) ?? "not supported"}`);
      console.log(`  mcp       ${harness.mcpFile(scope) ?? "not supported"}`);
    }
  });

program
  .command("import")
  .description("Copy skills and MCP servers from harnesses into the library")
  .option("--to <harness>", "Target harness (repeatable or comma-separated)", collectHarness, [] as string[])
  .option("--all", "Scan every known harness path, not only detected ones")
  .option("--project", "Also scan project-scoped files")
  .option("--overwrite", "Replace library entries that already exist")
  .option("--skills-only", "Import skills only")
  .option("--mcp-only", "Import MCP servers only")
  .action((opts) => {
    ensureInit();
    const result = importFromHarnesses({
      to: opts.to,
      all: Boolean(opts.all),
      project: Boolean(opts.project),
      overwrite: Boolean(opts.overwrite),
      skills: opts.mcpOnly ? false : true,
      mcp: opts.skillsOnly ? false : true,
    });
    printImport(result);
  });

program
  .command("sync")
  .description("Write the library out to harness skill dirs and MCP configs")
  .option("--to <harness>", "Target harness (repeatable or comma-separated)", collectHarness, [] as string[])
  .option("--all", "Write every known harness path, even if the product is not installed")
  .option("--project", "Also write project-scoped files")
  .option("--dry-run", "Show what would change")
  .option("--force", "Replace existing skill directories that Skillcp does not own")
  .option("--prune", "Remove library-managed MCP servers that were deleted from the library")
  .option("--skills-only", "Sync skills only")
  .option("--mcp-only", "Sync MCP servers only")
  .action((opts) => {
    ensureInit();
    const targets = syncAll({
      to: opts.to,
      all: Boolean(opts.all),
      project: Boolean(opts.project),
      dryRun: Boolean(opts.dryRun),
      force: Boolean(opts.force),
      prune: Boolean(opts.prune),
      skills: opts.mcpOnly ? false : true,
      mcp: opts.skillsOnly ? false : true,
    });
    printTargets(targets);
  });

program
  .command("install")
  .description("Add Skillcp itself as a skill and MCP server, then sync")
  .option("--no-sync", "Update the library without writing harness configs")
  .option("--project", "Also sync project-scoped files")
  .action((opts) => {
    ensureInit();
    installSelfSkill();
    installSelfMcp();
    console.log("Registered Skillcp in the library (skill + MCP server).");
    if (opts.sync !== false) {
      printTargets(syncAll({ project: Boolean(opts.project) }));
    }
  });

program
  .command("serve")
  .description("Start the Skillcp MCP server on stdio")
  .action(async () => {
    const { startMcpServer } = await import("./serve.js");
    await startMcpServer();
  });

const skill = program.command("skill").description("Manage the skill library");

skill
  .command("list")
  .description("List skills in the library")
  .action(() => {
    ensureInit();
    const skills = listLibrarySkills();
    if (!skills.length) {
      console.log("No skills in the library yet. Try `skillcp import` or `skillcp skill add <path>`.");
      return;
    }
    for (const item of skills) {
      console.log(`${item.name}\t${item.description || "(no description)"}`);
    }
  });

skill
  .command("add")
  .argument("<source>", "Skill directory, git URL, or GitHub owner/repo")
  .option("--path <subdir>", "Subdirectory inside a git repository")
  .description("Add a skill from a local folder or git repository")
  .action((source, opts) => {
    ensureInit();
    const added = addSkillSource(source, opts.path);
    for (const item of added) console.log(`Added skill ${item.name}`);
  });

skill
  .command("rm")
  .argument("<name>", "Skill name")
  .description("Remove a skill from the library")
  .action((name) => {
    ensureInit();
    if (!removeLibrarySkill(name)) {
      console.error(`Skill "${name}" is not in the library.`);
      process.exitCode = 1;
      return;
    }
    console.log(`Removed skill ${name}. Run \`skillcp sync --force --prune\` if harness copies should go too.`);
  });

skill
  .command("show")
  .argument("<name>", "Skill name")
  .description("Print a skill's SKILL.md")
  .action((name) => {
    ensureInit();
    const dir = librarySkillDir(name);
    const skillFile = path.join(dir, "SKILL.md");
    if (!fs.existsSync(skillFile)) {
      console.error(`Skill "${name}" is not in the library.`);
      process.exitCode = 1;
      return;
    }
    const parsed = parseSkill(dir);
    console.log(fs.readFileSync(skillFile, "utf8"));
    if (parsed) console.error(`# ${parsed.name}  ${dir}`);
  });

const mcp = program.command("mcp").description("Manage the MCP server library");

mcp
  .command("list")
  .description("List MCP servers in the library")
  .action(() => {
    ensureInit();
    const servers = loadLibraryMcp();
    const names = Object.keys(servers);
    if (!names.length) {
      console.log("No MCP servers in the library yet. Try `skillcp import` or `skillcp mcp add`.");
      return;
    }
    for (const name of names) {
      console.log(`${name}\t${describeServer(servers[name])}`);
    }
  });

mcp
  .command("add")
  .argument("<name>", "Server name")
  .option("--command <cmd>", "stdio command")
  .option("--args <args>", "Comma-separated stdio args")
  .option("--url <url>", "HTTP or SSE URL")
  .option("--type <type>", "stdio | http | sse")
  .option("--env <pairs...>", "KEY=VALUE environment variables")
  .option("--header <pairs...>", "Header KEY=VALUE pairs")
  .option("--cwd <dir>", "Working directory")
  .description("Add or replace an MCP server in the library")
  .action((name, opts) => {
    ensureInit();
    const server = parseServerInput({
      type: opts.type,
      command: opts.command,
      args: opts.args ? String(opts.args).split(",").map((item: string) => item.trim()).filter(Boolean) : undefined,
      url: opts.url,
      cwd: opts.cwd,
      env: pairs(opts.env),
      headers: pairs(opts.header),
    });
    addMcp(name, server);
    console.log(`Added MCP server ${name} (${describeServer(server)})`);
  });

mcp
  .command("rm")
  .argument("<name>", "Server name")
  .description("Remove an MCP server from the library")
  .action((name) => {
    ensureInit();
    if (!removeMcp(name)) {
      console.error(`MCP server "${name}" is not in the library.`);
      process.exitCode = 1;
      return;
    }
    console.log(`Removed MCP server ${name}.`);
  });

mcp
  .command("show")
  .argument("<name>", "Server name")
  .description("Print one MCP server definition")
  .action((name) => {
    ensureInit();
    const servers = loadLibraryMcp();
    if (!servers[name]) {
      console.error(`MCP server "${name}" is not in the library.`);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({ [name]: servers[name] }, null, 2));
  });

function collectHarness(value: string, previous: string[]): string[] {
  return previous.concat(value.split(",").map((item) => item.trim()).filter(Boolean));
}

program.parse();

function ensureInit(): void {
  if (!isInitialized()) initLibrary();
}

function pad(value: string, size: number): string {
  return value.length >= size ? value : value + " ".repeat(size - value.length);
}

function pairs(values: string[] | undefined): Record<string, string> | undefined {
  if (!values?.length) return undefined;
  const out: Record<string, string> = {};
  for (const item of values) {
    const index = item.indexOf("=");
    if (index === -1) continue;
    out[item.slice(0, index)] = item.slice(index + 1);
  }
  return out;
}

function describeServer(server: McpServerConfig | undefined): string {
  if (!server) return "";
  if (server.command) return [server.command, ...(server.args ?? [])].join(" ");
  if (server.url) return server.url;
  return server.type ?? "unknown";
}

function printImport(result: ReturnType<typeof importFromHarnesses>): void {
  const show = (label: string, rows: typeof result.skills) => {
    const kept = rows.filter((row) => row.action !== "skipped");
    const skipped = rows.length - kept.length;
    console.log(`${label}: ${kept.length} imported, ${skipped} skipped`);
    for (const row of kept) console.log(`  ${row.action.padEnd(8)} ${row.name}`);
  };
  show("Skills", result.skills);
  show("MCP", result.mcp);
}

function printTargets(targets: ReturnType<typeof syncAll>): void {
  if (!targets.length) {
    console.log("Nothing to sync. Add skills or MCP servers, or pass --all / --to.");
    return;
  }
  const counts = new Map<string, number>();
  for (const target of targets) {
    counts.set(target.action, (counts.get(target.action) ?? 0) + 1);
    const mark =
      target.action === "unchanged"
        ? "="
        : target.action === "skip"
          ? "!"
          : target.action === "write"
            ? "W"
            : target.action === "copy"
              ? "C"
              : "L";
    console.log(`${mark} ${target.harness.padEnd(14)} ${target.kind.padEnd(6)} ${target.scope.padEnd(8)} ${target.path}${target.detail ? `  (${target.detail})` : ""}`);
  }
  const summary = [...counts.entries()].map(([action, count]) => `${count} ${action}`).join(", ");
  console.log(`\n${summary}`);
}
