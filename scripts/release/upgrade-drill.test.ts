import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { upgradeDrill } from "./upgrade-drill.ts";

function fixture(version: string) {
  return `#!/bin/sh
exec "${process.execPath}" "${resolve(import.meta.path)}" --fixture ${version} "$@"
`;
}

function release(old = fixture("old"), checksum = Bun.CryptoHasher.hash("sha256", old, "hex")) {
  const name = `openboard-bun-${process.platform}-${process.arch}`;
  const requests: string[] = [];
  const fetchRelease = Object.assign(
    async (url: string | URL | Request) => {
      const base = "https://github.com/The-Vibe-Company/openboard/releases/download/v1.2.3";
      requests.push(String(url));
      if (url === `${base}/SHA256SUMS`) return new Response(`${checksum}  ${name}\n`);
      if (url === `${base}/${name}`) return new Response(old);
      return new Response(null, { status: 404 });
    },
    { preconnect: () => {} },
  );
  return { runtime: { download: fetchRelease, port: () => 8787, ready: async () => true }, name, requests };
}

async function withBinary(version: string, run: (binary: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "upgrade-drill-test-"));
  try {
    const binary = join(dir, "openboard-built");
    await Bun.write(binary, fixture(version));
    await chmod(binary, 0o700);
    await run(binary);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function registerTests() {
  test("checks a release and preserves the same reads and migration backup across executables", async () => {
    await withBinary("new", async (binary) => {
      const { runtime, name, requests } = release();
      expect(await upgradeDrill("v1.2.3", binary, runtime)).toEqual([
        `Verified SHA-256 for v1.2.3/${name}`,
        "Message #2, claimed task #3 survived the upgrade",
        "Created backups/pre-migrate-7.sqlite",
      ]);
      expect(requests.map((url) => url.split("/").at(-1))).toEqual(["SHA256SUMS", name]);
    });
  });

  test("rejects a changed binary before it can execute", async () => {
    const { runtime } = release("#!/bin/sh\nexit 42\n", "0".repeat(64));
    await expect(upgradeDrill("v1.2.3", "/unused", runtime)).rejects.toThrow("SHA-256 mismatch");
  });

  test("rejects changed message data", async () => {
    await withBinary("changed", async (binary) => {
      await expect(upgradeDrill("v1.2.3", binary, release().runtime)).rejects.toThrow(
        "Message, channel or task reads changed",
      );
    });
  });

  test("requires a new migration backup", async () => {
    await withBinary("no-backup", async (binary) => {
      await expect(upgradeDrill("v1.2.3", binary, release().runtime)).rejects.toThrow("No new backups/pre-migrate");
    });
  });
}

async function serveFixture(dir: string, version: string) {
  const lock = join(dir, "running");
  await writeFile(lock, "", { flag: "wx" });
  if (version === "new") {
    await mkdir(join(dir, "backups"));
    await Bun.write(join(dir, "backups/pre-migrate-7.sqlite"), await Bun.file(join(dir, "message")).text());
  }
  const port = Number(process.env.PORT);
  process.on("SIGTERM", async () => {
    await rm(lock);
    process.exit(0);
  });
  const credentials = join(process.env.HOME ?? "", ".config/openboard/local");
  await mkdir(credentials, { recursive: true });
  await Bun.write(join(credentials, `${port}.json`), "{}");
  process.stdin.resume();
}

async function fixtureCommand(version: string, args: string[]) {
  const dir = process.env.OPENBOARD_DATA_DIR;
  if (!dir) throw new Error("Missing fixture data directory");
  const messageFile = join(dir, "message");
  const claimFile = join(dir, "claim");
  const [command, subcommand, id] = args;
  if (command === "serve") return serveFixture(dir, version);
  if (!(await Bun.file(join(dir, "running")).exists())) throw new Error("Fixture server is stopped");
  if (command === "post" && args[3] === "--json") {
    const message = { id: "2", text: id };
    await Bun.write(messageFile, JSON.stringify(message));
    console.log(JSON.stringify({ message }));
  } else if (command === "tasks" && subcommand === "create") {
    console.log(JSON.stringify({ task: { id: "3" } }));
  } else if (command === "tasks" && subcommand === "claim" && id === "3") {
    await Bun.write(claimFile, JSON.stringify({ id, task: { state: "claimed" } }));
  } else if (command === "read" && (subcommand === "2" || subcommand === "3")) {
    const message = await Bun.file(subcommand === "2" ? messageFile : claimFile).text();
    const replies = version === "changed" ? [{ id: "4", text: "unexpected reply" }] : [];
    console.log(JSON.stringify({ message: JSON.parse(message), replies }));
  } else if (command === "messages") {
    console.log(`{"messages":[${await Bun.file(messageFile).text()},${await Bun.file(claimFile).text()}]}`);
  } else {
    throw new Error("Unexpected fixture command");
  }
}

if (import.meta.main && process.argv[2] === "--fixture") {
  const [version, ...args] = process.argv.slice(3);
  await fixtureCommand(version ?? "", args);
} else {
  registerTests();
}
