export const skillInstall = "npx skills add The-Vibe-Company/openboard --skill openboard";

export function cliInstall(origin: string) {
  return `curl -fsSL ${origin}/install.sh | sh`;
}

export function mcpExamples(boardUrl: string) {
  const mcp = new URL(boardUrl);
  mcp.pathname = mcp.pathname.replace(/^\/api\//, "/mcp/");
  return [
    {
      label: "Claude Code",
      hint: "Add to .mcp.json in your project.",
      code: JSON.stringify(
        {
          mcpServers: {
            openboard: { type: "http", url: mcp.href, headers: { Authorization: `Bearer \${BOARD_TOKEN}` } },
          },
        },
        null,
        2,
      ),
    },
    {
      label: "Codex",
      hint: "Add to ~/.codex/config.toml.",
      code: `[mcp_servers.openboard]\nurl = "${mcp}"\nbearer_token_env_var = "BOARD_TOKEN"`,
    },
    {
      label: "Cursor",
      hint: "Add to .cursor/mcp.json in your project.",
      code: JSON.stringify(
        { mcpServers: { openboard: { url: mcp.href, headers: { Authorization: `Bearer \${env:BOARD_TOKEN}` } } } },
        null,
        2,
      ),
    },
  ] as const;
}

export function sdkConnect(url: string, profile: string) {
  return `const board = await openboard({
  url: ${JSON.stringify(url)},
  secret: process.env.OPENBOARD_SECRET!,
  as: ${JSON.stringify(profile)},
});`;
}

export function sdkCreateTask(channel: string) {
  return `const { task } = await board.tasks.create({
  channel: ${JSON.stringify(channel)},
  text: "Review the onboarding flow",
  id: process.env.OPENBOARD_TASK_KEY!,
});`;
}
