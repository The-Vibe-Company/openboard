import { BoardError } from "@openboard/contract";
import { setOperatorDeletion, setOperatorQuota, showOperatorOrg } from "@openboard/server";
import { withAdminStore } from "./compose.ts";
import { type Config, operatorName } from "./config.ts";
import type { MigrateOutput } from "./migrate.ts";

const quotaUsage = 'openboard admin quota <org> <boards|members|connections>=<limit> --reason "<reason>"';
const usage = [
  "Usage: openboard admin orgs [--json]",
  "       openboard admin show <org> [--json]",
  '       openboard admin delete <org> --reason "<reason>" [--json]',
  '       openboard admin undelete <org> --reason "<reason>" [--json]',
  `       ${quotaUsage}`,
].join("\n");

function parseQuota(args: readonly string[]) {
  const [command, slug, assignment, flag, reason] = args;
  if (command !== "quota" || !slug || !assignment) throw new BoardError("invalid_request", `Usage: ${quotaUsage}`);
  if (flag !== "--reason" || !reason?.trim()) throw new BoardError("invalid_request", "--reason is required");
  if (args.length !== 5) throw new BoardError("invalid_request", `Usage: ${quotaUsage}`);
  const [quota, value, extra] = assignment.split("=");
  const limit = Number(value);
  if (
    (quota !== "boards" && quota !== "members" && quota !== "connections") ||
    !value ||
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(limit) ||
    extra !== undefined
  ) {
    throw new BoardError(
      "invalid_request",
      "expected boards, members or connections with a non-negative integer limit",
    );
  }
  return { slug, quota, limit, reason } as const;
}

function parseArgs(args: readonly string[]) {
  const [command, slug, ...options] = args;
  if (command === "quota") return { command, change: parseQuota(args) } as const;
  if (command === "orgs" && (args.length === 1 || (slug === "--json" && args.length === 2))) {
    return { command, json: slug === "--json" } as const;
  }
  if (!slug || slug.startsWith("--")) throw new BoardError("invalid_request", "see openboard admin --help");
  if (command === "show" && (options.length === 0 || (options.length === 1 && options[0] === "--json"))) {
    return { command, slug, json: options[0] === "--json" } as const;
  }
  if (command === "delete" || command === "undelete") {
    const [flag, reason, json] = options;
    if (flag !== "--reason" || !reason?.trim() || reason.startsWith("--")) {
      throw new BoardError("invalid_request", "--reason is required");
    }
    if (options.length > 3 || (json !== undefined && json !== "--json")) {
      throw new BoardError("invalid_request", "see openboard admin --help");
    }
    return { command, slug, reason, json: json === "--json" } as const;
  }
  throw new BoardError("invalid_request", "see openboard admin --help");
}

function date(at: number | null) {
  return at === null ? null : new Date(at).toISOString();
}

function describeOrg(org: { slug: string; deletedAt: string | null; purgedAt: string | null }) {
  return `${org.slug}  ${org.purgedAt ? `purged ${org.purgedAt}` : org.deletedAt ? `deleted ${org.deletedAt}` : "active"}`;
}

function dates<Org extends { createdAt: number; deletedAt: number | null; purgedAt: number | null }>(org: Org) {
  return { ...org, createdAt: date(org.createdAt), deletedAt: date(org.deletedAt), purgedAt: date(org.purgedAt) };
}

function summarize(org: {
  createdAt: string | null;
  deletedAt: string | null;
  purgedAt: string | null;
  slug: string;
  boards: number;
  members: number;
  storedBytes: number;
}) {
  return `${describeOrg(org)}  created ${org.createdAt}  boards ${org.boards}  members ${org.members}  stored bytes ${org.storedBytes}`;
}

async function runAdmin(config: Config, args: ReturnType<typeof parseArgs>, output: MigrateOutput) {
  await withAdminStore(config, async (platform, now) => {
    switch (args.command) {
      case "quota": {
        const quotas = await setOperatorQuota(platform, { ...args.change, name: operatorName() }, now);
        output.out(JSON.stringify({ org: args.change.slug, quotas }));
        break;
      }
      case "orgs": {
        const orgs = (await platform.listOperatorOrgs()).map(dates);
        if (args.json) output.out(JSON.stringify(orgs));
        else for (const org of orgs) output.out(summarize(org));
        break;
      }
      case "show": {
        const details = await showOperatorOrg(platform, args.slug);
        const org = {
          ...dates(details),
          boardList: details.boardList.map((board) => ({
            ...board,
            deletedAt: date(board.deletedAt),
          })),
        };
        if (args.json) output.out(JSON.stringify(org));
        else {
          output.out(summarize(org));
          if (org.deletionReason !== null) output.out(`Deletion reason: ${JSON.stringify(org.deletionReason)}`);
          output.out(`Quotas: ${JSON.stringify(org.quotas)}`);
          output.out(`Overrides: ${JSON.stringify(org.overrides)}`);
          output.out(`Owners: ${org.owners.join(", ") || "none"}`);
          output.out(
            `Boards: ${
              org.boardList
                .map(
                  (board) =>
                    `${board.slug} (${JSON.stringify(board.name)})${board.deletedAt ? ` deleted ${board.deletedAt}` : ""}`,
                )
                .join(", ") || "none"
            }`,
          );
        }
        break;
      }
      case "delete":
      case "undelete": {
        const result = await setOperatorDeletion(
          platform,
          { ...args, action: args.command, name: operatorName() },
          now,
        );
        output.out(
          args.json
            ? JSON.stringify(result)
            : describeOrg({ ...result, purgedAt: null }) +
                (result.purgeAt ? `  purge scheduled ${result.purgeAt}` : ""),
        );
        break;
      }
    }
  });
}

export async function admin(config: Config, args: readonly string[], output: MigrateOutput): Promise<number> {
  if (args.length === 1 && args[0] === "--help") {
    output.out(usage);
    return 0;
  }
  try {
    const command = parseArgs(args);
    if (command.command !== "quota" && config.mode !== "hosted") {
      throw new BoardError("invalid_request", "OPENBOARD_DATABASE_URL is required");
    }
    await runAdmin(config, command, output);
    return 0;
  } catch (error) {
    if (error instanceof BoardError) {
      output.err(`error: ${error.code}: ${error.message}`);
      return error.code === "invalid_request" ? 2 : 1;
    }
    output.err("error: internal: Could not run the admin command");
    return 1;
  }
}
