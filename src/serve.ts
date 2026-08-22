import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { importFromHarnesses } from "./import.js";
import { addMcp, addSkillSource, installSelfMcp, installSelfSkill, removeMcp, uninstallSkill } from "./install.js";
import { initLibrary, isInitialized, libraryRoot } from "./library.js";
import { parseServerInput } from "./mcp-io.js";
import { doctor, statusReport } from "./status.js";
import { listLibrarySkills } from "./skills.js";
import { loadLibraryMcp, syncAll } from "./sync.js";
import { packageVersion } from "./version.js";

function text(value: unknown) {
  return {
    content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  };
}

function ensure(): void {
  if (!isInitialized()) initLibrary();
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "skillcp",
    version: packageVersion(),
  });

  server.tool("skillcp_status", "Show the Skillcp library and harness sync status", {}, async () => {
    ensure();
    return text(statusReport());
  });

  server.tool("skillcp_doctor", "Find drift between the library and harness configs", {}, async () => {
    ensure();
    const issues = doctor();
    return text(issues.length ? issues : "All detected harnesses match the Skillcp library.");
  });

  server.tool("skillcp_list_skills", "List skills stored in the Skillcp library", {}, async () => {
    ensure();
    return text(
      listLibrarySkills().map((skill) => ({
        name: skill.name,
        description: skill.description,
        dir: skill.dir,
      })),
    );
  });

  server.tool("skillcp_list_mcps", "List MCP servers stored in the Skillcp library", {}, async () => {
    ensure();
    return text(loadLibraryMcp());
  });

  server.tool(
    "skillcp_add_skill",
    "Add a skill from a local directory, git URL, or GitHub owner/repo into the library",
    {
      source: z.string().describe("Local path, git URL, or GitHub owner/repo"),
      path: z.string().optional().describe("Subdirectory inside a git repository"),
    },
    async ({ source, path: subpath }) => {
      ensure();
      const added = addSkillSource(source, subpath);
      return text({ added });
    },
  );

  server.tool(
    "skillcp_remove_skill",
    "Remove a skill from the Skillcp library and unsync it from detected harnesses",
    {
      name: z.string(),
      keep: z.boolean().optional().describe("Leave harness copies in place"),
      project: z.boolean().optional().describe("Also unsync project-scoped copies"),
    },
    async ({ name, keep, project }) => {
      ensure();
      const result = uninstallSkill(name, { keep, project });
      return text(
        result.removed
          ? { removed: name, keep: Boolean(keep), targets: result.targets }
          : `Skill ${name} was not in the library`,
      );
    },
  );

  server.tool(
    "skillcp_add_mcp",
    "Add an MCP server to the library. Provide command for stdio or url for HTTP/SSE.",
    {
      name: z.string(),
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
      url: z.string().optional(),
      type: z.enum(["stdio", "http", "sse"]).optional(),
      env: z.record(z.string()).optional(),
      headers: z.record(z.string()).optional(),
      cwd: z.string().optional(),
    },
    async (input) => {
      ensure();
      const server = parseServerInput(input);
      addMcp(input.name, server);
      return text({ name: input.name, server });
    },
  );

  server.tool(
    "skillcp_remove_mcp",
    "Remove an MCP server from the library and unsync it from detected harnesses",
    {
      name: z.string(),
      keep: z.boolean().optional().describe("Leave harness copies in place"),
      project: z.boolean().optional().describe("Also unsync project-scoped copies"),
    },
    async ({ name, keep, project }) => {
      ensure();
      const ok = removeMcp(name, { keep, project });
      return text(ok ? `Removed ${name}` : `MCP server ${name} was not in the library`);
    },
  );

  server.tool(
    "skillcp_import",
    "Import skills and MCP configs from detected harnesses into the library",
    {
      project: z.boolean().optional(),
      overwrite: z.boolean().optional(),
      harnesses: z.array(z.string()).optional(),
    },
    async ({ project, overwrite, harnesses }) => {
      ensure();
      return text(importFromHarnesses({ project, overwrite, to: harnesses }));
    },
  );

  server.tool(
    "skillcp_sync",
    "Sync the Skillcp library to harness skill directories and MCP config files",
    {
      project: z.boolean().optional(),
      dryRun: z.boolean().optional(),
      force: z.boolean().optional(),
      harnesses: z.array(z.string()).optional(),
      all: z.boolean().optional(),
    },
    async ({ project, dryRun, force, harnesses, all }) => {
      ensure();
      return text(syncAll({ project, dryRun, force, to: harnesses, all }));
    },
  );

  server.tool(
    "skillcp_install_self",
    "Register Skillcp as a skill and MCP server in the library, then sync it to harnesses",
    {
      sync: z.boolean().optional().default(true),
    },
    async ({ sync }) => {
      ensure();
      installSelfSkill();
      installSelfMcp();
      const result = sync ? syncAll() : undefined;
      return text({ library: libraryRoot(), synced: result ?? "skipped" });
    },
  );

  server.tool(
    "skillcp_write_skill",
    "Create or overwrite a skill in the library from name, description, and markdown body",
    {
      name: z.string(),
      description: z.string(),
      body: z.string().optional(),
    },
    async ({ name, description, body }) => {
      ensure();
      const { writeLibrarySkill } = await import("./skills.js");
      return text(writeLibrarySkill(name, description, body ?? ""));
    },
  );

  server.tool(
    "skillcp_open_ui",
    "Start the Skillcp localhost web UI if needed and return its URL",
    {
      port: z.number().optional(),
      open: z.boolean().optional(),
    },
    async ({ port, open }) => {
      ensure();
      const { ensureWebUi } = await import("./web.js");
      const ui = await ensureWebUi({ port, open: open ?? true });
      return text({ url: ui.url, host: ui.host, port: ui.port });
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
