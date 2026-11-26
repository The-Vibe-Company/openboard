import { expect, test } from "bun:test";
import { decideInvitation, orgs } from "@openboard/core";
import type { OrgScope } from "../../src/index.ts";
import type { OpenStore } from "../index.ts";

export function invitationsSuite(driver: string, open: OpenStore): void {
  issueAndJoin(driver, open);
  joinAnotherOrganization(driver, open);
  revokeLink(driver, open);
  refuseUsedOrExpired(driver, open);
}

function issueAndJoin(driver: string, open: OpenStore): void {
  test(`${driver}: an administrator issues an invitation and the recipient joins its organization`, async () => {
    const store = await open();
    try {
      const platform = store.platform();
      const at = 1_700_000_000_000;
      const personId = `u_${"a".repeat(16)}`;
      const by = `ob:user:${personId}`;
      await platform.signIn({
        identity: {
          provider: "github",
          subject: "ada",
          login: "ada",
          name: "Ada",
          email: null,
          avatar: "https://example.com/ada.png",
        },
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
        {
          principal: by,
          role: "owner",
          profile: { handle: "ada", name: "Ada", avatar: "https://example.com/ada.png" },
        },
        { principal: `ob:user:${recipient}`, role: "member", profile: { handle: "lin", name: "Lin", avatar: null } },
      ]);
      expect(await platform.orgMembership("local", recipient)).toBeNull();
      expect(await platform.invitationPreview(tokenHash)).toMatchObject({ used: true });
    } finally {
      await store.close();
    }
  });
}

function joinAnotherOrganization(driver: string, open: OpenStore): void {
  test(`${driver}: an existing member leaves a link pending for someone from another organization`, async () => {
    const store = await open();
    try {
      const platform = store.platform();
      const at = 1_700_000_000_000;
      const owner = async (letter: string, slug: string) => {
        const personId = `u_${letter.repeat(16)}`;
        await platform.signIn({
          identity: { provider: "github", subject: slug, login: slug, name: slug, email: null, avatar: null },
          admitNew: true,
          newPersonId: personId,
          session: { idHash: letter.repeat(64), csrf: "fixture", expiresAt: at + 86_400_000 },
          now: at,
        });
        const by = `ob:user:${personId}`;
        await platform.createOrg({ ...orgs.decideCreate({ name: slug, slug }, { by, now: at }), now: at, personId });
        return { personId, by };
      };
      const acme = await owner("a", "acme");
      const beta = await owner("b", "beta");
      const membership = await platform.orgMembership("acme", acme.personId);
      if (!membership) throw new Error("expected the organization's owner");
      const org = store.org({ orgId: membership.orgId } as OrgScope);
      const betaMembership = await platform.orgMembership("beta", beta.personId);
      if (!betaMembership) throw new Error("expected beta's owner");
      const betaOrg = store.org({ orgId: betaMembership.orgId } as OrgScope);
      const link = async (letter: string, createdAt: number) => {
        const record = decideInvitation(
          { role: "member", email: "guest@example.com" },
          { by: acme.by, id: `inv_${letter.repeat(16)}`, now: createdAt },
        );
        const tokenHash = new Uint8Array(32).fill(letter.charCodeAt(0));
        expect(await org.createInvitation({ ...record, personId: acme.personId, at: createdAt, tokenHash })).toBe(true);
        return { ...record, tokenHash };
      };
      const expired = await link("z", at);
      const pending = await link("a", at + 1);
      const revoked = await link("b", at + 1);
      const newer = await link("c", at + 2);
      const tied = await link("d", at + 2);
      expect(await org.revokeInvitation(revoked.invitation.id, acme.personId, at + 3)).toBe("revoked");
      expect(await org.listInvitations(expired.expiresAt)).toEqual([
        tied.invitation,
        newer.invitation,
        pending.invitation,
      ]);
      expect(await betaOrg.listInvitations(at + 3)).toEqual([]);

      const record = decideInvitation({ role: "member" }, { by: acme.by, id: `inv_${"e".repeat(16)}`, now: at });
      const tokenHash = new Uint8Array(32).fill(9);
      expect(await org.createInvitation({ ...record, personId: acme.personId, at, tokenHash })).toBe(true);
      await expect(platform.acceptInvitation(tokenHash, acme.personId, at + 1)).rejects.toMatchObject({
        code: "already_in_org",
        message: "you already belong to this organization",
      });
      expect(await platform.invitationPreview(tokenHash)).toMatchObject({ used: false });
      expect(await platform.acceptInvitation(tokenHash, beta.personId, at + 1)).toEqual({
        org: { slug: "acme", name: "acme" },
        role: "member",
      });
      expect(await platform.memberships(beta.personId)).toEqual([
        { org: { slug: "acme", name: "acme" }, role: "member" },
        { org: { slug: "beta", name: "beta" }, role: "owner" },
      ]);
      expect(await org.listInvitations(at + 3)).toEqual([
        tied.invitation,
        newer.invitation,
        pending.invitation,
        expired.invitation,
      ]);
    } finally {
      await store.close();
    }
  });
}

