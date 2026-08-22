import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  toCodexEntry,
  toGeminiEntry,
  toMcpServersEntry,
  toOpenCodeEntry,
  toVscodeEntry,
  normalizeServer,
  normalizeMap,
} from "../src/mcp-format.js";
import { parseSkill, validateSkillName, findSkills, removeLibrarySkill, writeLibrarySkill } from "../src/skills.js";
import { initLibrary, libraryRoot, saveConfig } from "../src/library.js";
import { addMcp, addSkillSource, installSelfMcp, installSelfSkill, removeMcp, uninstallSkill } from "../src/install.js";
import { importFromHarnesses } from "../src/import.js";
import { loadLibraryMcp, syncAll } from "../src/sync.js";
import { writeJson, readJsonc, readLink, readToml, lexists, which } from "../src/fsx.js";
import { HARNESSES, harnessById, pickSkillWriteIds } from "../src/harnesses.js";
import { writeServerMap, readServerMap } from "../src/mcp-io.js";
import { doctor, doctorReport, statusReport } from "../src/status.js";
import { spawnSync } from "node:child_process";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skillcp-home-"));
}

let home: string;
let project: string;

beforeEach(() => {
  home = tempHome();
  project = path.join(home, "proj");
  fs.mkdirSync(project, { recursive: true });
  process.env.SKILLCP_HOME = home;
  process.env.SKILLCP_DIR = path.join(home, ".skillcp");
  process.env.SKILLCP_PROJECT = project;
  process.env.XDG_CONFIG_HOME = path.join(home, ".config");
  delete process.env.PI_CODING_AGENT_DIR;
  initLibrary();
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  delete process.env.SKILLCP_HOME;
  delete process.env.SKILLCP_DIR;
  delete process.env.SKILLCP_PROJECT;
  delete process.env.XDG_CONFIG_HOME;
});

describe("mcp format conversion", () => {
  const stdio = {
    type: "stdio" as const,
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_TOKEN: "$GITHUB_TOKEN" },
  };
  const http = {
    type: "http" as const,
    url: "https://example.com/mcp",
    headers: { Authorization: "Bearer x" },
  };

  it("round-trips stdio servers across harness formats", () => {
    expect(toMcpServersEntry(stdio)).toEqual({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "$GITHUB_TOKEN" },
    });
    expect(toVscodeEntry(stdio)).toMatchObject({ type: "stdio", command: "npx" });
    expect(toOpenCodeEntry(stdio)).toEqual({
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-github"],
      environment: { GITHUB_TOKEN: "$GITHUB_TOKEN" },
      enabled: true,
    });
    expect(toGeminiEntry(stdio).command).toBe("npx");
    expect(toCodexEntry(stdio).command).toBe("npx");
    expect(normalizeServer(toOpenCodeEntry(stdio))).toMatchObject({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
    });
  });

  it("maps HTTP vs SSE for Gemini and VS Code", () => {
    expect(toGeminiEntry(http)).toEqual({
      httpUrl: "https://example.com/mcp",
      headers: { Authorization: "Bearer x" },
    });
    expect(toGeminiEntry({ type: "sse", url: "https://example.com/sse" })).toEqual({
      url: "https://example.com/sse",
    });
    expect(toVscodeEntry(http)).toMatchObject({ type: "http", url: http.url });
    expect(normalizeServer({ httpUrl: "https://example.com/mcp" })?.type).toBe("http");
  });

  it("ignores underscore keys when normalizing maps", () => {
    expect(normalizeMap({ _comment: "nope", github: stdio })).toHaveProperty("github");
    expect(normalizeMap({ _comment: "nope", github: stdio })).not.toHaveProperty("_comment");
  });
});

