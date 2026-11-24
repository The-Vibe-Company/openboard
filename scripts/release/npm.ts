import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const sdk = new URL("../../packages/sdk/", import.meta.url);
const cli = new URL("../../packages/cli/", import.meta.url);
const sdkFiles = ["dist/index.js", "dist/index.d.ts", "dist/NOTICE", "dist/TYPEBOX-LICENSE", "README.md", "LICENSE"];

type Artifact = { name: string; version: string; tarball: string };

export function requireReleaseVersion(tag: string, version: string, packageLabel = "SDK"): void {
  if (tag !== `v${version}`) {
    throw new Error(`error: version_mismatch: ${packageLabel} version ${version} does not match release tag ${tag}`);
  }
}

async function packPackage(
  source: URL,
  destination: string,
  files: readonly string[],
  manifest: { name: string; version: string },
): Promise<Artifact> {
  const { name, version } = manifest;
  // Workspace callers use source entries. Each tarball gets its own public manifest.
  const dir = await mkdtemp(join(tmpdir(), "openboard-npm-"));
  try {
    await mkdir(join(dir, "dist"));
    if (source === cli) await mkdir(join(dir, "bin"));
    await Promise.all(files.map((file) => copyFile(new URL(file, source), join(dir, file))));
    if (source === cli) await copyFile(new URL("../../LICENSE", cli), join(dir, "LICENSE"));
    await writeFile(join(dir, "package.json"), JSON.stringify(manifest));
    const pack = Bun.spawnSync(["npm", "pack", "--ignore-scripts", "--pack-destination", resolve(destination)], {
      cwd: dir,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (!pack.success) throw new Error(`error: pack_failed: npm could not pack ${name}`);
    return {
      name,
      version,
      tarball: resolve(destination, `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function packRelease(tag: string, destination: string, includeCli: boolean): Promise<Artifact[]> {
  const { name, version, license, type, repository } = await Bun.file(new URL("package.json", sdk)).json();
  requireReleaseVersion(tag, version);
  const cliManifest = includeCli ? await Bun.file(new URL("package.json", cli)).json() : undefined;
  if (cliManifest) requireReleaseVersion(tag, cliManifest.version, "CLI");

  const sdkManifest = {
    name,
    version,
    license,
    type,
    repository,
    exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
    files: ["dist/"],
  };
  const artifacts = [await packPackage(sdk, destination, sdkFiles, sdkManifest)];
  if (cliManifest) {
    const { name: cliName, license, type, repository, files, bin, engines } = cliManifest;
    const manifest = {
      name: cliName,
      version,
      license,
      type,
      repository,
      files,
      bin,
      engines,
      dependencies: { [name]: version },
    };
    artifacts.push(await packPackage(cli, destination, files, manifest));
  }
  return artifacts;
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

async function publishPackage({ name, version, tarball }: Artifact): Promise<void> {
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
  if (!publish.success) throw new Error(`error: publish_failed: npm could not publish ${name}`);
}

if (import.meta.main) {
  try {
    const [, , tag, destination, ...options] = Bun.argv;
    if (!tag || !destination || options.some((option) => option !== "--publish" && option !== "--with-cli")) {
      throw new Error("Usage: bun scripts/release/npm.ts <release-tag> <pack-destination> [--with-cli] [--publish]");
    }
    const artifacts = await packRelease(tag, destination, options.includes("--with-cli"));
    if (options.includes("--publish")) {
      for (const artifact of artifacts) await publishPackage(artifact);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
