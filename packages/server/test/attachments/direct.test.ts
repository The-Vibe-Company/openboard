import { expect, test } from "bun:test";
import { BOARD_URL, makeApp, OWNER } from "../support/app.ts";

test("both direct-upload routes require authentication and explain the file size limit", async () => {
  const app = makeApp();
  const routes = [
    ["/attachments/uploads", { name: "demo.mp4", type: "video/mp4", size: 11429478 }],
    ["/attachments/uploads/att_ffffffff-ffff-4fff-bfff-ffffffffffff", {}],
  ] as const;
  try {
    for (const credential of [undefined, OWNER.token]) {
      for (const [path, body] of routes) {
        const headers = new Headers({ "content-type": "application/json" });
        if (credential) {
          headers.set("authorization", `Bearer ${credential}`);
          headers.set("x-board-can", "dev=read");
        }
        const response = await app.fetch(
          new Request(BOARD_URL + path, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          }),
        );
        expect(response.status).toBe(credential ? 501 : 401);
        expect(await response.json()).toMatchObject({
          error: credential
            ? {
                code: "no_direct_uploads",
                hint: "Use POST /attachments with a file of at most 4 MB.",
                next: [
                  { kind: "run", argv: ["ob", "post", "--help"], description: "Files are at most 4 MB on this board." },
                ],
              }
            : { code: "unauthorized" },
        });
      }
    }
  } finally {
    await app.close();
  }
});
