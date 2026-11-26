import { expect, test } from "bun:test";
import { runCli } from "../src/main.ts";

const boardUrl = "https://board.example/api/acme/ops/";
const orgPath = "/api/x/orgs/acme";
const invitation = {
  id: "inv_aaaaaaaaaaaaaaaa",
  role: "member",
  createdBy: "ob:user:owner",
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-01-08T00:00:00.000Z",
};
const inviteUrl = "https://board.example/invite/example";
const email = "pat@example.com";

async function run(
  args: string[],
  fetch: (request: Request) => Response | Promise<Response> = () => {
    throw new Error("Unexpected network request");
  },
  url = boardUrl,
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(
    args,
    { BOARD_URL: url, BOARD_TOKEN: "fixture" },
    {
      output: { out: (line) => stdout.push(line), err: (line) => stderr.push(line) },
      fetch: async (request) => fetch(request),
    },
  );
  return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

test.each([
  { flags: [], body: { role: "member" }, emailSent: undefined },
  { flags: ["--email", email], body: { role: "member", email }, emailSent: true },
  { flags: ["--email", email], body: { role: "member", email }, emailSent: false },
  { flags: ["--role", "admin", "--email", email, "--no-send"], body: { role: "admin", email, send: false } },
])("org invite creates the requested invitation (%j)", async ({ flags, body, emailSent }) => {
  const result = {
    invitation: { ...invitation, role: body.role, ...(body.email ? { email: body.email } : {}) },
    url: inviteUrl,
    ...(emailSent === undefined ? {} : { emailSent }),
  };
  const fetch = async (request: Request) => {
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe(`${orgPath}/invitations`);
    expect(await request.json()).toEqual(body);
    return Response.json(result, { status: 201 });
  };
  expect(await run(["org", "invite", ...flags], fetch)).toEqual({
    code: 0,
    stdout: `One-time invite URL: ${inviteUrl}\nRole: ${body.role}\nExpires: ${invitation.expiresAt}\nEmail sent: ${emailSent ? "yes" : "no"}`,
    stderr: "",
  });
  expect(await run(["org", "invite", ...flags, "--json"], fetch)).toEqual({
    code: 0,
    stdout: JSON.stringify(result),
    stderr: "",
  });
});

test.each([
  { flags: ["--role", "owner"], message: "--role must be member or admin" },
  { flags: ["--role", "--no-send"], message: "--role takes a value" },
  { flags: ["--email", "invalid"], message: "--email must be an email address" },
  { flags: ["--email"], message: "--email takes a value" },
  { flags: ["--email", "--", email], message: "--email takes a value" },
  { flags: ["--email", email, "--email", email], message: "unexpected or repeated option" },
  { flags: ["--", inviteUrl], message: "unexpected argument" },
])("org invite rejects misuse without sending a request (%j)", async ({ flags, message }) => {
  const result = await run(["org", "invite", ...flags]);
  expect(result.code).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain(`error: invalid_request: ${message}`);
  expect(result.stderr).not.toContain(inviteUrl);
});

test("org commands require a board URL with an organization", async () => {
  const result = await run(["members"], undefined, "https://board.example/api/");
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("BOARD_URL must name your organization and board");
});

test.each([true, false])("org invitations lists pending invitations (empty=%s)", async (empty) => {
  const addressed = { ...invitation, id: "inv_bbbbbbbbbbbbbbbb", role: "admin", email: "pat\x1b@example.com" };
  const data = { invitations: empty ? [] : [invitation, addressed] };
  const fetch = (request: Request) => {
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe(`${orgPath}/invitations`);
    return Response.json(data);
  };
  const listed = `${invitation.id}  (link)  member  ${invitation.expiresAt}\n${addressed.id}  pat\\u{1b}@example.com  admin  ${addressed.expiresAt}`;
  expect(await run(["org", "invitations"], fetch)).toEqual({
    code: 0,
    stdout: empty ? "no pending invitations" : listed,
    stderr: "",
  });
  expect(await run(["org", "invitations", "--json"], fetch)).toEqual({
    code: 0,
    stdout: JSON.stringify(data),
    stderr: "",
  });
});

test("org invite revoke prints the result and reports used invitations without leaking remote details", async () => {
  const args = ["org", "invite", "revoke", invitation.id];
  const data = { id: invitation.id, revokedAt: invitation.createdAt };
  const fetch = (request: Request) => {
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe(`${orgPath}/invitations/${invitation.id}/revoke`);
    return Response.json(data);
  };
  expect(await run(args, fetch)).toEqual({ code: 0, stdout: `revoked ${invitation.id}`, stderr: "" });
  expect(await run([...args, "--json"], fetch)).toEqual({ code: 0, stdout: JSON.stringify(data), stderr: "" });
  expect(
    await run([...args, "--json"], () =>
      Response.json(
        { error: { code: "invitation_used", message: inviteUrl, hint: "Bearer fixture" } },
        { status: 409 },
      ),
    ),
  ).toEqual({ code: 1, stdout: "", stderr: "error: invitation_used: this invitation was already accepted or revoked" });
});

test("members lists profile fields, roles and principals", async () => {
  const data = {
    members: [
      { principal: "ob:user:pat", role: "owner", profile: { handle: "pat", name: "Pat\nLee", avatar: null } },
      { principal: "ob:user:sam", role: "member" },
    ],
  };
  const fetch = (request: Request) => {
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe(`${orgPath}/members`);
    return Response.json(data);
  };
  expect(await run(["members"], fetch)).toEqual({
    code: 0,
    stdout: "pat  Pat\\u{a}Lee  owner  ob:user:pat\n-  -  member  ob:user:sam",
    stderr: "",
  });
  expect(await run(["members", "--json"], fetch)).toEqual({ code: 0, stdout: JSON.stringify(data), stderr: "" });
});

test("invitation and member commands appear in grouped help, detailed help and each completion script", async () => {
  const commands = ["org invite", "org invitations", "org invite revoke", "members"];
  const help = await run(["--help"]);
  const admin = help.stdout.split("Admin & diagnostics\n")[1]?.split("\n\n")[0] ?? "";
  for (const command of commands) {
    expect(admin).toContain(`  ${command} `);
    const result = await run(["help", ...command.split(" ")]);
    expect(result.code).toBe(0);
    expect(result.stdout).toStartWith(`ob ${command} `);
    expect(result.stdout).toContain("--json");
  }

  for (const shell of ["bash", "zsh", "fish"]) {
    const result = await run(["completion", shell]);
    expect(result.code).toBe(0);
    for (const candidate of ["members", "invitations", "revoke"]) expect(result.stdout).toContain(candidate);
    expect(result.stdout).toContain("'org invite'");
  }
});
