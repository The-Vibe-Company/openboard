import { webhookText } from "../../output.ts";
import { type Command, Misuse } from "../index.ts";

function stateCommand(enabled: boolean): Command {
  const action = enabled ? "enable" : "disable";
  return {
    words: ["webhooks", action],
    usage: `ob webhooks ${action} <id>`,
    async run(ctx) {
      const [id] = ctx.args;
      if (!id || id.startsWith("--") || ctx.args.length !== 1) throw new Misuse("expected one webhook ID");
      const { webhook } = await ctx.client.updateWebhook({ id, enabled });
      ctx.output.out(ctx.json ? JSON.stringify(webhook, null, 2) : webhookText(webhook));
      return 0;
    },
  };
}

export const enableWebhookCommand = stateCommand(true);
export const disableWebhookCommand = stateCommand(false);
