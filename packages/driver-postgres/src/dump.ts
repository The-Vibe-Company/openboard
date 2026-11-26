import type { Bucket, DatabaseDump } from "@openboard/ports";
import { SQL } from "bun";

// Separate from the migrator's advisory lock. All replicas contend on the same database.
const DUMP_LOCK = 0x6f6264756d700001n;
const LOOKUP_MS = 5_000;

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

async function dumpExists(bucket: Bucket, key: string, deadline: number, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  // The bucket port guarantees a deadline. Implementations can also honor the signal.
  const exists: (key: string, deadline: number, signal: AbortSignal) => Promise<boolean> = bucket.exists.bind(bucket);
  let abort: () => void = () => {};
  try {
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
    });
    return await Promise.race([cancelled, exists(key, deadline, signal)]);
  } catch {
    signal.throwIfAborted();
    throw new Error("Database dump existence check failed");
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export function postgresDump(url: string, now: () => number = Date.now): DatabaseDump {
  return async (bucket, key, shutdown) => {
    shutdown.throwIfAborted();
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
    const lookup = AbortSignal.any([signal, AbortSignal.timeout(LOOKUP_MS)]);
    const exists = await dumpExists(bucket, key, now() + LOOKUP_MS, lookup);
    signal.throwIfAborted();
    if (exists) return true;
    const env = await dumpEnvironment(url, sql.options);
    signal.throwIfAborted();
    await uploadDump(env, signal, (stream) => bucket.putStream(key, stream));
    return true;
  };
}

// Server errors and query text can contain arbitrary data. Keep only recognized diagnostic phrases.
const stderrDiagnostic =
  /server version mismatch|aborting because of server version mismatch|connection to server|password authentication failed|no password supplied|permission denied|lock timeout|statement timeout|server closed the connection unexpectedly|SSL error|certificate verify failed|could not (?:connect to server|resolve host name|translate host name|write to output file|read from input file|obtain lock on relation)|query failed|out of memory|no space left on device|unrecognized option|terminating connection/gi;

async function stderrTail(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let tail = "";
  for await (const chunk of stream) tail = (tail + decoder.decode(chunk, { stream: true })).slice(-4_096);
  tail = (tail + decoder.decode()).slice(-4_096);
  const diagnostics = Array.from(tail.matchAll(stderrDiagnostic), ([phrase]) => phrase.toLowerCase()).slice(-8);
  return diagnostics.join("; ");
}

export async function uploadDump(
  env: Record<string, string>,
  signal: AbortSignal,
  upload: (stream: ReadableStream<Uint8Array>) => Promise<void>,
  command?: string[],
) {
  signal.throwIfAborted();
  const executable = command?.[0] ?? Bun.which("pg_dump");
  if (!executable) throw new Error("pg_dump is required for hosted backups");
  const child = Bun.spawn(command ?? [executable, "--format=custom", "--no-password", "--lock-wait-timeout=30s"], {
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    signal,
  });
  const stderr = stderrTail(child.stderr).catch(() => "");
  let failure: Error | undefined;
  try {
    const checked = new TransformStream<Uint8Array, Uint8Array>({
      async flush() {
        const status = await child.exited;
        signal.throwIfAborted();
        if (status === 0) return;
        const tail = await stderr;
        failure = new Error(`pg_dump failed (exit ${status})${tail ? `: ${tail}` : ""}`);
        throw failure;
      },
    });
    // The stream reaches EOF only after pg_dump succeeds, so failed dumps cannot be published.
    await upload(child.stdout.pipeThrough(checked, { signal }));
  } catch {
    signal.throwIfAborted();
    throw failure ?? new Error("Database dump upload failed");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await child.exited;
    await stderr;
  }
}
