import { expect, test } from "bun:test";
import { AuditEvent, Event, operations, OrgAuditEvent, OrgExportAuditEvent } from "@openboard/contract";
import { exportEvent } from "../../src/orgs/export.ts";

test("every event payload is scrubbed recursively without changing its other fields", () => {
  const payload = {
    name: "worker",
    tokenHash: "fixture",
    nested: [{ preserved: [null, 3, "text"], private_key: "fixture", options: { signingSecret: "fixture" } }],
  };
  const event = { id: 17, type: "an.unknown.event", payload };
  expect(exportEvent(event)).toEqual({
    id: 17,
    type: "an.unknown.event",
    payload: { name: "worker", nested: [{ preserved: [null, 3, "text"], options: {} }] },
  });
  expect(payload.nested[0]?.private_key).toBe("fixture");
});

test("redacted grant predicates and channel overrides cannot widen access", () => {
  const claim = { kind: "oidc", claims: { sub: "worker", session: "fixture" } };
  const can = { "*": ["read"], secret: [] };
  const grant = { id: 5, principals: [claim], can };
  const redacted = exportEvent({ type: "ob.connection.created", payload: { grant, connection: { can } } });
  expect(redacted).toEqual({
    type: "ob.connection.created",
    payload: {
      grant: { id: 5, principals: [{ kind: "oidc", claims: { sub: "worker" } }], can: {}, recreate: true },
      connection: { can: {} },
    },
  });
});

const credentialLike =
  /secret|token|password|credential|session|cookie|csrf|authorization|(?:private|signing|claim)[_-]?key|key[_-]?material|jwks?|(?:id|previous|prev)[_-]?hash/i;

/** Walk property declarations inside unions, intersections, arrays, and records. */
function credentialNames(schema: unknown): string[] {
  if (Array.isArray(schema)) return schema.flatMap(credentialNames);
  if (!schema || typeof schema !== "object") return [];
  return Object.entries(schema).flatMap(([key, value]) => [
    ...(key === "properties" && value && typeof value === "object"
      ? Object.keys(value).filter((name) => credentialLike.test(name))
      : []),
    ...credentialNames(value),
  ]);
}

test("every declared contract event type strips its credential-like payload fields", () => {
  const declared = new Map<string, string[]>();
  for (const schema of [Event, AuditEvent, OrgAuditEvent, OrgExportAuditEvent]) {
    for (const variant of schema.anyOf) {
      const { type, payload } = variant.properties;
      const names = declared.get(type.const) ?? [];
      declared.set(type.const, [...names, ...credentialNames(payload)]);
    }
  }
  for (const type of operations.flatMap(({ effects }) => effects.emits)) {
    if (!declared.has(type)) declared.set(type, []);
  }
  for (const [type, names] of declared) {
    const record = Object.fromEntries([...names, "tokenHash", "signingSecret"].map((name) => [name, "fixture"]));
    expect(exportEvent({ type, payload: { envelope: [record] } }), type).toEqual({
      type,
      payload: { envelope: [{}] },
    });
  }
});
