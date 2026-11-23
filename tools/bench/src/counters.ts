import { operations } from "@openboard/contract";
import { boot, type Mode } from "./drivers";
import { countArmedTimers } from "./timers";

/** A counter not measured yet: the drivers' statement counters do not exist so far. */
export type Count = number | undefined;

export interface OperationCounters {
  readonly operation: string;
  readonly statements: Count;
  readonly roundTrips: Count;
}

export interface ModeCounters {
  readonly mode: Mode;
  readonly operations: readonly OperationCounters[];
  readonly idleTimers: number;
}

/** Boots `mode`, lets it settle, and reads the deterministic counters it would be held to. */
export async function measure(mode: Mode): Promise<ModeCounters> {
  let server: ReturnType<typeof boot> | undefined;
  try {
    const idleTimers = await countArmedTimers(async () => {
      server = boot(mode);
      await Promise.all(server.apps.map((app) => app.drain()));
    });
    return {
      mode,
      operations: operations.map(({ name }) => ({ operation: name, statements: undefined, roundTrips: undefined })),
      idleTimers,
    };
  } finally {
    await server?.close();
  }
}

const show = (count: Count) => (count === undefined ? "-" : String(count));

/** Renders one mode's table; database round trips are counted on Postgres only, so only hosted shows them. */
export function formatTable(counters: ModeCounters): string {
  const columns = counters.mode === "hosted" ? ["Statements", "Round trips"] : ["Statements"];
  const width = Math.max(24, ...counters.operations.map(({ operation }) => operation.length + 2));
  const header = "Operation".padEnd(width) + columns.map((column) => column.padStart(12)).join("");
  const rows = counters.operations.map((row) => {
    const cells = counters.mode === "hosted" ? [row.statements, row.roundTrips] : [row.statements];
    return row.operation.padEnd(width) + cells.map((cell) => show(cell).padStart(12)).join("");
  });
  if (rows.length === 0) rows.push("(no operations yet)");
  const idle = "Timers armed when idle".padEnd(width) + String(counters.idleTimers).padStart(12);
  return [counters.mode, header, ...rows, idle].join("\n");
}
