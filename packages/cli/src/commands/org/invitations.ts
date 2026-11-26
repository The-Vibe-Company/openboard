import { BoardError } from "@openboard/contract";
import { type Command, type CommandContext, Misuse } from "../index.ts";
import { organization } from "./organization.ts";

function inviteOptions(ctx: CommandContext) {
  let email: string | undefined;
  let role: "member" | "admin" | undefined;
  let noSend = false;
  for (let at = 0; at < ctx.args.length; at++) {
    const flag = ctx.args[at];
    if (at >= ctx.optionsEnd) throw new Misuse("unexpected argument");
    if (flag === "--no-send" && !noSend) {
      noSend = true;
      continue;
    }
    if ((flag !== "--email" && flag !== "--role") || (flag === "--email" ? email !== undefined : role !== undefined)) {
      throw new Misuse("unexpected or repeated option");
    }
    const value = ctx.args[++at];
    if (!value || at >= ctx.optionsEnd || value.startsWith("--")) throw new Misuse(`${flag} takes a value`);
    if (flag === "--email") {
      if (value.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(value)) {
        throw new Misuse("--email must be an email address");
      }
      email = value;
    } else {
      if (value !== "member" && value !== "admin") throw new Misuse("--role must be member or admin");
      role = value;
    }
  }
  return { role: role ?? "member", ...(email === undefined ? {} : { email }), ...(noSend ? { send: false } : {}) };
}

/** Keep server error details out of stderr, since they can contain credentials or invitation URLs. */
async function orgRequest<T>(request: Promise<T>, action: string): Promise<T> {
  try {
    return await request;
  } catch (error) {
    const { BoardError: SdkError } = await import("@the-vibe-company/openboard");
    if (!(error instanceof BoardError) && !(error instanceof SdkError)) throw error;
    const message =
      error.code === "invitation_used" ? "this invitation was already accepted or revoked" : `could not ${action}`;
    throw new BoardError(error.code, message);
  }
}

/** Preserve row boundaries and keep terminal controls visible in server-supplied fields. */
function terminalField(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) => `\\u{${character.codePointAt(0)?.toString(16)}}`);
}

export const inviteCommand: Command = {
  async run(ctx) {
    const options = inviteOptions(ctx);
    const result = await orgRequest(
      ctx.client.createInvitation({ org: organization(ctx), ...options }),
      "create the invitation",
    );
    const { invitation, url, emailSent } = result;
    ctx.output.out(
      ctx.json
        ? JSON.stringify(result)
        : [
            `One-time invite URL: ${url}`,
            `Role: ${invitation.role}`,
            `Expires: ${invitation.expiresAt}`,
            `Email sent: ${emailSent === true ? "yes" : "no"}`,
          ].join("\n"),
    );
    return 0;
  },
};

export const invitationsCommand: Command = {
  async run(ctx) {
    if (ctx.args.length) throw new Misuse("unexpected argument");
    const result = await orgRequest(ctx.client.listInvitations({ org: organization(ctx) }), "list invitations");
    const lines = result.invitations.map(
      ({ id, email, role, expiresAt }) => `${id}  ${terminalField(email ?? "(link)")}  ${role}  ${expiresAt}`,
    );
    ctx.output.out(ctx.json ? JSON.stringify(result) : lines.join("\n") || "no pending invitations");
    return 0;
  },
};

export const revokeInviteCommand: Command = {
  async run(ctx) {
    const [id] = ctx.args;
    if (!id || ctx.args.length !== 1 || (ctx.optionsEnd && id.startsWith("-"))) {
      throw new Misuse("supply one invitation ID");
    }
    const result = await orgRequest(
      ctx.client.revokeInvitation({ org: organization(ctx), id }),
      "revoke the invitation",
    );
    ctx.output.out(ctx.json ? JSON.stringify(result) : `revoked ${result.id}`);
    return 0;
  },
};

export const membersCommand: Command = {
  async run(ctx) {
    if (ctx.args.length) throw new Misuse("unexpected argument");
    const result = await orgRequest(ctx.client.listMembers({ org: organization(ctx) }), "list members");
    const lines = result.members.map(({ profile, role, principal }) =>
      [profile?.handle || "-", profile?.name || "-", role, principal].map(terminalField).join("  "),
    );
    ctx.output.out(ctx.json ? JSON.stringify(result) : lines.join("\n") || "no members");
    return 0;
  },
};
