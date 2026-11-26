import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { version } from "../package.json";
import { agentConfigPath } from "../src/config.ts";
import { type CliOptions, runCli } from "../src/main.ts";

const url = "https://board.example/api/acme/main";
const env = { BOARD_URL: url, BOARD_PROFILE: "worker", BOARD_TOKEN: "fixture" };

async function invoke(args: string[], environment = {}, options: CliOptions = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(args, environment, {
    ...options,
    output: { out: (line) => stdout.push(line), err: (line) => stderr.push(line) },
  });
  return { code, stdout: stdout.join("\n"), stderr };
}

test.each([[], ["--help"], ["-h"], ["help"]].map((args) => [args]))("overview %j", async (args) => {
  const result = await invoke(args);
  expect(result.code).toBe(0);
  expect(result.stderr).toEqual([]);
  for (const group of ["Quick start", "Messages & channels", "Tasks", "Admin & diagnostics"]) {
    expect(result.stdout).toContain(`\n${group}\n`);
  }
  expect(result.stdout).toContain("Next step: Run ob start to get set up or ob doctor to check your connection.");
  expect(result.stdout).not.toContain("Other commands");
});

test.each(
  [
    ["help", "tasks", "claim"],
    ["tasks", "claim", "--help"],
    ["tasks", "claim", "-h"],
  ].map((args) => [args]),
)("command help %j", async (args) => {
  const { code, stdout } = await invoke(args);
  expect(code).toBe(0);
  expect(stdout).toMatch(/^ob tasks claim <id>/);
  expect(stdout).toContain("Options:\n");
  expect(stdout).toContain("Example: ob tasks claim");
});

test.each(["--version", "-V"])("%s reads the manifest version", async (flag) => {
  expect(await invoke([flag])).toEqual({ code: 0, stdout: `ob ${version}`, stderr: [] });
});

test("start guides fresh setup without contacting a server", async () => {
  const fetch = async () => {
    throw new Error("start must work offline");
  };
  const { code, stdout, stderr } = await invoke(["start"], {}, { fetch });
  expect(code).toBe(0);
  expect(stderr).toEqual([]);
  for (const step of [
    "ob login '<origin>'",
    "ob connect '<board-url>' --as '<name>'",
    "ob serve",
    "In a second terminal, export BOARD_URL='<printed-board-url>'",
    "Replace the angle-bracket placeholders with your values.",
    "ob doctor",
    `ob tasks create '<channel>' "First task"`,
    "ob tasks claim '<id>'",
    `ob reply '<id>' "Work in progress"`,
    `ob tasks complete '<id>' "Done"`,
    "npx skills add The-Vibe-Company/openboard --skill openboard",
    "npm install @the-vibe-company/openboard",
  ]) {
    expect(stdout).toContain(step);
  }
});

test("start shows the saved agent board, auth mode and effective profile", async () => {
  const HOME = mkdtempSync(join(tmpdir(), "ob-start-"));
  const agent = agentConfigPath({ HOME }) as string;
  try {
    const token = `obt_${"a".repeat(16)}_${"x".repeat(43)}`;
    mkdirSync(dirname(agent), { recursive: true, mode: 0o700 });
    writeFileSync(agent, JSON.stringify({ boardUrl: url, profile: "saved-worker", token }), { mode: 0o600 });
    const { code, stdout } = await invoke(["start"], { HOME });
    expect(code).toBe(0);
    expect(stdout).toContain(`Board: ${url}\nAuth: agent (profile "saved-worker")`);
    expect(stdout).not.toContain("ob login");
    expect(stdout).not.toContain(token);
    const json = await invoke(["start", "--as", "override", "--json"], { HOME });
    expect(json.code).toBe(0);
    expect(json.stderr).toEqual([]);
    expect(JSON.parse(json.stdout)).toMatchObject({
      boardUrl: url,
      authMode: "agent",
      profile: "override",
      connect: [],
      verify: "ob doctor",
      tasks: expect.arrayContaining(["ob tasks claim '<id>'"]),
    });
    expect(json.stdout).not.toContain(token);
  } finally {
    rmSync(HOME, { recursive: true, force: true });
  }
});

test("start keeps setup steps for a board without credentials", async () => {
  const { code, stdout } = await invoke(["start", "--json"], { BOARD_URL: url });
  expect(code).toBe(0);
  expect(JSON.parse(stdout)).toMatchObject({
    boardUrl: url,
    authMode: "none",
    profile: null,
    connect: expect.arrayContaining(["Humans: ob login '<origin>'"]),
  });
});

test("start never prints embedded URL credentials", async () => {
  const { stdout } = await invoke(["start", "--json"], {
    BOARD_URL: "https://user:fixture@board.example/api/acme/main",
  });
  expect(JSON.parse(stdout)).toMatchObject({ boardUrl: null, authMode: "none" });
  expect(stdout).not.toContain("fixture");
});

