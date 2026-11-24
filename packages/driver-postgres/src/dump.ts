import type { DatabaseDump } from "@openboard/ports";
import { SQL } from "bun";

// Separate from the migrator's advisory lock. All replicas contend on the same database.
const DUMP_LOCK = 0x6f6264756d700001n;

export async function dumpEnvironment(url: string, connection: SQL["options"]): Promise<Record<string, string>> {
  // Bun resolves connection defaults and aliases before opening the lock connection. Use those
  // same values for libpq so the advisory lock and the archive always refer to the same database.
  const { hostname, port, username, password, database, path } = connection;
  const mode: unknown = Reflect.get(connection, "sslMode");
  const sslMode =
    typeof mode === "number" ? ["disable", "prefer", "require", "verify-ca", "verify-full"][mode] : undefined;
  if (!sslMode || !hostname || !port || !username || !database) throw new Error("Unsupported dump connection");
  const socket = path ? /^(\/(?:.*\/)?)\.s\.PGSQL\.(\d+)$/.exec(path) : null;
  if (path && !socket) throw new Error("Unsupported PostgreSQL socket path for pg_dump");
  const db = new URL(url);
  const env: Record<string, string> = {
    PGHOST: socket ? socket[1]?.slice(0, -1) || "/" : hostname.replace(/^\[|\]$/g, ""),
    PGPORT: socket?.[2] || String(port),
    PGUSER: username,
    PGPASSWORD: typeof password === "string" ? password : "",
    PGDATABASE: database,
    PGSSLMODE: sslMode,
    PGCONNECT_TIMEOUT: "5",
  };
  const options = {
    sslrootcert: "PGSSLROOTCERT",
    sslcert: "PGSSLCERT",
    sslkey: "PGSSLKEY",
    channel_binding: "PGCHANNELBINDING",
  };
  for (const [param, variable] of Object.entries(options)) {
    const value = db.searchParams.get(param);
    if (value !== null) env[variable] = value;
  }
  if (!env.PGSSLROOTCERT && sslMode === "verify-full") env.PGSSLROOTCERT = "system";
  if (!env.PGSSLROOTCERT && sslMode === "verify-ca") {
    for (const candidate of [
      "/etc/ssl/certs/ca-certificates.crt",
      "/etc/pki/tls/certs/ca-bundle.crt",
      "/etc/ssl/cert.pem",
    ]) {
      if (!(await Bun.file(candidate).exists())) continue;
      env.PGSSLROOTCERT = candidate;
      break;
    }
    if (!env.PGSSLROOTCERT) throw new Error("pg_dump requires a trusted CA bundle for verify-ca");
  }
  return env;
}

export function postgresDump(url: string): DatabaseDump {
  return async (bucket, key, shutdown) => {
    const disconnected = new AbortController();
    const signal = AbortSignal.any([shutdown, disconnected.signal]);
    await using sql = new SQL(url, {
      max: 1,
      connectionTimeout: 3,
      connection: { statement_timeout: "5s" },
      onclose: () => disconnected.abort(),
    });
    const [lock] = await sql<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(${DUMP_LOCK}) AS acquired
    `;
    if (!lock?.acquired) return false;

    // Closing this dedicated connection releases the lock on every exit path.
    for await (const existing of bucket.list(key)) {
      if (existing === key) return true;
    }
    const env = await dumpEnvironment(url, sql.options);
    signal.throwIfAborted();
    await uploadDump(env, signal, (stream) => bucket.putStream(key, stream));
    return true;
  };
}

async function uploadDump(
  env: Record<string, string>,
  signal: AbortSignal,
  upload: (stream: ReadableStream<Uint8Array>) => Promise<void>,
) {
  const executable = Bun.which("pg_dump");
  if (!executable) throw new Error("pg_dump is required for hosted backups");
  const child = Bun.spawn([executable, "--format=custom", "--no-password", "--lock-wait-timeout=30s"], {
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    signal,
  });
  try {
    const checked = new TransformStream<Uint8Array, Uint8Array>({
      async flush() {
        if ((await child.exited) !== 0) throw new Error("pg_dump failed");
        signal.throwIfAborted();
      },
    });
    // The stream reaches EOF only after pg_dump succeeds, so failed dumps cannot be published.
    await upload(child.stdout.pipeThrough(checked, { signal }));
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await child.exited;
  }
}
