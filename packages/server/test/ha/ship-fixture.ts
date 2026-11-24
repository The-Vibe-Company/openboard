import { expect } from "bun:test";
import type { Bucket, Store } from "@openboard/ports";
import { createApp, maintenanceJobs } from "../../src/index.ts";
import { signIn } from "../isolation/seed.ts";
import { LOCAL_OWNER, makeApp, NOW, PUBLIC_URL } from "../support/app.ts";
import type { openSnapshotStore } from "../support/drivers.ts";

export function fakeClock() {
  let now = NOW;
  const timers = new Map<() => void | Promise<void>, number>();
  const shippingRunners = new Set<string>();
  const armed = Promise.withResolvers<void>();
  const purgeArmed = Promise.withResolvers<void>();
  return {
    now: () => now,
    armed: armed.promise,
    purgeArmed: purgeArmed.promise,
    schedule(delay: number, run: () => void | Promise<void>, shippingRunner?: string) {
      timers.set(run, now + delay);
      if (shippingRunner !== undefined) shippingRunners.add(shippingRunner);
      if (shippingRunners.size === 2) armed.resolve();
      if (delay > 86_400_000) purgeArmed.resolve();
      return () => {
        timers.delete(run);
      };
    },
    async advance(at: number) {
      now = at;
      await Promise.all(
        [...timers]
          .filter(([, time]) => time <= at)
          .map(async ([run]) => {
            timers.delete(run);
            await run();
          }),
      );
    },
  };
}

export function runner(
  store: Store,
  bucket: Bucket,
  clock: ReturnType<typeof fakeClock>,
  id: string,
  polls: string[],
  errors?: string[],
) {
  return createApp(
    { mode: "hosted", publicUrl: PUBLIC_URL, localOwner: LOCAL_OWNER },
    {
      store,
      blobs: store.blobs,
      jobs: {
        ...store.jobs,
        watch(kinds, schedule, wake) {
          const shipSchedule: typeof schedule = (delay, run) => clock.schedule(delay, run, id);
          return store.jobs.watch(kinds, kinds.includes("ship-log") ? shipSchedule : schedule, wake);
        },
        claim(kinds, lease) {
          if (kinds.includes("ship-log")) polls.push(id);
          return store.jobs.claim(kinds, lease);
        },
      },
      bucket,
    },
    {
      now: clock.now,
      schedule: clock.schedule,
      log: {
        info() {},
        error(message) {
          if (!errors) throw new Error(message);
          errors.push(message);
        },
      },
      requestId: () => id,
      randomBytes: (length) => new Uint8Array(length),
    },
    maintenanceJobs,
  );
}

export async function keysFor(store: Store, org: string, board: string) {
  const keys = await store.platform().findBoard(org, board);
  if (!keys) throw new Error("missing fixture board");
  return keys;
}

export async function fixtureFor(store: ReturnType<typeof openSnapshotStore>, withPosts = true, now?: () => number) {
  const app = makeApp({ store, mode: "hosted", now });
  const send = (path: string, headers: Record<string, string>, body?: object) =>
    app.fetch(
      new Request(PUBLIC_URL + path, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        ...(body && { body: JSON.stringify(body) }),
      }),
    );
  const a = (await signIn(store, "alpha-owner", "a")).headers;
  const b = (await signIn(store, "bravo-owner", "b")).headers;
  expect((await send("/api/x/orgs", a, { slug: "alpha", name: "Alpha" })).status).toBe(201);
  expect((await send("/api/x/orgs", b, { slug: "bravo", name: "Bravo" })).status).toBe(201);
  if (withPosts) {
    expect((await send("/api/alpha/main/messages", a, { channel: "dev", text: "Alpha only" })).status).toBe(201);
    expect((await send("/api/bravo/main/messages", b, { channel: "dev", text: "Bravo only" })).status).toBe(201);
  }
  return { app, a, b, send };
}
