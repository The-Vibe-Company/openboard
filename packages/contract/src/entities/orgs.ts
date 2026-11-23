import { type Static, Type } from "@sinclair/typebox";
import { Person } from "./accounts.ts";

/** A person's role in an organization (docs/auth.md "Organizations, boards, people"). */
export const Role = Type.Union([Type.Literal("owner"), Type.Literal("admin"), Type.Literal("member")]);
export type Role = Static<typeof Role>;

/** Organization and board slugs (docs/protocol.md "Slugs"). */
export const Slug = Type.String({ pattern: "^[a-z0-9][a-z0-9-]{1,38}$" });

/** An organization or a board: its slug, which its URLs carry, and its display name. */
export const Named = Type.Object({ slug: Type.String(), name: Type.String() });
export type Named = Static<typeof Named>;

/** A person's membership of an organization, as `GET /api/x/me` lists it. */
export const Membership = Type.Object({ org: Named, role: Role });
export type Membership = Static<typeof Membership>;

/** What creating an organization made, in one transaction: the organization, its owner, and its board `main`. */
export const CreatedOrg = Type.Object({
  org: Named,
  membership: Type.Object({
    /** `ob:user:u_<base32>`: the person who created the organization. */
    principal: Type.String(),
    role: Role,
  }),
  board: Named,
});
export type CreatedOrg = Static<typeof CreatedOrg>;

/** The signed-in person and the organizations they belong to, with their role in each. */
export const Account = Type.Object({ person: Person, memberships: Type.Array(Membership) });
export type Account = Static<typeof Account>;
