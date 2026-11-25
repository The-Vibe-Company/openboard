import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../apps/openboard/src/config.ts";

const app = [process.execPath, "--no-env-file", `${import.meta.dir}/../../apps/openboard/src/main.ts`];
const shippingWindow = 10_000;
const workloadDuration = 60_000;

type Env = Record<string, string | undefined>;
type Ack = { id: string; text: string; at: number };
type Board = { url: string; token: string; channel: string };

export function measure(acks: readonly Ack[], restored: ReadonlyMap<string, string>, killedAt: number) {
  const missing = acks.filter(({ id, text }) => restored.get(id) !== text);
  const oldestLoss = Math.max(0, ...missing.map(({ at }) => killedAt - at));
  return {
    restored: acks.length - missing.length,
    lost: missing.length,
    oldestLoss,
    passed: oldestLoss <= shippingWindow,
  };
}

const backupPrefix = "OPENBOARD_BACKUP_S3_";

function fakeBucket() {
  const objects = new Map<string, Uint8Array>();
  const base = "/drill/";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/drill" || url.pathname === base) {
        const prefix = url.searchParams.get("prefix") ?? "";
        // Keys in this drill are made of numeric IDs, timestamps and fixed path components.
        const entries = [...objects.keys()]
          .filter((key) => key.startsWith(prefix))
          .sort()
          .map((key) => `<Contents><Key>${key}</Key></Contents>`);
        return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated>${entries.join("")}</ListBucketResult>`);
      }
      if (!url.pathname.startsWith(base)) return new Response(null, { status: 404 });
      const key = decodeURIComponent(url.pathname.slice(base.length));
      if (request.method === "PUT") {
        objects.set(key, new Uint8Array(await request.arrayBuffer()));
        return new Response(null, { status: 200 });
      }
      const object = objects.get(key);
      if (!object) return new Response(null, { status: 404 });
      return new Response(request.method === "HEAD" ? null : object.slice(), {
        headers: { "content-length": String(object.length) },
      });
    },
  });
  return {
    stop: () => server.stop(true),
    env: {
      OPENBOARD_BACKUP_S3_ENDPOINT: server.url.origin,
      OPENBOARD_BACKUP_S3_BUCKET: "drill",
      OPENBOARD_BACKUP_S3_REGION: "us-east-1",
      OPENBOARD_BACKUP_S3_ACCESS_KEY_ID: "fake-access",
      OPENBOARD_BACKUP_S3_SECRET_ACCESS_KEY: "fake-secret",
    },
  };
}

function backupEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith(backupPrefix)));
}

function configuredBucket(env: Env) {
  const { backup } = loadConfig(env);
  if (!backup) throw new Error("Configure the dedicated scratch backup bucket with OPENBOARD_BACKUP_S3_*");
  return new Bun.S3Client(backup);
}

function required(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`Set ${key} for the drill`);
  return value;
}

async function requiredSecret(key: string) {
  const file = process.env[`${key}_FILE`];
  if (file === undefined) return required(key);
  if (process.env[key] !== undefined) throw new Error(`Set only one of ${key} and ${key}_FILE`);
  const value = await Bun.file(file)
    .text()
    .then(
      (text) => text.trim(),
      () => "",
    );
  if (!value) throw new Error(`Read a nonempty secret from ${key}_FILE`);
  return value;
}

function scratchPort() {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const { port } = server;
  void server.stop(true);
  return String(port);
}

async function start(env: Env) {
  const child = Bun.spawn([...app, "serve"], { env, stdout: "pipe", stderr: "ignore" });
  const reader = child.stdout.getReader();
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  try {
    const decoder = new TextDecoder();
    let output = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error("OpenBoard exited before announcing its listener");
      output += decoder.decode(value, { stream: true });
      if (/^(BOARD_URL=|OpenBoard listening on ).+\n/m.test(output)) return child;
    }
  } catch (error) {
    child.kill("SIGKILL");
    await child.exited;
    throw error;
  } finally {
    clearTimeout(timer);
    await reader.cancel();
  }
}

async function run(args: string[], env: Env, label: string, print = true) {
  const child = Bun.spawn(args, { env, stdout: "pipe", stderr: "ignore" });
  const output = await new Response(child.stdout).text();
  const code = await child.exited;
  if (code !== 0) throw new Error(`${label} exited with status ${code}`);
  if (print && output) process.stdout.write(output);
  return output;
}

async function boardRequest<T>(board: Board, path: string, body?: object) {
  const response = await fetch(board.url + path, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${board.token}`, "content-type": "application/json" },
    ...(body && { body: JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Board request returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function writeForMinute(board: Board) {
  const acks: Ack[] = [];
  const until = performance.now() + workloadDuration;
  while (performance.now() < until) {
    const text = `${board.channel} post ${acks.length + 1}`;
    const { message } = await boardRequest<{ message: { id: string } }>(board, "/messages", {
      channel: board.channel,
      text,
      noSync: true,
    });
    acks.push({ id: message.id, text, at: performance.now() });
    await Bun.sleep(Math.min(1_000, Math.max(0, until - performance.now())));
  }
  return acks;
}

async function cutoff(env: Env, board: () => Promise<Board>, prepare?: () => Promise<void>) {
  const child = await start(env);
  try {
    await prepare?.();
    const acks = await writeForMinute(await board());
    child.kill("SIGKILL");
    const killedAt = performance.now();
    if ((await child.exited) !== 137) throw new Error("Expected the source process to exit after SIGKILL");
    return { acks, killedAt };
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await child.exited;
  }
}

async function verify(env: Env, board: () => Promise<Board>, sample: Awaited<ReturnType<typeof cutoff>>, rto: number) {
  const child = await start(env);
  try {
    const target = await board();
    const { events } = await boardRequest<{ events: { type: string; message: { id: string; text: string } }[] }>(
      target,
      `/events?last=100&channel=${target.channel}`,
    );
    const recovered = new Map(
      events.filter(({ type }) => type === "message.posted").map(({ message }) => [message.id, message.text]),
    );
    const result = measure(sample.acks, recovered, sample.killedAt);
    console.log(`Acknowledged events: ${sample.acks.length}`);
    console.log(`Restored events: ${result.restored}`);
    console.log(
      `RPO: ${result.lost} lost events; oldest loss ${(result.oldestLoss / 1_000).toFixed(3)} s before SIGKILL`,
    );
    console.log(`RTO: ${(rto / 1_000).toFixed(3)} s`);
    if (!result.passed) throw new Error("An acknowledged event older than 10 s was lost");
  } finally {
    child.kill("SIGTERM");
    await child.exited;
  }
}

async function local(dir: string, env: Env, channel: string, shipping: Env, bucket: Bun.S3Client, fake: boolean) {
  const data = join(dir, "data");
  const tokenFile = join(dir, ".config", "openboard", "local", `${env.PORT}.json`);
  const board = async () => ({ ...((await Bun.file(tokenFile).json()) as { url: string; token: string }), channel });
  if (!fake) {
    const listing = await bucket.list({ maxKeys: 1 });
    if (listing.contents?.length || listing.isTruncated) throw new Error("Use an empty bucket for the local drill");
  }
  // The child alone uses the scratch home, so its key and owner token stay with the drill.
  const localEnv = { ...env, HOME: dir, OPENBOARD_DATA_DIR: data };
  const sourceEnv = { ...localEnv, ...shipping };
  const sample = await cutoff(sourceEnv, board);
  await rm(data, { recursive: true });
  const start = performance.now();
  await run([...app, "restore", "--to", data], sourceEnv, "SQLite restore");
  await verify(localEnv, board, sample, performance.now() - start);
}

function scratchDatabase(value: string, name: string, fake: boolean) {
  const url = new URL(value);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    [...url.searchParams.keys()].some((key) => key !== "sslmode") ||
    (fake && !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)) ||
    !new RegExp(`^${name}(?:_[a-z0-9_]+)?$`).test(database)
  ) {
    throw new Error(`Use a scratch Postgres database named ${name} or ${name}_<suffix> with an explicit user`);
  }
  return { url, database };
}

