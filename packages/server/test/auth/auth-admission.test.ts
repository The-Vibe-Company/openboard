import { expect, spyOn, test } from "bun:test";
import { limitAuthentication } from "../../src/auth/chain.ts";
import { requestRateLimits } from "../../src/http/limits.ts";
import { BOARD_URL, makeApp, NOW, OWNER } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

test("aborted auth waiters leave the queue before a slot opens", async () => {
  const store = openStore(() => NOW);
  try {
    const limits = requestRateLimits(() => NOW, store.platform());
    const ip = "198.51.100.1";
    const disconnected = new AbortController();
    disconnected.abort();
    await expect(limits.admitAuth(ip, disconnected.signal)).rejects.toBe(disconnected.signal.reason);

    const held = await Promise.all(Array.from({ length: 20 }, () => limits.admitAuth(ip)));
    const cancelled = new AbortController();
    const removeCancelledListener = spyOn(cancelled.signal, "removeEventListener");
    const queued = limitAuthentication({ rateLimits: limits, ip, signal: cancelled.signal }, async () => {
      throw new Error("cancelled authentication should not run");
    }).catch((error: unknown) => error);
    const next = new AbortController();
    const removeListener = spyOn(next.signal, "removeEventListener");
    const waiting = limits.admitAuth(ip, next.signal);
    cancelled.abort();
    // All slots are still held when the disconnected request settles.
    expect(removeCancelledListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(await queued).toBe(cancelled.signal.reason);

    const [first, ...rest] = held;
    if (typeof first !== "function") throw new Error("expected an auth slot");
    first(false);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    const admitted = await waiting;
    if (typeof admitted !== "function") throw new Error("expected the next waiter to receive the slot");
    admitted(false);
    for (const finish of rest) {
      if (typeof finish !== "function") throw new Error("expected an auth slot");
      finish(false);
    }
  } finally {
    await store.close();
  }
});

test("board HTTP authentication receives the request's abort signal", async () => {
  const app = makeApp();
  try {
    const controller = new AbortController();
    controller.abort(new Error("fixture request disconnected"));
    const response = await app.fetch(
      new Request(`${BOARD_URL}/events`, {
        headers: { authorization: `Bearer ${OWNER.token}` },
        signal: controller.signal,
      }),
      { ip: "198.51.100.1" },
    );
    expect(response.ok).toBe(false);
    expect(app.logged).toContainEqual(
      expect.objectContaining({
        message: "request failed",
        stack: expect.stringContaining("fixture request disconnected"),
      }),
    );
  } finally {
    await app.close();
  }
});

test("auth admission caps the combined waiter queue across IPs and reuses released slots", async () => {
  const store = openStore(() => NOW);
  const controller = new AbortController();
  try {
    const limits = requestRateLimits(() => NOW, store.platform());
    const ips = ["198.51.100.1", "198.51.100.2"] as const;
    const held = await Promise.all(ips.flatMap((ip) => Array.from({ length: 20 }, () => limits.admitAuth(ip))));
    const cancelled = limits.admitAuth(ips[0], controller.signal);
    const queued = Array.from({ length: 255 }, (_, index) => limits.admitAuth(ips[index % 2 === 0 ? 0 : 1]));
    const ip = "198.51.100.1";
    await expect(limitAuthentication({ rateLimits: limits, ip }, async () => false)).rejects.toMatchObject({
      code: "rate_limited",
      next: [{ kind: "wait", seconds: 1 }],
    });
    controller.abort();
    await expect(cancelled).rejects.toBe(controller.signal.reason);
    const replacement = limits.admitAuth(ip);
    expect(await limits.admitAuth(ip)).toBe(1);
    for (const finish of held) {
      if (typeof finish !== "function") throw new Error("expected an auth slot");
      finish(false);
    }
    for (const waiting of [...queued, replacement]) {
      const finish = await waiting;
      if (typeof finish !== "function") throw new Error("expected a queued auth slot");
      finish(false);
    }
  } finally {
    controller.abort();
    await store.close();
  }
});
