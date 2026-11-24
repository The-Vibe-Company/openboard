import { type Actor, BoardError, type Message } from "@openboard/contract";

interface ClaimProof {
  readonly tokenMatches: boolean;
  readonly until: number;
}

export interface HeldTaskState {
  readonly head: number;
  readonly target: Message | null;
  readonly actor: Actor | null;
  readonly proof: ClaimProof | null;
}

export function requireHeldTask(
  target: Message | null,
  proof: ClaimProof | null,
  id: string,
  epoch: number,
  now: number,
) {
  if (!target) throw new BoardError("message_not_found", `Couldn't find message #${id}.`);
  const { task } = target;
  if (!task || target.deleted) throw new BoardError("not_a_task", `#${id} is not a task.`);
  if (task.state !== "claimed" || task.epoch !== epoch || !task.claim || !proof?.tokenMatches || !(proof.until > now)) {
    throw new BoardError("claim_lost", `This claim on #${id} is over: claim it again.`);
  }
  return { ...target, task: { ...task, claim: task.claim } };
}
