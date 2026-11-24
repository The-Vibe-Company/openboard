import { expect, test } from "bun:test";
import type { createInbound, OutputOf } from "@openboard/contract";
import { testScope } from "@openboard/ports/testkit";
import { call, makeApp, NOW } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

const goodRule = { when: {}, do: [{ reply: "ok" }] };
const spec = {
  name: "runner",
  can: { "work/": ["read", "post"] },
  verify: { preset: "ts-id-body", signatureHeader: "X-Sig", timestampHeader: "X-Time", idHeader: "X-Id" },
  thread: { from: "{{body.externalRef}}", pattern: "^ob:(\\d+)$" },
  rules: [goodRule],
};

test("refuses malformed rules with the exact field on create and update", async () => {
  const app = makeApp({ secretKey: new Uint8Array(32) });
  const cases: [unknown[], string][] = [
    [[goodRule, { when: {}, do: [{ post: "no" }] }], "rules[1].do[0].post"],
    [[goodRule, { when: {}, do: [{ reply: {} }] }], "rules[1].do[0].reply"],
    [[{ when: {}, do: [{ "task.block": { kind: "agent" } }] }], "rules[0].do[0].task.block.reason"],
    [[{ when: {}, do: [{ "task.expire": { extra: true } }] }], "rules[0].do[0].task.expire.extra"],
    [[{ ...goodRule, when: { "event.name": "no" } }], "rules[0].when.event.name: expected a condition path"],
    [[{ ...goodRule, when: { "body.event": {} } }], "rules[0].when.body.event: Expected union value"],
    [[{ when: {}, do: [{ label: { unset: [0] } }] }], "rules[0].do[0].label.unset[0]"],
    [[{ when: {}, do: [{ reply: "{{body.summary" }] }], "rules[0].do[0].reply"],
    [[{ when: {}, do: [{ reply: "{{headers.source}}" }] }], "rules[0].do[0].reply"],
    [Array.from({ length: 33 }, () => goodRule), "rules"],
    [[{ when: {}, do: Array.from({ length: 9 }, () => ({ reply: "ok" })) }], "rules[0].do"],
    [[{ when: {}, do: [] }], "rules[0].do"],
  ];
  try {
    const created = await call(app, "POST", "/x/inbound", spec);
    expect(created.status).toBe(201);
    const { inbound } = (await created.json()) as OutputOf<typeof createInbound>;
    const path = `/x/inbound/${inbound.id}`;
    for (const [rules, field] of cases) {
      for (const [url, body] of [
        ["/x/inbound", { ...spec, rules }],
        [path, { rules }],
      ] as const) {
        const response = await call(app, "POST", url, body);
        expect(await response.json()).toMatchObject({
          error: { code: "invalid_rule", message: expect.stringContaining(field) },
        });
        expect(response.status).toBe(400);
      }
    }
    expect(await (await call(app, "GET", path)).json()).toEqual(inbound);
  } finally {
    await app.close();
  }
});

test("refuses invalid thread patterns with a reason during creation", async () => {
  const app = makeApp({ secretKey: new Uint8Array(32) });
  const cases = [
    ["(", "", "unclosed group"],
    ["^ob:[0-9]+$", "", "expected a capturing group"],
    ["(a)\\1", "", "backreferences"],
    ["(?=x)(x)", "", "expected a capturing group"],
    ["(?<=x)(x)", "", "expected a capturing group"],
    ["(x)", "g", "only the i flag"],
    [`(${"a".repeat(199)})`, "", "maximum length is 200 characters"],
    ["(a{1,21})", "", "expected 0 <= n <= m <= 20"],
  ] as const;
  try {
    for (const [pattern, flags, reason] of cases) {
      const response = await call(app, "POST", "/x/inbound", { ...spec, thread: { ...spec.thread, pattern, flags } });
      expect(await response.json()).toMatchObject({
        error: {
          code: "invalid_rule",
          message: expect.stringContaining(`thread.${flags ? "flags" : "pattern"}: ${reason}`),
        },
      });
      expect(response.status).toBe(400);
    }
  } finally {
    await app.close();
  }
});

test("persists compiled plans across updates and keeps them out of public responses", async () => {
  const store = openStore(() => NOW);
  const app = makeApp({ store, secretKey: new Uint8Array(32) });
  try {
    const created = await call(app, "POST", "/x/inbound", spec);
    expect(created.status).toBe(201);
    const { inbound } = (await created.json()) as OutputOf<typeof createInbound>;
    const keys = await store.platform().findBoard("local", "main");
    if (!keys) throw new Error("missing local board");
    const board = store.board(testScope(keys));
    const initial = (await board.inboundEndpoint(inbound.id))?.inbound;
    expect(initial?.threadPlan?.pattern.code.length).toBeGreaterThan(0);
    expect(initial?.rulePlan?.[0]?.do).toEqual([{ reply: ["ok"] }]);

    const rules = [{ when: { "headers.source": "runner" }, do: [{ reply: "{{thread.claim.profile}}" }] }];
    const path = `/x/inbound/${inbound.id}`;
    const updated = await call(app, "POST", path, { rules });
    expect(updated.status).toBe(200);
    const stored = (await board.inboundEndpoint(inbound.id))?.inbound;
    expect(stored?.threadPlan).toEqual(initial?.threadPlan);
    expect(stored?.rulePlan).toEqual([
      {
        when: [{ path: ["headers", "source"], values: ["runner"] }],
        do: [{ reply: [{ path: ["thread", "claim", "profile"] }] }],
      },
    ]);
    const responses = [inbound, await updated.json(), await (await call(app, "GET", path)).json()];
    for (const response of responses) {
      expect(response).not.toHaveProperty("rulePlan");
      expect(response).not.toHaveProperty("threadPlan");
    }
  } finally {
    await app.close();
  }
});
