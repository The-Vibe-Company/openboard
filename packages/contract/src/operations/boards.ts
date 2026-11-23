import { Type } from "@sinclair/typebox";
import { Named, Slug } from "../entities/orgs.ts";
import { defineOperation } from "../operation.ts";

/** Organization routes are relative to `/api/x`; the pipeline takes the organization from `:org` (codebase.md 4.4). */
const OrgParams = Type.Object({ org: Slug });

const why = "It acts for a person signed in with a browser session; the CLI and agents hold board credentials.";

export const listBoards = defineOperation({
  name: "listBoards",
  summary: "List the organization's boards, by slug.",
  route: { method: "GET", path: "/orgs/:org/boards" },
  scope: "org",
  input: { params: OrgParams },
  output: Type.Object({ boards: Type.Array(Named) }),
  errors: ["unauthorized", "forbidden", "not_found"],
  access: { permission: "read", channel: "any" },
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: false,
  why,
  upstream: false,
});

export const createBoard = defineOperation({
  name: "createBoard",
  summary:
    "Create a board in the organization at /api/<org>/<board>, its grant IDs g1 to g3 kept for the seeded grants.",
  route: { method: "POST", path: "/orgs/:org/boards" },
  status: 201,
  scope: "org",
  input: {
    params: OrgParams,
    body: Type.Object(
      { slug: Slug, name: Type.String({ minLength: 1, maxLength: 80 }) },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ board: Named }),
  errors: ["invalid_request", "reserved_slug", "unauthorized", "forbidden", "not_found", "slug_taken"],
  access: { permission: "manage", channel: "any" },
  effects: { readOnly: false, idempotent: false, emits: ["ob.board.created"] },
  cli: false,
  mcp: false,
  why,
  upstream: false,
});
