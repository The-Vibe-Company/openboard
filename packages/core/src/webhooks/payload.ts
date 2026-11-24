import type { Message } from "@openboard/contract";

import { renderWebhookTemplate } from "./template.ts";

const limit = 256 * 1024;
const encoder = new TextEncoder();

function webhookSubject(root: Message, message: string, url: string) {
  const task = root.task;
  return {
    channel: root.channel,
    thread: root.thread,
    message,
    task: task ? { id: root.thread, state: task.state, owner: task.owner, for: task.for, epoch: task.epoch } : null,
    labels: root.labels,
    schedule: null,
    url,
  };
}

function encodeWebhookPayload<T extends { event: { message: Message; payload: object } }>(payload: T): string | null {
  let body = JSON.stringify(payload);
  if (encoder.encode(body).length <= limit) return body;
  const text = Array.from(payload.event.message.text);
  const fields = payload.event.payload;
  const encode = (length: number) => {
    const shortened = text.slice(0, length).join("");
    return JSON.stringify({
      ...payload,
      truncated: true,
      event: {
        ...payload.event,
        message: { ...payload.event.message, text: shortened },
        payload: "text" in fields ? { ...fields, text: shortened } : fields,
      },
    });
  };
  body = encode(0);
  if (encoder.encode(body).length > limit) return null;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = encode(middle);
    if (encoder.encode(candidate).length <= limit) {
      body = candidate;
      low = middle;
    } else high = middle - 1;
  }
  return body;
}

export function webhookPayload(
  origin: string,
  org: string,
  board: string,
  delivery: { id: string; attempt: number; webhook: string; name: string },
  event: { message: Message; payload: object },
  root: Message,
  template: object | null = null,
): string | null {
  const path = `/${org}/${board}`;
  const threadUrl = `${origin}${path}/t/${event.message.thread}`;
  const payload = {
    type: "board.event",
    version: 1,
    delivery,
    board: { url: `${origin}/api${path}`, org, board },
    subject: webhookSubject(root, event.message.id, threadUrl),
    event,
  };
  return template === null ? encodeWebhookPayload(payload) : renderWebhookTemplate(template, payload, limit);
}
