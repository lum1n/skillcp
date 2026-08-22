export type McpTransport = "stdio" | "http" | "sse";

export type McpServerConfig = {
  type?: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
};

export type McpServerMap = Record<string, McpServerConfig>;

export type SkillRecord = {
  name: string;
  description: string;
  dir: string;
  origin?: string;
};

export type SkillStrategy = "symlink" | "copy";

export type Scope = "global" | "project";

export type SyncTarget = {
  harness: string;
  kind: "skills" | "mcp";
  scope: Scope;
  path: string;
  action: "write" | "skip" | "link" | "copy" | "unchanged" | "remove";
  detail?: string;
};

export type Manifest = {
  skills: Record<string, { origin?: string }>;
  mcp: string[];
};

export type LibraryConfig = {
  skillStrategy: SkillStrategy;
  enabledHarnesses?: string[];
  disabledHarnesses?: string[];
};

export type DetectedHarness = {
  id: string;
  name: string;
  detected: boolean;
  skills: boolean;
  mcp: boolean;
};
