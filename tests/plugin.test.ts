import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.join(import.meta.dirname, "..");

describe("harness plugins", () => {
  it("ships a Claude Code plugin manifest and MCP launcher", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8"),
    );
    expect(manifest.name).toBe("skillcp");
    const mcp = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers.skillcp.args.join(" ")).toContain("bin/serve.mjs");
    expect(fs.existsSync(path.join(root, "bin", "serve.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(root, "skills", "skillcp", "SKILL.md"))).toBe(true);
  });

  it("ships a VS Code / Cursor extension that contributes MCP, skill, and commands", () => {
    const ext = JSON.parse(
      fs.readFileSync(path.join(root, "extensions", "vscode", "package.json"), "utf8"),
    );
    expect(ext.contributes.mcpServerDefinitionProviders[0].id).toBe("skillcp");
    expect(ext.contributes.chatSkills[0].path).toContain("skillcp");
    expect(ext.contributes.commands.map((c: { command: string }) => c.command)).toEqual(
      expect.arrayContaining(["skillcp.openUi", "skillcp.sync", "skillcp.import"]),
    );
    expect(fs.existsSync(path.join(root, "extensions", "vscode", "extension.js"))).toBe(true);
    expect(fs.existsSync(path.join(root, "extensions", "vscode", "skills", "skillcp", "SKILL.md"))).toBe(
      true,
    );
  });
});
