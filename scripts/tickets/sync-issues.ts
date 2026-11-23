import { rename } from "node:fs/promises";
import { join } from "node:path";
import { isManagedLabel, parseTicket, updateIssueNumber } from "./lib.ts";

const repository = "The-Vibe-Company/openboard";

type Issue = {
  number: number;
  title: string;
  body: string;
  labels: { name: string }[];
  milestone: { title: string } | null;
};

type Options = { metadataOnly?: boolean; cwd?: string };
type RunGitHub = (args: string[], stdin?: string) => string;

function runGitHub(args: string[], stdin?: string) {
  const result = Bun.spawnSync(["gh", ...args], {
    stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}

async function readTickets(cwd: string) {
  const paths = Array.from(new Bun.Glob(".veebee/tickets/*.md").scanSync({ cwd })).sort();
  if (paths.length === 0) throw new Error("No ticket files found in .veebee/tickets");
  return Promise.all(paths.map(async (path) => parseTicket(path, await Bun.file(join(cwd, path)).text())));
}

function editArguments(issue: Issue, ticket: ReturnType<typeof parseTicket>, milestone: string, body?: string) {
  const args: string[] = [];
  const existing = issue.labels.map(({ name }) => name);
  for (const label of ticket.labels) {
    if (!existing.includes(label)) args.push("--add-label", label);
  }
  for (const label of existing) {
    if (isManagedLabel(label) && !ticket.labels.includes(label)) args.push("--remove-label", label);
  }
  if (issue.milestone?.title !== milestone) args.push("--milestone", milestone);
  if (body !== undefined) {
    if (issue.title !== ticket.title) args.push("--title", ticket.title);
    if (issue.body.trimEnd() !== body) args.push("--body-file", "-");
  }
  return args;
}

export async function syncIssues(options: Options = {}, run: RunGitHub = runGitHub) {
  const cwd = options.cwd ?? ".";
  const gh: RunGitHub = (args, stdin) => run([...args, "-R", repository], stdin);
  const tickets = await readTickets(cwd);
  if (options.metadataOnly && tickets.some((ticket) => ticket.issue === null)) {
    throw new Error("--metadata-only requires every ticket to have an issue number");
  }
  const issues: Issue[] = JSON.parse(
    gh(["issue", "list", "--state", "all", "--limit", "10000", "--json", "number,title,body,labels,milestone"]),
  );
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const plan = tickets.map((ticket) => {
    const matches =
      ticket.issue === null
        ? issues.filter((issue) => issue.body.split(/\r?\n/).includes(ticket.marker))
        : [byNumber.get(ticket.issue)].filter(Boolean);
    const issue = matches[0];
    if (matches.length > 1 || (!issue && ticket.issue !== null)) {
      throw new Error(`${ticket.path}: expected exactly one matching GitHub issue`);
    }
    return { ticket, issue, milestone: ticket.milestoneTitle };
  });
  const linked = plan.flatMap(({ issue }) => (issue ? [issue.number] : []));
  if (new Set(linked).size !== linked.length) throw new Error("Multiple tickets point to the same GitHub issue");

  const labels = new Set<string>(
    JSON.parse(gh(["label", "list", "--limit", "1000", "--json", "name"])).map(({ name }: { name: string }) => name),
  );
  for (const label of new Set(tickets.flatMap((ticket) => ticket.labels))) {
    if (!labels.has(label)) gh(["label", "create", label]);
  }

  let created = 0;
  let updated = 0;
  for (const { ticket, issue, milestone } of plan) {
    const body = `${ticket.body}\n\n${ticket.marker}`;
    let number = issue?.number;
    if (issue) {
      const args = editArguments(issue, ticket, milestone, options.metadataOnly ? undefined : body);
      if (args.length) {
        gh(["issue", "edit", String(issue.number), ...args], args.includes("--body-file") ? body : undefined);
        updated++;
      }
    } else {
      const labelArgs = ticket.labels.flatMap((label) => ["--label", label]);
      const url = gh(
        ["issue", "create", "--title", ticket.title, "--body-file", "-", "--milestone", milestone, ...labelArgs],
        body,
      );
      const parsed = /\/issues\/([1-9]\d*)$/.exec(url);
      if (!parsed) throw new Error(`${ticket.path}: gh issue create did not return an issue URL`);
      number = Number(parsed[1]);
      created++;
    }
    if (ticket.issue === null && number !== undefined && !options.metadataOnly) {
      const path = join(cwd, ticket.path);
      const temporary = `${path}.${process.pid}.tmp`;
      await Bun.write(temporary, updateIssueNumber(ticket.source, number));
      await rename(temporary, path);
    }
  }
  return `Tickets: ${tickets.length}; issues created: ${created}; updated: ${updated}; closed: 0.`;
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--metadata-only")) {
    console.error("Usage: bun scripts/tickets/sync-issues.ts [--metadata-only]");
    process.exitCode = 2;
  } else {
    try {
      console.log(await syncIssues({ metadataOnly: args[0] === "--metadata-only" }));
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
