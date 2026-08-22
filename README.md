# Skillcp

Yes. Skills and MCP servers are already portable — every major harness just hides them in a different folder and JSON shape. Skillcp is the missing library: **one copy of each skill and MCP server, published to every harness you use.**

It is a CLI, an MCP server, an Agent Skill, and a local web UI, so Cursor, Claude Code, Copilot, Codex, Gemini CLI, Windsurf, OpenCode, Cline, Claude Desktop, and Pi can all drive it — or you can manage the library in a browser.

## What it does

1. Keeps a canonical library in `~/.skillcp`
   - Skills as standard `SKILL.md` packages (`~/.skillcp/skills/<name>/`)
   - MCP servers as one `mcp.json` (`~/.skillcp/mcp.json`)
2. **Imports** whatever you already configured in Cursor, Claude, Copilot, and the rest
3. **Syncs** that library back out:
   - Skills are symlinked (copied if the OS blocks links) into each product's skills directory
   - MCP servers are merged into each product's native config format without clobbering unrelated settings

After sync, the same GitHub MCP server and the same `code-review` skill show up in every harness.

## Install

```bash
npm install -g skillcp
skillcp --version
```

Or run without installing:

```bash
npx skillcp
```

From a checkout:

```bash
npm install
npm run build
node dist/cli.js status
```

First run:

```bash
skillcp init --import --install --sync
```

That creates the library, vacuums up existing skills/MCP configs, registers Skillcp itself as a skill + MCP server, and writes everything back to the harnesses it detects.

## Everyday use

```bash
# Browser GUI for the library
skillcp ui

# See what is installed where
skillcp status
skillcp doctor

# Add a skill from a folder or GitHub repo
skillcp skill add ./my-skill
skillcp skill add anthropics/skills --path pdf

# Add an MCP server once
skillcp mcp add github --command npx --args -y,@modelcontextprotocol/server-github --env GITHUB_TOKEN=$GITHUB_TOKEN
skillcp mcp add docs --url https://example.com/mcp --type http

# Publish the library to every detected harness (user-global)
skillcp sync

# Also write project files (.cursor/skills, .mcp.json, .vscode/mcp.json, …)
skillcp sync --project

# Only Cursor + Claude Code
skillcp sync --to cursor --to claude
```

## Use it from any harness (the plugin)

`skillcp install` adds:

- the `skillcp` Agent Skill (so the model knows when to use it)
- the `skillcp` MCP server (`skillcp serve` over stdio)

Any MCP-capable harness can then call tools like `skillcp_add_skill`, `skillcp_add_mcp`, `skillcp_import`, `skillcp_sync`, and `skillcp_open_ui` instead of editing five config files by hand.

This repo is also a native plugin for the IDEs:

**Cursor / VS Code / Copilot / Windsurf**

```bash
code --install-extension ./extensions/vscode
# or, in Cursor: Install from VSIX / install the folder as an extension
```

The extension registers the Skillcp MCP server, contributes the skill, and adds commands: Open UI, Sync, Import, Status.

**Claude Code**

This repository is a Claude Code plugin (`/.claude-plugin/plugin.json`). Enable it with:

```bash
claude plugin install .
# or
claude --plugin-dir .
```

If the MCP server is not connected, agents can still run the CLI. For a browser GUI, run `skillcp ui`. The bundled skill at `skills/skillcp/SKILL.md` documents both paths.

## Web UI

```bash
skillcp ui
```

Starts a small local web server (default `http://127.0.0.1:8787`) and opens it in your browser. From there you can create, edit, and remove skills, add MCP servers, import from installed harnesses, and sync the library back out. It binds to localhost only.

```bash
skillcp ui --port 9000 --no-open
```

## Supported harnesses

