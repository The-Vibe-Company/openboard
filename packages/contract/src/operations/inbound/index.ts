import { Type } from "@sinclair/typebox";
import { Inbound, InboundSpec } from "../../entities/inbound/index.ts";
import { defineOperation, Ref } from "../../operation.ts";

const common = {
  scope: "board",
  upstream: false,
  access: { permission: "manage", channel: "some" },
  mcp: false,
  why: "Inbound endpoint configuration is a board administration command.",
} as const;
const params = Type.Object({ id: Ref("inbound") });
const read = { readOnly: true, idempotent: true, emits: [] } as const;
const errors = ["not_found", "forbidden"] as const;

export const createInbound = defineOperation({
  ...common,
  name: "createInbound",
  summary: "Create an inbound endpoint and return a generated verify secret once.",
  route: { method: "POST", path: "/x/inbound" },
  input: { body: InboundSpec },
  output: Type.Object({ inbound: Inbound, secret: Type.Optional(Type.String()) }),
  status: 201,
  invalidBodyItemCode: { array: "rules", code: "invalid_rule" },
  errors: [
    "forbidden",
    "invalid_request",
    "invalid_rule",
    "invalid_signing",
    "invalid_grant",
    "quota_exceeded",
    "not_supported",
    "slug_taken",
    "grant_lockout",
  ],
  effects: { readOnly: false, idempotent: false, emits: ["ob.inbound.created", "ob.grant.created"] },
  cli: false,
  why: "The CLI writes the verify secret to a private file.",
});

export const listInbound = defineOperation({
  ...common,
  name: "listInbound",
  summary: "List manageable inbound endpoints.",
  route: { method: "GET", path: "/x/inbound" },
  input: {},
  output: Type.Object({ inbound: Type.Array(Inbound) }),
  errors: ["forbidden"],
  effects: read,
  cli: { command: ["inbound"], args: [] },
});

export const getInbound = defineOperation({
  ...common,
  name: "getInbound",
  summary: "Show an inbound endpoint without its verify secret.",
  route: { method: "GET", path: "/x/inbound/:id" },
  input: { params },
  output: Inbound,
  errors,
  effects: read,
  cli: { command: ["inbound", "show"], args: ["id"] },
});

export const updateInbound = defineOperation({
  ...common,
  name: "updateInbound",
  summary: "Replace the rules on an inbound endpoint.",
  route: { method: "POST", path: "/x/inbound/:id" },
  input: { params, body: Type.Object({ rules: InboundSpec.properties.rules }, { additionalProperties: false }) },
  output: Inbound,
  invalidBodyItemCode: { array: "rules", code: "invalid_rule" },
  errors: [...errors, "invalid_rule", "invalid_request"],
  effects: { readOnly: false, idempotent: false, emits: ["ob.inbound.updated"] },
  cli: false,
  why: "The endpoint update is available through the API.",
});

export const deleteInbound = defineOperation({
  ...common,
  name: "deleteInbound",
  summary: "Delete an inbound endpoint and its grant.",
  route: { method: "POST", path: "/x/inbound/:id/delete" },
  input: { params },
  output: Type.Object({ id: Type.String() }),
  errors: [...errors, "grant_lockout"],
  effects: { readOnly: false, idempotent: false, emits: ["ob.inbound.deleted", "ob.grant.revoked"] },
  cli: { command: ["inbound", "delete"], args: ["id"] },
});
