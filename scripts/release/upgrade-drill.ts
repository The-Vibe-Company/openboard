import { type Dirent, existsSync, watch } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { hostTarget } from "../build/index.ts";

const releases = "https://github.com/The-Vibe-Company/openboard/releases/download";
const channel = "upgrade-drill";

async function download(url: string, request: typeof fetch, stop: AbortSignal): Promise<Response> {
  const response = await request(url, { signal: AbortSignal.any([stop, AbortSignal.timeout(120_000)]) });
  if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
  return response;
}

async function fetchBinary(tag: string, name: string, path: string, request: typeof fetch, stop: AbortSignal) {
  const base = `${releases}/${tag}`;
  const manifest = await (await download(`${base}/SHA256SUMS`, request, stop)).text();
  const sums = manifest.split(/\r?\n/).flatMap((line) => {
    const match = /^([0-9a-f]{64}) [ *](.+)$/i.exec(line);
    return match?.[2] === name ? [match[1]?.toLowerCase()] : [];
  });
  if (sums.length !== 1) throw new Error(`Expected one SHA-256 entry for ${name} in ${tag}/SHA256SUMS`);

  const response = await download(`${base}/${name}`, request, stop);
  await Bun.write(path, response);
  const hash = new Bun.CryptoHasher("sha256");
  for await (const bytes of Bun.file(path).stream()) hash.update(bytes);
  if (hash.digest("hex") !== sums[0]) throw new Error(`SHA-256 mismatch for ${tag}/${name}`);
  await chmod(path, 0o700);
}

function localPort() {
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {} },
  });
  const port = listener.port;
  listener.stop(true);
  return port;
}

function environment(dir: string, port: number) {
  return {
    HOME: dir,
    PATH: process.env.PATH,
    USER: "upgrade-drill",
    PORT: String(port),
    BOARD_URL: `http://127.0.0.1:${port}/api/local/main`,
    OPENBOARD_DATA_DIR: join(dir, "data"),
  };
}

type DrillEnvironment = ReturnType<typeof environment>;

async function waitForOwner(ownerFile: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const found = Promise.withResolvers<void>();
  const check = () => {
    if (existsSync(ownerFile)) found.resolve();
  };
  const watcher = watch(dirname(ownerFile), check);
  const abort = () => found.reject(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  watcher.on("error", found.reject);
  try {
    check();
    await found.promise;
  } finally {
    watcher.close();
    signal.removeEventListener("abort", abort);
  }
}

async function ready(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal }).catch(() => undefined);
  await response?.body?.cancel();
  return response?.ok === true;
}

interface Runtime {
  readonly download: typeof fetch;
  readonly port: () => number;
  readonly ready: typeof ready;
}

async function withServer<T>(
  binary: string,
  env: DrillEnvironment,
  run: () => Promise<T>,
  probe: Runtime["ready"],
  stop: AbortSignal,
): Promise<T> {
  const ownerFile = join(env.HOME, ".config/openboard/local", `${env.PORT}.json`);
  await mkdir(dirname(ownerFile), { recursive: true, mode: 0o700 });
  await rm(ownerFile, { force: true });
  stop.throwIfAborted();
  const server = Bun.spawn([binary, "serve"], {
    cwd: env.HOME,
    env,
    stdin: "pipe",
    stdout: Bun.file(join(env.HOME, "serve.log")),
    stderr: Bun.file(join(env.HOME, "serve-errors.log")),
  });
  let result: T;
  try {
    const url = `http://127.0.0.1:${env.PORT}/readyz`;
    const startup = AbortSignal.timeout(15_000);
    const exited = new AbortController();
    void server.exited.then(() => exited.abort());
    const signal = AbortSignal.any([stop, startup, exited.signal]);
    try {
      await waitForOwner(ownerFile, signal);
      while (!(await probe(url, signal))) {
        signal.throwIfAborted();
        await Bun.sleep(25);
      }
      signal.throwIfAborted();
    } catch (error) {
      if (exited.signal.aborted) throw new Error(`serve exited before readiness (status ${server.exitCode})`);
      if (startup.aborted) throw new Error("serve did not become ready within 15 seconds");
      throw error;
    }
    result = await run();
  } finally {
    if (server.exitCode === null) server.kill("SIGTERM");
    const timeout = setTimeout(() => server.kill("SIGKILL"), 12_000);
    try {
      await server.exited;
    } finally {
      clearTimeout(timeout);
    }
  }
  if (server.exitCode !== 0) throw new Error("serve did not stop cleanly");
  return result;
}

