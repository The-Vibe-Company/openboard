import { BoardError, createClient } from "@the-vibe-company/openboard";
import { agentConfigPath, boardAddress, connectionSecret, isAgentToken, storeAgentClaim } from "../config.ts";
import { Misuse, type StandaloneContext } from "./index.ts";

function parse(ctx: StandaloneContext) {
  let address: string | undefined;
  let secretFile: string | undefined;
  for (let index = 0; index < ctx.args.length; index++) {
    const word = ctx.args[index];
    if (index < ctx.optionsEnd && word?.startsWith("-")) {
      if (word !== "--secret-file" || secretFile !== undefined) throw new Misuse("unexpected connect option");
      secretFile = ctx.args[++index];
      if (!secretFile || secretFile.startsWith("--") || index >= ctx.optionsEnd) {
        throw new Misuse("--secret-file takes one path");
      }
    } else {
      if (address !== undefined) throw new Misuse("connect takes one board URL");
      address = word;
    }
  }
  const url = boardAddress(address);
  if (!url)
    throw new Misuse(
      "connect requires a board URL using HTTPS or loopback HTTP, without credentials, query, or fragment",
    );
  if (!ctx.profile) throw new Misuse("connect requires --as <name>");
  return { url, profile: ctx.profile, secretFile };
}

export const connectCommand = {
  standalone: true,
  words: ["connect"],
  usage: "ob connect <url> --as <name> [--secret-file <path>]",
  async run(ctx: StandaloneContext): Promise<number> {
    const { url, profile, secretFile } = parse(ctx);
    const path = agentConfigPath(ctx.env);
    if (!path) throw new Misuse("HOME is required to store the agent credential");
    const secret = connectionSecret(ctx.env, secretFile, ctx.options.readStdin);
    const send = ctx.options.fetch ?? ((request: Request) => fetch(request));
    const client = createClient({
      url,
      token: secret,
      fetch: (request) => send(new Request(request, { redirect: "error" })),
    });
    await storeAgentClaim(path, { boardUrl: url, profile }, async () => {
      const claim = await client.claimConnection({ profile }).catch((error: unknown) => {
        if (error instanceof TypeError)
          throw new BoardError("remote_error", "the board returned an invalid claim response");
        if (!(error instanceof BoardError)) throw error;
        // A remote error may reflect the bearer in its message or recovery guidance.
        throw new BoardError(
          error.code,
          error.message.includes(secret) ? "the board refused the claim" : error.message,
        );
      });
      if (!isAgentToken(claim?.token) || claim.token === secret) {
        throw new BoardError("remote_error", "the board did not return an agent token");
      }
      return claim.token;
    });
    ctx.output.out(ctx.json ? JSON.stringify({ boardUrl: url, profile }) : `connected as ${profile}`);
    return 0;
  },
};
