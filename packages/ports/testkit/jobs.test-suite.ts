import { expect, test } from "bun:test";
import { messages } from "@openboard/core";
import { type OpenStore, testScope } from "./index.ts";

export function runJobsSuite(driver: string, open: OpenStore): void {
  test(`${driver}: jobs honor due times, kinds, rollback, and lease ownership`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("local board is missing");
      const board = store.board(testScope(keys));
      const enqueue = () => board.write((writer) => writer.enqueue("test", 100, { message: "queued" }));
      await expect(
        board.write(async (writer) => {
          await writer.enqueue("test", 0, {});
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      await enqueue();

      const first = { instanceId: "first", claimedAt: 100 };
      const second = { instanceId: "second", claimedAt: 30_100 };
      expect(await store.jobs.claim(["test"], { ...first, claimedAt: 99 })).toBeNull();
      expect(await store.jobs.claim(["unknown"], first)).toBeNull();
      const job = await store.jobs.claim(["test"], first);
      if (!job) throw new Error("due job is missing");
      expect(job).toEqual({ ...keys, id: expect.any(String), kind: "test" });
      expect(await store.jobs.claim(["test"], { ...second, claimedAt: 30_099 })).toBeNull();
      expect(await store.jobs.claim(["test"], second)).toEqual(job);
      await board.write(async (writer) => {
        expect(await writer.takeJob(job.id, first, first.claimedAt)).toBeNull();
      });
      await expect(
        board.write(async (writer) => {
          expect(await writer.takeJob(job.id, second, second.claimedAt)).toEqual({ message: "queued" });
          const by = { actor: "ob:user:local-test", principal: "ob:user:local-test", profile: null };
          const post = messages.decidePost(
            { head: writer.head },
            { channel: "jobs/test", text: "must roll back" },
            { by, now: second.claimedAt },
          );
          await writer.append(post.events);
          throw new Error("effect failed");
        }),
      ).rejects.toThrow("effect failed");
      expect(await board.channelMessages({ channel: "jobs/test", limit: 10 })).toEqual([]);
      await board.write(async (writer) => {
        expect(await writer.takeJob(job.id, second, second.claimedAt)).toEqual({ message: "queued" });
        expect(await writer.takeJob(job.id, second, second.claimedAt)).toBeNull();
      });
      expect(await store.jobs.claim(["test"], { ...second, claimedAt: 100_000 })).toBeNull();
    } finally {
      await store.close();
    }
  });
}
