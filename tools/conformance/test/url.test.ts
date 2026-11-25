import { describe, expect, test } from "bun:test";
import { parseOptions, readConnectionSecret } from "../src/run";

describe("deployed conformance", () => {
  const board = "https://staging.example.test/api/conformance-ci/main";

  test("uses the hosted score by default without boot options", () => {
    expect(parseOptions(["--url", board])).toEqual({ mode: "hosted", url: new URL(board), update: false });
  });

  test("can check a deployed SQLite server against the local score", () => {
    const url = "http://127.0.0.1:8787/api/local/main";
    expect(parseOptions(["--url", url, "--driver", "sqlite"])).toEqual({
      mode: "local",
      url: new URL(url),
      update: false,
    });
  });

  test.each(["--update", "--instances=2"])("rejects %s when targeting a deployed board", (flag) => {
    expect(() => parseOptions(["--url", board, flag])).toThrow("--url cannot be used with --update or --instances");
  });

  test.each(["", "file:///tmp/main", "https://name:password@staging.example.test/api", `${board}?key=example`])(
    "rejects a malformed or credential-bearing URL (%s)",
    (url) => {
      expect(() => parseOptions(["--url", url])).toThrow("--url must be an HTTP(S) board URL");
    },
  );

  test("reads the secret from redirected stdin and removes the trailing newline", async () => {
    expect(await readConnectionSecret(new Blob(["example\r\n"]))).toBe("example");
  });

  test("requires a nonempty secret on stdin", async () => {
    await expect(readConnectionSecret(new Blob(["\n"]))).rejects.toThrow("--url requires a connection secret on stdin");
  });
});
