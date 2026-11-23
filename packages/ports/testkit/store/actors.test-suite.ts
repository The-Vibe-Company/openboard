import { afterEach, expect, test } from "bun:test";
import type { Actor } from "@openboard/contract";
import { messages } from "@openboard/core";
import type { BoardView, Store } from "../../src/index.ts";
import { type OpenStore, testScope } from "../index.ts";

const at = 1_700_000_000_000;

function person(handle: string, name = handle): Actor {
  return { id: `ob:user:${handle}`, kind: "person", handle, name, avatar: null };
}

/** Posts as `as`, with the record the write read under the lock, and returns that record. */
function postAs(board: BoardView, as: Actor) {
  const by = { actor: as.id, principal: as.id, profile: null };
  return board.write(async (writer) => {
    const state = { head: writer.head, actor: writer.actor };
    const { id: _, ...author } = as;
    const { events } = messages.decidePost(state, { channel: "dev", text: "hi" }, { by, author, now: at });
    await writer.append(events);
    return writer.actor;
  }, as.id);
}

export function actorsSuite(driver: string, open: OpenStore): void {
  let store: Store | undefined;
  afterEach(() => store?.close());

  async function board(): Promise<BoardView> {
    store = await open();
    const keys = await store.platform().findBoard("local", "main");
    if (!keys) throw new Error("the implicit board local/main is missing");
    return store.board(testScope(keys));
  }

  test(`${driver}: lists every actor that wrote, once, by handle, with the board head`, async () => {
    const main = await board();
    expect(await main.listActors()).toEqual({ actors: [], head: 0 });
    expect(await postAs(main, person("zed"))).toBeNull();
    expect(await postAs(main, person("ada"))).toBeNull();
    expect(await postAs(main, person("zed"))).toEqual(person("zed"));
    expect(await main.listActors()).toEqual({ actors: [person("ada"), person("zed")], head: 5 });
  });

  test(`${driver}: keeps an actor's latest details when it shows otherwise`, async () => {
    const main = await board();
    await postAs(main, person("ada"));
    await postAs(main, person("ada", "Ada Lovelace"));
    expect(await main.listActors()).toEqual({ actors: [person("ada", "Ada Lovelace")], head: 4 });
  });

  test(`${driver}: reads no record without an actor named, and shows no actor to another organization`, async () => {
    const main = await board();
    await postAs(main, person("ada"));
    expect(await main.write(async (writer) => writer.actor)).toBeNull();
    const keys = await store?.platform().findBoard("local", "main");
    if (!keys || !store) throw new Error("the implicit board local/main is missing");
    const other = store.board(testScope({ ...keys, orgId: keys.orgId + 1 }));
    expect(await other.listActors()).toEqual({ actors: [], head: 0 });
  });
}
