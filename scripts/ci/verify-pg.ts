// `bun run verify:pg`: the Postgres test run and two-instance conformance on a real Postgres (docs/codebase.md 6.2).
// Uses OPENBOARD_TEST_DATABASE_URL when set; otherwise starts docker-compose.test.yml and uses its database.
// An unreachable database fails the run: Postgres suites never skip.

const composeFile = "docker-compose.test.yml";
// The throwaway database docker-compose.test.yml starts, bound to loopback only.
const composeUrl = "postgres://openboard:openboard@127.0.0.1:55432/openboard";
const connectTimeoutMs = 5_000;

export function databaseAddress(url: string): { hostname: string; port: number } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("OPENBOARD_TEST_DATABASE_URL is not a valid URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("OPENBOARD_TEST_DATABASE_URL must use the postgres:// or postgresql:// scheme");
  }
  if (!parsed.hostname) throw new Error("OPENBOARD_TEST_DATABASE_URL has no host");
  return { hostname: parsed.hostname.replace(/^\[(.*)\]$/, "$1"), port: Number(parsed.port || 5432) };
}

export async function reachable(hostname: string, port: number, timeoutMs = connectTimeoutMs): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const attempt = Bun.connect({
    hostname,
    port,
    socket: { data() {}, open: (socket) => socket.end() },
  }).then(
    () => true,
    () => false,
  );
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function run(label: string, command: string[], env: Record<string, string | undefined>): boolean {
  console.log(`\n$ ${command.join(" ")}`);
  try {
    return Bun.spawnSync(command, { env, stdio: ["inherit", "inherit", "inherit"] }).success;
  } catch (error) {
    console.error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function verifyPg(): Promise<number> {
  let url = process.env.OPENBOARD_TEST_DATABASE_URL;
  if (!url) {
    const started = run("docker compose", ["docker", "compose", "-f", composeFile, "up", "-d", "--wait"], process.env);
    if (!started) {
      console.error(`Could not start Postgres from ${composeFile}; start Docker or set OPENBOARD_TEST_DATABASE_URL.`);
      return 1;
    }
    url = composeUrl;
  }

  const { hostname, port } = databaseAddress(url);
  if (!(await reachable(hostname, port))) {
    console.error(`Postgres is unreachable at ${hostname}:${port}; the Postgres suites fail rather than skip.`);
    return 1;
  }

  const env = { ...process.env, OPENBOARD_TEST_DRIVER: "postgres", OPENBOARD_TEST_DATABASE_URL: url };
  const steps: [string, string[]][] = [
    [
      "Postgres tests",
      ["bun", "run", "--filter", "@openboard/driver-postgres", "--filter", "@openboard/server", "test"],
    ],
    ["Conformance", ["bun", "run", "conformance", "--driver", "postgres", "--instances", "2"]],
  ];
  const failed = steps.filter(([label, command]) => !run(label, command, env)).map(([label]) => label);
  if (failed.length > 0) {
    console.error(`\nverify:pg failed: ${failed.join(", ")}`);
    return 1;
  }
  console.log("\nverify:pg passed");
  return 0;
}

if (import.meta.main) {
  let code = 1;
  try {
    code = await verifyPg();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
  // Exit now: a connection attempt to a host that never answers would otherwise keep the process alive.
  process.exit(code);
}
