import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initLibrary, libraryRoot } from "../src/library.js";
import { writeLibrarySkill, listLibrarySkills, readSkillMarkdown } from "../src/skills.js";
import { loadLibraryMcp } from "../src/sync.js";
import { startWebUi, type WebUi } from "../src/web.js";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skillcp-web-"));
}

let home: string;
let ui: WebUi | undefined;

beforeEach(() => {
  home = tempHome();
  process.env.SKILLCP_HOME = home;
  process.env.SKILLCP_DIR = path.join(home, ".skillcp");
  process.env.SKILLCP_PROJECT = path.join(home, "proj");
  process.env.XDG_CONFIG_HOME = path.join(home, ".config");
  fs.mkdirSync(process.env.SKILLCP_PROJECT, { recursive: true });
  initLibrary();
});

afterEach(async () => {
  if (ui) {
    await ui.close();
    ui = undefined;
  }
  fs.rmSync(home, { recursive: true, force: true });
  delete process.env.SKILLCP_HOME;
  delete process.env.SKILLCP_DIR;
  delete process.env.SKILLCP_PROJECT;
  delete process.env.XDG_CONFIG_HOME;
});

async function start() {
  ui = await startWebUi({ host: "127.0.0.1", port: 0, open: false });
  return ui;
}

describe("writeLibrarySkill", () => {
  it("creates an editable SKILL.md in the library", () => {
    const skill = writeLibrarySkill("code-review", "Review diffs.", "Look at the patch.");
    expect(skill.name).toBe("code-review");
    expect(listLibrarySkills().map((item) => item.name)).toContain("code-review");
    expect(readSkillMarkdown("code-review")).toContain("Look at the patch.");
  });
});

describe("web UI server", () => {
  it("serves the GUI and health check", async () => {
    const server = await start();
    const page = await fetch(server.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Skillcp");
    const css = await fetch(new URL("/styles.css", server.url));
    expect(css.status).toBe(200);
    const health = await fetch(new URL("/api/health", server.url));
    expect(await health.json()).toEqual({ ok: true });
  });

  it("rejects path traversal", async () => {
    const server = await start();
    const res = await fetch(new URL("/api/../package.json", server.url));
    expect(res.status).toBe(404);
    const res2 = await fetch(new URL("/../../package.json", server.url));
    expect(res2.status).toBe(404);
  });

  it("creates, edits, and deletes skills through the API", async () => {
    const server = await start();
    const created = await fetch(new URL("/api/skills", server.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "web-skill",
        description: "Created from the UI.",
        body: "Do the thing.",
      }),
    });
    expect(created.status).toBe(200);
    const createdBody = await created.json();
    expect(createdBody.skill.name).toBe("web-skill");
    expect(createdBody.state.skills.some((s: { name: string }) => s.name === "web-skill")).toBe(true);

    const got = await fetch(new URL("/api/skills/web-skill", server.url));
    const skill = await got.json();
    expect(skill.body).toContain("Do the thing.");

    const updated = await fetch(new URL("/api/skills/web-skill", server.url), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Updated description.", body: "New instructions." }),
    });
    expect(updated.status).toBe(200);
    expect(readSkillMarkdown("web-skill")).toContain("New instructions.");

    const removed = await fetch(new URL("/api/skills/web-skill", server.url), { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect(listLibrarySkills().some((item) => item.name === "web-skill")).toBe(false);
  });

  it("adds and removes MCP servers, then reports them in /api/state", async () => {
    const server = await start();
    const added = await fetch(new URL("/api/mcp", server.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "docs",
        type: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer $TOKEN" },
      }),
    });
    expect(added.status).toBe(200);
    expect(loadLibraryMcp().docs?.url).toBe("https://example.com/mcp");

    const state = await (await fetch(new URL("/api/state", server.url))).json();
    expect(state.library).toBe(libraryRoot());
    expect(state.mcp.docs.url).toBe("https://example.com/mcp");

    const removed = await fetch(new URL("/api/mcp/docs", server.url), { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect(loadLibraryMcp().docs).toBeUndefined();
  });

  it("returns 400 for invalid skill names", async () => {
    const server = await start();
    const res = await fetch(new URL("/api/skills", server.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bad Name", description: "Nope." }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid skill name/);
  });
});
