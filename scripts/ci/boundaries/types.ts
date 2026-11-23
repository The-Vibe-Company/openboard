/** The allow-list entry for one workspace (docs/codebase.md 3.1). */
export type Rule = { may: string[]; types?: string[]; external: string[] };

/** The data in scripts/ci/boundaries.json. */
export type Config = { graph: Record<string, Rule>; tests: { external: string[] }; denyTerms: string[] };

/** One refused import, manifest entry or integration name. */
export type Violation = { file: string; line?: number; message: string };
