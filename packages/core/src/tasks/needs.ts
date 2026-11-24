import { BoardError, type Message } from "@openboard/contract";
import { parseId } from "../ids.ts";

export interface TaskNeeds {
  readonly ids: readonly number[];
  readonly waitingOn: number;
}

export function needPositions(needs: readonly string[], self?: number | null): number[] {
  const positions = new Set<number>();
  for (const need of needs) {
    const id = parseId(need);
    if (id === null || id === self) invalidNeed(need);
    positions.add(id);
  }
  return [...positions];
}

function invalidNeed(id: string): never {
  throw new BoardError("invalid_needs", `#${id} must name another task you can read.`);
}

export function checkNeeds(
  ids: readonly number[],
  roots: readonly Message[],
  canRead: (root: Message) => boolean,
): TaskNeeds {
  const byId = new Map(roots.map((root) => [Number(root.id), root]));
  let waitingOn = 0;
  for (const id of ids) {
    const root = byId.get(id);
    if (!root?.task || root.deleted || !canRead(root)) invalidNeed(String(id));
    if (root.task.state !== "completed") waitingOn++;
  }
  return { ids, waitingOn };
}
