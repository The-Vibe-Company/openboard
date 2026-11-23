import { expect, test } from "bun:test";
import { decideInvitation, previewInvite } from "../../src/orgs/invite.ts";

test("a link expires seven days after creation and normalizes the email restriction", () => {
  const now = 1_700_000_000_000;
  const { invitation, expiresAt } = decideInvitation(
    { role: "admin", email: "Ada@Example.com" },
    { id: "fixture", by: "ada", now },
  );
  expect(expiresAt - now).toBe(604_800_000);
  expect(invitation.email).toBe("ada@example.com");
  const record = { orgName: "Acme", role: invitation.role, expiresAt, used: false };
  expect(previewInvite(record, expiresAt - 1)).toEqual({
    orgName: "Acme",
    role: "admin",
    expiresAt: invitation.expiresAt,
  });
  expect(() => previewInvite(record, expiresAt)).toThrow("this invitation is no longer available");
  expect(() => previewInvite({ ...record, used: true }, now)).toThrow("this invitation is no longer available");
});
