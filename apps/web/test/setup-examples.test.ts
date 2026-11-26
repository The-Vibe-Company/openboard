import { expect, test } from "bun:test";
import { mcpExamples } from "../src/components/setup-examples.ts";

test("MCP examples scope URLs to the board and defer credential expansion to the client", () => {
  const url = "http://localhost:8787/mcp/acme/releases";
  const [claude, codex, cursor] = mcpExamples("http://localhost:8787/api/acme/releases");
  expect(JSON.parse(claude.code).mcpServers.openboard).toEqual({
    type: "http",
    url,
    headers: { Authorization: `Bearer \${BOARD_TOKEN}` },
  });
  expect(codex.code).toBe(`[mcp_servers.openboard]\nurl = "${url}"\nbearer_token_env_var = "BOARD_TOKEN"`);
  expect(JSON.parse(cursor.code).mcpServers.openboard).toEqual({
    url,
    headers: { Authorization: `Bearer \${env:BOARD_TOKEN}` },
  });
});
