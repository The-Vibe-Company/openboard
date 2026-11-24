import { type Client, createClient } from "@the-vibe-company/openboard";
import { type Policy, startProxy } from "./proxy.ts";

type Claim = Parameters<Client["claimConnection"]>[0];
type AgentEnv = Awaited<ReturnType<Client["claimConnection"]>>["env"];

async function claimEnv(boardUrl: string, secret: string, claim: Claim): Promise<AgentEnv> {
  const { env } = await createClient({ url: boardUrl, token: secret }).claimConnection(claim);
  return env;
}

function spawnAgent(command: string[], env: AgentEnv, cwd: string) {
  return Bun.spawn(command, {
    cwd,
    env,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
}

async function run(argv: string[]) {
  const [mode, target, arg, separator, ...command] = argv;
  if ((mode !== "claim" && mode !== "proxy") || !target || !arg || separator !== "--" || !command[0]?.startsWith("/")) {
    process.stderr.write(
      "Usage: bun src/main.ts claim <board-url> <profile> -- <absolute-executable> [args...]\n" +
        "       bun src/main.ts proxy <policy.json> <agent-cwd> -- <absolute-executable> [args...]\n",
    );
    return 2;
  }

  const secret = (await Bun.stdin.text()).trim();
  if (!secret) throw new Error("missing connection secret");
  if (mode === "claim") {
    const env = await claimEnv(target, secret, { profile: arg, ttl: "5m" });
    return spawnAgent(command, env, process.cwd()).exited;
  }
  const policy = (await Bun.file(target).json()) as Policy;
  const proxy = await startProxy(policy, secret);
  try {
    return await spawnAgent(command, proxy.env, arg).exited;
  } finally {
    await proxy.close();
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await run(Bun.argv.slice(2));
  } catch {
    process.stderr.write("error: launch_failed: could not start the board agent\n");
    process.exitCode = 1;
  }
}
