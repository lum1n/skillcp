const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

function resolveLaunch(subcommand) {
  const dist = path.join(__dirname, "..", "..", "dist", "cli.js");
  if (fs.existsSync(dist)) {
    return { command: process.execPath, args: [dist, subcommand] };
  }
  return { command: "npx", args: ["-y", "skillcp", subcommand] };
}

function runInTerminal(subcommand, extraArgs = []) {
  const launch = resolveLaunch(subcommand);
  const term = vscode.window.createTerminal({ name: "Skillcp" });
  const quoted = [launch.command, ...launch.args, ...extraArgs]
    .map((part) => (/\s/.test(part) ? `"${part}"` : part))
    .join(" ");
  term.sendText(quoted);
  term.show();
}

function activate(context) {
  if (vscode.lm && typeof vscode.lm.registerMcpServerDefinitionProvider === "function") {
    const launch = resolveLaunch("serve");
    context.subscriptions.push(
      vscode.lm.registerMcpServerDefinitionProvider("skillcp", {
        provideMcpServerDefinitions: async () => [
          new vscode.McpStdioServerDefinition({
            label: "skillcp",
            command: launch.command,
            args: launch.args,
            env: {},
            version: "0.1.0",
          }),
        ],
      }),
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("skillcp.openUi", () => runInTerminal("ui")),
    vscode.commands.registerCommand("skillcp.sync", () => runInTerminal("sync")),
    vscode.commands.registerCommand("skillcp.import", () => runInTerminal("import")),
    vscode.commands.registerCommand("skillcp.status", () => runInTerminal("status")),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
