import { BoardError, type Client, createClient } from "../../packages/sdk/src/index.ts";
import { parseTicket } from "./lib.ts";

/** The channel every mirrored ticket becomes a task of (docs/project.md 6, phase B). */
export const CHANNEL = "openboard/tickets";
const PAGE = 500;

type Ticket = ReturnType<typeof parseTicket>;
type Fetch = (request: Request) => Promise<Response>;

/** A ticket's task as the board holds it: the root message ID and its public state. */
type OnBoard = { readonly task: string; readonly state: string };

export type SyncOptions = {
  /** `BOARD_URL`, as any agent has it: the board the tasks go to. */
  readonly url: string;
  /** The board credential, read from stdin by the CLI and never printed. */
  readonly token: string;
  /** Where `.veebee/tickets/` is; the repository root by default. */
  readonly cwd?: string;
  /** The app's `fetch`, for the test that runs against an in-process board. */
  readonly fetch?: Fetch;
  /** Where each line goes: `console.log` by default, a collector in tests. */
  readonly log?: (line: string) => void;
};

export type SyncReport = { readonly ready: number; readonly created: number; readonly skipped: number };

async function readTickets(cwd: string): Promise<Ticket[]> {
  const paths = Array.from(new Bun.Glob(".veebee/tickets/*.md").scanSync({ cwd })).sort();
  if (paths.length === 0) throw new Error("No ticket files found in .veebee/tickets");
  return Promise.all(paths.map(async (path) => parseTicket(path, await Bun.file(`${cwd}/${path}`).text())));
}

/** Every task in the tickets channel, keyed by the `ticket=<id>` label it carries. */
async function readBoard(client: Client): Promise<Map<number, OnBoard>> {
  const tasks = new Map<number, OnBoard>();
  let after: string | undefined;
  for (;;) {
    const page = await client.listTasks({ channel: CHANNEL, state: "all", limit: PAGE, ...(after ? { after } : {}) });
    for (const { message } of page.tasks) {
      const id = Number(message.labels.ticket ?? NaN);
      if (!message.task || !Number.isInteger(id) || tasks.has(id)) continue;
      tasks.set(id, { task: message.id, state: message.task.state });
    }
    if (page.tasks.length < PAGE || page.cursor === after) return tasks;
    after = page.cursor;
  }
}

/**
 * The tasks of the ticket's prerequisites that are not `done`. A prerequisite that is not done and has no task on the
 * board cannot be waited on yet: the task is created ready and the log names it, since nothing would point the need at.
 */
function prerequisites(ticket: Ticket, tickets: Map<number, Ticket>, board: Map<number, OnBoard>) {
  const tasks: string[] = [];
  const missing: string[] = [];
  for (const id of ticket.dependsOn) {
    if (tickets.get(id)?.status === "done") continue;
    const found = board.get(id);
    if (found) tasks.push(found.task);
    else missing.push(tickets.get(id)?.idText ?? String(id));
  }
  return { tasks, missing };
}

/**
 * Mirrors every `status: ready` ticket as a task in `openboard/tickets`, one per ticket, text `<id> <title>`, label
 * `ticket=<id>`, needing the task of each prerequisite that is not `done`. The client ID is the ticket path, so a
 * rerun finds what exists and prints what it skipped instead of creating a second task (docs/project.md 6, phase B).
 */
export async function syncBoard(options: SyncOptions): Promise<SyncReport> {
  const cwd = options.cwd ?? ".";
  const log = options.log ?? ((line: string) => console.log(line));
  const client = createClient({
    url: options.url,
    token: options.token,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const all = await readTickets(cwd);
  const tickets = new Map(all.map((ticket) => [ticket.id, ticket]));
  const ready = all.filter((ticket) => ticket.status === "ready").sort((left, right) => left.id - right.id);
  const board = await readBoard(client);
  let created = 0;
  let skipped = 0;
  for (const ticket of ready) {
    const existing = board.get(ticket.id);
    if (existing) {
      skipped++;
      log(`skipped ${ticket.idText}: task #${existing.task} is already on the board (${existing.state})`);
      continue;
    }
    const needs = prerequisites(ticket, tickets, board);
    try {
      const answer = await client.createTask({
        channel: CHANNEL,
        text: `${ticket.idText} ${ticket.title}`,
        labels: { ticket: ticket.idText },
        id: ticket.path,
        ...(needs.tasks.length > 0 ? { needs: needs.tasks } : {}),
      });
      board.set(ticket.id, { task: answer.task.id, state: answer.task.task.state });
      created++;
      const waiting = needs.tasks.map((task) => `#${task}`).join(", ");
      // A prerequisite with no task yet is named, not waited on: its need lands when a later run creates it.
      const missing = needs.missing.length > 0 ? `; ${needs.missing.join(", ")} has no task yet` : "";
      log(
        `created ${ticket.idText}: task #${answer.task.id} ${answer.task.task.state}${waiting ? ` on ${waiting}` : ""}${missing}`,
      );
    } catch (error) {
      // A task a rerun finds by its client ID is the task this ticket already has.
      if (!(error instanceof BoardError) || error.code !== "duplicate_id") throw error;
      skipped++;
      log(`skipped ${ticket.idText}: ${error.message}`);
    }
  }
  log(`Ready tickets: ${ready.length}; tasks created: ${created}; skipped: ${skipped}.`);
  return { ready: ready.length, created, skipped };
}

async function readSecret(): Promise<string> {
  const token = process.stdin.isTTY ? "" : (await Bun.stdin.text()).trim();
  if (!token) throw new Error("Provide the board connection secret on stdin");
  return token;
}

const USAGE = "Usage: bun scripts/tickets/sync-board.ts --url <BOARD_URL> < secret-file";

/** What the CLI needs beyond the script: stdin for the secret, and a fetch and writers a test injects. */
export type CliDeps = {
  readonly readSecret: () => Promise<string>;
  readonly fetch?: Fetch;
  readonly cwd?: string;
  readonly log?: (line: string) => void;
  readonly err?: (line: string) => void;
};

const cli: CliDeps = { readSecret };

/** Parses the CLI's arguments, reads the secret from stdin and mirrors the tickets. Answers the exit code. */
export async function runSyncBoard(args: string[], deps: CliDeps = cli): Promise<number> {
  const [flag, url] = args;
  const log = deps.log ?? ((line: string) => console.log(line));
  const err = deps.err ?? ((line: string) => console.error(line));
  if (args.length === 1 && flag === "--help") {
    log(USAGE);
    return 0;
  }
  if (args.length !== 2 || flag !== "--url" || !url || !URL.canParse(url)) {
    err(USAGE);
    return 2;
  }
  // The secret is a board credential: it crosses the network only under TLS, or not at all off this machine.
  const target = new URL(url);
  if (target.protocol !== "https:" && !(target.protocol === "http:" && target.hostname === "127.0.0.1")) {
    throw new Error("Use an HTTPS board URL, or HTTP on 127.0.0.1");
  }
  const token = await deps.readSecret();
  if (!token) throw new Error("Provide the board connection secret on stdin");
  await syncBoard({
    url,
    token,
    ...(deps.cwd === undefined ? {} : { cwd: deps.cwd }),
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    ...(deps.log === undefined ? {} : { log: deps.log }),
  });
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await runSyncBoard(Bun.argv.slice(2));
  } catch (error) {
    console.error(`error: sync_board_failed: ${error instanceof Error ? error.message : "Ticket sync failed"}`);
    process.exitCode = 1;
  }
}
