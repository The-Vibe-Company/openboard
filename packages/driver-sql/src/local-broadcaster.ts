import type { BoardScope, Broadcaster } from "@openboard/ports";

function key({ orgId, boardId }: BoardScope): string {
  return `${orgId}/${boardId}`;
}

/** One instance's wake-ups. Both SQL drivers can deliver these without another database round trip. */
export function localBroadcaster(): Broadcaster {
  const boards = new Map<string, Set<{ fromPosition: number; wake: () => void }>>();
  return {
    publish(scope, position) {
      const id = key(scope);
      const subscribers = boards.get(id);
      if (!subscribers) return;
      for (const subscription of subscribers) {
        if (position <= subscription.fromPosition) continue;
        try {
          subscription.wake();
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
      const subscription = { fromPosition, wake };
      subscribers.add(subscription);
      return () => {
        if (subscribers.delete(subscription) && subscribers.size === 0) boards.delete(id);
      };
    },
  };
}
