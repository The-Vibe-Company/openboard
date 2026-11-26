import { expect, test } from "bun:test";
import { DRAIN_TIMEOUT_MS } from "../src/app.ts";
import { BOARD_URL, call, makeApp, OWNER } from "./support/app.ts";

test("event waits, watcher pulls and task claims share an instance ceiling that recovers on abort and timeout", async () => {
  const timers = new Set<() => void>();
  let full = Promise.withResolvers<void>();
  const app = makeApp({
    schedule(delay, expire) {
      if (delay === DRAIN_TIMEOUT_MS) return () => {};
      if (delay !== 5000) throw new Error(`unexpected timer: ${delay}`);
      timers.add(expire);
      if (timers.size === 500) full.resolve();
      return () => {
        timers.delete(expire);
      };
    },
  });
  const [instance] = app.instances;
  if (!instance) throw new Error("expected a test instance");
  const controllers = Array.from({ length: 500 }, () => new AbortController());
  const events = (signal: AbortSignal) =>
    instance.fetch(
      new Request(`${BOARD_URL}/events?wait=5`, {
        headers: { authorization: `Bearer ${OWNER.token}` },
        signal,
      }),
    );
  const waiting = controllers.map(({ signal }) => events(signal));
  const refill = new AbortController();
  const replacements: Promise<Response>[] = [];
  const claim = () => call(instance, "POST", "/tasks/claim", { channel: "dev", wait: 5 });
  try {
    await Promise.race([
      full.promise,
      Promise.race(waiting).then(() => {
        throw new Error("event request returned before the ceiling was reached");
      }),
    ]);
    for (const response of await Promise.all([
      call(instance, "GET", "/events?wait=5"),
      call(instance, "GET", "/watchers/matches?wait=5"),
      claim(),
    ])) {
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("1");
      expect(await response.json()).toMatchObject({ error: { code: "rate_limited" } });
    }
    const [aborted] = waiting;
    controllers[0]?.abort();
    expect((await aborted)?.status).toBe(200);
    const expireOne = timers.values().next().value;
    expireOne?.();
    await Promise.race(waiting.slice(1));
    expect(timers.size).toBe(498);
    const invalid = await call(instance, "GET", "/events?after=999999&wait=5");
    expect(invalid.status).toBe(400);

    full = Promise.withResolvers<void>();
    replacements.push(events(refill.signal), events(refill.signal));
    await Promise.race([
      full.promise,
      Promise.race(replacements).then(() => {
        throw new Error("a released wait slot could not be reused");
      }),
    ]);
  } finally {
    for (const controller of controllers) controller.abort();
    refill.abort();
    await Promise.all([...waiting, ...replacements]);
    await app.close();
  }
});
