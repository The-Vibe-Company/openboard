import { parseCanScope } from "@openboard/contract";
import { BoardError, type Client, createClient } from "@the-vibe-company/openboard";
import { isPersonalToken, loginOrigin, personalConfigPath, storePersonalLogin } from "../config.ts";
import { Misuse, type StandaloneContext } from "./index.ts";

function invalidResponse(): BoardError {
  return new BoardError("remote_error", "the board returned an invalid sign-in response");
}

async function deviceRequest<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    // Remote messages and transport errors may contain values from a sign-in exchange.
    if (error instanceof BoardError) throw new BoardError(error.code, "the board refused the sign-in request");
    if (error instanceof TypeError) throw invalidResponse();
    throw error;
  }
}

const slug = (value: unknown) => typeof value === "string" && /^[a-z0-9][a-z0-9-]{1,38}$/.test(value);

async function approve(ctx: StandaloneContext, client: Client, origin: string, can: string | undefined) {
  const wait = ctx.options.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = ctx.options.now ?? (() => performance.now());
  const started = now();
  const begun = await deviceRequest(client.startDeviceSignIn({ clientName: "ob", can }));
  if (
    !begun ||
    begun.verificationUri !== `${origin}/device` ||
    begun.expiresIn !== 600 ||
    typeof begun.userCode !== "string" ||
    !/^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/.test(begun.userCode) ||
    typeof begun.deviceCode !== "string" ||
    !(can === undefined ? /^[A-Za-z0-9_-]{43}$/ : /^[A-Za-z0-9_-]{43}n$/).test(begun.deviceCode) ||
    !Number.isInteger(begun.interval) ||
    begun.interval < 1 ||
    begun.interval > 60
  )
    throw invalidResponse();

  const instructions = `Open ${begun.verificationUri} and enter code ${begun.userCode}.`;
  if (ctx.json) ctx.output.err(instructions);
  else ctx.output.out(instructions);
  const deadline = started + begun.expiresIn * 1000;
  const interval = begun.interval * 1000;
  while (now() + interval < deadline) {
    await wait(interval);
    if (now() >= deadline) break;
    const answer = await deviceRequest(client.pollDeviceSignIn({ deviceCode: begun.deviceCode })).catch(
      (error: unknown) => {
        if (error instanceof BoardError && error.code === "rate_limited") return { pending: true } as const;
        throw error;
      },
    );
    if (!answer || typeof answer !== "object") throw invalidResponse();
    if ("pending" in answer && answer.pending === true) continue;
    if (
      !("token" in answer) ||
      !isPersonalToken(answer.token) ||
      !slug(answer.org?.slug) ||
      !Array.isArray(answer.boards) ||
      !answer.boards.every((board) => board && slug(board.slug))
    )
      throw invalidResponse();
    return answer;
  }
  throw new BoardError("not_found", "the device code expired; run ob login again");
}

export const loginCommand = {
  standalone: true,
  words: ["login"],
  usage: "ob login <origin> [--can <scope>]",
  async run(ctx: StandaloneContext): Promise<number> {
    const origin = loginOrigin(ctx.args[0]);
    const scoped = ctx.args[1] === "--can" && ctx.optionsEnd >= 2;
    if (!origin || ctx.args.length !== (scoped ? 3 : 1) || ctx.profile !== undefined) {
      throw new Misuse("login requires one HTTPS or loopback HTTP origin");
    }
    const can = scoped ? ctx.args[2] : undefined;
    if (can !== undefined) parseCanScope(can);
    const path = personalConfigPath(ctx.env);
    if (!path) throw new Misuse("HOME is required to store the personal credential");
    const send = ctx.options.fetch ?? ((request: Request) => fetch(request));
    const client = createClient({
      url: origin,
      fetch: (request) => send(new Request(request, { redirect: "error", signal: AbortSignal.timeout(15_000) })),
    });
    const { org, boards } = await storePersonalLogin(path, async () => {
      const { token, org, boards } = await approve(ctx, client, origin, can);
      return {
        credential: { token, origin, org: org.slug, board: "main" },
        result: { org: org.slug, boards: boards.map((board) => board.slug) },
      };
    });
    if (ctx.json) ctx.output.out(JSON.stringify({ org, boards }));
    else ctx.output.out(`Signed in to ${org}. Boards: ${boards.join(", ") || "(none)"}.`);
    return 0;
  },
};
