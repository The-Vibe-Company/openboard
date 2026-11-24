import { expect, test } from "bun:test";
import type { Db } from "@openboard/driver-sql";
import type { CommittedPage } from "@openboard/ports";
import { testScope } from "@openboard/ports/testkit";
import type { SQL } from "bun";
import { postgresBroadcaster } from "../src/broadcaster.ts";

/** A broadcaster whose LISTEN connection is a fake: the test delivers each notification itself. */
async function listening() {
  let deliver: (payload: string) => void = () => {};
  const sql = {
    listen: async (_channel: string, onNotify: (payload: string) => void) => {
      deliver = onNotify;
      return { unlisten: async () => {} };
    },
  } as unknown as SQL;
  const broadcaster = await postgresBroadcaster(sql, {} as Db, () => () => {});
  // A notification flushes on the next turn of the event loop, coalesced with others for the board.
  const notify = async (payload: string) => {
    deliver(payload);
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { broadcaster, notify };
}

test("an instance's own notification leaves the wake to its publish, which carries the page", async () => {
  const { broadcaster, notify } = await listening();
  const scope = testScope({ orgId: 1, boardId: 7 });
  const wakes: [CommittedPage | undefined, number][] = [];
  broadcaster.subscribe(scope, 1, (page, head) => wakes.push([page, head]));
  const page: CommittedPage = { after: 1, head: 3, events: [] };
  try {
    // The notifications of this instance's commit can arrive before the write returns and publishes its page, for its
    // last head and for any it set on the way.
    const release = broadcaster.committing?.(scope, 1, 3);
    await notify("7:2");
    await notify("7:3");
    expect(wakes).toEqual([]);
    broadcaster.publish(scope, page);
    release?.();
    expect(wakes).toEqual([[page, 3]]);
    // Another instance's commit still wakes without a page, and so does a head this instance no longer commits.
    await notify("7:4");
    expect(wakes.at(-1)).toEqual([undefined, 4]);
    broadcaster.committing?.(scope, 4, 5)();
    await notify("7:5");
    expect(wakes.at(-1)).toEqual([undefined, 5]);
  } finally {
    await broadcaster.close();
  }
});
