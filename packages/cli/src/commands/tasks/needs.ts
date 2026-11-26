import { type RegisteredCommand as Command, Misuse } from "../index.ts";

export function taskNeedsCommand(words: readonly string[]): Command {
  return {
    words,
    usage: "ob tasks needs <id> (<needs>... | --none)",
    async run(ctx) {
      let none = false;
      const positional: string[] = [];
      for (const [index, word] of ctx.args.entries()) {
        if (index >= ctx.optionsEnd || !word.startsWith("--")) positional.push(word);
        else if (word === "--none") none = true;
        else throw new Misuse(`unknown option ${word}`);
      }
      const [id, ...needs] = positional.map((ref) => ref.replace(/^#/, ""));
      if (!id || none === needs.length > 0) {
        throw new Misuse("expected a task ID followed by prerequisite IDs or --none");
      }
      const { task } = await ctx.client.setTaskNeeds({ id, needs });
      const prerequisites = task.task.needs.map((need) => `#${need}`).join(" ");
      ctx.output.out(
        ctx.json ? JSON.stringify({ task, outcome: "set" }, null, 2) : `${task.id} needs ${prerequisites || "nothing"}`,
      );
      return 0;
    },
  };
}
