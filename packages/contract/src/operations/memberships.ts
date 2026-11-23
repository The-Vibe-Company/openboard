import { Type } from "@sinclair/typebox";
import { Role, Slug } from "../entities/orgs.ts";
import { defineOperation, Ref } from "../operation.ts";

export const changeMemberRole = defineOperation({
  name: "changeMemberRole",
  summary: "Change an organization member's role.",
  route: { method: "POST", path: "/orgs/:org/members/:user/role" },
  scope: "org",
  input: {
    params: Type.Object({ org: Slug, user: Ref("member") }),
    body: Type.Object({ role: Role }, { additionalProperties: false }),
  },
  output: Type.Object({ principal: Type.String(), role: Role }),
  errors: ["invalid_request", "not_found", "unauthorized", "forbidden"],
  access: null,
  effects: { readOnly: false, idempotent: true, emits: ["ob.member.role_changed"] },
  cli: false,
  mcp: false,
  why: "An organization administrator changes roles with a browser session.",
  upstream: false,
});
