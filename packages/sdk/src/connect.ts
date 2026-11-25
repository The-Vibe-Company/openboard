import { BoardError, type claimConnection, type InputOf, type OutputOf } from "@openboard/contract";
import { type Client, type ClientOptions, createClient } from "./client.ts";

type ClaimOptions = Omit<InputOf<typeof claimConnection>, "profile"> & {
  readonly secret: string;
  readonly as: string;
  /** Current epoch milliseconds. Defaults to Date.now. */
  readonly now?: () => number;
  /** Schedule a callback after a delay in milliseconds and return its cancellation function. */
  readonly schedule?: (callback: () => Promise<void>, delayMs: number) => () => void;
};

export type OpenBoardOptions =
  | (ClientOptions & { readonly secret?: never })
  | (Pick<ClientOptions, "url" | "fetch"> & ClaimOptions & { readonly token?: never });

type Send = NonNullable<ClientOptions["fetch"]>;
type ClaimResult = OutputOf<typeof claimConnection>;
type Credential = {
  readonly token: string;
  readonly expiresAt: number;
  readonly hardExpiresAt: number;
};

function credentialOf(result: ClaimResult): Credential {
  const token = result?.token;
  const expiresAt = Date.parse(result?.agent?.expiresAt);
  const hardExpiresAt = Date.parse(result?.agent?.hardExpiresAt);
  if (
    typeof token !== "string" ||
    !/^obt_[\w-]+$/.test(token) ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(hardExpiresAt) ||
    expiresAt > hardExpiresAt
  ) {
    throw new BoardError("remote_error", "the board did not return a valid agent credential");
  }
  return { token, expiresAt, hardExpiresAt };
}

function secretBoardUrl(address: string): string {
  const url = URL.parse(address);
  const loopback = url && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    !url ||
    url.username ||
    url.password ||
    /[?#]/.test(url.href) ||
    !(url.protocol === "https:" || (url.protocol === "http:" && loopback))
  ) {
    throw new BoardError("invalid_request", "provide a board URL using HTTPS or loopback HTTP");
  }
  return url.href.replace(/\/+$/, "");
}

function scheduleTimer(callback: () => Promise<void>, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  if (typeof timer === "object") timer.unref();
  return () => clearTimeout(timer);
}

function unauthorized() {
  return new BoardError("unauthorized", "the board rejected the agent credential");
}

/** A gateway may reject a rotation without the board's JSON error envelope. */
async function sendRotation(send: Send, request: Request): Promise<Response> {
  const response = await send(request);
  if (response.status === 401) {
    await response.body?.cancel();
    throw unauthorized();
  }
  if ([502, 503, 504].includes(response.status)) {
    await response.body?.cancel();
    throw new BoardError("unavailable", "the board could not refresh the agent credential");
  }
  return response;
}

