import { BoardError, type Message, type WebhookFilter } from "@openboard/contract";
import { isTailMessage, matchesTailEvent, parseTail } from "../events/tail.ts";

export function validateWebhookFilter(filter: WebhookFilter) {
  if (filter.became !== undefined && (filter.became.task !== "ready" || Object.keys(filter.became).length !== 1)) {
    throw new BoardError("invalid_request", 'became: expected { "task": "ready" }');
  }
  return parseTail(filter.tail);
}

export function matchesWebhookFilter(
  filter: WebhookFilter,
  event: Parameters<typeof matchesTailEvent>[0],
  resolved: Parameters<typeof matchesTailEvent>[1] & { all: boolean },
  previous: Message | undefined,
  root: Parameters<typeof matchesTailEvent>[3],
): boolean {
  const target = filter.became?.task;
  if (
    target !== undefined &&
    (event.thread !== event.message ||
      event.type === "message.posted" ||
      previous?.task?.state === target ||
      event.payload.view.task?.state !== target)
  )
    return false;
  return (
    (!filter.types || filter.types.includes(event.type)) &&
    isTailMessage(event, resolved.all) &&
    matchesTailEvent(event, resolved, previous, root)
  );
}
