import { BoardError, type WebhookFilter } from "@openboard/contract";
import { isTailMessage, matchesTailEvent, parseTail } from "../events/tail.ts";

export function validateWebhookFilter(filter: WebhookFilter) {
  if (filter.became !== undefined) throw new BoardError("invalid_request", "webhook transitions are not available yet");
  return parseTail(filter.tail);
}

export function matchesWebhookFilter(
  filter: WebhookFilter,
  event: Parameters<typeof matchesTailEvent>[0],
  resolved: Parameters<typeof matchesTailEvent>[1] & { all: boolean },
  previous: Parameters<typeof matchesTailEvent>[2],
  root: Parameters<typeof matchesTailEvent>[3],
): boolean {
  return (
    (!filter.types || filter.types.includes(event.type)) &&
    isTailMessage(event, resolved.all) &&
    matchesTailEvent(event, resolved, previous, root)
  );
}
