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
});

test("doctor diagnoses nested TLS failures", async () => {
  const { code, stdout } = await invoke(["doctor"], env, {
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
  for (const word of ["ob", "org export", "doctor", "completion", "help", "bash zsh fish"])
    expect(stdout).toContain(word);
});