function pgEnvironment({ url, database }: ReturnType<typeof scratchDatabase>) {
  return {
    PGHOST: url.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get("sslmode") ?? "prefer",
    PGCONNECT_TIMEOUT: "5",
    PGDATABASE: database,
  };
}

async function requireEmptyTarget(dir: string, env: Env, database: string) {
  const schema = join(dir, "target-schema.dump");
  await run(
    [
      "pg_dump",
      "--no-password",
      "--schema-only",
      "--no-comments",
      "--no-owner",
      "--no-privileges",
      "-Fc",
      "-f",
      schema,
    ],
    env,
    "Inspect the scratch target schema",
  );
  const listing = await run(["pg_restore", "--list", schema], env, "List the scratch target schema", false);
  if (/^\d+;/m.test(listing)) throw new Error(`The restore target ${database} must be empty`);
}

async function latestDump(bucket: Bun.S3Client) {
  let latest = "";
  let continuationToken: string | undefined;
  do {
    const page = await bucket.list({ prefix: "dumps/", continuationToken });
    for (const { key } of page.contents ?? []) {
      if (key && /^dumps\/\d{4}-\d{2}-\d{2}\.dump$/.test(key) && key > latest) latest = key;
    }
    continuationToken = page.nextContinuationToken;
    if (page.isTruncated && !continuationToken) throw new Error("Incomplete dump listing");
  } while (continuationToken);
  return latest;
}

