import type { CallOptions, Client } from "./client.ts";

type Input<Method extends keyof Client> = Parameters<Client[Method]>[0];
type Fields<Method extends keyof Client, Keys extends keyof Input<Method> = "id" & keyof Input<Method>> = Omit<
  Input<Method>,
  Keys
>;

type ReplyFields = Fields<"postMessage", "channel" | "re" | "text">;

function taskFacade(client: Client) {
  return Object.freeze({
    create: client.createTask,
    createBatch: client.createTaskBatch,
    list: client.listTasks,
    get: (id: string, query?: Fields<"readThread">, request?: CallOptions) =>
      client.readThread({ ...query, id }, request),
    claim: (id: string, input?: Fields<"claimTask">, request?: CallOptions) =>
      client.claimTask({ ...input, id }, request),
    claimNext: client.claimNextTask,
    renew: (id: string, { epoch, token, lease }: Fields<"renewTask">, request?: CallOptions) =>
      client.renewTask({ id, epoch, token, lease }, request),
    reply: (id: string, text: string, input?: ReplyFields, request?: CallOptions) =>
      client.postMessage({ ...input, re: id, text }, request),
    complete: (
      id: string,
      result: string | undefined,
      { epoch, token }: Fields<"completeTask", "id" | "result">,
      request?: CallOptions,
    ) => client.completeTask({ id, result, epoch, token }, request),
    fail: (id: string, reason: string, { epoch, token }: Fields<"failTask", "id" | "reason">, request?: CallOptions) =>
      client.failTask({ id, reason, epoch, token }, request),
    block: (
      id: string,
      reason: string,
      { kind, epoch, token }: Fields<"blockTask", "id" | "reason"> = {},
      request?: CallOptions,
    ) => client.blockTask({ id, reason, kind, epoch, token }, request),
    unblock: (id: string, request?: CallOptions) => client.unblockTask({ id }, request),
    assign: (id: string, assignee: Input<"assignTask">["for"], request?: CallOptions) =>
      client.assignTask({ id, for: assignee }, request),
    release: (id: string, { epoch, token }: Fields<"releaseTask">, request?: CallOptions) =>
      client.releaseTask({ id, epoch, token }, request),
    reopen: (id: string, request?: CallOptions) => client.reopenTask({ id }, request),
    cancel: (id: string, reason: string, request?: CallOptions) => client.cancelTask({ id, reason }, request),
  });
}

function messageFacade(client: Client) {
  return Object.freeze({
    post: client.postMessage,
    reply: (channel: string, threadId: string, text: string, input?: ReplyFields, request?: CallOptions) =>
      client.postMessage({ ...input, channel, re: threadId, text }, request),
    edit: (id: string, text: string, input?: Fields<"editMessage", "id" | "text">, request?: CallOptions) =>
      client.editMessage({ ...input, id, text }, request),
    delete: (id: string, input?: Fields<"deleteMessage">, request?: CallOptions) =>
      client.deleteMessage({ ...input, id }, request),
    react: (id: string, emoji: string, input?: Fields<"reactToMessage", "id" | "emoji">, request?: CallOptions) =>
      client.reactToMessage({ ...input, id, emoji }, request),
    label: (
      id: string,
      labels: Input<"labelMessage">["set"],
      input?: Fields<"labelMessage", "id" | "set">,
      request?: CallOptions,
    ) => client.labelMessage({ ...input, id, set: labels }, request),
  });
}

export function addFacades(client: Client) {
  return Object.freeze({
    ...client,
    tasks: taskFacade(client),
    messages: messageFacade(client),
    threads: Object.freeze({
      list: client.listThreads,
      read: (id: string, query?: Fields<"readThread">, request?: CallOptions) =>
        client.readThread({ ...query, id }, request),
    }),
    channels: Object.freeze({
      list: (input: Input<"listChannels"> = {}, request?: CallOptions) => client.listChannels(input, request),
      create: client.createChannel,
    }),
    webhooks: Object.freeze({
      list: (request?: CallOptions) => client.listWebhooks({}, request),
      create: client.createWebhook,
      update: (id: string, input: Fields<"updateWebhook">, request?: CallOptions) =>
        client.updateWebhook({ ...input, id }, request),
      delete: (id: string, request?: CallOptions) => client.deleteWebhook({ id }, request),
      test: (id: string, request?: CallOptions) => client.testWebhook({ id }, request),
    }),
  });
}
