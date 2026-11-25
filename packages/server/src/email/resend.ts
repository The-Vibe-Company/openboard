import type { InvitationRole } from "@openboard/contract";

interface InvitationEmail {
  readonly id: string;
  readonly email: string;
  readonly orgName: string;
  readonly inviter: string;
  readonly role: InvitationRole;
  readonly url: string;
  readonly expiresAt: number;
}

export type InvitationMailer = (invitation: InvitationEmail) => Promise<void>;

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInvitation(invite: InvitationEmail) {
  const subject = `You're invited to ${invite.orgName} on OpenBoard`;
  const intro = `${invite.inviter} invited you to join ${invite.orgName}.`;
  const expiry = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(invite.expiresAt);
  const note =
    "This link can only be used once. If you weren’t expecting this invitation, you can safely ignore this email.";
  const url = escapeHtml(invite.url);
  const mono = "'Courier New', Courier, monospace";
  const text = [
    "OpenBoard",
    subject,
    intro,
    `Role: ${invite.role}\nExpires: ${expiry} (UTC)`,
    `Accept invitation:\n${invite.url}`,
    note,
  ].join("\n\n");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f2f2f2;color:#171717;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f2f2">
    <tr><td align="center" style="padding:32px 12px">
      <!--[if mso]><table role="presentation" width="560" cellspacing="0" cellpadding="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #d4d4d4">
        <tr><td style="padding:20px 24px;background:#171717;color:#fff;font-family:${mono};font-size:17px;font-weight:bold">
          <span aria-hidden="true" style="display:inline-block;padding:3px 6px;border:1px solid #fff">&gt;_</span>&nbsp; OpenBoard
        </td></tr>
        <tr><td style="padding:28px 24px">
          <h1 style="margin:0 0 14px;font-size:28px;line-height:1.2;overflow-wrap:anywhere">${escapeHtml(subject)}</h1>
          <p style="margin:0 0 24px;font-size:16px;line-height:1.5;color:#404040;overflow-wrap:anywhere">${escapeHtml(intro)}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f5;border:1px solid #dedede;font-family:${mono};font-size:14px">
            <tr><td style="padding:13px 12px;border-bottom:1px solid #dedede">
              Role&nbsp; <span style="display:inline-block;border:1px solid #bdbdbd;border-radius:20px;background:#fff;padding:2px 9px;font-weight:bold">${escapeHtml(invite.role)}</span>
            </td></tr>
            <tr><td style="padding:13px 12px">Expires&nbsp; ${escapeHtml(expiry)} (UTC)</td></tr>
          </table>
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0">
            <tr><td align="center" style="background:#171717;border-radius:4px">
              <a href="${url}" style="display:inline-block;border:14px solid #171717;color:#fff;font-size:15px;font-weight:bold;text-decoration:none">Accept invitation</a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:14px;color:#404040">If the button doesn’t work, copy and paste this link into your browser.</p>
          <p style="margin:0;padding:12px;border:1px solid #dedede;background:#f5f5f5;font-family:${mono};font-size:13px;line-height:1.5;word-break:break-all;overflow-wrap:anywhere">${url}</p>
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #dedede;font-size:13px;line-height:1.5;color:#525252">${note}</td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, html, text };
}

export function resendInvitationMailer(
  { apiKey, from }: { readonly apiKey: string; readonly from: string },
  fetch: (request: Request) => Promise<Response>,
): InvitationMailer {
  return async (invitation) => {
    const request = new Request("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `invite-${invitation.id}`,
      },
      body: JSON.stringify({ from, to: [invitation.email], ...renderInvitation(invitation) }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    const response = await fetch(request);
    void response.body?.cancel().catch(() => {});
    if (!response.ok) throw new Error(`Resend rejected invitation email (HTTP ${response.status})`);
  };
}
