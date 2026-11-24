import { expect, test } from "bun:test";
import type { Author, Permission } from "@openboard/contract";
import { decideCreateTask } from "../../src/index.ts";
import { requireTaskOwner } from "../../src/tasks/ownership.ts";

const maker = { actor: "agents+fixer-1", principal: "agents", profile: "fixer-1" };
const { task } = decideCreateTask({ head: 0 }, { channel: "dev", text: "work" }, { by: maker, now: 0 });

const principal = { actor: "agents", principal: "agents", profile: null };
const sibling = { actor: "agents+fixer-2", principal: "agents", profile: "fixer-2" };
const collision = { actor: maker.actor, principal: maker.actor, profile: null };

const cases: readonly [string, Author, readonly Permission[], boolean][] = [
  ["maker can post", maker, ["post"], true],
  ["principal can label", principal, ["label"], true],
  ["sibling can write but did not make the task", sibling, ["post", "label"], false],
  ["another principal's actor ID matches", collision, ["label"], false],
  ["maker can only read", maker, ["read"], false],
  ["caller can manage the channel", sibling, ["manage"], true],
];

test.each(cases)("%s", (_name, by, permissions, allowed) => {
  const authorize = () => requireTaskOwner(task, by, permissions);
  if (allowed) expect(authorize).not.toThrow();
  else expect(authorize).toThrow(expect.objectContaining({ code: "task_not_owned" }));
});
