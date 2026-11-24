import { BoardError, type Client } from "@the-vibe-company/openboard";

export type Grant = Awaited<ReturnType<Client["createGrant"]>>["grant"];
export type Can = Grant["can"];
type Permission = Exclude<Can[string], "all">[number];

const permissions = new Set<string>(["read", "post", "react", "label", "sync", "manage"]);

export function formatCan(can: Can): string {
  return Object.entries(can)
    .map(([pattern, value]) => `${pattern}=${value.length ? value : "none"}`)
    .join("\n");
}

export function parseCan(text: string): Can {
  const entries = new Map<string, Can[string]>();
  for (const entry of text.trim().split(/[;\s]+/)) {
    const [pattern, value, extra] = entry.split("=");
    if (!pattern || !value || extra !== undefined) throw new Error("Use pattern=permissions for every entry.");
    if (entries.has(pattern)) throw new Error(`Enter permissions for ${pattern} only once.`);
    if (value === "all" || value === "none") {
      entries.set(pattern, value === "all" ? "all" : []);
    } else {
      const listed = value.split(",");
      if (listed.length > 6 || !listed.every((permission) => permissions.has(permission))) {
        throw new Error("Use all, none, or a comma-separated list of read, post, react, label, sync, and manage.");
      }
      entries.set(pattern, listed as Permission[]);
    }
  }
  return Object.fromEntries(entries);
}

export function addConnectionGrant(client: Client, connection: string, can: Can) {
  return client.createGrant({ principals: [{ kind: "connection", connection }], can });
}

/** Cache authorization denials in place of previously visible data. */
export async function grantList<T>(load: () => Promise<T>) {
  try {
    return { value: await load() };
  } catch (error) {
    if (error instanceof BoardError && [401, 403, 404].includes(error.status)) return { denial: error };
    throw error;
  }
}

export function grantError(error: unknown): string[] {
  if (!(error instanceof BoardError)) return [error instanceof Error ? error.message : "Request failed."];
  return [
    error.message,
    ...(error.hint ? [error.hint] : []),
    ...(error.next ?? []).map((step) => {
      switch (step.kind) {
        case "run":
          return step.argv.join(" ");
        case "call":
          return `Call ${step.operation} with ${JSON.stringify(step.input)}`;
        case "wait":
          return `Wait ${step.seconds} seconds.`;
        case "read":
          return step.url;
        default:
          return "";
      }
    }),
  ];
}
