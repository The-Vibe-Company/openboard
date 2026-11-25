import { expect, spyOn, test } from "bun:test";
import { resendInvitationMailer } from "../src/email/resend.ts";

const config = { apiKey: "example-key", from: "OpenBoard <invites@example.com>" };
const invitation = {
  id: "inv_example",
  email: "ada@example.com",
  orgName: '<img src=x> & "Co"',
  inviter: "O'Reilly <b>Admin</b>",
  role: "admin",
  url: 'https://board.example/invite/example?a="b"&c=d',
  expiresAt: 1_795_472_000_000,
} as const;

test("posts a multipart-ready invitation with escaped HTML and a plain-text link", async () => {
  const send = resendInvitationMailer(config, async (request) => {
    expect(request.url).toBe("https://api.resend.com/emails");
    expect(request.method).toBe("POST");
    expect(request.redirect).toBe("error");
    expect(request.headers.get("Authorization")).toBe("Bearer example-key");
    expect(request.headers.get("Content-Type")).toBe("application/json");
    expect(request.headers.get("Idempotency-Key")).toBe("invite-inv_example");
    const body = (await request.json()) as { html: string; text: string };
    expect(body).toMatchObject({
      from: config.from,
      to: [invitation.email],
      subject: `You're invited to ${invitation.orgName} on OpenBoard`,
    });
    expect(body.html).toContain("&lt;img src=x&gt; &amp; &quot;Co&quot;");
    expect(body.html).toContain("O&#39;Reilly &lt;b&gt;Admin&lt;/b&gt;");
    expect(body.html).not.toContain("<img");
    expect(body.html).not.toContain("<b>Admin");
    expect(body.html).toContain('href="https://board.example/invite/example?a=&quot;b&quot;&amp;c=d"');
    expect(body.html).toContain("Accept invitation");
    expect(body.text).toContain(invitation.inviter);
    expect(body.text).toContain("Role: admin\nExpires: November 23, 2026 (UTC)");
    expect(body.text).toContain(`Accept invitation:\n${invitation.url}`);
    expect(body.text).toContain("This link can only be used once.");
    return new Response(null, { status: 200 });
  });
  await send(invitation);
});

test("rejects HTTP failures without including the provider response body", async () => {
  const send = resendInvitationMailer(config, async () => new Response(invitation.url, { status: 500 }));
  await expect(send(invitation)).rejects.toThrow(/^Resend rejected invitation email \(HTTP 500\)$/);
});

test("passes a ten-second timeout signal to fetch and propagates timeout failures", async () => {
  const reason = new DOMException("timed out", "TimeoutError");
  const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort(reason));
  try {
    const send = resendInvitationMailer(config, async (request) => {
      request.signal.throwIfAborted();
      throw new Error("Expected the request to be aborted");
    });
    await expect(send(invitation)).rejects.toBe(reason);
    expect(timeout).toHaveBeenCalledWith(10_000);
  } finally {
    timeout.mockRestore();
  }
});
