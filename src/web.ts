import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { HARNESSES } from "./harnesses.js";
import { importFromHarnesses } from "./import.js";
import { addMcp, addSkillSource, installSelfMcp, installSelfSkill, removeMcp } from "./install.js";
import { initLibrary, isInitialized, libraryRoot } from "./library.js";
import { parseServerInput } from "./mcp-io.js";
import { doctor, statusReport } from "./status.js";
import {
  listLibrarySkills,
  readSkillMarkdown,
  removeLibrarySkill,
  skillBody,
  writeLibrarySkill,
} from "./skills.js";
import { loadLibraryMcp, syncAll } from "./sync.js";

export type WebUiOptions = {
  host?: string;
  port?: number;
  open?: boolean;
};

export type WebUi = {
  url: string;
  host: string;
  port: number;
  server: http.Server;
  close: () => Promise<void>;
};

const MAX_BODY = 1_000_000;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

export function webRoot(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
}

function ensure(): void {
  if (!isInitialized()) initLibrary();
}

function snapshot() {
  ensure();
  const skills = listLibrarySkills().map((skill) => ({
    name: skill.name,
    description: skill.description,
    dir: skill.dir,
  }));
  return {
    library: libraryRoot(),
    skills,
    mcp: loadLibraryMcp(),
    status: statusReport(),
    doctor: doctor(),
    harnesses: HARNESSES.map((harness) => ({
      id: harness.id,
      name: harness.name,
      detected: harness.detect(),
      skills: harness.skills,
      mcp: harness.mcp,
    })),
  };
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY) {
      throw new Error("Request body too large");
    }
    chunks.push(buf);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON");
  }
}

