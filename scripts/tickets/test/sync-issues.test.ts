import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTicket } from "../lib.ts";
import { syncIssues } from "../sync-issues.ts";

const path = ".veebee/tickets/01-sample.md";
const source = `---
id: 01
title: Mirror a sample ticket
milestone: M0-foundations
package: tools  # owning workspace
writes:
  - packages/server/test/isolation/**
conformance: []
status: ready  # state
issue: null  # issue number
---

## Done when
The issue has the ticket body.
`;

test.each(["ready", "claimed", "review", "blocked", "draft", "done", "dropped"])(
  "A %s ticket gets only its documented state label",
  (status) => {
    const { labels } = parseTicket(path, source.replace("status: ready", `status: ${status}`));
    const expected = ["pkg:tools", "M0", "isolation"];
    if (["ready", "claimed", "review", "blocked"].includes(status)) expected.push(status);
    expect(labels.sort()).toEqual(expected.sort());
  },
);

test("The mirror creates and links an issue once, and can recover the link after an interrupted write", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "openboard-ticket-"));
  const file = Bun.file(join(cwd, path));
  const labels = ["pkg:tools", "M0", "ready", "isolation"].map((name) => ({ name }));
  const issues: unknown[] = [];
  const commands: string[] = [];
  const mockGitHub = (args: string[], body?: string) => {
    const command = args.slice(0, 2).join(" ");
    commands.push(command);
    if (command === "issue list") return JSON.stringify(issues);
    if (command === "label list") return JSON.stringify(labels);
    expect(command).toBe("issue create");
    expect(args).toEqual([
      "issue",
      "create",
      "--title",
      "Mirror a sample ticket",
      "--body-file",
      "-",
      "--milestone",
      "M0 Foundations",
      ...labels.flatMap(({ name }) => ["--label", name]),
      "-R",
      "The-Vibe-Company/openboard",
    ]);
    expect(body).toBe(`## Done when\nThe issue has the ticket body.\n\n<!-- openboard-ticket: ${path} -->`);
    issues.push({ number: 42, title: "Mirror a sample ticket", body, labels, milestone: { title: "M0 Foundations" } });
    return "https://github.example/issues/42";
  };

  try {
    await file.write(source);
    expect(await syncIssues({ cwd }, mockGitHub)).toBe("Tickets: 1; issues created: 1; updated: 0; closed: 0.");
    expect(await file.text()).toBe(source.replace("issue: null", "issue: 42"));
    expect(await syncIssues({ cwd }, mockGitHub)).toBe("Tickets: 1; issues created: 0; updated: 0; closed: 0.");
    await file.write(source);
    await expect(syncIssues({ cwd, metadataOnly: true }, mockGitHub)).rejects.toThrow("requires every ticket");
    expect(await syncIssues({ cwd }, mockGitHub)).toBe("Tickets: 1; issues created: 0; updated: 0; closed: 0.");
    expect(await file.text()).toBe(source.replace("issue: null", "issue: 42"));
    expect(commands).toEqual([
      "issue list",
      "label list",
      "issue create",
      "issue list",
      "label list",
      "issue list",
      "label list",
    ]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("Metadata-only corrects labels and milestone while preserving manually managed issue content", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "openboard-ticket-"));
  const file = Bun.file(join(cwd, path));
  const numbered = source.replace("issue: null", "issue: 42").replace("status: ready", "status: done");
  const labels = ["pkg:tools", "M0", "isolation", "ready", "bug"].map((name) => ({ name }));
  const issue = {
    number: 42,
    title: "Custom issue title",
    body: "Custom issue description",
    labels: labels.filter(({ name }) => name !== "isolation"),
    milestone: null,
  };

  try {
    await file.write(numbered);
    const edits: string[][] = [];
    const result = await syncIssues({ cwd, metadataOnly: true }, (args, body) => {
      expect(body).toBeUndefined();
      if (args[0] === "issue" && args[1] === "list") return JSON.stringify([issue]);
      if (args[0] === "label" && args[1] === "list") return JSON.stringify(labels);
      edits.push(args);
      return "";
    });
    expect(edits).toEqual([
      [
        "issue",
        "edit",
        "42",
        "--add-label",
        "isolation",
        "--remove-label",
        "ready",
        "--milestone",
        "M0 Foundations",
        "-R",
        "The-Vibe-Company/openboard",
      ],
    ]);
    expect(result).toBe("Tickets: 1; issues created: 0; updated: 1; closed: 0.");
    expect(await file.text()).toBe(numbered);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test.each([
  [42, "<!-- openboard-ticket: .veebee/tickets/02-other.md -->"],
  [41, `<!-- openboard-ticket: ${path} -->`],
] as const)(
  "A numbered ticket refuses conflicting links from issue #%i before any remote edits",
  async (number, marker) => {
    const cwd = await mkdtemp(join(tmpdir(), "openboard-ticket-"));
    const file = Bun.file(join(cwd, path));
    try {
      await file.write(source.replace("issue: null", "issue: 42"));
      const issues = [{ number: 42, body: "" }];
      if (number === 42) issues[0] = { number, body: marker };
      else issues.push({ number, body: marker });
      const commands: string[][] = [];
      await expect(
        syncIssues({ cwd, metadataOnly: true }, (args) => {
          commands.push(args);
          return JSON.stringify(issues);
        }),
      ).rejects.toThrow("conflicting GitHub issue links");
      expect(commands.map((args) => args.slice(0, 2))).toEqual([["issue", "list"]]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  },
);

test("An intervening ticket edit survives and the next run recovers the issue number", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "openboard-ticket-"));
  const file = Bun.file(join(cwd, path));
  const edited = `${source}\nAn edit made during sync.\n`;
  const labels = ["pkg:tools", "M0", "ready", "isolation"].map((name) => ({ name }));
  const issues: unknown[] = [];
  let creations = 0;
  const mockGitHub = (args: string[], body?: string) => {
    switch (args.slice(0, 2).join(" ")) {
      case "issue list":
        return JSON.stringify(issues);
      case "label list":
        return JSON.stringify(labels);
      case "issue create":
        creations++;
        writeFileSync(join(cwd, path), edited);
        issues.push({
          number: 42,
          title: "Mirror a sample ticket",
          body,
          labels,
          milestone: { title: "M0 Foundations" },
        });
        return "https://github.example/issues/42";
      case "issue edit":
        expect(body).toContain("An edit made during sync.");
        return "";
      default:
        throw new Error("Unexpected GitHub command");
    }
  };
  try {
    await file.write(source);
    await expect(syncIssues({ cwd }, mockGitHub)).rejects.toThrow("changed during sync");
    expect(await file.text()).toBe(edited);
    await syncIssues({ cwd }, mockGitHub);
    expect(creations).toBe(1);
    expect(await file.text()).toBe(edited.replace("issue: null", "issue: 42"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("A second creation checkout fails before reading GitHub while the host lock is held", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "openboard-ticket-"));
  const lock = join(tmpdir(), "openboard-ticket-sync-The-Vibe-Company-openboard.lock");
  try {
    await Bun.write(join(cwd, path), source);
    await mkdir(lock);
    try {
      await expect(
        syncIssues({ cwd }, () => {
          throw new Error("GitHub was called while creation was locked");
        }),
      ).rejects.toThrow("Issue creation is locked");
    } finally {
      await rmdir(lock);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
