import { isInitialized, libraryRoot } from "./library.js";
import { loadLibraryMcp } from "./sync.js";
import { listLibrarySkills } from "./skills.js";
import { HARNESSES } from "./harnesses.js";
import { statusReport } from "./status.js";

export * from "./types.js";
export * from "./paths.js";
export * from "./harnesses.js";
export * from "./library.js";
export * from "./skills.js";
export * from "./mcp-format.js";
export * from "./mcp-io.js";
export * from "./sync.js";
export * from "./import.js";
export * from "./install.js";
export * from "./status.js";

export function snapshot() {
  return {
    library: libraryRoot(),
    initialized: isInitialized(),
    skills: listLibrarySkills(),
    mcp: loadLibraryMcp(),
    harnesses: HARNESSES.map((harness) => ({
      id: harness.id,
      name: harness.name,
      detected: harness.detect(),
    })),
    status: statusReport(),
  };
}