function client(binary: string, env: DrillEnvironment, stop: AbortSignal) {
  return async (...args: string[]) => {
    stop.throwIfAborted();
    const child = Bun.spawn([binary, ...args], {
      cwd: env.HOME,
      env,
      stdout: "pipe",
      stderr: "ignore",
      signal: AbortSignal.any([stop, AbortSignal.timeout(15_000)]),
      killSignal: "SIGKILL",
    });
    const [output, code] = await Promise.all([child.stdout.text(), child.exited]);
    stop.throwIfAborted();
    if (code !== 0) {
      throw new Error(`${args.slice(0, args[0] === "tasks" ? 2 : 1).join(" ")} failed (exit ${code})`);
    }
    return output;
  };
}

type Client = ReturnType<typeof client>;

function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Missing ${name} in CLI output`);
  return value;
}

async function seed(ob: Client) {
  const posted = JSON.parse(await ob("post", channel, "Before upgrading", "--json"));
  const id = identifier(posted.message?.id, "message ID");
  const task = JSON.parse(await ob("tasks", "create", channel, "Keep this claim", "--json"));
  const taskId = identifier(task.task?.id, "task ID");
  await ob("tasks", "claim", taskId);
  return { id, taskId };
}

async function read(ob: Client, { id, taskId }: Awaited<ReturnType<typeof seed>>) {
  const thread = JSON.parse(await ob("read", id, "--json"));
  const task = JSON.parse(await ob("read", taskId, "--json"));
  const messages = JSON.parse(await ob("messages", channel, "--json"));
  if (thread.message?.text !== "Before upgrading" || task.message?.task?.state !== "claimed") {
    throw new Error("Expected the seeded message and claimed task in thread reads");
  }
  return { thread, task, messages };
}

async function snapshots(dataDir: string) {
  const dir = join(dataDir, "backups");
  let files: Dirent[];
  try {
    files = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  return files.filter((file) => file.isFile() && /^pre-migrate-\d+\.sqlite$/.test(file.name)).map((file) => file.name);
}

export async function upgradeDrill(
  tag: string,
  built: string,
  runtime: Runtime = { download: fetch, port: localPort, ready },
  stop: AbortSignal = new AbortController().signal,
): Promise<string[]> {
  if (!/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(tag)) throw new Error("Expected a release tag such as v1.2.3");
  const target = hostTarget();
  const dir = await mkdtemp(join(tmpdir(), "openboard-upgrade-"));
  try {
    const env = environment(dir, runtime.port());
    const name = `openboard-${target}`;
    const previous = join(dir, name);
    await fetchBinary(tag, name, previous, runtime.download, stop);
    await mkdir(env.OPENBOARD_DATA_DIR);
    const before = await withServer(
      previous,
      env,
      async () => {
        const ob = client(previous, env, stop);
        const ids = await seed(ob);
        return { ids, reads: await read(ob, ids) };
      },
      runtime.ready,
      stop,
    );
    const existing = await snapshots(env.OPENBOARD_DATA_DIR);
    await withServer(
      built,
      env,
      async () => {
        const after = await read(client(built, env, stop), before.ids);
        if (!isDeepStrictEqual(before.reads, after)) throw new Error("Message, channel or task reads changed");
      },
      runtime.ready,
      stop,
    );
    const snapshot = (await snapshots(env.OPENBOARD_DATA_DIR)).find((file) => !existing.includes(file));
    stop.throwIfAborted();
    if (!snapshot) throw new Error("No new backups/pre-migrate-<version>.sqlite was created");
    return [
      `Verified SHA-256 for ${tag}/${name}`,
      `Message #${before.ids.id}, claimed task #${before.ids.taskId} survived the upgrade`,
      `Created backups/${snapshot}`,
    ];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const stop = new AbortController();
  const cancel = () => stop.abort(new Error("Upgrade drill interrupted"));
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    const [flag, tag, ...extra] = process.argv.slice(2);
    if (flag !== "--from" || !tag || extra.length) {
      throw new Error("Usage: bun scripts/release/upgrade-drill.ts --from <previous release tag>");
    }
    const built = resolve(import.meta.dir, "../../dist", `openboard-${hostTarget()}`);
    if (!(await Bun.file(built).exists())) throw new Error("Run bun run build first");
    for (const line of await upgradeDrill(tag, built, undefined, stop.signal)) console.log(line);
  } catch (error) {
    console.error(`error: upgrade_failed: ${error instanceof Error ? error.message : "Upgrade drill failed"}`);
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}
