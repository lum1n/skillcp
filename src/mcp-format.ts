import type { McpServerConfig, McpServerMap, McpTransport } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item;
  }
  return Object.keys(out).length ? out : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function transportOf(raw: Record<string, unknown>): McpTransport | undefined {
  const type = typeof raw.type === "string" ? raw.type : undefined;
  if (type === "stdio" || type === "local") return "stdio";
  if (type === "http" || type === "streamable-http" || type === "remote") return "http";
  if (type === "sse") return "sse";
  if (typeof raw.httpUrl === "string") return "http";
  if (typeof raw.url === "string" && !raw.command) return raw.type === "sse" ? "sse" : "http";
  if (typeof raw.command === "string" || Array.isArray(raw.command)) return "stdio";
  return undefined;
}

export function normalizeServer(raw: unknown): McpServerConfig | undefined {
  if (!isRecord(raw)) return undefined;
  const type = transportOf(raw);
  const env = stringRecord(raw.env) ?? stringRecord(raw.environment);
  const headers = stringRecord(raw.headers);
  const cwd = typeof raw.cwd === "string" ? raw.cwd : undefined;
  const args = stringArray(raw.args);

  if (Array.isArray(raw.command) && raw.command.length > 0) {
    const [command, ...rest] = raw.command.filter((item): item is string => typeof item === "string");
    if (!command) return undefined;
    return compact({ type: type ?? "stdio", command, args: rest.length ? rest : undefined, env, cwd, headers });
  }

  const command = typeof raw.command === "string" ? raw.command : undefined;
  const url =
    typeof raw.url === "string" ? raw.url : typeof raw.httpUrl === "string" ? raw.httpUrl : undefined;

  if (command) {
    return compact({ type: type ?? "stdio", command, args, env, cwd, url, headers });
  }
  if (url) {
    return compact({ type: type ?? "http", url, headers, env, cwd });
  }
  return undefined;
}

function compact(server: McpServerConfig): McpServerConfig {
  const out: McpServerConfig = {};
  if (server.type) out.type = server.type;
  if (server.command) out.command = server.command;
  if (server.args?.length) out.args = server.args;
  if (server.env && Object.keys(server.env).length) out.env = server.env;
  if (server.cwd) out.cwd = server.cwd;
  if (server.url) out.url = server.url;
  if (server.headers && Object.keys(server.headers).length) out.headers = server.headers;
  return out;
}

export function normalizeMap(raw: unknown): McpServerMap {
  if (!isRecord(raw)) return {};
  const out: McpServerMap = {};
  for (const [name, value] of Object.entries(raw)) {
    if (name.startsWith("_")) continue;
    const server = normalizeServer(value);
    if (server) out[name] = server;
  }
  return out;
}

export function extractMap(doc: unknown, rootKey: string): McpServerMap {
  if (!isRecord(doc)) return {};
  return normalizeMap(doc[rootKey]);
}

export function toMcpServersEntry(server: McpServerConfig): Record<string, unknown> {
  const type = server.type ?? (server.command ? "stdio" : "http");
  if (type === "stdio" && server.command) {
    return compactRecord({
      command: server.command,
      args: server.args,
      env: server.env,
      cwd: server.cwd,
    });
  }
  return compactRecord({
    type: type === "sse" ? "sse" : "http",
    url: server.url,
    headers: server.headers,
  });
}

export function toVscodeEntry(server: McpServerConfig): Record<string, unknown> {
  const type = server.type ?? (server.command ? "stdio" : "http");
  if (type === "stdio" && server.command) {
    return compactRecord({
      type: "stdio",
      command: server.command,
      args: server.args,
      env: server.env,
      cwd: server.cwd,
    });
  }
  return compactRecord({
    type: type === "sse" ? "sse" : "http",
    url: server.url,
    headers: server.headers,
  });
}

export function toOpenCodeEntry(server: McpServerConfig): Record<string, unknown> {
  const type = server.type ?? (server.command ? "stdio" : "http");
  if (type === "stdio" && server.command) {
    return compactRecord({
      type: "local",
      command: [server.command, ...(server.args ?? [])],
      environment: server.env,
      cwd: server.cwd,
      enabled: true,
    });
  }
  return compactRecord({
    type: "remote",
    url: server.url,
    headers: server.headers,
    enabled: true,
  });
}

export function toGeminiEntry(server: McpServerConfig): Record<string, unknown> {
  const type = server.type ?? (server.command ? "stdio" : "http");
  if (type === "stdio" && server.command) {
    return compactRecord({
      command: server.command,
      args: server.args,
      env: server.env,
      cwd: server.cwd,
    });
  }
  if (type === "sse") {
    return compactRecord({
      url: server.url,
      headers: server.headers,
    });
  }
  return compactRecord({
    httpUrl: server.url,
    headers: server.headers,
  });
}

export function toCodexEntry(server: McpServerConfig): Record<string, unknown> {
  const type = server.type ?? (server.command ? "stdio" : "http");
  if (type === "stdio" && server.command) {
    return compactRecord({
      command: server.command,
      args: server.args,
      env: server.env,
      cwd: server.cwd,
    });
  }
  return compactRecord({
    url: server.url,
  });
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    if (Array.isArray(item) && item.length === 0) continue;
    if (isRecord(item) && Object.keys(item).length === 0) continue;
    out[key] = item;
  }
  return out;
}

export function mapsEqual(a: McpServerMap, b: McpServerMap): boolean {
  return JSON.stringify(sortMap(a)) === JSON.stringify(sortMap(b));
}

export function sortMap(map: McpServerMap): McpServerMap {
  return Object.fromEntries(
    Object.entries(map)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, server]) => [name, compact(server)]),
  );
}

export function pickManaged(map: McpServerMap, names: string[]): McpServerMap {
  const out: McpServerMap = {};
  for (const name of names) {
    if (map[name]) out[name] = map[name];
  }
  return out;
}
