import { extraCopilotProjectMcp, vscodeGlobalMcpFile, type Harness, type McpFormat } from "./harnesses.js";
import { backupFile, exists, readJsonc, readToml, writeJson, writeToml, type JsonObject } from "./fsx.js";
import { backupRoot } from "./library.js";
import {
  extractMap,
  normalizeMap,
  normalizeServer,
  toCodexEntry,
  toGeminiEntry,
  toMcpServersEntry,
  toOpenCodeEntry,
  toVscodeEntry,
} from "./mcp-format.js";
import type { McpServerConfig, McpServerMap, Scope } from "./types.js";

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function emptyDocument(format: McpFormat): JsonObject {
  switch (format) {
    case "mcpServers":
    case "claude-json":
    case "gemini-settings":
      return { mcpServers: {} };
    case "vscode-servers":
      return { servers: {} };
    case "opencode":
      return { $schema: "https://opencode.ai/config.json", mcp: {} };
    case "codex-toml":
      return { mcp_servers: {} };
  }
}

function opencodeBucket(doc: JsonObject): { parent: JsonObject; key: "mcp" | "servers"; nested: boolean } {
  const mcp = isRecord(doc.mcp) ? doc.mcp : undefined;
  if (mcp && isRecord(mcp.servers)) {
    return { parent: mcp, key: "servers", nested: true };
  }
  return { parent: doc, key: "mcp", nested: false };
}

export function readServerMap(file: string, format: McpFormat): McpServerMap {
  if (format === "codex-toml") {
    const doc = readToml(file) ?? {};
    return normalizeMap(doc.mcp_servers);
  }
  const doc = readJsonc(file);
  if (!doc) return {};
  if (format === "vscode-servers") {
    if (isRecord(doc.servers)) return normalizeMap(doc.servers);
    if (isRecord(doc.mcpServers)) return normalizeMap(doc.mcpServers);
    return {};
  }
  if (format === "opencode") {
    const mcp = isRecord(doc.mcp) ? doc.mcp : undefined;
    if (mcp && isRecord(mcp.servers)) return normalizeMap(mcp.servers);
    return normalizeMap(doc.mcp);
  }
  return extractMap(doc, "mcpServers");
}

function mergeJsonMap(
  doc: JsonObject,
  key: string,
  incoming: Record<string, Record<string, unknown>>,
  prune: Set<string> | undefined,
): JsonObject {
  const current = isRecord(doc[key]) ? { ...doc[key] } : {};
  if (prune) {
    for (const name of prune) delete current[name];
  }
  for (const [name, server] of Object.entries(incoming)) {
    current[name] = server;
  }
  return { ...doc, [key]: current };
}

export function writeServerMap(
  file: string,
  format: McpFormat,
  incoming: McpServerMap,
  options: { prune?: string[]; dryRun?: boolean } = {},
): { previous: McpServerMap; next: McpServerMap; changed: boolean } {
  const previous = exists(file) ? readServerMap(file, format) : {};
  const prune = options.prune ? new Set(options.prune) : undefined;
  const next: McpServerMap = { ...previous };
  if (prune) {
    for (const name of prune) delete next[name];
  }
  for (const [name, server] of Object.entries(incoming)) {
    next[name] = server;
  }

  const changed = JSON.stringify(previous) !== JSON.stringify(next);
  if (!changed || options.dryRun) {
    return { previous, next, changed };
  }

  backupFile(file, backupRoot());

  if (format === "codex-toml") {
    const doc = (exists(file) ? readToml(file) : undefined) ?? emptyDocument(format);
    const encoded: JsonObject = {};
    for (const [name, server] of Object.entries(next)) {
      encoded[name] = toCodexEntry(server);
    }
    writeToml(file, { ...doc, mcp_servers: encoded });
    return { previous, next, changed };
  }

  const existing = exists(file) ? readJsonc<JsonObject>(file) : undefined;
  const doc = existing ? { ...existing } : emptyDocument(format);
  const encoded: Record<string, Record<string, unknown>> = {};
  const encode = encoder(format);
  for (const [name, server] of Object.entries(next)) {
    encoded[name] = encode(server);
  }

  if (format === "opencode") {
    const bucket = opencodeBucket(doc);
    if (bucket.nested) {
      const mcp = isRecord(doc.mcp) ? { ...doc.mcp } : {};
      mcp.servers = encoded;
      writeJson(file, { ...doc, mcp });
    } else {
      writeJson(file, { ...doc, mcp: encoded });
    }
    return { previous, next, changed };
  }

  const key = format === "vscode-servers" ? "servers" : "mcpServers";
  writeJson(file, mergeJsonMap(doc, key, encoded, prune));
  return { previous, next, changed };
}

function encoder(format: McpFormat): (server: McpServerConfig) => Record<string, unknown> {
  switch (format) {
    case "vscode-servers":
      return toVscodeEntry;
    case "opencode":
      return toOpenCodeEntry;
    case "gemini-settings":
      return toGeminiEntry;
    case "mcpServers":
    case "claude-json":
      return toMcpServersEntry;
    case "codex-toml":
      return toCodexEntry;
  }
}

export function harnessMcpTargets(harness: Harness, scope: Scope): Array<{ file: string; format: McpFormat }> {
  const file = harness.mcpFile(scope);
  const format = harness.mcpFormat(scope);
  if (!file || !format) return [];
  const targets = [{ file, format }];
  if (harness.id === "copilot" && scope === "global") {
    targets.push({ file: vscodeGlobalMcpFile(), format: "vscode-servers" });
  }
  if (harness.id === "copilot" && scope === "project") {
    targets.push({ file: extraCopilotProjectMcp(), format: "mcpServers" });
  }
  return targets;
}

export function importServersFromFile(file: string, format: McpFormat): McpServerMap {
  return readServerMap(file, format);
}

export function parseServerInput(input: unknown): McpServerConfig {
  const server = normalizeServer(input);
  if (!server) throw new Error("Invalid MCP server definition");
  if (!server.command && !server.url) {
    throw new Error("MCP server needs a command (stdio) or url (http/sse)");
  }
  return server;
}
