import { expect } from "bun:test";
import type { BoardView } from "../src/index.ts";

type Headers = Readonly<Record<string, string>>;
type Send = (path: string, headers: Headers, body?: object) => Promise<Response>;
type Secrets = Readonly<Record<string, string>>;

async function created<T>(response: Promise<Response>, status: number): Promise<T> {
  const result = await response;
  expect(result.status).toBe(status);
  return (await result.json()) as T;
}

function bearerValue(headers: Headers) {
  const token = headers.authorization?.slice("Bearer ".length);
  if (!token) throw new Error("missing personal token fixture");
  return token;
}

const digest = async (value: string) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

export async function seedExportCredentials(
  send: Send,
  board: BoardView,
  owner: Headers,
  personal: Headers,
  at: number,
) {
  const base = "/api/alpha/main";
  const { secret: connection } = await created<{ secret: string }>(
    send(`${base}/x/connections`, owner, { name: "worker", can: { "*": "all" } }),
    201,
  );
  const { token: agent } = await created<{ token: string }>(
    send(`${base}/x/connections/claim`, { authorization: `Bearer ${connection}` }, { profile: "worker" }),
    200,
  );
  const { url } = await created<{ url: string }>(send("/api/x/orgs/alpha/invitations", owner, { role: "member" }), 201);
  const { claim } = await created<{ claim: { token: string } }>(
    send(`${base}/tasks`, owner, { channel: "dev", text: "Claimed export fixture", claim: true }),
    201,
  );
  const session = owner.cookie?.split("=", 2)[1];
  const invitation = new URL(url).pathname.split("/").at(-1);
  const csrf = owner["x-ob-csrf"];
  if (!session || !invitation || !csrf) throw new Error("missing invitation or session fixture");
  // Webhook storage has not shipped. Put its signing secret in a realistic nested
  // record in a shipped board event and exercise the same archive ingestion path.
  const webhook = "synthetic-webhook-signing-fixture";
  const secrets = {
    connection,
    agent,
    invitation,
    personal: bearerValue(personal),
    session,
    webhook,
    task: claim.token,
  };
  const hashes = Object.fromEntries(
    await Promise.all(
      Object.entries(secrets).map(async ([name, value]) => [name, (await digest(value)).toString("hex")] as const),
    ),
  );
  const actor = "fixture-export-watch";
  const appendCanary = () =>
    board.write(async (writer) => {
      const payload = {
        matched: "fixture",
        thread: "1",
        error: "synthetic watcher fixture",
        details: [
          {
            webhook: { signingSecret: webhook, signingSecretHash: hashes.webhook },
            connection: { secret: connection, secret_hash: hashes.connection },
            agent: { token: agent, tokenHash: hashes.agent },
            invitation: { token: invitation, tokenHash: hashes.invitation },
            personal: { token: secrets.personal, tokenHash: hashes.personal },
            sessionRecord: { session, id_hash: hashes.session, csrf },
            task: { claimToken: secrets.task, tokenHash: hashes.task },
          },
        ],
      };
      await writer.append([
        {
          id: writer.head + 1,
          type: "watch.failed",
          at,
          actor,
          principal: actor,
          channel: "dev",
          thread: 1,
          message: null,
          visibility: 0,
          payload,
        },
      ]);
    });
  await appendCanary();
  return { secrets, csrf, appendCanary };
}

export async function assertArchiveCredentialsAbsent(
  raw: ArrayBuffer,
  files: ReadonlyMap<string, Blob>,
  seeded: {
    readonly secrets: Secrets;
    readonly csrf: string;
  },
) {
  const needles: [string, string | Buffer][] = [["session CSRF", seeded.csrf]];
  for (const [name, value] of Object.entries(seeded.secrets)) {
    const hash = await digest(value);
    needles.push([name, value], [`${name} hash bytes`, hash]);
    for (const encoding of ["hex", "base64", "base64url"] as const) {
      needles.push([`${name} ${encoding} hash`, hash.toString(encoding)]);
    }
  }
  const check = (layer: string, bytes: Uint8Array) => {
    const haystack = Buffer.from(bytes);
    for (const [label, value] of needles) expect(haystack.includes(value), `${label} in ${layer}`).toBe(false);
  };
  check("downloaded bytes", new Uint8Array(raw));
  check("uncompressed tar", Bun.gunzipSync(new Uint8Array(raw)));
  for (const [path, file] of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    check(path, path.endsWith(".ndjson.gz") ? Bun.gunzipSync(bytes) : bytes);
  }
}
