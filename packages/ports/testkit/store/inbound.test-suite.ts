import { expect, test } from "bun:test";
import { isoTime } from "@openboard/core";
import type { BoardView } from "../../src/index.ts";
import type { OpenStore } from "../index.ts";
import { at, storeTenant } from "../isolation-seed.ts";

export const inboundId = "ib_aaaaaaaaaaaaaaaa";
export const inboundCipher = { keyVersion: 1, ciphertext: "encrypted fixture" };

export async function seedInbound(board: BoardView, name: string, actor: string) {
  const inbound = {
    id: inboundId,
    name,
    can: { "*": "all" as const },
    thread: { from: "{{body.ref}}", pattern: "^ob:(\\d+)$" },
    rules: [],
    enabled: true,
    principal: `ob:hook:${inboundId}`,
    verify: { tolerance: 300 },
    createdAt: isoTime(at),
  };
  await board.write(async (writer) => {
    await writer.storeInboundSecret(inboundId, inboundCipher);
    await writer.append([
      {
        id: writer.head + 1,
        at,
        actor,
        principal: actor,
        channel: null,
        thread: null,
        message: null,
        visibility: 2,
        type: "ob.inbound.created",
        payload: { inbound, grantId: 7 },
      },
    ]);
  });
  return inbound;
}

export function inboundSuite(driver: string, open: OpenStore) {
  test(`${driver}: folds inbound endpoint deletion and removes its secret`, async () => {
    const store = await open();
    try {
      const { board, actor } = await storeTenant(store, "alpha", "a", 2);
      const inbound = await seedInbound(board, "alpha-only", actor);
      expect(await board.inboundEndpoints()).toEqual([{ inbound, grantId: 7 }]);
      await board.write(async (writer) => {
        expect(await writer.inboundSecret(inbound.id)).toEqual(inboundCipher);
        await writer.append([
          {
            id: writer.head + 1,
            at,
            actor,
            principal: actor,
            channel: null,
            thread: null,
            message: null,
            visibility: 2,
            type: "ob.inbound.deleted",
            payload: { id: inbound.id },
          },
        ]);
        expect(await writer.inboundSecret(inbound.id)).toBeNull();
      });
      expect(await board.inboundEndpoint(inbound.id)).toBeNull();
    } finally {
      await store.close();
    }
  });
}
