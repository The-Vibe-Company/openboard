import { expect, test } from "bun:test";
import { decideInvitation, orgs } from "@openboard/core";
import type { OrgScope, PlatformView } from "../../src/index.ts";
import type { OpenStore } from "../index.ts";

const at = 1_700_000_000_000;

async function signIn(platform: PlatformView, login: string) {
  const personId = `u_${login}`;
  await platform.signIn({
    identity: { provider: "github", subject: login, login, name: login, email: null, avatar: null },
    admitNew: true,
    newPersonId: personId,
    session: { idHash: login.charCodeAt(0).toString(16).repeat(32), csrf: "fixture", expiresAt: at + 86_400_000 },
    now: at,
  });
  return personId;
}

async function createOrg(platform: PlatformView, slug: string, personId: string): Promise<OrgScope> {
  const by = `ob:user:${personId}`;
  await platform.createOrg({ ...orgs.decideCreate({ name: slug, slug }, { by, now: at }), personId, now: at });
  const membership = await platform.orgMembership(slug, personId);
  if (!membership) throw new Error("expected the organization's owner");
  return { orgId: membership.orgId } as OrgScope;
}

export function membershipsSuite(driver: string, open: OpenStore): void {
  test(`${driver}: organization role changes stay within the organization and require current admin rights`, async () => {
    const store = await open();
    try {
      const platform = store.platform();
      const owner = await signIn(platform, "ada");
      const member = await signIn(platform, "lin");
      const outsider = await signIn(platform, "mei");
      const acme = store.org(await createOrg(platform, "acme", owner));
      const other = store.org(await createOrg(platform, "other", outsider));

      const tokenHash = new Uint8Array(32).fill(7);
      const invitation = decideInvitation(
        { role: "member" },
        { by: `ob:user:${owner}`, id: `inv_${"a".repeat(16)}`, now: at },
      );
      expect(await acme.createInvitation({ ...invitation, personId: owner, tokenHash, at })).toBe(true);
      expect(await platform.acceptInvitation(tokenHash, member, at + 1)).toMatchObject({ role: "member" });

      const change = { personId: owner, targetId: member, role: "admin", at: at + 2 } as const;
      expect(await acme.changeMemberRole({ ...change, targetId: outsider })).toBeNull();
      expect(await other.listMembers()).toEqual([
        { principal: `ob:user:${outsider}`, role: "owner", profile: { handle: "mei", name: "mei", avatar: null } },
      ]);
      await expect(acme.changeMemberRole({ ...change, personId: member })).rejects.toMatchObject({ code: "forbidden" });
      expect(await acme.changeMemberRole(change)).toEqual({ principal: `ob:user:${member}`, role: "admin" });
      expect(await platform.orgMembership("acme", member)).toMatchObject({ role: "admin" });

      const demoteOwner = { ...change, targetId: owner };
      await expect(acme.changeMemberRole(demoteOwner)).rejects.toMatchObject({ code: "last_owner" });
      await acme.changeMemberRole({ ...change, role: "owner" });
      const demotions = await Promise.allSettled([
        acme.changeMemberRole(demoteOwner),
        acme.changeMemberRole({ ...change, personId: member }),
      ]);
      expect(demotions.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(demotions).toContainEqual({ status: "rejected", reason: expect.objectContaining({ code: "last_owner" }) });
      expect((await acme.listMembers()).filter(({ role }) => role === "owner")).toHaveLength(1);

      const currentOwner = (await platform.orgMembership("acme", owner))?.role === "owner" ? owner : member;
      const currentAdmin = currentOwner === owner ? member : owner;
      const remove = { personId: currentAdmin, targetId: currentAdmin, at: at + 3 };
      expect(await acme.removeMember({ ...remove, targetId: outsider })).toBeNull();
      await acme.changeMemberRole({ ...change, personId: currentOwner, targetId: currentAdmin, role: "owner" });
      const changes = await Promise.allSettled([
        acme.removeMember(remove),
        acme.changeMemberRole({ ...change, personId: currentOwner, targetId: currentOwner }),
      ]);
      expect(changes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(changes).toContainEqual({ status: "rejected", reason: expect.objectContaining({ code: "last_owner" }) });
      expect((await acme.listMembers()).filter(({ role }) => role === "owner")).toHaveLength(1);
      expect(await other.listMembers()).toEqual([
        { principal: `ob:user:${outsider}`, role: "owner", profile: { handle: "mei", name: "mei", avatar: null } },
      ]);
    } finally {
      await store.close();
    }
  });
}
