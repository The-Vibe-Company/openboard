import { renameSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { globsOverlap, parseTicket, setClaim } from "./lib.ts";

type Ticket = ReturnType<typeof parseTicket>;
type Options = { cwd?: string; agent: string };

// Statuses whose writes are held by an agent: claimed, and review until the PR merges.
const holding = ["claimed", "review"];

// docs/project.md section 5: shared foundations take one held ticket at a time; server and web three.
const limits = [
  { area: "contract", glob: "packages/contract/**", max: 1 },
  { area: "ports", glob: "packages/ports/**", max: 1 },
  { area: "driver-sql migrations", glob: "packages/driver-sql/migrations/**", max: 1 },
  { area: "server", glob: "packages/server/**", max: 3 },
  { area: "web", glob: "apps/web/**", max: 3 },
];

export class ClaimRefused extends Error {}

function overlaps(ticket: Ticket, held: Ticket[]) {
  return held.flatMap((other) =>
    ticket.writes.flatMap((mine) =>
      other.writes
        .filter((theirs) => globsOverlap(mine, theirs))
        .map((theirs) => `${other.path} (${other.claimedBy}) holds ${theirs}, which overlaps ${mine}`),
    ),
  );
}

function overLimit(ticket: Ticket, held: Ticket[]) {
  const touches = (candidate: Ticket, glob: string) => candidate.writes.some((write) => globsOverlap(write, glob));
  return limits.flatMap(({ area, glob, max }) => {
    if (!touches(ticket, glob)) return [];
    const holders = held.filter((other) => touches(other, glob));
    if (holders.length < max) return [];
    return [`${area} allows ${max} held ticket(s) and has ${holders.map(({ path }) => path).join(", ")}`];
  });
}

export async function claimTicket(reference: string, { cwd = process.cwd(), agent }: Options) {
  if (!/^\d+$/.test(reference)) throw new ClaimRefused(`Expected a ticket number, got ${JSON.stringify(reference)}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(agent)) {
    throw new ClaimRefused(
      `Expected an agent name of letters, digits, '.', '_' or '-', got ${JSON.stringify(agent)}; pass --as <agent>`,
    );
  }
  const paths = Array.from(new Bun.Glob(".veebee/tickets/*.md").scanSync({ cwd })).sort();
  const tickets = await Promise.all(
    paths.map(async (path) => parseTicket(path, await Bun.file(join(cwd, path)).text())),
  );
  const matches = tickets.filter(({ id }) => id === Number(reference));
  const [ticket] = matches;
  if (!ticket) throw new ClaimRefused(`No ticket ${reference} in .veebee/tickets`);
  if (matches.length > 1)
    throw new ClaimRefused(`Ticket ${reference} is ambiguous: ${matches.map(({ path }) => path).join(", ")}`);
  if (ticket.status !== "ready") {
    throw new ClaimRefused(
      `${ticket.path} is ${ticket.status} (claimed_by: ${ticket.claimedBy}); only a ready ticket can be claimed`,
    );
  }
  if (ticket.writes.length === 0) throw new ClaimRefused(`${ticket.path} lists no writes`);

  const held = tickets.filter((other) => other !== ticket && holding.includes(other.status));
  const conflicts = [...overlaps(ticket, held), ...overLimit(ticket, held)];
  if (conflicts.length > 0) {
    throw new ClaimRefused(`Refused to claim ${ticket.path}:\n${conflicts.map((line) => `- ${line}`).join("\n")}`);
  }

  const path = join(cwd, ticket.path);
  const temporary = `${path}.claim-${process.pid}`;
  try {
    await Bun.write(temporary, setClaim(ticket.source, agent));
    if ((await Bun.file(path).text()) !== ticket.source)
      throw new ClaimRefused(`${ticket.path} changed during claim; rerun`);
    renameSync(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return `Claimed ${ticket.path} as ${agent}.`;
}

function gitUserName() {
  const result = Bun.spawnSync(["git", "config", "user.name"], { stdout: "pipe", stderr: "ignore" });
  return result.exitCode === 0 ? result.stdout.toString().trim() : "";
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const usage =
    "Usage: bun scripts/tickets/claim.ts <ticket number> [--as <agent>]\nThe agent defaults to `git config user.name`.";
  const valid = (args.length === 1 || (args.length === 3 && args[1] === "--as")) && args[0] !== "--help";
  if (!valid) {
    if (args[0] === "--help") console.log(usage);
    else {
      console.error(usage);
      process.exitCode = 2;
    }
  } else {
    try {
      console.log(await claimTicket(args[0] ?? "", { agent: args[2] ?? gitUserName() }));
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