| Harness | Skills (global / project) | MCP config (global / project) |
| --- | --- | --- |
| **Cursor** | `~/.cursor/skills` / `.cursor/skills` | `~/.cursor/mcp.json` / `.cursor/mcp.json` |
| **Claude Code** | `~/.claude/skills` / `.claude/skills` | `~/.claude.json` / `.mcp.json` |
| **GitHub Copilot / VS Code** | `~/.copilot/skills` / `.github/skills` | `~/.copilot/mcp-config.json` + VS Code user `mcp.json` / `.vscode/mcp.json` |
| **Windsurf** | `~/.windsurf/skills` / `.windsurf/skills` | `~/.codeium/windsurf/mcp_config.json` / `.windsurf/mcp.json` |
| **OpenAI Codex** | `~/.codex/skills` / `.codex/skills` | `~/.codex/config.toml` / `.codex/config.toml` |
| **Gemini CLI** | `~/.gemini/skills` / `.gemini/skills` | `~/.gemini/settings.json` / `.gemini/settings.json` |
| **OpenCode** | `~/.config/opencode/skills` / `.opencode/skills` | `opencode.json` (`mcp` map, local/remote) |
| **Cline** | — | `~/.cline/mcp.json` |
| **Claude Desktop** | — | `claude_desktop_config.json` |
| **Generic `.agents`** | `~/.agents/skills` / `.agents/skills` | — |
| **Pi** | `~/.pi/agent/skills` / `.pi/skills` | `~/.pi/agent/mcp.json` / `.pi/mcp.json` |

MCP conversion covers the real format drift: `mcpServers` vs `servers` vs OpenCode `mcp` vs Codex TOML `mcp_servers`, plus Gemini's `httpUrl` vs `url`.

Pi has no native MCP; Skillcp still writes `mcp.json` in Pi's agent dir so [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) (and similar extensions) pick the same servers up.

Several hosts scan more than their own skill folder (Cursor also reads Claude, Codex, and `.agents`; Copilot and Gemini read `.agents`; Pi reads `.agents`). Sync writes each skill to the fewest folders that still reach every product, and removes leftover Skillcp links that would show up twice. MCP configs are per-product and are not folded this way.

`skillcp harnesses` prints the resolved paths on your machine.

## How a library looks

```
~/.skillcp/
  config.json          # symlink vs copy
  mcp.json             # canonical MCP servers
  manifest.json        # names Skillcp manages
  skills/
    code-review/SKILL.md
    skillcp/SKILL.md
  backups/             # copies of harness files before each MCP write
```

Sync is additive. Extra MCP servers a harness already had are left alone. Servers Skillcp used to manage that left the library are dropped from harness files on the next sync (and immediately on `skill rm` / `mcp rm`). `--force` replaces skill folders that are not Skillcp symlinks. `--keep` on `rm` leaves harness copies in place.

## Project vs global

Default sync is **user-global**, so every repo you open gets the same personal skills and MCP servers.

`--project` writes into the current working directory for team-shared setup. Commit those files if the whole team should get them.

## Secrets

Skillcp does not rewrite or encrypt env values. Prefer environment-variable references (`$GITHUB_TOKEN`) in `mcp.json` instead of pasting tokens. Backups under `~/.skillcp/backups` will contain whatever was already in the harness file.

## CLI

```
skillcp init [--import] [--install] [--sync]
skillcp status [--project]
skillcp doctor
skillcp import [--to cursor] [--all] [--project] [--overwrite]
skillcp sync [--to claude] [--all] [--project] [--dry-run] [--force] [--prune]
skillcp install [--no-sync]
skillcp serve
skillcp ui [--port 8787] [--host 127.0.0.1] [--no-open]
skillcp skill list|add|rm|show
skillcp skill rm <name> [--keep] [--project]
skillcp mcp list|add|rm|show
skillcp mcp rm <name> [--keep] [--project]
skillcp harnesses
```

## What we deliberately do not do

Skillcp stays a local library plus adapters. It does not:

- Store secrets in a keychain (copy env values as written; prefer `$ENV_NAME`)
- Cover every editor (Amp, Roo, Continue, Zed, Goose, Crush, …). New hosts are a small adapter if you need them.

`skill rm` and `mcp rm` unsync detected harnesses by default. Pass `--keep` to leave those copies alone (skills that were symlinks are copied first so they keep working).

`skillcp` with no arguments prints a short status and the two commands that matter: `ui` and `sync`.

## Development

```bash
npm install
npm test
npm run build
node dist/cli.js status
```

Node 20+ is required.