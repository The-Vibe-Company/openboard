import { expect, test } from "bun:test";
import { decideClaimTask, decideCompleteTask, decideCreateTask, decideSettlement } from "@openboard/core";
import { testScope } from "@openboard/ports/testkit";
import { createTestDatabases, postgresDriver } from "../src/index.ts";
import { postgresTestUrl } from "./support/env.ts";

const url = postgresTestUrl();
const now = 1_700_000_000_000;
const context = { by: { actor: "owner", principal: "owner", profile: null }, now };

if (url) {
  test("an older completion cannot strand a dependant during a rolling deploy", async () => {
    const databases = await createTestDatabases(url, () => now);
    const database = await databases.create();
    const store = await postgresDriver({ url: database.url }, () => now);
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("missing local/main fixture board");
      const board = store.board(testScope(keys));
      const { id, dependant } = await board.write(async (writer) => {
        const root = decideCreateTask(writer, { channel: "dev", text: "build" }, context);
        const id = Number(root.task.id);
        const dependant = decideCreateTask(
          { head: root.task.version },
          { channel: "dev", text: "deploy" },
          { ...context, needs: { ids: [id], waitingOn: 1 } },
        );
        const { events } = decideClaimTask(
          { head: dependant.task.version, target: root.task },
          { id: root.task.id, tokenHash: "00".repeat(32) },
          context,
        );
        await writer.append([...root.events, ...dependant.events, ...events]);
        return { id, dependant: Number(dependant.task.id) };
      });

      const proof = { tokenMatches: true, until: now + 900_000 };
      const input = { id: String(id), epoch: 1, result: null };
      await expect(
        board.write(async (writer) => {
          const target = await writer.taskRoot(id);
          const { events } = decideCompleteTask({ head: writer.head, actor: null, target, proof }, input, context);
          const legacy = events.map((event) => {
            if (event.type !== "task.completed") return event;
            const { hasDependants: _hasDependants, ...payload } = event.payload;
            return { ...event, payload };
          });
          await writer.append(legacy);
        }),
      ).rejects.toMatchObject({ code: "unavailable", status: 503 });
      expect((await board.taskRoot(id))?.task?.state).toBe("claimed");
      expect((await board.taskRoot(dependant))?.task?.state).toBe("waiting");

      await board.write(
        async (writer) => {
          const target = await writer.taskRoot(id);
          const dependants = await writer.taskDependants(id);
          const { events } = decideSettlement(
            { head: writer.head, actor: null, target, proof },
            input,
            context,
            dependants,
          );
          await writer.append(events);
        },
        context.by.actor,
        id,
      );
      expect((await board.taskRoot(id))?.task?.state).toBe("completed");
      expect((await board.taskRoot(dependant))?.task?.state).toBe("ready");
    } finally {
      await store.close();
      await database.drop();
      await databases.close();
    }
  });
}
