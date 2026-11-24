import { BoardError } from "@openboard/contract";
import type { PlatformView, SignInRecord } from "@openboard/ports";
import { hashToken } from "../secrets.ts";

function invitationError(error: unknown) {
  if (!(error instanceof BoardError)) throw error;
  switch (error.code) {
    case "forbidden":
      // The sign-up transaction uses forbidden when the invitation cannot be found.
      return "not_found";
    case "already_in_org":
    case "invitation_email_mismatch":
    case "invitation_used":
    case "not_found":
    case "quota_exceeded":
      return error.code;
    default:
      throw error;
  }
}

export async function signInWithInvitation(
  platform: PlatformView,
  signup: "open" | "invite" | "closed",
  record: SignInRecord,
  invitation: string,
) {
  const hash = Buffer.from(hashToken(invitation), "hex");
  const failed = (code: string) => `/invite/${invitation}?${new URLSearchParams({ error: code })}`;
  let person: Awaited<ReturnType<PlatformView["signIn"]>>;
  try {
    person = await platform.signIn(signup === "closed" ? record : { ...record, invitationHash: hash });
  } catch (error) {
    // Invite-only enrollment requires successful redemption. Open enrollment can still open a session.
    if (signup !== "open") throw error;
    const code = invitationError(error);
    return { person: await platform.signIn(record), next: failed(code) };
  }

  if (!person) return { person };
  if (person.invitedOrg) return { person, next: `/${person.invitedOrg}/main` };

  // The returning person's session committed first so redemption can take its usual locks in order.
  try {
    const outcome = await platform.acceptInvitation(hash, person.id, record.now);
    if (!outcome) return { person, next: failed("not_found") };
    if ("quota" in outcome) return { person, next: failed("quota_exceeded") };
    return { person, next: `/${outcome.org.slug}/main` };
  } catch (error) {
    return { person, next: failed(invitationError(error)) };
  }
}
