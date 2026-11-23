import { expect, test } from "bun:test";
import { decideInvitation, orgs } from "@openboard/core";
import type { OrgScope } from "../../src/index.ts";
import type { OpenStore } from "../index.ts";

export function invitationsSuite(driver: string, open: OpenStore): void {
  test(`${driver}: an administrator issues an invitation and the recipient joins its organization`, async () => {
    const store = await open();
    try {
      const platform = store.platform();
      const at = 1_700_000_000_000;
      const personId = `u_${"a".repeat(16)}`;
      const by = `ob:user:${personId}`;
      await platform.signIn({
        identity: { provider: "github", subject: "ada", login: "ada", name: "Ada", email: null, avatar: null },
        admitNew: true,
        newPersonId: personId,
        session: { idHash: "a".repeat(64), csrf: "fixture", expiresAt: at + 86_400_000 },
        now: at,
      });
      await platform.createOrg({
        ...orgs.decideCreate({ name: "Acme", slug: "acme" }, { by, now: at }),
        now: at,
        personId,
      });
      const membership = await platform.orgMembership("acme", personId);
      if (!membership) throw new Error("expected the organization's owner");
      const id = `inv_${"a".repeat(16)}`;
      const record = decideInvitation({ role: "member" }, { by, id, now: at });
      const tokenHash = new Uint8Array(32).fill(7);
      const input = { ...record, personId, at, tokenHash };
      expect(await platform.orgMembership("local", personId)).toBeNull();
      expect(await store.org({ orgId: membership.orgId + 1 } as OrgScope).createInvitation(input)).toBe(false);
      expect(await platform.invitationPreview(tokenHash)).toBeNull();
      expect(await store.org({ orgId: membership.orgId } as OrgScope).createInvitation(input)).toBe(true);
      expect(await platform.invitationPreview(tokenHash)).toEqual({
        orgName: "Acme",
        role: "member",
        expiresAt: record.expiresAt,
        used: false,
      });
      const recipient = `u_${"b".repeat(16)}`;
      await platform.signIn({
        identity: { provider: "github", subject: "lin", login: "lin", name: "Lin", email: null, avatar: null },
        admitNew: true,
        newPersonId: recipient,
        session: { idHash: "b".repeat(64), csrf: "fixture", expiresAt: at + 86_400_000 },
        now: at,
      });
      expect(await platform.acceptInvitation(tokenHash, recipient, at + 1)).toEqual({
        org: { slug: "acme", name: "Acme" },
        role: "member",
      });
      const org = store.org({ orgId: membership.orgId } as OrgScope);
      expect(await org.listMembers()).toEqual([
        { principal: by, role: "owner" },
        { principal: `ob:user:${recipient}`, role: "member" },
      ]);
      expect(await platform.orgMembership("local", recipient)).toBeNull();
      expect(await platform.invitationPreview(tokenHash)).toMatchObject({ used: true });
    } finally {
      await store.close();
    }
  });
}
