import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimTicket } from "../claim.ts";
import { globsOverlap, setClaim } from "../lib.ts";

function ticket(id: string, status: string, writes: string[]) {
  return `---
id: ${id}
title: Sample ticket ${id}
milestone: M0-foundations
package: tools
writes:
${writes.map((glob) => `  - ${glob}`).join("\n")}
conformance: []
status: ${status}  # state
claimed_by: ${status === "ready" ? "null" : "agent-a"}
issue: null
---

## Done when
It works.
`;
}

async function withTickets(files: Record<string, string>, run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), "openboard-claim-"));
  try {
    await mkdir(join(cwd, ".veebee/tickets"), { recursive: true });
    for (const [name, source] of Object.entries(files)) await Bun.write(join(cwd, ".veebee/tickets", name), source);
    await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

test.each([
  ["scripts/ci/**", "scripts/ci/sizes.ts", true],
  ["scripts/ci/**", "scripts/ci", true],
  ["scripts/ci/**", "scripts/cid/x.ts", false],
  ["packages/*/package.json", "packages/core/package.json", true],
  ["packages/*/package.json", "packages/core/src/package.json", false],
  ["packages/**/index.ts", "packages/core/src/*.ts", true],
  ["packages/driver-sql/migrations/*-orgs.sql", "packages/driver-sql/migrations/*-device.sql", false],
  ["packages/driver-sql/migrations/*-orgs.sql", "packages/driver-sql/migrations/0004-*", true],
  ["tools/*/tsconfig.json", "tools/bench/**", true],
  ["docs/a?.md", "docs/ab.md", true],
  ["docs/a?.md", "docs/a.md", false],
  ["**", "anything/at/all", true],
])("%s and %s overlap: %p", (a, b, expected) => {
  expect(globsOverlap(a, b)).toBe(expected);
  expect(globsOverlap(b, a)).toBe(expected);
});

test("Unsupported glob syntax is refused rather than guessed", () => {
  expect(() => globsOverlap("src/{a,b}.ts", "src/a.ts")).toThrow("unsupported writes glob");
});

test("A claim only rewrites status and claimed_by", () => {
  const source = ticket("07", "ready", ["docs/x.md"]);
  expect(setClaim(source, "agent-b")).toBe(
    source.replace("status: ready", "status: claimed").replace("claimed_by: null", "claimed_by: agent-b"),
  );
});

test("A claim whose writes overlap a held ticket is refused and leaves the file unchanged", async () => {
  const b = ticket("02", "ready", ["scripts/ci/sizes.ts"]);
  await withTickets({ "01-a.md": ticket("01", "claimed", ["scripts/ci/**"]), "02-b.md": b }, async (cwd) => {
    await expect(claimTicket("2", { cwd, agent: "agent-b" })).rejects.toThrow(
      "- .veebee/tickets/01-a.md (agent-a) holds scripts/ci/**, which overlaps scripts/ci/sizes.ts",
    );
    expect(await Bun.file(join(cwd, ".veebee/tickets/02-b.md")).text()).toBe(b);
  });
});

test("A ticket in review still holds its writes", async () => {
  await withTickets(
    { "01-a.md": ticket("01", "review", ["docs/**"]), "02-b.md": ticket("02", "ready", ["docs/x.md"]) },
    async (cwd) => {
      await expect(claimTicket("02", { cwd, agent: "agent-b" })).rejects.toThrow("01-a.md (agent-a) holds docs/**");
    },
  );
});

test("A second held ticket on a shared foundation is refused even without overlapping writes", async () => {
  await withTickets(
    {
      "01-a.md": ticket("01", "claimed", ["packages/contract/src/operations/tasks.ts"]),
      "02-b.md": ticket("02", "ready", ["packages/contract/src/operations/messages.ts"]),
    },
    async (cwd) => {
      await expect(claimTicket("02", { cwd, agent: "agent-b" })).rejects.toThrow(
        "contract allows 1 held ticket(s) and has .veebee/tickets/01-a.md",
      );
    },
  );
});

test("A ready ticket without overlap is claimed; a ticket not ready is refused", async () => {
  const b = ticket("02", "ready", ["scripts/tickets/claim.ts"]);
  await withTickets(
    { "01-a.md": ticket("01", "claimed", ["scripts/ci/**"]), "02-b.md": b, "03-c.md": ticket("03", "done", ["x"]) },
    async (cwd) => {
      expect(await claimTicket("02", { cwd, agent: "agent-b" })).toBe("Claimed .veebee/tickets/02-b.md as agent-b.");
      expect(await Bun.file(join(cwd, ".veebee/tickets/02-b.md")).text()).toBe(setClaim(b, "agent-b"));
      await expect(claimTicket("02", { cwd, agent: "agent-c" })).rejects.toThrow("is claimed (claimed_by: agent-b)");
      await expect(claimTicket("3", { cwd, agent: "agent-c" })).rejects.toThrow("is done");
      await expect(claimTicket("9", { cwd, agent: "agent-c" })).rejects.toThrow("No ticket 9");
      await expect(claimTicket("01", { cwd, agent: "bad name" })).rejects.toThrow("Expected an agent name");
    },
  );
});