describe("skills", () => {
  it("parses SKILL.md frontmatter and validates names", () => {
    const dir = path.join(home, "pdf-processing");
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: pdf-processing\ndescription: Extract text from PDFs.\n---\n\nDo the work.\n`,
    );
    const skill = parseSkill(dir);
    expect(skill?.name).toBe("pdf-processing");
    expect(skill?.description).toContain("PDFs");
    expect(validateSkillName("pdf-processing")).toEqual([]);
    expect(validateSkillName("PDF")).not.toEqual([]);
    expect(validateSkillName("-bad")).not.toEqual([]);
  });

  it("finds nested skills", () => {
    const root = path.join(home, "tree");
    const nested = path.join(root, "shipping", "deploy-staging");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(nested, "SKILL.md"),
      `---\nname: deploy-staging\ndescription: Deploy staging.\n---\n`,
    );
    expect(findSkills(root).map((s) => s.name)).toEqual(["deploy-staging"]);
  });
});

describe("library sync", () => {
  it("imports from Cursor and syncs to Claude Code", () => {
    const cursorSkills = path.join(home, ".cursor", "skills", "code-review");
    fs.mkdirSync(cursorSkills, { recursive: true });
    fs.writeFileSync(
      path.join(cursorSkills, "SKILL.md"),
      `---\nname: code-review\ndescription: Review diffs.\n---\nLook at the diff.\n`,
    );
    writeJson(path.join(home, ".cursor", "mcp.json"), {
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
        },
      },
    });

    const imported = importFromHarnesses({ to: ["cursor"] });
    expect(imported.skills.some((s) => s.name === "code-review" && s.action === "added")).toBe(true);
    expect(imported.mcp.some((s) => s.name === "github" && s.action === "added")).toBe(true);
    expect(loadLibraryMcp().github?.command).toBe("npx");

    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    const targets = syncAll({ to: ["claude"], force: true });
    expect(targets.some((t) => t.kind === "skills" && t.action === "link")).toBe(true);
    expect(targets.some((t) => t.kind === "mcp" && t.action === "write")).toBe(true);

    const linked = readLink(path.join(home, ".claude", "skills", "code-review"));
    expect(linked && linked.endsWith(path.join(".skillcp", "skills", "code-review"))).toBe(true);

    const claudeJson = readJsonc(path.join(home, ".claude.json"));
    expect(claudeJson).toMatchObject({
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
        },
      },
    });
  });

  it("writes OpenCode, Codex, Gemini, and VS Code shapes", () => {
    addMcp("docs", { type: "http", url: "https://example.com/mcp" });
    addMcp("github", {
      command: "npx",
      args: ["-y", "github"],
      env: { TOKEN: "x" },
    });

    fs.mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    fs.mkdirSync(path.join(home, ".gemini"), { recursive: true });
    fs.mkdirSync(path.join(home, ".copilot"), { recursive: true });
    fs.mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });

    syncAll({ to: ["opencode", "codex", "gemini", "copilot", "pi"] });

    const opencode = readJsonc(path.join(home, ".config", "opencode", "opencode.json"));
    expect(opencode?.mcp).toMatchObject({
      github: { type: "local", command: ["npx", "-y", "github"] },
      docs: { type: "remote", url: "https://example.com/mcp" },
    });

    const codex = readToml(path.join(home, ".codex", "config.toml"));
    expect(codex?.mcp_servers).toMatchObject({
      github: { command: "npx" },
      docs: { url: "https://example.com/mcp" },
    });

    const gemini = readJsonc(path.join(home, ".gemini", "settings.json"));
    expect(gemini?.mcpServers).toMatchObject({
      github: { command: "npx" },
      docs: { httpUrl: "https://example.com/mcp" },
    });

    const vscode = readJsonc(path.join(home, ".copilot", "mcp-config.json"));
    expect(vscode?.mcpServers?.github?.command).toBe("npx");

    const piMcp = readJsonc(path.join(home, ".pi", "agent", "mcp.json"));
    expect(piMcp?.mcpServers).toMatchObject({
      github: { command: "npx" },
      docs: { url: "https://example.com/mcp" },
    });
  });

  it("preserves unrelated keys when merging MCP configs", () => {
    writeJson(path.join(home, ".cursor", "mcp.json"), {
      mcpServers: { keepme: { command: "echo" } },
      extra: true,
    });
    addMcp("github", { command: "npx" });
    syncAll({ to: ["cursor"] });
    const doc = readJsonc(path.join(home, ".cursor", "mcp.json"));
    expect(doc?.extra).toBe(true);
    expect(doc?.mcpServers).toMatchObject({
      keepme: { command: "echo" },
      github: { command: "npx" },
    });
  });

  it("registers the bundled skillcp skill and MCP server", () => {
    installSelfSkill();
    installSelfMcp();
    expect(fs.existsSync(path.join(libraryRoot(), "skills", "skillcp", "SKILL.md"))).toBe(true);
    expect(loadLibraryMcp().skillcp?.args?.slice(-1)[0]).toBe("serve");
  });

  it("skips importing a skill that already points at the library", () => {
    const dir = path.join(project, "demo-skill");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: demo-skill\ndescription: Demo.\n---\n`,
    );
    addSkillSource(dir);
    fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
    syncAll({ to: ["cursor"] });
    const again = importFromHarnesses({ to: ["cursor"] });
    expect(again.skills.find((s) => s.name === "demo-skill")?.action).toBe("skipped");
  });

  it("unsyncs harness skill copies on uninstall, including dangling links", () => {
    const dir = path.join(project, "gone-skill");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: gone-skill\ndescription: Temporary.\n---\n`,
    );
    addSkillSource(dir);
    fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
    syncAll({ to: ["cursor"] });
    const dest = path.join(home, ".cursor", "skills", "gone-skill");
    expect(lexists(dest)).toBe(true);

    const result = uninstallSkill("gone-skill");
    expect(result.removed).toBe(true);
    expect(lexists(dest)).toBe(false);
    expect(fs.existsSync(path.join(libraryRoot(), "skills", "gone-skill"))).toBe(false);
  });

  it("cleans orphan skillcp links on the next sync", () => {
    const dir = path.join(project, "orphan-skill");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: orphan-skill\ndescription: Temporary.\n---\n`,
    );
    addSkillSource(dir);
    fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
    syncAll({ to: ["cursor"] });
    const dest = path.join(home, ".cursor", "skills", "orphan-skill");
    expect(removeLibrarySkill("orphan-skill")).toBe(true);
    expect(readLink(dest)?.endsWith(path.join(".skillcp", "skills", "orphan-skill"))).toBe(true);
    expect(lexists(dest)).toBe(true);

    const targets = syncAll({ to: ["cursor"] });
    expect(targets.some((row) => row.path === dest && row.action === "remove")).toBe(true);
    expect(lexists(dest)).toBe(false);
  });

  it("materializes harness skill copies when uninstalling with keep", () => {
    const dir = path.join(project, "keep-skill");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: keep-skill\ndescription: Keep me.\n---\nBody.\n`,
    );
    addSkillSource(dir);
    fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
    syncAll({ to: ["cursor"] });
    const dest = path.join(home, ".cursor", "skills", "keep-skill");
    expect(readLink(dest)).toBeTruthy();

    expect(uninstallSkill("keep-skill", { keep: true }).removed).toBe(true);
    expect(readLink(dest)).toBeUndefined();
    expect(fs.existsSync(path.join(dest, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(libraryRoot(), "skills", "keep-skill"))).toBe(false);
  });

  it("unsyncs managed MCP servers on remove and leaves unrelated servers", () => {
    writeJson(path.join(home, ".cursor", "mcp.json"), {
      mcpServers: { keepme: { command: "echo" } },
    });
    addMcp("github", { command: "npx" });
    syncAll({ to: ["cursor"] });
    expect(removeMcp("github")).toBe(true);
    expect(loadLibraryMcp().github).toBeUndefined();
    const doc = readJsonc(path.join(home, ".cursor", "mcp.json"));
    expect(doc?.mcpServers).toMatchObject({ keepme: { command: "echo" } });
    expect(doc?.mcpServers).not.toHaveProperty("github");
  });

  it("leaves harness MCP copies when remove is called with keep", () => {
    addMcp("docs", { type: "http", url: "https://example.com/mcp" });
    fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
    syncAll({ to: ["cursor"] });
    expect(removeMcp("docs", { keep: true })).toBe(true);
    expect(loadLibraryMcp().docs).toBeUndefined();
    const doc = readJsonc(path.join(home, ".cursor", "mcp.json"));
    expect(doc?.mcpServers?.docs?.url).toBe("https://example.com/mcp");
  });
});

describe("cli", () => {
  it("prints status", () => {
    const result = spawnSync("npx", ["tsx", "src/cli.ts", "status"], {
      cwd: path.join(import.meta.dirname, ".."),
      encoding: "utf8",
      env: { ...process.env },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Library:");
    expect(result.stdout).toContain("cursor");
  });

  it("prints the package.json version", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")) as {
      version: string;
    };
    const result = spawnSync("npx", ["tsx", "src/cli.ts", "--version"], {
      cwd: path.join(import.meta.dirname, ".."),
      encoding: "utf8",
      env: { ...process.env },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  it("prints a short getting-started screen with no arguments", () => {
    const result = spawnSync("npx", ["tsx", "src/cli.ts"], {
      cwd: path.join(import.meta.dirname, ".."),
      encoding: "utf8",
      env: { ...process.env },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("skillcp ui");
    expect(result.stdout).toContain("skillcp sync");
  });
});

describe("mcp file io", () => {
  it("round-trips vscode servers and opencode v2 nested servers", () => {
    const vscodeFile = path.join(home, "mcp.json");
    writeServerMap(vscodeFile, "vscode-servers", {
      github: { command: "npx", args: ["-y", "gh"] },
    });
    expect(readServerMap(vscodeFile, "vscode-servers").github?.command).toBe("npx");

    const openFile = path.join(home, "opencode.json");
    writeJson(openFile, { mcp: { servers: {} }, theme: "dark" });
    writeServerMap(openFile, "opencode", {
      github: { command: "uvx", args: ["mcp-git"] },
    });
    const doc = readJsonc(openFile);
    expect(doc?.theme).toBe("dark");
    expect((doc?.mcp as { servers: unknown }).servers).toMatchObject({
      github: { type: "local", command: ["uvx", "mcp-git"] },
    });
  });
});

describe("harness registry", () => {
  it("exposes the major coding harnesses", () => {
    const ids = HARNESSES.map((h) => h.id);
    expect(ids).toEqual(
      expect.arrayContaining(["cursor", "claude", "copilot", "windsurf", "codex", "gemini", "opencode", "pi"]),
    );
    expect(harnessById("Claude Code")?.id).toBe("claude");
    expect(harnessById("pi")?.skillsDir("global")).toMatch(/\.pi[/\\]agent[/\\]skills$/);
    expect(harnessById("pi")?.mcpFile("global")).toMatch(/\.pi[/\\]agent[/\\]mcp\.json$/);
    expect(harnessById("pi")?.mcpFile("project")).toMatch(/\.pi[/\\]mcp\.json$/);
  });

  it("does not treat generic binaries as Copilot or Pi", () => {
    const bin = path.join(home, "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "code"), "#!/bin/sh\n", { mode: 0o755 });
    fs.writeFileSync(path.join(bin, "pi"), "#!/bin/sh\n", { mode: 0o755 });
    const previousPath = process.env.PATH ?? "";
    process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
    try {
      expect(which("code")).toBe(true);
      expect(which("pi")).toBe(true);
      expect(harnessById("copilot")?.detect()).toBe(false);
      expect(harnessById("pi")?.detect()).toBe(false);

      fs.mkdirSync(path.join(home, ".copilot"), { recursive: true });
      fs.mkdirSync(path.join(home, ".pi"), { recursive: true });
      expect(harnessById("copilot")?.detect()).toBe(true);
      expect(harnessById("pi")?.detect()).toBe(true);
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

describe("skill folder overlap", () => {
  it("picks the fewest write targets that still reach every product", () => {
    expect(pickSkillWriteIds(["cursor", "claude"])).toEqual(["claude"]);
    expect(pickSkillWriteIds(["cursor", "pi", "agents"])).toEqual(["agents"]);
    expect(pickSkillWriteIds(["cursor", "claude", "pi"])).toEqual(["claude", "pi"]);
    expect(pickSkillWriteIds(["cursor"])).toEqual(["cursor"]);
    expect(pickSkillWriteIds(["agents"])).toEqual(["agents"]);
  });

  it("writes Cursor+Claude skills once and treats Cursor as covered", () => {
    const dir = path.join(project, "shared-skill");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: shared-skill\ndescription: Shared.\n---\n`,
    );
    addSkillSource(dir);
    fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });

    const targets = syncAll({ to: ["cursor", "claude"] });
    expect(lexists(path.join(home, ".claude", "skills", "shared-skill"))).toBe(true);
    expect(lexists(path.join(home, ".cursor", "skills", "shared-skill"))).toBe(false);
    expect(
      targets.some(
        (row) => row.harness === "cursor" && row.kind === "skills" && row.detail?.includes("covered by claude"),
      ),
    ).toBe(true);

    const report = statusReport();
    const cursor = report.harnesses.find((row) => row.id === "cursor");
    expect(cursor?.skillMatches).toBe(1);
    expect(doctor(["cursor", "claude"]).some((issue) => issue.includes("more than once"))).toBe(false);
  });

  it("removes leftover Cursor links that would duplicate Claude", () => {
    const dir = path.join(project, "dup-skill");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: dup-skill\ndescription: Dup.\n---\n`,
    );
    addSkillSource(dir);
    fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
    syncAll({ to: ["cursor"] });
    expect(lexists(path.join(home, ".cursor", "skills", "dup-skill"))).toBe(true);

    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    syncAll({ to: ["cursor", "claude"] });
    expect(lexists(path.join(home, ".claude", "skills", "dup-skill"))).toBe(true);
    expect(lexists(path.join(home, ".cursor", "skills", "dup-skill"))).toBe(false);
    expect(doctor(["cursor", "claude"]).some((issue) => issue.includes("more than once"))).toBe(false);
  });

  it("warns only when a host can already see two Skillcp copies", () => {
    const dir = path.join(project, "warn-skill");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: warn-skill\ndescription: Warn.\n---\n`,
    );
    addSkillSource(dir);
    const src = path.join(libraryRoot(), "skills", "warn-skill");
    const cursorDest = path.join(home, ".cursor", "skills", "warn-skill");
    const claudeDest = path.join(home, ".claude", "skills", "warn-skill");
    fs.mkdirSync(path.dirname(cursorDest), { recursive: true });
    fs.mkdirSync(path.dirname(claudeDest), { recursive: true });
    fs.symlinkSync(src, cursorDest);
    fs.symlinkSync(src, claudeDest);
    const issues = doctor(["cursor", "claude"]);
    expect(issues.some((issue) => issue.includes("more than once"))).toBe(true);
  });

  it("groups existing-folder notes instead of listing each skill per host", () => {
    for (const name of ["agents-sdk", "bubbletea", "wrangler"]) {
      const lib = path.join(project, name);
      fs.mkdirSync(lib, { recursive: true });
      fs.writeFileSync(path.join(lib, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}.\n---\n`);
      addSkillSource(lib);
      const dest = path.join(home, ".cursor", "skills", name);
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}.\n---\n`);
    }
    writeLibrarySkill("only-in-library", "Library only.", "Body.");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });

    const report = doctorReport(["cursor", "claude"]);
    const unmanaged = report.filter((item) => item.kind === "unmanaged-skills");
    expect(unmanaged).toHaveLength(1);
    expect(unmanaged[0]?.names).toEqual(["agents-sdk", "bubbletea", "wrangler"]);
    expect(unmanaged[0]?.detail).toMatch(/Cursor/);

    const missing = report.filter((item) => item.kind === "missing-skills");
    expect(missing.some((item) => item.harness === "cursor" && item.title.includes("1 of 4"))).toBe(true);

    const lines = doctor(["cursor", "claude"]);
    expect(lines.some((line) => line.includes("exists but is not a skillcp link"))).toBe(false);
    expect(lines.filter((line) => line.includes("existing folders"))).toHaveLength(1);
  });

  it("treats Cursor seeing Claude and Codex copies as expected, not a sync failure", () => {
    const dir = path.join(project, "shared-both");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: shared-both\ndescription: Shared.\n---\n`,
    );
    addSkillSource(dir);
    const src = path.join(libraryRoot(), "skills", "shared-both");
    for (const dest of [
      path.join(home, ".claude", "skills", "shared-both"),
      path.join(home, ".codex", "skills", "shared-both"),
    ]) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.symlinkSync(src, dest);
    }
    fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
    const report = doctorReport(["cursor", "claude", "codex"]);
    const overlap = report.find((item) => item.kind === "duplicates" && item.harness === "cursor");
    expect(overlap?.level).toBe("info");
    expect(overlap?.title).toMatch(/Claude Code and OpenAI Codex/);
    expect(overlap?.action).toBeUndefined();
    expect(doctor(["cursor", "claude", "codex"]).some((line) => line.includes("keep one copy"))).toBe(false);
  });

  it("stops publishing to a disabled harness and removes its Skillcp links", () => {
    const dir = path.join(project, "off-skill");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: off-skill\ndescription: Off.\n---\n`);
    addSkillSource(dir);
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    syncAll({ to: ["codex", "claude"] });
    expect(lexists(path.join(home, ".codex", "skills", "off-skill"))).toBe(true);

    saveConfig({ skillStrategy: "symlink", disabledHarnesses: ["codex"] });
    syncAll();
    expect(lexists(path.join(home, ".codex", "skills", "off-skill"))).toBe(false);
    expect(lexists(path.join(home, ".claude", "skills", "off-skill"))).toBe(true);
  });
});
