import { accessSync, constants, lstatSync } from "node:fs";
import { dirname } from "node:path";
import {
  agentConfigPath,
  type ClientConfig,
  clientConfig,
  localOwnerConfigPath,
  personalConfigPath,
} from "../../config.ts";
import { credentialHint, networkHint, setupHint } from "../../output.ts";
import { version } from "../../version.ts";
import { Misuse, type StandaloneContext } from "../index.ts";

type Check = {
  name: string;
  state: "ok" | "failed" | "skipped";
  detail: string;
  status?: number;
  latencyMs?: number;
  next?: string;
};

function permissions(path: string | undefined, directory = false): Check {
  const name = path ?? "Config path";
  if (!path) return { name, state: "skipped", detail: "HOME is unset" };
  try {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat) return { name, state: "skipped", detail: "absent" };
    const mode = (stat.mode & 0o777).toString(8).padStart(4, "0");
    const kind = directory ? stat.isDirectory() : stat.isFile();
    accessSync(path, constants.R_OK | (directory ? constants.X_OK : 0));
    const safe = kind && (directory ? !(stat.mode & 0o022) : !(stat.mode & 0o077));
    return {
      name,
      state: safe ? "ok" : "failed",
      detail: kind ? `present, mode ${mode}` : `expected a ${directory ? "directory" : "regular file"}`,
      ...(kind && !safe ? { next: `Use chmod ${directory ? "700" : "600"} on this path.` } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOTDIR") return { name, state: "skipped", detail: "absent" };
    return { name, state: "failed", detail: "could not inspect or read" };
  }
}

function networkFailure(error: unknown): Pick<Check, "detail" | "next"> {
  for (let depth = 0; depth < 5 && error instanceof Error; depth++, error = error.cause) {
    const code = "code" in error ? error.code : "";
    const reason = `${code} ${error.message}`;
    if (/certificate|CERT_|SELF_SIGNED|UNABLE_TO_(?:GET_ISSUER|VERIFY_LEAF)/i.test(reason)) {
      return {
        detail: "TLS certificate validation failed",
        next: "Check for corporate proxy or VPN interception and configure NODE_EXTRA_CA_CERTS with the trusted CA.",
      };
    }
    if (/\b(?:ENOTFOUND|EAI_AGAIN|EAI_NONAME)\b|unable to resolve|could not resolve|DNS lookup/i.test(reason)) {
      return { detail: "DNS resolution failed", next: "Check the board hostname and your DNS, VPN or proxy settings." };
    }
    if (/\b(?:TLS|SSL)\b|ERR_(?:TLS|SSL)_/i.test(reason)) {
      return { detail: "TLS connection failed", next: "Check HTTPS and the TLS settings on the board or proxy." };
    }
  }
  return { detail: "server could not be reached", next: networkHint };
}

async function readiness(url: URL, send: (request: Request) => Promise<Response>, now: () => number): Promise<Check> {
  const name = "Server readiness";
  const start = now();
  try {
    const response = await send(new Request(new URL("/readyz", url.origin), { redirect: "manual" }));
    const latencyMs = now() - start;
    await response.body?.cancel();
    return {
      name,
      state: response.ok ? "ok" : "failed",
      detail: `HTTP ${response.status} (${latencyMs} ms)`,
      status: response.status,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = now() - start;
    return { name, state: "failed", latencyMs, ...networkFailure(error) };
  }
}

async function authentication(
  url: URL,
  token: string | undefined,
  profile: string | undefined,
  send: (request: Request) => Promise<Response>,
): Promise<Check> {
  const name = "Authentication";
  if (!token) return { name, state: "skipped", detail: "no credentials", next: credentialHint };
  const { createClient, BoardError } = await import("@the-vibe-company/openboard");
  try {
    const me = await createClient({ url: url.href, token, profile, fetch: send }).getMe({});
    const principal = me.handle || me.name || me.actor;
    if (!principal) return { name, state: "failed", detail: "whoami returned no principal" };
    return { name, state: "ok", detail: `signed in as ${principal}` };
  } catch (error) {
    if (error instanceof BoardError && (error.status === 401 || error.status === 403)) {
      const command = token.startsWith("obt_") ? "ob connect <board-url> --as <name>" : "ob login <origin>";
      return {
        name,
        state: "failed",
        detail: "credential rejected (expired, invalid or missing access)",
        next: `Run ${command}.`,
      };
    }
    return { name, state: "failed", detail: "whoami could not be verified" };
  }
}

export async function doctor(ctx: StandaloneContext): Promise<number> {
  if (ctx.args.length) throw new Misuse("doctor takes no arguments");
  const { env, options } = ctx;
  const checks: Check[] = [];
  let config: ClientConfig = { boardUrl: undefined, profile: undefined, token: undefined };
  try {
    config = clientConfig(env);
  } catch {
    checks.push({ name: "Configuration", state: "failed", detail: "could not read the active configuration" });
  }
  const profile = ctx.profile ?? config.profile;
  const agent = agentConfigPath(env);
  const local = localOwnerConfigPath(config.boardUrl, env.HOME);
  checks.push(permissions(agent && dirname(agent), true), permissions(agent), permissions(personalConfigPath(env)));
  if (local) checks.push(permissions(local));
  const url = URL.parse(config.boardUrl ?? "");
  const valid = url && /^https?:$/.test(url.protocol) && !url.username && !url.password && !/[?#]/.test(url.href);
  if (valid) {
    const send = (request: Request) =>
      (options.fetch ?? fetch)(new Request(request, { signal: (options.timeoutSignal ?? AbortSignal.timeout)(5000) }));
    const ready = await readiness(url, send, options.now ?? Date.now);
    checks.push(
      ready,
      ready.status !== undefined
        ? await authentication(url, config.token, profile, send)
        : { name: "Authentication", state: "skipped", detail: "server unreachable" },
    );
  } else {
    checks.push({
      name: "Board URL",
      state: "failed",
      detail: config.boardUrl ? "invalid" : "unconfigured",
      next: setupHint,
    });
  }
  const result = {
    ok: checks.every(({ state }) => state !== "failed"),
    version,
    upgrade: "curl -fsSL https://openboard.thevibecompany.co/install.sh | sh",
    boardUrl: valid ? url.href : null,
    profile: profile ?? null,
    checks,
  };
  ctx.output.out(
    ctx.json
      ? JSON.stringify(result, null, 2)
      : [
          `ob ${version}`,
          `Board: ${result.boardUrl ?? "—"}`,
          `Profile: ${profile ?? "default"}`,
          ...checks.flatMap(({ name, state, detail, next }) => [
            `${name}: ${state} — ${JSON.stringify(detail).slice(1, -1)}`,
            ...(next ? [`Next step: ${next}`] : []),
          ]),
          `Upgrade ob: ${result.upgrade}`,
        ].join("\n"),
  );
  return result.ok ? 0 : 1;
}
