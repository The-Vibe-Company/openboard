import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const sdk = new URL("../../packages/sdk/", import.meta.url);
const files = ["dist/index.js", "dist/index.d.ts", "dist/NOTICE", "dist/TYPEBOX-LICENSE", "README.md", "LICENSE"];

export function requireReleaseVersion(tag: string, version: string): void {
  if (tag !== `v${version}`) {
    throw new Error(`error: version_mismatch: SDK version ${version} does not match release tag ${tag}`);
  }
}

async function packSdk(tag: string, destination: string) {
  const { name, version, license, type, repository } = await Bun.file(new URL("package.json", sdk)).json();
  requireReleaseVersion(tag, version);

  // Workspace callers use the source entry. The tarball resolves only the bundled entry and types.
  const dir = await mkdtemp(join(tmpdir(), "openboard-sdk-"));
  try {
    await mkdir(join(dir, "dist"));
    await Promise.all(files.map((file) => copyFile(new URL(file, sdk), join(dir, file))));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name,
        version,
        license,
        type,
        repository,
        exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
        files: ["dist/"],
      }),
    );
    const pack = Bun.spawnSync(["npm", "pack", "--ignore-scripts", "--pack-destination", resolve(destination)], {
      cwd: dir,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (!pack.success) throw new Error("error: pack_failed: npm could not pack the SDK");
    return {
      name,
      version,
      tarball: resolve(destination, `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

type PublishedDist = {
  integrity?: string;
  attestations?: { provenance?: { predicateType?: string } };
};

export function requirePublishedArtifact(dist: PublishedDist, integrity: string): void {
  if (
    dist.integrity !== integrity ||
    dist.attestations?.provenance?.predicateType !== "https://slsa.dev/provenance/v1"
  ) {
    throw new Error(
      "error: publication_mismatch: npm already has this version with different contents or no provenance",
    );
  }
}

async function publishSdk({ name, version, tarball }: Awaited<ReturnType<typeof packSdk>>): Promise<void> {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    {
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.ok) {
    const { dist } = (await response.json()) as { dist: PublishedDist };
    const hash = new Bun.CryptoHasher("sha512").update(await Bun.file(tarball).bytes()).digest("base64");
    requirePublishedArtifact(dist, `sha512-${hash}`);
    console.log(`${name}@${version} is already published with matching integrity and provenance`);
    return;
  }
  if (response.status !== 404) throw new Error(`error: registry_failed: npm returned HTTP ${response.status}`);

  const tag = version.includes("-") ? "next" : "latest";
  const publish = Bun.spawnSync(["npm", "publish", tarball, "--access", "public", "--provenance", "--tag", tag], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!publish.success) throw new Error("error: publish_failed: npm could not publish the SDK");
}

if (import.meta.main) {
  try {
    const [, , tag, destination, option, ...rest] = Bun.argv;
    if (!tag || !destination || (option !== undefined && option !== "--publish") || rest.length > 0) {
      throw new Error("Usage: bun scripts/release/npm.ts <release-tag> <pack-destination> [--publish]");
    }
    const artifact = await packSdk(tag, destination);
    if (option === "--publish") await publishSdk(artifact);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
