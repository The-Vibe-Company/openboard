import { expect, test } from "bun:test";
import { BOARD_URL, makeApp, OWNER } from "../support/app.ts";

test("uploads reject unsafe names and keep or normalize safe names", async () => {
  const app = makeApp();
  const upload = (name: string) =>
    app.fetch(
      new Request(`${BOARD_URL}/attachments`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${OWNER.token}`,
          "content-type": "application/octet-stream",
          "x-board-filename": encodeURIComponent(name),
        },
        body: new Uint8Array([1]),
      }),
    );

  try {
    for (const name of [".env", "a/ \u0000.env", "a\\.env", "after\u202e.png"]) {
      const response = await upload(name);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "invalid_attachment" } });
    }

    for (const [name, stored] of [
      ["../x.txt", "x.txt"],
      ["a/b.txt", "b.txt"],
      ["", "file"],
      ["after\u0000.png", "after.png"],
      ["after.png", "after.png"],
    ] as const) {
      const response = await upload(name);
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ attachment: { name: stored } });
    }
  } finally {
    await app.close();
  }
});
