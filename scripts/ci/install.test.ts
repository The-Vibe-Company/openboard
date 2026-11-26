import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readlinkSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "../install.sh");
const release = "https://github.com/The-Vibe-Company/openboard/releases";
const binary = "#!/bin/sh\nprintf 'OpenBoard fixture\\n'\n";

function withInstaller(run: (dir: string, install: (...args: string[]) => ReturnType<typeof Bun.spawnSync>) => void) {
  const dir = mkdtempSync(join(tmpdir(), "openboard-install-test-"));
  try {
    const digest = new Bun.CryptoHasher("sha256").update(binary).digest("hex");
    writeFileSync(join(dir, "uname"), '#!/bin/sh\ncase "$1" in -s) echo "$TEST_OS";; -m) echo "$TEST_ARCH";; esac\n');
    writeFileSync(
      join(dir, "curl"),
      `#!/bin/sh
while [ "$#" -gt 1 ]; do
  if [ "$1" = -o ]; then output=$2; shift; fi
  shift
done
case "$1" in
  ${release}/latest) printf '%s' '${release}/tag/v1.2.3' ;;
  ${release}/download/v1.2.3/ob-bun-linux-x64) cp "$FIXTURES/binary" "$output" ;;
  ${release}/download/v1.2.3/SHA256SUMS) cp "$FIXTURES/sums" "$output" ;;
  *) exit 1 ;;
esac
`,
    );
    chmodSync(join(dir, "uname"), 0o755);
    chmodSync(join(dir, "curl"), 0o755);
    writeFileSync(join(dir, "binary"), binary);
    writeFileSync(join(dir, "sums"), `${digest}  ob-bun-linux-x64\n`);
    run(dir, (...args) =>
      Bun.spawnSync(["sh", script, ...args], {
        env: {
          PATH: `${dir}:/usr/bin:/bin`,
          FIXTURES: dir,
          OPENBOARD_INSTALL_DIR: join(dir, "bin"),
          OPENBOARD_VERSION: "v1.2.3",
          TEST_OS: "Linux",
          TEST_ARCH: "x86_64",
        },
      }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("installer passes sh syntax check and matches the public asset byte for byte", async () => {
  expect(Bun.spawnSync(["sh", "-n", script]).exitCode).toBe(0);
  const publicScript = Bun.file(join(import.meta.dir, "../../apps/web/public/install.sh"));
  expect(await publicScript.bytes()).toEqual(await Bun.file(script).bytes());
});

test.each([
  ["Darwin", "arm64", "darwin-arm64"],
  ["Darwin", "x86_64", "darwin-x64"],
  ["Linux", "aarch64", "linux-arm64"],
  ["Linux", "x86_64", "linux-x64"],
])("dry run maps %s %s and uses the requested release", (os, arch, target) => {
  withInstaller((dir) => {
    const { stdout, exitCode } = Bun.spawnSync(["sh", script, "--dry-run", "--version", "v2.0.0"], {
      env: { PATH: `${dir}:/usr/bin:/bin`, TEST_OS: os, TEST_ARCH: arch, OPENBOARD_VERSION: "v1.2.3" },
    });
    expect(exitCode).toBe(0);
    expect(stdout.toString().trim().split("\n")).toEqual([
      `${release}/download/v2.0.0/ob-bun-${target}`,
      `${release}/download/v2.0.0/SHA256SUMS`,
    ]);
  });
});

test("resolves the latest release redirect when a version is omitted", () => {
  withInstaller((dir) => {
    const result = Bun.spawnSync(["sh", script, "--dry-run"], {
      env: { PATH: `${dir}:/usr/bin:/bin`, TEST_OS: "Linux", TEST_ARCH: "x86_64" },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain(`${release}/download/v1.2.3/ob-bun-linux-x64`);
  });
});

test("installs the verified binary and preserves it when an upgrade fails its checksum", () => {
  withInstaller((dir, install) => {
    const result = install();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Installed OpenBoard v1.2.3");
    const bin = join(dir, "bin");
    const alias = join(bin, "openboard");
    expect(readlinkSync(alias)).toBe("ob");
    expect(Bun.spawnSync([alias]).stdout.toString()).toBe("OpenBoard fixture\n");

    writeFileSync(join(dir, "binary"), "corrupted download");
    const update = install();
    expect(update.exitCode).toBe(1);
    expect(update.stderr.toString()).toContain("SHA256 checksum mismatch");
    expect(Bun.spawnSync([alias]).stdout.toString()).toBe("OpenBoard fixture\n");
    expect(readdirSync(bin).sort()).toEqual(["ob", "openboard"]);
  });
});
