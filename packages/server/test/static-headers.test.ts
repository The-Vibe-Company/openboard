import { expect, test } from "bun:test";
import { join } from "node:path";
import { makeApp, PUBLIC_URL } from "./support/app.ts";

const CSP =
  "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://github.com";

test.each([
  [PUBLIC_URL, null],
  ["https://board.example.com", "max-age=31536000"],
])("static responses use the security policy for public URL %s", async (publicUrl, hsts) => {
  const app = makeApp({ publicUrl, webDir: join(import.meta.dir, "fixtures/web"), schedule: () => () => {} });
  try {
    for (const path of ["/index.html", "/acme/main", "/assets/app-hash.txt"]) {
      for (const method of ["GET", "HEAD"]) {
        // The internal request can use HTTP behind an HTTPS terminator.
        const response = await app.fetch(new Request(PUBLIC_URL + path, { method }));
        expect(response.status).toBe(200);
        expect(response.headers.get("content-security-policy")).toBe(CSP);
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.get("referrer-policy")).toBe("same-origin");
        expect(response.headers.get("strict-transport-security")).toBe(hsts);
      }
    }
  } finally {
    await app.close();
  }
});
