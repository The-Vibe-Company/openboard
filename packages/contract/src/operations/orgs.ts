import { Type } from "@sinclair/typebox";
import { CreatedOrg, DeletedOrg, Slug } from "../entities/orgs.ts";
import { defineOperation } from "../operation.ts";

/** Routes are relative to `/api/x` (docs/codebase.md 4.1). */
export const createOrg = defineOperation({
  name: "createOrg",
  summary: "Create an organization: the signed-in person becomes its owner, and it gets the board main.",
  route: { method: "POST", path: "/orgs" },
  status: 201,
  scope: "account",
  input: {
    body: Type.Object(
      { name: Type.String({ minLength: 1, maxLength: 80 }), slug: Type.Union([Slug, Type.Literal("x")]) },
      { additionalProperties: false },
    ),
  },
  output: CreatedOrg,
  errors: ["invalid_request", "unauthorized", "forbidden", "reserved_slug", "slug_taken", "rate_limited"],
  access: null,
  effects: { readOnly: false, idempotent: false, emits: ["ob.org.created", "ob.board.created"] },
  cli: false,
  mcp: false,
  why: "It acts for a person signed in with a browser session; the CLI and agents hold board credentials.",
  upstream: false,
});

export const deleteOrg = defineOperation({
  name: "deleteOrg",
  summary: "Soft-delete an organization as its owner and retain its data for 30 days.",
  route: { method: "POST", path: "/orgs/:org/delete" },
  scope: "org",
  input: { params: Type.Object({ org: Slug }) },
  output: DeletedOrg,
  errors: ["unauthorized", "forbidden", "not_found"],
  access: null,
  effects: { readOnly: false, idempotent: false, emits: ["ob.org.deleted"] },
  cli: false,
  mcp: false,
  why: "Only an organization owner signed in with a browser session can delete it.",
  upstream: false,
});
