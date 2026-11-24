import { expect, test } from "bun:test";
import { requirePublishedArtifact, requireReleaseVersion } from "./npm.ts";

test("the SDK package version matches its release tag", () => {
  expect(() => requireReleaseVersion("v1.2.3", "1.2.3")).not.toThrow();
  expect(() => requireReleaseVersion("v1.2.3-rc.1", "1.2.3-rc.1")).not.toThrow();
});

test("a release rejects a CLI version different from the SDK release", () => {
  expect(() => requireReleaseVersion("v1.2.3", "1.2.3", "CLI")).not.toThrow();
  expect(() => requireReleaseVersion("v1.2.3", "1.2.2", "CLI")).toThrow(
    "error: version_mismatch: CLI version 1.2.2 does not match release tag v1.2.3",
  );
});

test("packaging for npm refuses a mismatched release tag", async () => {
  const { version } = await Bun.file(new URL("../../packages/sdk/package.json", import.meta.url)).json();
  const tag = `v${version}-other`;
  const result = Bun.spawnSync(["bun", Bun.fileURLToPath(new URL("./npm.ts", import.meta.url)), tag, "."]);
  expect(result.exitCode).toBe(1);
  expect(result.stdout.toString()).toBe("");
  expect(result.stderr.toString().trim()).toBe(
    `error: version_mismatch: SDK version ${version} does not match release tag ${tag}`,
  );
});

test("an npm publish retry requires matching integrity and provenance", () => {
  const dist = {
    integrity: "sha512-matching",
    attestations: { provenance: { predicateType: "https://slsa.dev/provenance/v1" } },
  };
  expect(() => requirePublishedArtifact(dist, "sha512-matching")).not.toThrow();
  expect(() => requirePublishedArtifact(dist, "sha512-different")).toThrow("error: publication_mismatch:");
  expect(() => requirePublishedArtifact({ integrity: dist.integrity }, dist.integrity)).toThrow(
    "error: publication_mismatch:",
  );
});