function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendError(res: http.ServerResponse, status: number, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  sendJson(res, status, { error: message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string" && value.trim()) {
    return value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
  }
  return undefined;
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  const method = req.method ?? "GET";
  const pathname = url.pathname;
  if (!pathname.startsWith("/api/")) return false;

  try {
    const body = method === "GET" || method === "HEAD" ? {} : await readBody(req);
    const data = isRecord(body) ? body : {};

    if (method === "GET" && pathname === "/api/state") {
      sendJson(res, 200, snapshot());
      return true;
    }

    if (method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, { ok: true });
      return true;
    }

    const skillGet = pathname.match(/^\/api\/skills\/([^/]+)$/);
    if (method === "GET" && skillGet) {
      const name = decodeURIComponent(skillGet[1]);
      const markdown = readSkillMarkdown(name);
      if (markdown === undefined) {
        sendError(res, 404, `Skill "${name}" is not in the library`);
        return true;
      }
      const skills = listLibrarySkills();
      const record = skills.find((skill) => skill.name === name);
      sendJson(res, 200, {
        name,
        description: record?.description ?? "",
        dir: record?.dir,
        markdown,
        body: skillBody(markdown),
      });
      return true;
    }

    if (method === "POST" && pathname === "/api/skills") {
      const source = str(data.source);
      if (source) {
        const added = addSkillSource(source, str(data.path));
        sendJson(res, 200, { added, state: snapshot() });
        return true;
      }
      const name = str(data.name);
      const description = str(data.description);
      if (!name || description === undefined) {
        throw new Error("Provide source, or name and description");
      }
      const record = writeLibrarySkill(name, description, str(data.body) ?? "");
      sendJson(res, 200, { skill: record, state: snapshot() });
      return true;
    }

    if (method === "PUT" && skillGet) {
      const name = decodeURIComponent(skillGet[1]);
      if (readSkillMarkdown(name) === undefined) {
        sendError(res, 404, `Skill "${name}" is not in the library`);
        return true;
      }
      const description = str(data.description);
      if (description === undefined) throw new Error("description is required");
      const record = writeLibrarySkill(name, description, str(data.body) ?? "");
      sendJson(res, 200, { skill: record, state: snapshot() });
      return true;
    }

    if (method === "DELETE" && skillGet) {
      const name = decodeURIComponent(skillGet[1]);
      const ok = removeLibrarySkill(name);
      if (!ok) {
        sendError(res, 404, `Skill "${name}" is not in the library`);
        return true;
      }
      sendJson(res, 200, { removed: name, state: snapshot() });
      return true;
    }

    if (method === "POST" && pathname === "/api/mcp") {
      const name = str(data.name);
      if (!name) throw new Error("name is required");
      const server = parseServerInput({
        type: str(data.type),
        command: str(data.command),
        args: stringArray(data.args),
        url: str(data.url),
        cwd: str(data.cwd),
        env: stringMap(data.env),
        headers: stringMap(data.headers),
      });
      addMcp(name, server);
      sendJson(res, 200, { name, server, state: snapshot() });
      return true;
    }

    const mcpMatch = pathname.match(/^\/api\/mcp\/([^/]+)$/);
    if (method === "DELETE" && mcpMatch) {
      const name = decodeURIComponent(mcpMatch[1]);
      const ok = removeMcp(name);
      if (!ok) {
        sendError(res, 404, `MCP server "${name}" is not in the library`);
        return true;
      }
      sendJson(res, 200, { removed: name, state: snapshot() });
      return true;
    }

    if (method === "POST" && pathname === "/api/import") {
      const result = importFromHarnesses({
        project: bool(data.project),
        overwrite: bool(data.overwrite),
        all: bool(data.all),
        to: stringArray(data.harnesses) ?? stringArray(data.to),
      });
      sendJson(res, 200, { result, state: snapshot() });
      return true;
    }

    if (method === "POST" && pathname === "/api/sync") {
      const targets = syncAll({
        project: bool(data.project),
        dryRun: bool(data.dryRun),
        force: bool(data.force),
        prune: bool(data.prune),
        all: bool(data.all),
        to: stringArray(data.harnesses) ?? stringArray(data.to),
      });
      sendJson(res, 200, { targets, state: snapshot() });
      return true;
    }

    if (method === "POST" && pathname === "/api/install") {
      installSelfSkill();
      installSelfMcp();
      const targets = bool(data.sync) === false ? undefined : syncAll({ project: bool(data.project) });
      sendJson(res, 200, { installed: true, targets, state: snapshot() });
      return true;
    }

    sendError(res, 404, `No API route ${method} ${pathname}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /not in the library|required|Invalid|No SKILL|too large|JSON/i.test(message) ? 400 : 500;
    sendError(res, status, error);
    return true;
  }
}

function safeStatic(pathname: string): string | undefined {
  const root = path.resolve(webRoot());
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = path.resolve(root, relative);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (file !== root && !file.startsWith(prefix)) return undefined;
  return file;
}

function serveStatic(res: http.ServerResponse, pathname: string): void {
  const file = safeStatic(pathname);
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    sendError(res, 404, "Not found");
    return;
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  fs.createReadStream(file).pipe(res);
}

export function createWebServer(): http.Server {
  return http.createServer(async (req, res) => {
    const host = req.headers.host ?? "127.0.0.1";
    const url = new URL(req.url ?? "/", `http://${host}`);
    try {
      const handled = await handleApi(req, res, url);
      if (handled) return;
      if ((req.method ?? "GET") !== "GET" && (req.method ?? "GET") !== "HEAD") {
        sendError(res, 405, "Method not allowed");
        return;
      }
      serveStatic(res, url.pathname);
    } catch (error) {
      if (!res.headersSent) sendError(res, 500, error);
    }
  });
}

function openBrowser(url: string): void {
  try {
    const child =
      process.platform === "darwin"
        ? spawn("open", [url], { detached: true, stdio: "ignore" })
        : process.platform === "win32"
          ? spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" })
          : spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // Opening a browser is optional; the URL is printed either way.
  }
}

export async function startWebUi(options: WebUiOptions = {}): Promise<WebUi> {
  ensure();
  const host = options.host ?? "127.0.0.1";
  const wantedPort = options.port ?? 8787;
  const server = createWebServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(wantedPort, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : wantedPort;
  const url = `http://${host}:${port}/`;
  if (options.open) openBrowser(url);
  return {
    url,
    host,
    port,
    server,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

let running: Promise<WebUi> | undefined;

export async function ensureWebUi(options: WebUiOptions = {}): Promise<WebUi> {
  if (!running) {
    running = startWebUi({
      host: options.host ?? "127.0.0.1",
      port: options.port ?? 8787,
      open: options.open ?? true,
    })
      .then((ui) => {
        ui.server.on("close", () => {
          running = undefined;
        });
        return ui;
      })
      .catch((error) => {
        running = undefined;
        throw error;
      });
  }
  return running;
}
