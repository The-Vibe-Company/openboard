import type { Command, CommandMetadata, RegisteredCommand, StandaloneContext } from "../index.ts";

type StandaloneHandler = { run(ctx: StandaloneContext): Promise<number> };
type StandaloneCommand = CommandMetadata & StandaloneHandler & { readonly standalone: true };

function commandWords(usage: string): string[] {
  const name = /^ob ([a-z]+(?: [a-z]+)*)/.exec(usage)?.[1];
  if (!name) throw new Error(`Invalid command usage: ${usage}`);
  return name.split(" ");
}

function board(usage: string, load: () => Promise<Command>): RegisteredCommand {
  return { words: commandWords(usage), usage, run: async (ctx) => (await load()).run(ctx) };
}

function standalone(usage: string, load: () => Promise<StandaloneHandler>): StandaloneCommand {
  return { words: commandWords(usage), usage, standalone: true, run: async (ctx) => (await load()).run(ctx) };
}

export const handwrittenCommands: readonly (RegisteredCommand | StandaloneCommand)[] = [
  standalone("ob connect <url> --as <name> [--secret-file <path>]", () =>
    import("../connect.ts").then((m) => m.connectCommand),
  ),
  standalone("ob login <origin> [--can <scope>]", () => import("../login.ts").then((m) => m.loginCommand)),
  board("ob org invite [--email <email>] [--role member|admin] [--no-send] [--json]", () =>
    import("../org/invitations.ts").then((m) => m.inviteCommand),
  ),
  board("ob org invitations [--json]", () => import("../org/invitations.ts").then((m) => m.invitationsCommand)),
  board("ob org invite revoke <id> [--json]", () => import("../org/invitations.ts").then((m) => m.revokeInviteCommand)),
  board("ob members [--json]", () => import("../org/invitations.ts").then((m) => m.membersCommand)),
  board("ob org export", () => import("../org/export.ts").then((m) => m.exportOrgCommand)),
  board("ob org export download <id> --out <file>", () =>
    import("../org/export.ts").then((m) => m.downloadOrgExportCommand),
  ),
  board("ob download <id> [path]", () => import("../attachments/attach.ts").then((m) => m.downloadCommand)),
  board(
    "ob grants update <id> [--add-connection <id>] [--remove-connection <id>] [--add-project <id> --environment <names>] [--can <pattern=permissions>…] [--lock-me-out]",
    () => import("../grants.ts").then((m) => m.updateGrantCommand),
  ),
  standalone("ob use <board> | ob use <org>/<board>", () => import("../use.ts").then((m) => m.useCommand)),
  board(
    "ob connections create <name> --can <pattern=permissions>… [--direct] [--profiles <pattern,…>] [--claims <n>] " +
      "--secret-file <path>",
    () => import("../connections.ts").then((m) => m.createConnectionCommand),
  ),
  board("ob inbound create --file <spec.json> --secret-file <path>", () =>
    import("../inbound/index.ts").then((m) => m.createInboundCommand),
  ),
  board("ob webhooks create --file <spec.json> [--secret-file <path>]", () =>
    import("../webhooks/create.ts").then((m) => m.createWebhookCommand),
  ),
  board("ob webhooks disable <id>", () => import("../webhooks/state.ts").then((m) => m.disableWebhookCommand)),
  board("ob webhooks enable <id>", () => import("../webhooks/state.ts").then((m) => m.enableWebhookCommand)),
  board(
    "ob grants create --can <pattern=permissions>… [--user <id>] [--project <id> | --all-projects] [--environment <names>] " +
      "[--github <repository-or-subject>] [--workflow <file>] [--git-branch <branch>] [--event <event>] " +
      "[--oidc <issuer>] [--claim <name=value>] [--app <id>] [--all-apps] [--all-users] [--everyone] " +
      "[--connection <id>] [--all-connections] [--lock-me-out]\n" +
      "ob grants create --file <path|-> [--lock-me-out]",
    () => import("../grants.ts").then((m) => m.createGrantCommand),
  ),
  board(
    "ob grants explain <channel> [--user <id> | --project <id> [--environment <name>] | --github <repository> [--workflow <file>] [--git-branch <branch>] [--event <event>] | --oidc <issuer> [--claim <name=value>]… | --app <id> | --connection <id>]",
    () => import("../grants/explain.ts").then((m) => m.explainGrantsCommand),
  ),
  board("ob schemas create <id> (--file <path> | --data <json>) [--description <text>]", () =>
    import("../schemas/create.ts").then((m) => m.createSchemaCommand),
  ),
  board("ob connections rotate <name|id> [--overlap <duration>] --secret-file <path>", () =>
    import("../rotate.ts").then((m) => m.rotateConnectionCommand),
  ),
  board(
    "ob read <channel> [--label <key[=value]>]... [--by <handle>] [--mentions <handle>] [--text <text>] [--before <older> | --after <cursor>] [--limit <limit>] | ob read <id> [--after <id>] [--limit <limit>]",
    () => import("../read.ts").then((m) => m.readCommand),
  ),
  board("ob messages <channel> [--after <cursor>] [--limit <limit>]", () =>
    import("../messages.ts").then((m) => m.messagesCommand),
  ),
  board("ob reply <id> [<text>] [--after <id>] [--no-sync] [--idempotency-key <id>] [--attach <file>]...", () =>
    import("../reply.ts").then((m) => m.replyCommand),
  ),
  board(
    "ob schedule <channel|id> [<text>|-] [--in <duration> | --at <ISO time>] [--every <duration> [--until <ISO time> | --for <duration> | --times <count>]] [--no-sync] [--label <k=v>]... [--attach <file>]...",
    () => import("../schedule/index.ts").then((m) => m.scheduleCommand),
  ),
  board("ob schedules [<id>] [--channel <channel>] [--by <actor|handle>] [--all]", () =>
    import("../schedule/index.ts").then((m) => m.schedulesCommand),
  ),
  board("ob wait <channel|id> [--after <cursor>] [--timeout <duration>]", () =>
    import("../wait.ts").then((m) => m.waitCommand),
  ),
  board("ob tail <channel> [--last <n>]", () => import("../tail.ts").then((m) => m.tailCommand)),
  board("ob whoami", () => import("../whoami.ts").then((m) => m.whoamiCommand)),
];
