import { BoardError } from "@openboard/contract";
import { withAdminStore } from "./compose.ts";
import type { Config } from "./config.ts";
import type { MigrateOutput } from "./migrate.ts";

const usage = "Usage: openboard reproject (local) | openboard reproject <org>/<board> (hosted)";

function target(config: Config, args: readonly string[]): [string, string] {
  if (config.mode === "local" && args.length === 0) return ["local", "main"];
  const [org, board, extra] = args[0]?.split("/") ?? [];
  if (config.mode === "hosted" && args.length === 1 && org && board && extra === undefined) return [org, board];
  throw new BoardError("invalid_request", usage);
}

export async function reproject(config: Config, args: readonly string[], output: MigrateOutput): Promise<number> {
  if (args.length === 1 && args[0] === "--help") {
    output.out(usage);
    return 0;
  }
  try {
    const [org, board] = target(config, args);
    await withAdminStore(config, async (platform) => {
      const keys = await platform.findBoard(org, board);
      if (!keys) throw new BoardError("not_found", "no such board");
      const start = performance.now();
      const result = await platform.reprojectBoard(keys);
      if (!result) throw new Error("Reprojection unexpectedly skipped the board");
      const elapsed = (performance.now() - start).toFixed(1);
      output.out(
        `${org}/${board}: replayed ${result.events} events in ${elapsed} ms (projection ${result.projection})`,
      );
    });
    return 0;
  } catch (error) {
    if (error instanceof BoardError) {
      output.err(`error: ${error.code}: ${error.message}`);
      return error.code === "invalid_request" ? 2 : 1;
    }
    output.err("error: internal: Could not reproject the board");
    return 1;
  }
}
