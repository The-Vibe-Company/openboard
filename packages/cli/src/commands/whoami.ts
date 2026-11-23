import { type Command, Misuse } from "./index.ts";

export const whoamiCommand: Command = {
  words: ["whoami"],
  usage: "ob whoami",
  async run(ctx) {
    if (ctx.args.length > 0) throw new Misuse("whoami takes no arguments");
    const me = await ctx.client.getMe({});
    if (ctx.json) {
      ctx.output.out(JSON.stringify(me, null, 2));
    } else {
      const { org, board, role, credential } = me.openboard;
      ctx.output.out(`${me.name} (${me.actor}) via ${credential}`);
      ctx.output.out(`org     ${org.slug} (${role})`);
      ctx.output.out(`board   ${board.slug}  ${ctx.boardUrl}`);
    }
    return 0;
  },
};
