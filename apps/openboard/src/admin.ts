import { BoardError } from "@openboard/contract";
import { changeQuota } from "./compose.ts";
import { type Config, operatorName } from "./config.ts";
import type { MigrateOutput } from "./migrate.ts";

const usage = 'Usage: openboard admin quota <org> <boards|members|connections>=<limit> --reason "<reason>"';

function parseQuota(args: readonly string[]) {
  const [command, slug, assignment, flag, reason] = args;
  if (command !== "quota" || !slug || !assignment) throw new BoardError("invalid_request", usage);
  if (flag !== "--reason" || !reason?.trim()) throw new BoardError("invalid_request", "--reason is required");
  if (args.length !== 5) throw new BoardError("invalid_request", usage);
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

export async function admin(config: Config, args: readonly string[], output: MigrateOutput): Promise<number> {
  if (args.length === 1 && args[0] === "--help") {
    output.out(usage);
    return 0;
  }
  try {
    const change = parseQuota(args);
    const quotas = await changeQuota(config, { ...change, name: operatorName() });
    output.out(JSON.stringify({ org: change.slug, quotas }));
    return 0;
  } catch (error) {
    if (error instanceof BoardError) {
      output.err(`error: ${error.code}: ${error.message}`);
      return error.code === "invalid_request" ? 2 : 1;
    }
    output.err("error: internal: Could not change the organization's quotas");
    return 1;
  }
}