async function waitForDump(bucket: Bun.S3Client) {
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    if (await latestDump(bucket)) return;
    await Bun.sleep(250);
  }
  throw new Error("The source did not publish a daily Postgres dump within 30 s");
}

async function hosted(dir: string, env: Env, channel: string, shipping: Env, bucket: Bun.S3Client, fake: boolean) {
  const source = await requiredSecret("OPENBOARD_DATABASE_URL");
  const target = await requiredSecret("OPENBOARD_DRILL_TARGET_DATABASE_URL");
  scratchDatabase(source, "openboard_drill_source", fake);
  const targetDatabase = scratchDatabase(target, "openboard_restore_drill", fake);
  const restoreEnv = { ...env, ...pgEnvironment(targetDatabase) };
  const path = required("OPENBOARD_DRILL_BOARD");
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(path)) throw new Error("OPENBOARD_DRILL_BOARD must be org/board");
  const secretKey = await requiredSecret("OPENBOARD_SECRET_KEY");
  const token = (await Bun.file(required("OPENBOARD_DRILL_TOKEN_FILE")).text()).trim();
  if (!token) throw new Error("The drill board token file is empty");
  const board = async () => ({
    url: `http://127.0.0.1:${env.PORT}/api/${path}`,
    channel,
    token,
  });
  if (!Bun.which("pg_restore") || !Bun.which("pg_dump")) {
    throw new Error("Install compatible pg_restore and pg_dump before running the hosted drill");
  }
  await requireEmptyTarget(dir, restoreEnv, targetDatabase.database);
  if (!fake && !(await latestDump(bucket))) throw new Error("The drill bucket contains no daily Postgres dump");
  const appEnv = { ...env, OPENBOARD_SECRET_KEY: secretKey };
  const sample = await cutoff(
    { ...appEnv, ...shipping, OPENBOARD_DATABASE_URL: source },
    board,
    fake ? () => waitForDump(bucket) : undefined,
  );
  const started = performance.now();
  const key = await latestDump(bucket);
  if (!key) throw new Error("The drill bucket contains no daily Postgres dump");
  const archive = join(dir, "restore.dump");
  await Bun.write(archive, bucket.file(key));
  console.log(`Restoring ${key}`);
  await run(
    [
      "pg_restore",
      "--no-password",
      "--single-transaction",
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      "--dbname",
      targetDatabase.database,
      archive,
    ],
    restoreEnv,
    "pg_restore",
  );
  const targetEnv = { ...appEnv, OPENBOARD_DATABASE_URL: target };
  const replay = await run([...app, "restore", "--after-dump"], { ...targetEnv, ...shipping }, "Hosted replay");
  if (
    !replay
      .split("\n")
      .some((line) => line.startsWith(`Restored ${path.split("/")[0]};`) && /replayed [1-9]\d* events$/.test(line))
  ) {
    throw new Error("No post-dump events replayed for the drill organization");
  }
  await verify(targetEnv, board, sample, performance.now() - started);
}

async function main(args: string[]) {
  const [mode, ...flags] = args;
  const fake = flags.length === 1 && flags[0] === "--fake-bucket";
  if ((mode !== "local" && mode !== "hosted") || (flags.length && !fake)) {
    throw new Error("Usage: bun scripts/ops/restore-drill.ts <local|hosted> [--fake-bucket]");
  }
  const dir = await mkdtemp(join(tmpdir(), "openboard-restore-drill-"));
  const env = {
    PATH: process.env.PATH,
    USER: process.env.USER,
    PORT: scratchPort(),
    OPENBOARD_HOST: "127.0.0.1",
    OPENBOARD_LOG_LEVEL: "error",
  };
  const channel = `restore-drill-${crypto.randomUUID()}`;
  const fakeServer = fake ? fakeBucket() : undefined;
  try {
    const shipping = fakeServer?.env ?? backupEnv();
    if (
      mode === "hosted" &&
      !fake &&
      !/^openboard-restore-drill(?:-[a-z0-9-]+)?$/.test(shipping.OPENBOARD_BACKUP_S3_BUCKET ?? "")
    ) {
      throw new Error(
        "Use a dedicated hosted drill bucket named openboard-restore-drill or openboard-restore-drill-<suffix>",
      );
    }
    const bucket = configuredBucket(shipping);
    if (mode === "local") await local(dir, env, channel, shipping, bucket, fake);
    else await hosted(dir, env, channel, shipping, bucket, fake);
  } finally {
    await fakeServer?.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`Restore drill failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}
