# Skillcp

Yes. Skills and MCP servers are already portable — every major harness just hides them in a different folder and JSON shape. Skillcp is the missing library: **one copy of each skill and MCP server, published to every harness you use.**

It is a CLI, an MCP server, and an Agent Skill, so Cursor, Claude Code, Copilot, Codex, Gemini CLI, Windsurf, OpenCode, Cline, and Claude Desktop can all drive it.

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
npm install -g github:lum1n/skillcp
# or from npm, once published:
# npm install -g skillcp
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

Any MCP-capable harness can then call tools like `skillcp_add_skill`, `skillcp_add_mcp`, `skillcp_import`, and `skillcp_sync` instead of editing five config files by hand.

If the MCP server is not connected, agents can still run the CLI. The bundled skill at `skills/skillcp/SKILL.md` documents both paths.

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

MCP conversion covers the real format drift: `mcpServers` vs `servers` vs OpenCode `mcp` vs Codex TOML `mcp_servers`, plus Gemini's `httpUrl` vs `url`.

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

Sync is additive. Extra MCP servers a harness already had are left alone. `--prune` removes servers Skillcp used to manage that are gone from the library. `--force` replaces skill folders that are not Skillcp symlinks.

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
skillcp skill list|add|rm|show
skillcp mcp list|add|rm|show
skillcp harnesses
```

## Development

```bash
npm install
npm test
npm run build
node dist/cli.js status
```

Node 20+ is required.