test("doctor checks readiness, effective profile, config permissions and whoami", async () => {
  const HOME = mkdtempSync(join(tmpdir(), "ob-doctor-"));
  const agent = agentConfigPath({ HOME }) as string;
  try {
    mkdirSync(dirname(agent), { recursive: true, mode: 0o700 });
    writeFileSync(agent, "{}", { mode: 0o600 });
    const options = {
      now: () => 42,
      fetch: async (request: Request) => {
        expect(request.method).toBe("GET");
        if (request.url === "https://board.example/readyz") {
          expect(request.headers.get("authorization")).toBeNull();
          return new Response(null, { status: 200 });
        }
        expect(request.url).toBe(`${url}/me`);
        expect(request.headers.get("authorization")).toBe("Bearer fixture");
        return Response.json({ handle: "worker" });
      },
    };
    const run = () => invoke(["doctor", "--as", "override", "--json"], { ...env, HOME }, options);
    const { code, stdout, stderr } = await run();
    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      version,
      upgrade: "curl -fsSL https://openboard.thevibecompany.co/install.sh | sh",
      boardUrl: url,
      profile: "override",
      checks: [
        { state: "ok", detail: "present, mode 0700" },
        { state: "ok", detail: "present, mode 0600" },
        { state: "skipped", detail: "absent" },
        { state: "ok", status: 200, latencyMs: 0 },
        { state: "ok", detail: "signed in as worker" },
      ],
    });
    expect(stdout).not.toContain("fixture");
    chmodSync(agent, 0o644);
    expect(await run()).toMatchObject({ code: 1, stdout: expect.stringContaining("chmod 600") });
  } finally {
    rmSync(HOME, { recursive: true, force: true });
  }
});

test("doctor reports an unconfigured board and a setup hint", async () => {
  const { code, stdout } = await invoke(["doctor"]);
  expect(code).toBe(1);
  expect(stdout).toContain("unconfigured\nNext step: Set BOARD_URL");
  expect(stdout).toContain("Upgrade ob: curl -fsSL https://openboard.thevibecompany.co/install.sh | sh");
});

test("doctor diagnoses nested TLS failures", async () => {
  const { code, stdout } = await invoke(["doctor"], env, {
    now: () => 0,
    fetch: async () => {
      throw new TypeError("fetch failed", { cause: new Error("unable to get local issuer certificate") });
    },
  });
  expect(code).toBe(1);
  expect(stdout).toContain("TLS certificate validation failed");
  expect(stdout).toContain(
    "Next step: Check for corporate proxy or VPN interception and configure NODE_EXTRA_CA_CERTS",
  );
});

test.each([
  ["ENOTFOUND", "DNS resolution failed", "Check the board hostname"],
  ["EAI_AGAIN", "DNS resolution failed", "Check the board hostname"],
  ["ERR_SSL_WRONG_VERSION_NUMBER", "TLS connection failed", "Check HTTPS"],
  ["ECONNREFUSED", "server could not be reached", "Check DNS, TLS certificates and network access"],
])("doctor diagnoses %s from the readiness probe", async (failure, detail, hint) => {
  const { code, stdout } = await invoke(["doctor", "--json"], env, {
    now: () => 0,
    fetch: async (request) => {
      expect(request.url).toBe("https://board.example/readyz");
      const cause = Object.assign(new Error("connection failed"), { code: failure });
      throw new TypeError("fetch failed", { cause });
    },
  });
  expect(code).toBe(1);
  expect(JSON.parse(stdout).checks.slice(-2)).toEqual([
    { name: "Server readiness", state: "failed", detail, next: expect.stringContaining(hint), latencyMs: 0 },
    { name: "Authentication", state: "skipped", detail: "server unreachable" },
  ]);
});

test("unreachable commands guide human readers to DNS, TLS, network and doctor", async () => {
  const fetch = async () => {
    throw new TypeError("fetch failed");
  };
  const human = await invoke(["whoami"], env, { fetch });
  expect(human.code).toBe(1);
  expect(human.stderr[0]).toStartWith("error: unreachable:");
  expect(human.stderr[1]).toMatch(/^Next step: .*DNS.*TLS.*network.*ob doctor/);
  const json = await invoke(["whoami", "--json"], env, { fetch });
  expect(json.code).toBe(1);
  expect(json.stderr).toEqual(human.stderr.slice(0, 1));
});

test("webhooks test distinguishes board and receiver reachability", async () => {
  const boardFailure = await invoke(["webhooks", "test", "fixture-id"], env, {
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
  });
  expect(boardFailure.code).toBe(1);
  expect(boardFailure.stderr[1]).toContain("network access for the board.");
  const receiverFailure = await invoke(["webhooks", "test", "fixture-id"], env, {
    fetch: async () => Response.json({ delivery: { status: null } }),
  });
  expect(receiverFailure.code).toBe(1);
  expect(receiverFailure.stderr[1]).toContain("network access for the webhook receiver.");
});

test("expired credentials get a login hint and ordinary JSON errors keep their first line", async () => {
  const fetch = async (request: Request) =>
    request.url.endsWith("/readyz")
      ? new Response(null)
      : Response.json({ error: { code: "unauthorized", message: "expired" } }, { status: 401 });
  expect(await invoke(["doctor"], env, { fetch })).toMatchObject({
    code: 1,
    stdout: expect.stringContaining("Next step: Run ob login"),
  });
  expect((await invoke(["whoami"], env, { fetch })).stderr).toEqual([
    "error: unauthorized: expired",
    "Next step: Run ob login <origin> or ob connect <board-url> --as <name>.",
  ]);
  expect((await invoke(["whoami", "--json"], env, { fetch })).stderr).toEqual(["error: unauthorized: expired"]);
});

test.each(["bash", "zsh", "fish"])("completion %s includes registered subcommands and utilities", async (shell) => {
  const { code, stdout } = await invoke(["completion", shell]);
  expect(code).toBe(0);
  expect(stdout).toMatch(/^# Enable with:/);
  expect(stdout).toMatch(/['"]tasks['"].*\bclaim\b/);
  for (const word of ["ob", "org export", "start", "doctor", "completion", "help", "bash zsh fish"])
    expect(stdout).toContain(word);
});
