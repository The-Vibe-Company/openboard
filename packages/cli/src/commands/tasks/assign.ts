import { type Command, Misuse } from "../index.ts";

export function profileActor(owner: string, profile: string): string {
  return profile.includes(":") || profile.includes("+") ? profile : `${owner}+${profile.toLowerCase()}`;
}

export function taskAssignCommand(words: readonly string[]): Command {
  return {
    words,
    usage: "ob tasks assign <id> (<profile> | --pool)",
    async run(ctx) {
      let pool = false;
      const positional: string[] = [];
      for (const [index, word] of ctx.args.entries()) {
        if (index >= ctx.optionsEnd || !word.startsWith("--")) positional.push(word);
        else if (word === "--pool") pool = true;
        else throw new Misuse(`unknown option ${word}`);
      }
      const [ref, profile] = positional;
      const id = ref?.replace(/^#/, "");
      if (!id || positional.length !== (pool ? 1 : 2)) {
        throw new Misuse("expected a task ID and either a profile or --pool");
      }
      let assignee: string | null = null;
      if (profile !== undefined) {
        const { message } = await ctx.client.readThread({ id });
        assignee = profileActor(message.task?.owner ?? (await ctx.client.getMe({})).principal, profile);
      }
      const { task } = await ctx.client.assignTask({ id, for: assignee });
      const outcome = pool ? "unassigned" : "assigned";
      const display = assignee?.slice(assignee.lastIndexOf("+") + 1);
      ctx.output.out(
        ctx.json ? JSON.stringify({ task, outcome }, null, 2) : `${outcome} ${task.id}${pool ? "" : ` to ${display}`}`,
      );
      return 0;
    },
  };
}