function revokeLink(driver: string, open: OpenStore): void {
  test(`${driver}: an administrator revokes a link, which then admits no one`, async () => {
    const store = await open();
    try {
      const platform = store.platform();
      const at = 1_700_000_000_000;
      const join = async (letter: string, login: string) => {
        const personId = `u_${letter.repeat(16)}`;
        await platform.signIn({
          identity: { provider: "github", subject: login, login, name: login, email: null, avatar: null },
          admitNew: true,
          newPersonId: personId,
          session: { idHash: letter.repeat(64), csrf: "fixture", expiresAt: at + 86_400_000 },
          now: at,
        });
        return personId;
      };
      const owner = await join("a", "ada");
      const by = `ob:user:${owner}`;
      await platform.createOrg({
        ...orgs.decideCreate({ name: "Acme", slug: "acme" }, { by, now: at }),
        now: at,
        personId: owner,
      });
      const membership = await platform.orgMembership("acme", owner);
      if (!membership) throw new Error("expected the organization's owner");
      const org = store.org({ orgId: membership.orgId } as OrgScope);
      const id = `inv_${"a".repeat(16)}`;
      const tokenHash = new Uint8Array(32).fill(11);
      const record = decideInvitation({ role: "member" }, { by, id, now: at });
      expect(await org.createInvitation({ ...record, personId: owner, at, tokenHash })).toBe(true);
      const recipient = await join("b", "lin");
      expect(await org.revokeInvitation(id, recipient, at + 1)).toBe("not_admin");
      expect(await store.org({ orgId: membership.orgId + 1 } as OrgScope).revokeInvitation(id, owner, at + 1)).toBe(
        "not_admin",
      );
      expect(await org.revokeInvitation(`inv_${"b".repeat(16)}`, owner, at + 1)).toBe("not_found");
      expect(await platform.invitationPreview(tokenHash)).toMatchObject({ used: false });
      expect(await org.revokeInvitation(id, owner, at + 1)).toBe("revoked");
      expect(await org.revokeInvitation(id, owner, at + 2)).toBe("used");
      expect(await platform.invitationPreview(tokenHash)).toMatchObject({ used: true });
      const refused = platform.acceptInvitation(tokenHash, recipient, at + 3);
      await expect(refused).rejects.toMatchObject({ code: "invitation_used" });
      expect(await org.listMembers()).toEqual([
        { principal: by, role: "owner", profile: { handle: "ada", name: "ada", avatar: null } },
      ]);
    } finally {
      await store.close();
    }
  });
}

/** docs/auth.md "Invitations": a link admits one person, for seven days. */
function refuseUsedOrExpired(driver: string, open: OpenStore): void {
  test(`${driver}: an accepted or seven-day-old link admits no one`, async () => {
    const store = await open();
    try {
      const platform = store.platform();
      const at = 1_700_000_000_000;
      const join = async (letter: string) => {
        const personId = `u_${letter.repeat(16)}`;
        await platform.signIn({
          identity: { provider: "github", subject: letter, login: letter, name: letter, email: null, avatar: null },
          admitNew: true,
          newPersonId: personId,
          session: { idHash: letter.repeat(64), csrf: "fixture", expiresAt: at + 86_400_000 },
          now: at,
        });
        return personId;
      };
      const owner = await join("a");
      const by = `ob:user:${owner}`;
      await platform.createOrg({
        ...orgs.decideCreate({ name: "Acme", slug: "acme" }, { by, now: at }),
        now: at,
        personId: owner,
      });
      const membership = await platform.orgMembership("acme", owner);
      if (!membership) throw new Error("expected the organization's owner");
      const org = store.org({ orgId: membership.orgId } as OrgScope);
      const link = async (letter: string, fill: number) => {
        const record = decideInvitation({ role: "member" }, { by, id: `inv_${letter.repeat(16)}`, now: at });
        const tokenHash = new Uint8Array(32).fill(fill);
        expect(await org.createInvitation({ ...record, personId: owner, at, tokenHash })).toBe(true);
        return { tokenHash, expiresAt: record.expiresAt };
      };
      const used = await link("c", 13);
      const first = await join("b");
      expect(await platform.acceptInvitation(used.tokenHash, first, at + 1)).toMatchObject({ role: "member" });
      const second = await join("d");
      await expect(platform.acceptInvitation(used.tokenHash, second, at + 2)).rejects.toMatchObject({
        code: "invitation_used",
      });
      await expect(platform.acceptInvitation(used.tokenHash, first, at + 2)).rejects.toMatchObject({
        code: "invitation_used",
      });
      const stale = await link("e", 15);
      await expect(platform.acceptInvitation(stale.tokenHash, second, stale.expiresAt)).rejects.toMatchObject({
        code: "invitation_used",
      });
      expect(await platform.acceptInvitation(stale.tokenHash, second, stale.expiresAt - 1)).toMatchObject({
        role: "member",
      });
      expect(await org.listMembers()).toEqual([
        { principal: by, role: "owner", profile: { handle: "a", name: "a", avatar: null } },
        { principal: `ob:user:${first}`, role: "member", profile: { handle: "b", name: "b", avatar: null } },
        { principal: `ob:user:${second}`, role: "member", profile: { handle: "d", name: "d", avatar: null } },
      ]);
    } finally {
      await store.close();
    }
  });
}
