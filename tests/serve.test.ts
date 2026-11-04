import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.join(import.meta.dirname, "..");

let home: string;
let client: Client;

async function connect(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), path.join(root, "src", "cli.ts"), "serve"],
    cwd: root,
    env: {
      ...(process.env as Record<string, string>),
      SKILLCP_HOME: home,
      SKILLCP_DIR: path.join(home, ".skillcp"),
      SKILLCP_PROJECT: path.join(home, "proj"),
      XDG_CONFIG_HOME: path.join(home, ".config"),
    },
  });
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
}

function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return content.map((c) => c.text).join("");
}

beforeEach(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "skillcp-serve-"));
  fs.mkdirSync(path.join(home, "proj"), { recursive: true });
  await connect();
}, 30_000);

afterEach(async () => {
  await client.close();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("MCP server", () => {
  it("registers the expected tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["skillcp_status", "skillcp_add_mcp", "skillcp_list_mcps", "skillcp_sync"]),
    );
  }, 30_000);

  it("accepts env and headers records in skillcp_add_mcp and stores them", async () => {
    const added = await client.callTool({
      name: "skillcp_add_mcp",
      arguments: {
        name: "demo",
        command: "node",
        args: ["server.js"],
        env: { TOKEN: "abc" },
      },
    });
    expect(added.isError).toBeFalsy();
    const body = JSON.parse(textOf(added));
    expect(body.name).toBe("demo");
    expect(body.server.env).toEqual({ TOKEN: "abc" });

    const http = await client.callTool({
      name: "skillcp_add_mcp",
      arguments: { name: "remote", url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } },
    });
    expect(http.isError).toBeFalsy();
    expect(JSON.parse(textOf(http)).server.headers).toEqual({ Authorization: "Bearer x" });

    const listed = JSON.parse(textOf(await client.callTool({ name: "skillcp_list_mcps", arguments: {} })));
    expect(Object.keys(listed)).toEqual(expect.arrayContaining(["demo", "remote"]));
  }, 30_000);

  it("rejects non-string env values", async () => {
    const result = await client
      .callTool({
        name: "skillcp_add_mcp",
        arguments: { name: "bad", command: "node", env: { PORT: 8080 } },
      })
      .catch((error: Error) => ({ isError: true, content: [{ type: "text", text: String(error) }] }));
    expect(result.isError).toBe(true);
    const listed = JSON.parse(textOf(await client.callTool({ name: "skillcp_list_mcps", arguments: {} })));
    expect(listed.bad).toBeUndefined();
  }, 30_000);

  it("reports removing an unknown MCP server", async () => {
    const result = await client.callTool({ name: "skillcp_remove_mcp", arguments: { name: "nope" } });
    expect(textOf(result)).toContain("was not in the library");
  }, 30_000);
});
