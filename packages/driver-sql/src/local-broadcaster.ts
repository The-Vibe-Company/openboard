import type { BoardScope, Broadcaster, CommittedPage } from "@openboard/ports";

function key({ orgId, boardId }: BoardScope): string {
  return `${orgId}/${boardId}`;
}

type Subscription = { fromPosition: number; wake: (page?: CommittedPage) => void };

/** One instance's wake-ups, each carrying the committed page, so a subscriber need not read what was just written. */
export function localBroadcaster(): Broadcaster {
  const boards = new Map<string, Set<Subscription>>();
  return {
    publish(scope, page) {
      const id = key(scope);
      const subscribers = boards.get(id);
      if (!subscribers) return;
      for (const subscription of subscribers) {
        if (page.head <= subscription.fromPosition) continue;
        try {
          subscription.wake(page);
        } catch {
          // A failed subscriber cannot turn a committed write into an error or stop other notifications.
          subscribers.delete(subscription);
        }
      }
      if (subscribers.size === 0 && boards.get(id) === subscribers) boards.delete(id);
    },
    subscribe(scope, fromPosition, wake) {
      const id = key(scope);
      const subscribers = boards.get(id) ?? new Set();
      boards.set(id, subscribers);
      const subscription: Subscription = { fromPosition, wake };
      subscribers.add(subscription);
      return () => {
        if (subscribers.delete(subscription) && subscribers.size === 0) boards.delete(id);
      };
    },
  };
}
