import { type Command, Misuse } from "./index.ts";

function expiryText(expiresAt: number, now: number): string {
  const remaining = expiresAt - now;
  if (remaining <= 0) return ", expired";
  const minutes = Math.floor(remaining / 60_000);
  if (minutes >= 1440) return `, expires in ${Math.floor(minutes / 1440)}d`;
  if (minutes >= 60) return `, expires in ${Math.floor(minutes / 60)}h`;
  return `, expires in ${minutes === 0 ? "<1" : minutes}m`;
}

export const whoamiCommand: Command = {
  async run(ctx) {
    if (ctx.args.length > 0) throw new Misuse("whoami takes no arguments");
    const me = await ctx.client.getMe({});
    if (ctx.json) {
      ctx.output.out(JSON.stringify(me, null, 2));
    } else {
      const { org, board, role, credential } = me.openboard;
      if (credential === "agent") {
        const connection = me.handle.split("/")[0];
        ctx.output.out(`${me.name} via ${connection} (credential: agent)`);
      } else if (me.kind === "person" && me.credential?.kind === "personal") {
        const { name, expiresAt } = me.credential;
        const label = name === undefined ? "" : ` ${JSON.stringify(name)}`;
        const expiry = expiresAt === undefined ? "" : expiryText(expiresAt, ctx.now());
        ctx.output.out(`${me.handle} (${me.actor}) via personal token${label}${expiry}`);
      } else {
        ctx.output.out(`${me.name} (${me.actor}) via ${credential}`);
      }
      ctx.output.out(`org     ${org.slug}${role === null ? "" : ` (${role})`}`);
      ctx.output.out(`board   ${board.slug}  ${ctx.boardUrl}`);
      for (const [pattern, permissions] of Object.entries(me.can)) {
        ctx.output.out(`can     ${pattern}  ${permissions.join(" ")}`);
      }
    }
    return 0;
  },
};
