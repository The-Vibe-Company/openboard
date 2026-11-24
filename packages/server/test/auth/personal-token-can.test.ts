import { expect, test } from "bun:test";
import type {
  createInvitation,
  listPersonalTokens,
  OutputOf,
  pollDeviceSignIn,
  startDeviceSignIn,
} from "@openboard/contract";
import { PUBLIC_URL } from "../support/app.ts";
import { browserSession, makeBrowserApp } from "../support/browser-session.ts";

function fixture() {
  const app = makeBrowserApp();
  const send = (method: string, path: string, headers?: Record<string, string>, body?: object) =>
    app.fetch(new Request(`${PUBLIC_URL}/api${path}`, { method, headers, body: JSON.stringify(body) }));
  async function start(can?: string) {
    const result = await send("POST", "/x/auth/device", {}, { clientName: "ob", can });
    expect(result.status).toBe(200);
    return (await result.json()) as OutputOf<typeof startDeviceSignIn>;
  }
  async function approve(userCode: string, headers: Record<string, string>) {
    expect((await send("POST", "/x/auth/device/approve", headers, { userCode, org: "acme" })).status).toBe(200);
  }
  async function redeem(deviceCode: string) {
    const result = await send("POST", "/x/auth/device/token", {}, { deviceCode });
    expect(result.status).toBe(200);
    const issued = (await result.json()) as OutputOf<typeof pollDeviceSignIn>;
    if (!("token" in issued)) throw new Error("expected an issued token");
    return { authorization: `Bearer ${issued.token}` };
  }
  return { app, send, start, approve, redeem };
}

test("device approval previews the scope and a read-only token cannot post or manage credentials", async () => {
  const { app, send, start, approve, redeem } = fixture();
  try {
    const ada = await browserSession(app.fetch, "ada");
    expect((await send("POST", "/x/orgs", ada.headers, { slug: "acme", name: "Acme" })).status).toBe(201);
    expect((await send("POST", "/acme/main/messages", ada.headers, { channel: "dev", text: "seed" })).status).toBe(201);
    const { userCode, deviceCode } = await start("dev=read");
    const preview = await send("GET", `/x/auth/device/${userCode}`, ada.headers);
    expect(await preview.json()).toMatchObject({ can: { dev: ["read"] } });
    await approve(userCode, ada.headers);
    const bearer = await redeem(deviceCode);

    const me = await send("GET", "/acme/main/me", { ...bearer, "x-board-can": "*=all" });
    expect(await me.json()).toMatchObject({ can: { dev: ["read"] } });
    const read = await send("GET", "/acme/main/messages?channel=dev", bearer);
    expect(await read.json()).toMatchObject({ messages: [{ text: "seed" }] });
    const post = await send("POST", "/acme/main/messages", bearer, { channel: "dev", text: "hi" });
    expect(post.status).toBe(403);
    expect(await post.json()).toMatchObject({ error: { code: "forbidden" } });

    const listedGrants = await send("GET", "/acme/main/grants", bearer);
    expect(listedGrants.status).toBe(403);
    const writeGrant = await send("POST", "/acme/main/grants", bearer, {
      principals: [{ kind: "all-users" }],
      can: { dev: ["read"] },
    });
    expect(writeGrant.status).toBe(403);
    expect(await writeGrant.json()).toMatchObject({ error: { code: "forbidden" } });

    const full = await start();
    await approve(full.userCode, ada.headers);
    const unrestricted = await redeem(full.deviceCode);
    const list = await send("GET", "/x/tokens", unrestricted);
    expect(list.status).toBe(200);
    const { tokens } = (await list.json()) as OutputOf<typeof listPersonalTokens>;
    const narrowed = tokens.find(({ can }) => can !== undefined);
    if (!narrowed) throw new Error("expected a listed narrowed token");
    expect(narrowed.can).toEqual({ dev: ["read"] });
    const revoke = `/x/tokens/${narrowed.id}/revoke`;
    for (const [method, path] of [
      ["GET", "/x/tokens"],
      ["GET", "/x/me"],
      ["POST", revoke],
    ] as const) {
      const result = await send(method, path, bearer);
      expect(result.status).toBe(403);
      expect(await result.json()).toMatchObject({ error: { code: "forbidden" } });
    }
    const exporting = await send("POST", "/x/orgs/acme/exports", bearer);
    expect(exporting.status).toBe(403);
    expect(await exporting.json()).toMatchObject({ error: { code: "forbidden" } });
    const watcher = await send("POST", "/acme/main/watchers", bearer, { watch: { scoped: { tail: "dev" } } });
    expect(watcher.status).toBe(403);
    expect(await watcher.json()).toMatchObject({ error: { code: "forbidden" } });
    expect((await send("POST", revoke, unrestricted)).status).toBe(200);
    expect((await send("GET", "/acme/main/me", bearer)).status).toBe(401);
  } finally {
    await app.close();
  }
});

test("promotion between approval and token exchange cannot widen the approved scope", async () => {
  const { app, send, start, approve, redeem } = fixture();
  try {
    const ada = await browserSession(app.fetch, "ada");
    const lin = await browserSession(app.fetch, "lin");
    expect((await send("POST", "/x/orgs", ada.headers, { slug: "acme", name: "Acme" })).status).toBe(201);
    const link = await send("POST", "/x/orgs/acme/invitations", ada.headers, { role: "member" });
    const { url } = (await link.json()) as OutputOf<typeof createInvitation>;
    const token = new URL(url).pathname.slice("/invite/".length);
    expect((await send("POST", "/x/invitations/accept", lin.headers, { token })).status).toBe(200);

    const invalid = await send("POST", "/x/auth/device", {}, { clientName: "ob", can: "dev" });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "invalid_scope" } });

    const { userCode, deviceCode } = await start("*=all");
    await approve(userCode, lin.headers);
    const role = await send("POST", `/x/orgs/acme/members/${encodeURIComponent(lin.principal)}/role`, ada.headers, {
      role: "admin",
    });
    expect(role.status).toBe(200);
    const bearer = await redeem(deviceCode);
    const me = await send("GET", "/acme/main/me", bearer);
    expect(await me.json()).toMatchObject({ can: { "*": ["read", "post", "react", "label"] } });
  } finally {
    await app.close();
  }
});
