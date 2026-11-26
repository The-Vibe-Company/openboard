import { expect, test } from "bun:test";
import type {
  claimConnection,
  createConnection,
  createInvitation,
  listMembers,
  OutputOf,
  pollDeviceSignIn,
  startDeviceSignIn,
} from "@openboard/contract";
import { browserSession, makeBrowserApp } from "../support/browser-session.ts";

const cli = new URL("../../../../apps/openboard/src/main.ts", import.meta.url).pathname;
const target = "/api/x/orgs/acme";

function fixture() {
  const app = makeBrowserApp();
  const listener = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request, server) => app.fetch(request, { ip: server.requestIP(request)?.address }),
  });
  const post = (path: string, body: object, headers?: Record<string, string>) =>
    fetch(new URL(path, listener.url), {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  return {
    async signIn(person: "ada" | "lin" | "sam") {
      return browserSession(app.fetch, person);
    },
    post,
    async login(headers: Record<string, string>, org: string) {
      const started = await post("/api/x/auth/device", { clientName: "ob" });
      const { deviceCode, userCode } = (await started.json()) as OutputOf<typeof startDeviceSignIn>;
      expect((await post("/api/x/auth/device/approve", { userCode, org }, headers)).status).toBe(200);
      const redeemed = await post("/api/x/auth/device/token", { deviceCode });
      const personal = (await redeemed.json()) as OutputOf<typeof pollDeviceSignIn>;
      if (!("token" in personal)) throw new Error("Device sign-in did not issue a personal token");
      expect(personal.org.slug).toBe(org);
      return personal.token;
    },
    async run(token: string, ...args: string[]) {
      const process = Bun.spawn([Bun.argv[0] ?? "bun", cli, ...args, "--json"], {
        env: { BOARD_URL: new URL("/api/acme/main", listener.url).href, BOARD_TOKEN: token },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([process.exited, process.stdout.text(), process.stderr.text()]);
      return { code, stdout, stderr };
    },
    async close() {
      await listener.stop(true);
      await app.close();
    },
  };
}

async function join(
  post: Awaited<ReturnType<typeof fixture>>["post"],
  owner: Record<string, string>,
  invitee: Record<string, string>,
  role: "member" | "admin",
) {
  const invitation = await post(`${target}/invitations`, { role }, owner);
  expect(invitation.status).toBe(201);
  const { url } = (await invitation.json()) as OutputOf<typeof createInvitation>;
  const token = new URL(url).pathname.split("/").at(-1);
  expect((await post("/api/x/invitations/accept", { token }, invitee)).status).toBe(200);
}

function commands(id: string) {
  return [["org", "invite", "--no-send"], ["org", "invitations"], ["org", "invite", "revoke", id], ["members"]];
}

test("the CLI manages invitations with an admin's device token and lists members with a member's token", async () => {
  const { signIn, post, login, run, close } = fixture();
  try {
    const owner = await signIn("ada");
    const admin = await signIn("lin");
    const member = await signIn("sam");
    expect((await post("/api/x/orgs", { slug: "acme", name: "Acme" }, owner.headers)).status).toBe(201);
    await join(post, owner.headers, admin.headers, "admin");
    await join(post, owner.headers, member.headers, "member");

    const adminToken = await login(admin.headers, "acme");
    const memberToken = await login(member.headers, "acme");
    const created = await run(
      adminToken,
      "org",
      "invite",
      "--email",
      "pat@example.com",
      "--role",
      "admin",
      "--no-send",
    );
    expect(created).toMatchObject({ code: 0, stderr: "" });
    const { invitation, url } = JSON.parse(created.stdout) as OutputOf<typeof createInvitation>;
    expect(invitation).toMatchObject({ email: "pat@example.com", role: "admin", createdBy: admin.principal });
    expect(new URL(url).pathname).toMatch(/^\/invite\/[\w-]{43}$/);
    const listed = await run(adminToken, "org", "invitations");
    expect(listed).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(listed.stdout)).toEqual({ invitations: [invitation] });

    const denied = await Promise.all(
      commands(invitation.id)
        .slice(0, 3)
        .map((args) => run(memberToken, ...args)),
    );
    for (const { code, stdout, stderr } of denied) {
      expect(code).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain("error: forbidden:");
    }
    const roster = await run(memberToken, "members");
    expect(roster).toMatchObject({ code: 0, stderr: "" });
    const { members } = JSON.parse(roster.stdout) as OutputOf<typeof listMembers>;
    expect(Object.fromEntries(members.map(({ principal, role }) => [principal, role]))).toEqual({
      [owner.principal]: "owner",
      [admin.principal]: "admin",
      [member.principal]: "member",
    });

    const revoked = await run(adminToken, "org", "invite", "revoke", invitation.id);
    expect(revoked).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(revoked.stdout)).toMatchObject({ id: invitation.id });
    const empty = await run(adminToken, "org", "invitations");
    expect(empty).toEqual({ code: 0, stdout: '{"invitations":[]}\n', stderr: "" });

    const bearer = { authorization: `Bearer ${adminToken}` };
    expect((await post(`${target}/exports`, {}, bearer)).status).toBe(403);
    expect(
      (await post(`${target}/invitations`, { role: "member" }, { ...bearer, "x-board-can": "*=read" })).status,
    ).toBe(403);
  } finally {
    await close();
  }
});

test("all four CLI operations reject real agent and wrong-org tokens", async () => {
  const { signIn, post, login, run, close } = fixture();
  try {
    const { headers } = await signIn("ada");
    for (const slug of ["acme", "beta"]) {
      expect((await post("/api/x/orgs", { slug, name: slug }, headers)).status).toBe(201);
    }
    const pending = await post(`${target}/invitations`, { role: "member" }, headers);
    expect(pending.status).toBe(201);
    const { invitation } = (await pending.json()) as OutputOf<typeof createInvitation>;

    // The same person owns both organizations. Only the token's organization differs.
    const wrongOrg = await login(headers, "beta");
    const owner = await login(headers, "acme");
    const connection = await post(
      "/api/acme/main/x/connections",
      { name: "test-agent", can: { "*": "all" } },
      {
        authorization: `Bearer ${owner}`,
      },
    );
    expect(connection.status).toBe(201);
    const { secret } = (await connection.json()) as OutputOf<typeof createConnection>;
    const claimed = await post(
      "/api/acme/main/x/connections/claim",
      { profile: "worker" },
      {
        authorization: `Bearer ${secret}`,
      },
    );
    expect(claimed.status).toBe(200);
    const { token: agent } = (await claimed.json()) as OutputOf<typeof claimConnection>;
    expect(typeof agent === "string" && agent.startsWith("obt_")).toBe(true);
    expect((await run(agent, "whoami")).code).toBe(0);

    for (const [token, error] of [
      [wrongOrg, "not_found"],
      [agent, "forbidden"],
    ] as const) {
      const results = await Promise.all(commands(invitation.id).map((args) => run(token, ...args)));
      for (const result of results) {
        expect(result.stderr).toContain(`error: ${error}:`);
        expect(result.stderr.includes(token)).toBe(false);
        expect(result.code).toBe(1);
        expect(result.stdout).toBe("");
      }
    }
    const listed = await run(owner, "org", "invitations");
    expect(JSON.parse(listed.stdout)).toEqual({ invitations: [invitation] });
  } finally {
    await close();
  }
});
