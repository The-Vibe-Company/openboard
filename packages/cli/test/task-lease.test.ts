import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withClaimStorage } from "../src/claims.ts";
import { runCli } from "../src/main.ts";

const boardUrl = "http://127.0.0.1:8787/api/local/main";
const actor = "agent-a";
const until = "2026-01-01T00:00:00.000Z";

describe.each([
  ["claim by ID", ["claim", "2"], "/tasks/2/claim", { task: { id: "2" } }],
  ["claim next", ["claim", "--next", "--channel", "dev"], "/tasks/claim", { task: null }],
  ["renew", ["renew", "2"], "/tasks/2/renew", { task: { id: "2" }, until }],
  ["create", ["create", "dev", "fix the build"], "/tasks", { task: { id: "2" } }],
] as const)("ob tasks %s --lease", (_command, args, path, response) => {
  test.each([
    ["3600", 3600],
    ["15m", 900],
    ["30s", 30],
    ["30m", 1800],
    ["1h", 3600],
    ["15m30s", 930],
  ] as const)("sends %s as %i seconds", async (value, seconds) => {
    const home = mkdtempSync(join(tmpdir(), "ob-task-lease-"));
    const requests: unknown[] = [];
    const fetch = async (request: Request) => {
      if (request.url === `${boardUrl}/me`) return Response.json({ actor });
      expect(request.url).toBe(`${boardUrl}${path}`);
      requests.push(await request.json());
      return Response.json(response);
    };
    const output = { out: mock(), err: mock() };
    try {
      if (args[0] === "renew") {
        const key = { boardUrl, actor, id: "2" };
        const claim = { epoch: 1, token: "test claim credential", until };
        await withClaimStorage(home, async () => ({ result: null, entry: { key, claim } }));
      }
      expect(
        await runCli(["tasks", ...args, "--lease", value], { BOARD_URL: boardUrl, HOME: home }, { fetch, output }),
      ).toBe(0);
      expect(requests).toEqual([expect.objectContaining({ lease: seconds })]);
      expect(output.err).not.toHaveBeenCalled();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test.each(["", "0", "0s", "-1", "-30s", "1.5", "1.5h", "1e3", "10ms", "1h30", "30m1h", "9007199254740993"])(
    "rejects %j before making a request",
    async (value) => {
      const fetch = mock();
      const output = { out: mock(), err: mock() };
      expect(await runCli(["tasks", ...args, "--lease", value], { BOARD_URL: boardUrl }, { fetch, output })).toBe(2);
      expect(output.err.mock.calls[0]?.[0]).toStartWith(
        "error: invalid_request: lease: expected seconds or a duration like 30m or 1h",
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
