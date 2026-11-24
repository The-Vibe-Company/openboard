import { expect, test } from "bun:test";
import {
  decideCreateTask,
  inboundActionNeedsThread,
  parseInboundRules,
  renderInboundAction,
  renderInboundRevoke,
  validateInboundActions,
} from "../../src/index.ts";

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

test("only thread-based revoke profiles require a thread", () => {
  const connection = "cn_abcdefghijklmnop";
  const [rule] = parseInboundRules([
    {
      when: {},
      do: [
        { "agents.revoke": { connection, profile: "{{body.profile}}" } },
        { "agents.revoke": { connection, profile: "{{thread.claim.profile}}" } },
      ],
    },
  ]);
  const [fromBody, fromThread] = rule?.do ?? [];
  if (!fromBody || !("agents.revoke" in fromBody) || !fromThread) throw new Error("missing actions");
  expect(inboundActionNeedsThread(fromBody)).toBe(false);
  expect(inboundActionNeedsThread(fromThread)).toBe(true);
  expect(renderInboundRevoke(fromBody, { profile: "Worker-1" })).toEqual({ connection, profile: "Worker-1" });
  expect(renderInboundRevoke(fromBody, { profile: "worker\0other" })).toEqual({ connection, profile: null });
});

test("rejects a templated revoke connection so a delivery cannot pick a different connection", () => {
  expect(() =>
    parseInboundRules([
      { when: {}, do: [{ "agents.revoke": { connection: "{{body.connection}}", profile: "worker" } }] },
    ]),
  ).toThrow(
    expect.objectContaining({
      code: "invalid_rule",
      message: expect.stringContaining("rules[0].do[0].agents.revoke.connection"),
    }),
  );
});
