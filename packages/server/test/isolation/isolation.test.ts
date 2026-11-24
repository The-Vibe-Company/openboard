import { afterAll, describe, expect, test } from "bun:test";
import { operations } from "@openboard/contract";
import { authenticated, type Call, callOf, idCases, pathCases, refFields } from "./cases.ts";
import { type Headers, seed } from "./seed.ts";

const seeded = await seed();
const { a, b } = seeded;
afterAll(async () => {
  await seeded.app.close();
  await seeded.store.close();
});

const send = (call: Call, headers: Headers) => seeded.send(call.method, call.path, headers, call.body);
/** B's slug, which every name B's seed gives carries: no answer to A may contain it. */
const holdsB = (text: string) => text.toLowerCase().includes(b.org);

/** The status and error code of an answer, which is all an unknown ID may tell. */
async function outcome(response: Response): Promise<string> {
  const text = await response.text();
  try {
    return `${response.status} ${(JSON.parse(text) as { error?: { code?: string } }).error?.code}`;
  } catch {
    return `${response.status} ${text}`;
  }
}

/** Lists, feeds and tails: read-only operations that name no single resource in their path. */
const lists = authenticated.filter(
  (operation) => operation.effects.readOnly && !refFields(operation).some(({ part }) => part === "params"),
);

/**
 * What B's owner and credentials read of B: every read-only operation as B's owner, `GET /me` with each of B's
 * board-bound credentials, and B's invitation link. Equal before and after the run, or A changed B.
 */
async function digestOfB(): Promise<string> {
  const reads: string[] = [];
  const read = async (what: string, call: Call, headers: Headers) => {
    const response = await send(call, headers);
    reads.push(`${what} ${response.status} ${await response.text()}`);
  };
  for (const operation of authenticated.filter((candidate) => candidate.effects.readOnly)) {
    await read(operation.name, callOf(operation, b), b.session);
  }
  const me = { method: "GET", path: `/api/${b.org}/${b.board}/me` };
  for (const credential of ["personal", "connection", "agent"] as const) await read(credential, me, b[credential]);
  await read("invitation", { method: "GET", path: `/api/x/invitations/${b.invitationToken}` }, {});
  return reads.join("\n");
}

const before = await digestOfB();
const paths = pathCases(seeded);
const ids = idCases(seeded);
const counted = { path: 0, id: 0, list: 0 };

test("every contract operation declares a scope", () => {
  for (const operation of operations) {
    expect(operation.scope, `${operation.name} must declare a scope`).toBeTruthy();
  }
});

describe("path cases: A's credentials off A's board or organization", () => {
  for (const { name, call, headers, status } of paths) {
    test(name, async () => {
      const response = await send(call, headers);
      expect(response.status, `${name}: ${call.method} ${call.path}`).toBe(status);
      const code = status === 401 ? "unauthorized" : "not_found";
      expect(await response.json()).toMatchObject({ error: { code } });
      counted.path++;
    });
  }
});

/**
 * A stub answers as a board without the feature does, so its answer holds no data to tell A's from B's: A on A's board
 * must answer exactly as B on B's board (same status, same body), and B's IDs on A's URL as IDs no board holds.
 */
async function expectTwin(name: string, response: Response, twin: Call) {
  const theirs = await send(twin, b.session);
  const answered = `${name}: ${twin.method} ${twin.path}`;
  expect(response.status, answered).toBeLessThan(500);
  expect(`${response.status} ${await response.text()}`, answered).toBe(`${theirs.status} ${await theirs.text()}`);
}

describe("ID cases: B's IDs on A's own URL", () => {
  for (const { name, call, nowhere, startsAtHead, eventThread, twin } of ids) {
    test(name, async () => {
      const response = await send(call, a.session);
      const text = await response.clone().text();
      const answered = `${name}: ${call.method} ${call.path} -> ${response.status} ${text}`;
      expect(holdsB(text), answered).toBe(false);
      if (nowhere) {
        // B's ID must be indistinguishable from one no board holds.
        const absent = await send(nowhere, a.session);
        expect(await outcome(response), answered).toBe(await outcome(absent));
        if (call.path.includes("/events?")) expect(JSON.parse(text), answered).toMatchObject({ events: [] });
      } else if (twin) {
        await expectTwin(name, response, twin);
      } else {
        // An ID both boards hold names A's message.
        expect(response.status, answered).toBe(200);
        if (startsAtHead) {
          expect(JSON.parse(text), answered).toMatchObject({ events: [] });
        } else {
          expect(text.includes(a.marker), answered).toBe(true);
          if (eventThread !== undefined) {
            const { events } = JSON.parse(text) as { events: { message: { thread: string; text: string } }[] };
            expect(
              events.map(({ message }) => message.thread),
              answered,
            ).toEqual([eventThread, eventThread]);
            expect(
              events.every(({ message }) => message.text.includes(a.marker)),
              answered,
            ).toBe(true);
          }
        }
      }
      counted.id++;
    });
  }
});

describe("list cases: what A reads holds nothing of B", () => {
  for (const operation of lists) {
    test(operation.name, async () => {
      const call = callOf(operation, a);
      const response = await send(call, a.session);
      const text = await response.clone().text();
      expect(holdsB(text), `${operation.name} answered ${text}`).toBe(false);
      if (operation.stub) await expectTwin(operation.name, response, callOf(operation, b));
      else expect(response.status, `${operation.name}: ${call.path} -> ${text}`).toBeLessThan(300);
      counted.list++;
    });
  }
});

test("B reads the same before and after A's run", async () => {
  expect(await digestOfB()).toBe(before);
  const total = counted.path + counted.id + counted.list;
  process.stdout.write(
    `isolation: ${counted.path} path cases, ${counted.id} ID cases, ${counted.list} list cases (${total} passed)\n`,
  );
});
