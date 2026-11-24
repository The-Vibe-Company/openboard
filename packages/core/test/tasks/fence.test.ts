import { expect, test } from "bun:test";
import type { Message } from "@openboard/contract";
import { decideClaimTask, decideCreateTask } from "../../src/index.ts";
import { requireHeldTask } from "../../src/tasks/fence.ts";

const now = 1_700_000_000_000;
const by = { actor: "agent", principal: "agent", profile: null };
const { task: ready } = decideCreateTask({ head: 0 }, { channel: "dev", text: "work" }, { by, now });
const { task: claimed, claim } = decideClaimTask(
  { head: ready.version, target: ready },
  { id: ready.id, tokenHash: "test hash" },
  { by, now },
);
const proof = { tokenMatches: true, until: now + 900_000 };

test("the fence accepts the current matching claim until the lease deadline", () => {
  expect<Message>(requireHeldTask(claimed, proof, ready.id, claim.epoch, proof.until - 1)).toEqual(claimed);
});

test.each([
  ["missing message", null, proof, claim.epoch, now, "message_not_found"],
  ["non-task message", { ...ready, task: undefined }, proof, claim.epoch, now, "not_a_task"],
  ["deleted task", { ...claimed, deleted: true }, proof, claim.epoch, now, "not_a_task"],
  ["ready task", ready, proof, claim.epoch, now, "claim_lost"],
  ["missing proof", claimed, null, claim.epoch, now, "claim_lost"],
  ["wrong hash", claimed, { ...proof, tokenMatches: false }, claim.epoch, now, "claim_lost"],
  ["older epoch", claimed, proof, claim.epoch - 1, now, "claim_lost"],
  ["lease deadline", claimed, proof, claim.epoch, proof.until, "claim_lost"],
  ["elapsed lease", claimed, proof, claim.epoch, proof.until + 1, "claim_lost"],
] as const)("the fence rejects %s", (_case, target, evidence, epoch, at, code) => {
  expect(() => requireHeldTask(target, evidence, ready.id, epoch, at)).toThrow(expect.objectContaining({ code }));
});
