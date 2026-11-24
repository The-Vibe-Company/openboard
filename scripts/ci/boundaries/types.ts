import type { DbClient } from "./db-client.ts";

/** The allow-list entry for one workspace (docs/codebase.md 3.1). */
export type Rule = { may: string[]; types?: string[]; external: string[] };

/** The data in scripts/ci/boundaries.json. */
export type Config = {
  graph: Record<string, Rule>;
  /** Workspace directory names of the drivers, and the only files outside them allowed to import one. */
  drivers: {
    workspaces: string[];
    compositionRoots: string[];
    exampleTestDriver: string;
    ciImports: Record<string, string>;
  };
  /** Each database client and the one driver workspace that may open it. */
  dbClients: { clients: DbClient[] };
  tests: { external: string[]; examples: string[] };
  denyTerms: string[];
};

/** One refused import, manifest entry or integration name. */
export type Violation = { file: string; line?: number; message: string };

export function isExampleTest(workspace: string, file: string): boolean {
  return workspace.startsWith("examples/") && file.startsWith(`${workspace}/test/`);
}
