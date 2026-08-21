---
name: skillcp
description: Organize Agent Skills and MCP servers in one library and sync them to Cursor, Claude Code, GitHub Copilot, Windsurf, Codex, Gemini CLI, OpenCode, Cline, and Claude Desktop. Use when the user wants the same skills or MCP servers available in every AI coding harness, to import existing configs, or to add/remove a skill or MCP server globally.
---

# Skillcp

Skillcp is the cross-harness library for Agent Skills and MCP servers. One copy lives in `~/.skillcp`. Sync writes that copy into each product's native paths and config formats.

## Prefer MCP tools when connected

If the `skillcp` MCP server is available, use those tools (`skillcp_status`, `skillcp_import`, `skillcp_sync`, `skillcp_add_skill`, `skillcp_add_mcp`, and the rest). Do not shell out unless the MCP server is missing.

## CLI fallback

```bash
npx skillcp status
npx skillcp import
npx skillcp skill add <path-or-git-url>
npx skillcp mcp add <name> --command npx --args -y,@scope/server
npx skillcp mcp add <name> --url https://example/mcp --type http
npx skillcp sync
npx skillcp sync --project
npx skillcp install
```

`sync` defaults to user-global files for whatever harnesses look installed. Add `--project` to also write repo-local files (`.cursor/skills`, `.mcp.json`, `.vscode/mcp.json`, …).

## Typical user intents

- "Make this skill work in Cursor and Claude" → `skill add` then `sync`
- "I already have MCP servers in Cursor" → `import` then `sync`
- "Give every harness my whole library" → `sync --all` if some products are not detected
- "Install Skillcp as a plugin" → `install` (adds this skill plus the Skillcp MCP server, then syncs)

## Rules

- Never duplicate a skill by hand-copying `SKILL.md` into each harness folder. Put it in the library and sync.
- Preserve secrets. Skillcp copies env values as written; prefer `$ENV_NAME` references over raw tokens when adding servers.
- After library edits, run `sync` so every harness sees the change.
- If a harness already has a real (non-linked) skill directory, `sync` skips it unless `--force` is set.
