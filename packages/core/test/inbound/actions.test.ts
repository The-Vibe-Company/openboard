import { expect, test } from "bun:test";
import { decideCreateTask, parseInboundRules, renderInboundAction, validateInboundActions } from "../../src/index.ts";

test("renders task reasons against the root and enforces the task route's character limit", () => {
  const { task } = decideCreateTask(
    { head: 1 },
    { channel: "work/tasks", text: "Task root" },
    { by: { actor: "owner", principal: "owner", profile: null }, now: 0 },
  );
  const plan = parseInboundRules([
    { when: {}, do: [{ "task.block": { kind: "human", reason: "{{thread.text}}{{body.detail}}" } }] },
  ]);
  validateInboundActions(plan);
  const action = plan[0]?.do[0];
  if (!action) throw new Error("missing action");
  const suffix = "🚦".repeat(991);
  expect(renderInboundAction(action, { detail: suffix }, task)).toEqual({
    permission: "manage",
    action: "task.block",
    input: { id: task.id, kind: "human", reason: `Task root${suffix}` },
  });
  expect(() => renderInboundAction(action, { detail: `${suffix}🚦` }, task)).toThrow(
    expect.objectContaining({ code: "invalid_request" }),
  );
});

test("renders task expiry as a manage action on the root", () => {
  const { task } = decideCreateTask(
    { head: 1 },
    { channel: "work/tasks", text: "Task root" },
    { by: { actor: "owner", principal: "owner", profile: null }, now: 0 },
  );
  const plan = parseInboundRules([{ when: {}, do: [{ "task.expire": {} }] }]);
  validateInboundActions(plan);
  const action = plan[0]?.do[0];
  if (!action) throw new Error("missing action");
  expect(renderInboundAction(action, {}, task)).toEqual({
    permission: "manage",
    action: "task.expire",
    input: { id: task.id },
  });
});

test("still refuses the unsupported agents.revoke action", () => {
  const plan = parseInboundRules([{ when: {}, do: [{ "agents.revoke": { connection: "runner", profile: "test" } }] }]);
  expect(() => validateInboundActions(plan)).toThrow(
    expect.objectContaining({ code: "invalid_rule", message: expect.stringContaining("rules[0].do[0].agents.revoke") }),
  );
});