/** The caller may stop waiting without aborting a credential rotation shared by other calls. */
async function waitForRefresh(refresh: Promise<ClaimResult>, signal?: AbortSignal): Promise<ClaimResult> {
  if (!signal) return refresh;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  refresh.catch(() => {});
  try {
    return await Promise.race([refresh, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function refreshDelay(credential: Credential, now: number, retrying: boolean): number | undefined {
  const remaining = credential.expiresAt - now;
  if (remaining <= 0 || credential.expiresAt === credential.hardExpiresAt) return;
  if (retrying) return remaining > 500 ? Math.min(1_000, remaining / 2) : undefined;
  const lead = Math.min(5_000, remaining / 10);
  return Math.max(1, Math.floor(remaining - lead));
}

function rotatingCredential(
  url: string,
  send: Send,
  initial: Credential,
  now: () => number,
  schedule: NonNullable<ClaimOptions["schedule"]>,
) {
  let current = initial;
  let pending: Promise<ClaimResult> | undefined;
  let lastAttempt: Promise<ClaimResult> | undefined;
  let cancelRefresh: (() => void) | undefined;

  function arm(retrying = false) {
    cancelRefresh?.();
    const delay = refreshDelay(current, now(), retrying);
    if (delay === undefined) return;
    const credential = current;
    cancelRefresh = schedule(
      async () => {
        if (credential !== current || now() >= credential.expiresAt) return;
        if (delay > 2_147_483_647) {
          arm();
          return;
        }
        try {
          await rotate();
        } catch (error) {
          if (error instanceof BoardError && (error.code === "unreachable" || error.code === "unavailable")) {
            arm(true);
          }
        }
      },
      Math.min(delay, 2_147_483_647),
    );
  }

  function rotate(): Promise<ClaimResult> {
    if (pending) return pending;
    pending = createClient({ url, token: current.token, fetch: (request) => sendRotation(send, request) })
      .refreshAgentToken({})
      .then((result) => {
        current = credentialOf(result);
        arm();
        return result;
      })
      .finally(() => {
        pending = undefined;
      });
    lastAttempt = pending;
    return pending;
  }

  function snapshot() {
    // A late 401 shares the rotation that happened after this particular request left.
    const completed = pending ? undefined : lastAttempt;
    const credential = current;
    return {
      token: credential.token,
      async recover(signal: AbortSignal) {
        signal.throwIfAborted();
        if (credential === current) {
          const attempted = lastAttempt !== completed ? lastAttempt : undefined;
          await waitForRefresh(attempted ?? rotate(), signal);
        }
        return current.token;
      },
    };
  }

  arm();
  return { rotate, snapshot };
}

function sendWith(send: Send, request: Request, token: string) {
  request.headers.set("authorization", `Bearer ${token}`);
  return send(request);
}

function managedClient(
  url: string,
  send: Send,
  credential: Credential,
  now: () => number,
  schedule: NonNullable<ClaimOptions["schedule"]>,
): Client {
  const tokens = rotatingCredential(url, send, credential, now, schedule);
  const client = createClient({
    url,
    // The generated client marks the requests that accept board authentication.
    token: "managed",
    fetch: async (request) => {
      if (!request.headers.has("authorization")) return send(request);
      const attempt = tokens.snapshot();
      const response = await sendWith(send, request.clone(), attempt.token);
      if (response.status !== 401) return response;
      await response.body?.cancel();
      const token = await attempt.recover(request.signal);
      const retried = await sendWith(send, request, token);
      if (retried.status !== 401) return retried;
      await retried.body?.cancel();
      throw unauthorized();
    },
  });
  const refreshAgentToken: Client["refreshAgentToken"] = async (_input, options) => {
    options?.signal?.throwIfAborted();
    return waitForRefresh(tokens.rotate(), options?.signal);
  };
  return Object.freeze({ ...client, refreshAgentToken });
}

/** Connect to a board with an existing token, or claim and automatically refresh an agent credential. */
export async function openboard(options: OpenBoardOptions): Promise<Client> {
  if (options.secret === undefined) {
    if ("secret" in options) throw new BoardError("invalid_request", "provide an obc_ connection secret");
    return createClient(options);
  }
  const { secret, as: profile, can, ttl, idempotencyKey, now = Date.now, schedule = scheduleTimer } = options;
  if (typeof secret !== "string" || !/^obc_[\w-]+$/.test(secret)) {
    throw new BoardError("invalid_request", "provide an obc_ connection secret");
  }

  const url = secretBoardUrl(options.url);
  const base = options.fetch ?? ((request: Request) => fetch(request));
  const send: Send = (request) => base(new Request(request, { redirect: "error" }));
  const claim = await createClient({ url, token: secret, fetch: send })
    .claimConnection({ profile, can, ttl, idempotencyKey })
    .catch((error: unknown) => {
      // The server or transport may echo the secret in any part of its error.
      throw new BoardError(error instanceof BoardError ? error.code : "remote_error", "the board refused the claim");
    });
  return managedClient(url, send, credentialOf(claim), now, schedule);
}
