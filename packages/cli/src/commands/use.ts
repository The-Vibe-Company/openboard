import { BoardError } from "@openboard/contract";
import { isSlug, personalBoardUrl, personalConfigPath, storedPersonal, storePersonalLogin } from "../config.ts";
import { Misuse, type StandaloneContext } from "./index.ts";

/** `ops` keeps the signed-in organization; `acme/ops` names it, and it must be that one (one per person in v1). */
function target(arg: string | undefined): { org?: string; board: string } | undefined {
  const parts = arg?.split("/") ?? [];
  if (parts.length === 1 && isSlug(parts[0])) return { board: parts[0] };
  if (parts.length === 2 && isSlug(parts[0]) && isSlug(parts[1])) return { org: parts[0], board: parts[1] };
  return undefined;
}

/** Ask the board who we are there, so a board that does not exist or is out of reach is never saved. */
async function checkBoard(ctx: StandaloneContext, boardUrl: string, token: string, name: string): Promise<void> {
  const send = ctx.options.fetch ?? ((request: Request) => fetch(request));
  const { BoardError, createClient } = await import("@the-vibe-company/openboard");
  const client = createClient({
    url: boardUrl,
    token,
    fetch: (request) => send(new Request(request, { redirect: "error", signal: AbortSignal.timeout(15_000) })),
  });
  try {
    await client.getMe({});
  } catch (error) {
    if (!(error instanceof BoardError)) throw error;
    if (error.code === "not_found") throw new BoardError("not_found", `no board ${name} you can use`);
    if (error.code === "unauthorized" || error.code === "forbidden") {
      throw new BoardError(error.code, `the board ${name} refused the personal credential`);
    }
    throw new BoardError(error.code, `could not check the board ${name}; it stays unchanged`);
  }
}

export const useCommand = {
  async run(ctx: StandaloneContext) {
    const wanted = target(ctx.args[0]);
    if (!wanted || ctx.args.length !== 1 || ctx.profile !== undefined) {
      throw new Misuse("use takes one board slug, or <org>/<board>");
    }
    const path = personalConfigPath(ctx.env);
    if (!path) throw new Misuse("HOME is required to read the personal credential");
    const saved = storedPersonal(ctx.env);
    if (!saved) throw new BoardError("unauthorized", "no personal sign-in: run ob login <origin> first");
    const org = wanted.org ?? saved.org;
    if (org !== saved.org) {
      throw new BoardError("invalid_request", `you are signed in to ${saved.org}; boards of ${org} are out of reach`);
    }
    const next = { origin: saved.origin, org, board: wanted.board };
    const url = personalBoardUrl(next);
    const context = await storePersonalLogin(path, async () => {
      await checkBoard(ctx, url, saved.token, `${org}/${wanted.board}`);
      return { credential: { token: saved.token, ...next }, result: { org, board: wanted.board, url } };
    });
    if (ctx.json) ctx.output.out(JSON.stringify(context));
    else ctx.output.out(`Using ${context.org}/${context.board}: ${context.url}`);
    return 0;
  },
};
