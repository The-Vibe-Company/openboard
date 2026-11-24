import type { SchemaView } from "@openboard/contract";

/** Built-in definitions from Vercel Board's src/contract/data-schemas.ts (Apache-2.0, see NOTICE). */
export function builtInSchemas(): SchemaView[] {
  const commitSha = {
    type: "string",
    pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
    description: "Full lowercase commit SHA",
  };
  const metadata = { version: 1, builtIn: true, by: null, at: null };
  return [
    {
      ...metadata,
      id: "git-commit@1",
      name: "git-commit",
      description: "A Git commit, by its full SHA and the first line of its message.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["sha", "title"],
        properties: {
          sha: commitSha,
          title: { type: "string", minLength: 1, maxLength: 1024 },
        },
      },
    },
    {
      ...metadata,
      id: "vercel-deployment@1",
      name: "vercel-deployment",
      description: "A Vercel deployment, by its URL and optionally the commit it was built from.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["url"],
        properties: {
          url: { type: "string", format: "uri", pattern: "^https://", maxLength: 2048 },
          gitSha: commitSha,
        },
      },
    },
  ];
}
