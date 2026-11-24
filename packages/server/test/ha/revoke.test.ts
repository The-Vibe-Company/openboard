import { expect, test } from "bun:test";
import type { ClaimResult, createInvitation, CreatedConnection, OutputOf } from "@openboard/contract";
import type { App } from "../../src/index.ts";
import { PUBLIC_URL } from "../support/app.ts";
import { browserSession, makeBrowserApp } from "../support/browser-session.ts";
import { postgresTestUrl } from "../support/env.ts";

const BOARD = "/api/acme/main";
const ORG = "/api/x/orgs/acme";

function send(app: App, path: string, headers: Record<string, string>, method = "GET", body?: object) {
  return app.fetch(
    new Request(PUBLIC_URL + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}

// Use direct instance handles so the mutation and the first subsequent read always go to different pools on Postgres.
test("revoked connections, claimed agents and sessions return 401 and removed members return 404 on the next request", async () => {
  const cluster = makeBrowserApp();
  try {
    expect(cluster.instances).toHaveLength(postgresTestUrl() ? 2 : 1);
    const [first, second = first] = cluster.instances;
    if (!first || !second) throw new Error("expected a test instance");

    const ada = await browserSession(first.fetch, "ada");
    expect((await send(first, "/api/x/orgs", ada.headers, "POST", { slug: "acme", name: "Acme" })).status).toBe(201);

    const created = await send(first, `${BOARD}/x/connections`, ada.headers, "POST", {
      name: "fixers",
      can: { "*": "all" },
      direct: true,
    });
    expect(created.status).toBe(201);
    const { connection, secret } = (await created.json()) as CreatedConnection;
    const claimed = await send(first, `${BOARD}/x/connections/claim`, bearer(secret), "POST", { profile: "fixer" });
    expect(claimed.status).toBe(200);
    const { agent, token } = (await claimed.json()) as ClaimResult;

    const lin = await browserSession(first.fetch, "lin");
    const invited = await send(first, `${ORG}/invitations`, ada.headers, "POST", { role: "member" });
    expect(invited.status).toBe(201);
    const { url } = (await invited.json()) as OutputOf<typeof createInvitation>;
    const accepted = await send(first, "/api/x/invitations/accept", lin.headers, "POST", {
      token: new URL(url).pathname.slice("/invite/".length),
    });
    expect(accepted.status).toBe(200);

    const me = (app: App, headers: Record<string, string>) => send(app, `${BOARD}/me`, headers);
    for (const app of [first, second]) {
      for (const headers of [bearer(secret), bearer(token), ada.headers, lin.headers]) {
        expect((await me(app, headers)).status).toBe(200);
      }
    }

    const connectionPath = `${BOARD}/x/connections/${connection.id}`;
    const agentRevoked = await send(first, `${connectionPath}/agents/${agent.id}/revoke`, ada.headers, "POST");
    expect(agentRevoked.status).toBe(200);
    await expectError(await me(second, bearer(token)), 401, "unauthorized");

    const connectionRevoked = await send(first, `${connectionPath}/revoke`, ada.headers, "POST");
    expect(connectionRevoked.status).toBe(200);
    await expectError(await me(second, bearer(secret)), 401, "unauthorized");

    const removed = await send(
      first,
      `${ORG}/members/${encodeURIComponent(lin.principal)}/remove`,
      ada.headers,
      "POST",
    );
    expect(removed.status).toBe(200);
    await expectError(await me(second, lin.headers), 404, "not_found");
    expect((await send(second, "/api/x/me", lin.headers)).status).toBe(200);

    const loggedOut = await send(first, "/auth/logout", ada.headers, "POST");
    expect(loggedOut.status).toBe(204);
    await expectError(await me(second, ada.headers), 401, "unauthorized");
  } finally {
    await cluster.close();
  }
});
