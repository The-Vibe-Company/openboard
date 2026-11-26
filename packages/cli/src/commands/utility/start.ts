import { clientConfig, isAgentToken, isPersonalToken } from "../../config.ts";
import { Misuse, type StandaloneContext } from "../index.ts";

const connect = [
  "Humans: ob login '<origin>'",
  "Agents: ob connect '<board-url>' --as '<name>' (provide the connection secret via stdin or --secret-file)",
  "Local board: ob serve",
  "   In a second terminal, export BOARD_URL='<printed-board-url>' before running ob doctor.",
] as const;

export const startCommand = {
  async run(ctx: StandaloneContext): Promise<number> {
    if (ctx.args.length) throw new Misuse("start takes no arguments");
    const { boardUrl, token, profile } = clientConfig(ctx.env);
    const url = URL.parse(boardUrl ?? "");
    const valid = url && /^https?:$/.test(url.protocol) && !url.username && !url.password && !/[?#]/.test(url.href);
    const result = {
      boardUrl: valid ? url.href : null,
      authMode:
        valid && token ? (isPersonalToken(token) ? "personal" : isAgentToken(token) ? "agent" : "token") : "none",
      profile: valid ? (ctx.profile ?? profile ?? null) : null,
      connect: valid && token ? [] : connect,
      instructions: "Replace the angle-bracket placeholders with your values.",
      verify: "ob doctor",
      tasks: [
        `ob tasks create '<channel>' "First task"`,
        "ob tasks claim '<id>'",
        `ob reply '<id>' "Work in progress"`,
        `ob tasks complete '<id>' "Done"`,
      ],
      integrations: {
        agentSkill: "npx skills add The-Vibe-Company/openboard --skill openboard",
        typescriptSdk: "npm install @the-vibe-company/openboard",
      },
    };
    const { verify, tasks, integrations } = result;
    ctx.output.out(
      ctx.json
        ? JSON.stringify(result, null, 2)
        : [
            "OpenBoard quickstart",
            ...(result.boardUrl
              ? [
                  `Board: ${result.boardUrl}`,
                  `Auth: ${result.authMode}${result.profile ? ` (profile ${JSON.stringify(result.profile)})` : ""}`,
                ]
              : ["Board: unconfigured or invalid"]),
            "",
            result.instructions,
            "",
            "1. Connect and verify",
            ...result.connect.map((step) => `   ${step}`),
            `   ${verify}`,
            "",
            "2. Create a task and use the returned ID",
            ...tasks.map((command) => `   ${command}`),
            "",
            "3. Install the agent skill or TypeScript SDK",
            `   ${integrations.agentSkill}`,
            `   ${integrations.typescriptSdk}`,
          ].join("\n"),
    );
    return 0;
  },
};
