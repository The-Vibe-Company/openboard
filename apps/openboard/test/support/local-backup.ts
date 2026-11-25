import { fakeBucket } from "@openboard/ports/testkit";
import type { App } from "@openboard/server";
import { mintLocalOwnerToken } from "@openboard/server";
import { compose } from "../../src/compose.ts";
import { loadConfig } from "../../src/config.ts";

export const start = Date.UTC(2026, 0, 1);
export const prefix = "org/1/";

export function restoreClock() {
  let time = start;
  const timers = new Map<() => void | Promise<void>, number>();
  const ready = Promise.withResolvers<void>();
  return {
    armed: ready.promise,
    now: () => time,
    schedule(delay: number, run: () => void | Promise<void>) {
      timers.set(run, time + delay);
      if (delay === 0) ready.resolve();
      return () => {
        timers.delete(run);
      };
    },
    async advance(at: number) {
      time = at;
      const dueTimers = Array.from(timers).filter(([, due]) => due <= at);
      for (const [run] of dueTimers) if (timers.delete(run)) await run();
    },
  };
}

export function request(
  app: App,
  base: string,
  token: string,
  path: string,
  body?: string | Uint8Array<ArrayBuffer>,
  headers?: Record<string, string>,
) {
  return app.fetch(
    new Request(`${base}/api/local/main/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, ...headers },
      ...(body === undefined ? {} : { body }),
    }),
  );
}

export async function startBoard(dir: string) {
  const config = loadConfig({
    OPENBOARD_DATA_DIR: dir,
    OPENBOARD_BACKUP_S3_ENDPOINT: "http://127.0.0.1:9000",
    OPENBOARD_BACKUP_S3_BUCKET: "backups",
    OPENBOARD_BACKUP_S3_REGION: "us-east-1",
    OPENBOARD_BACKUP_S3_ACCESS_KEY_ID: "sample-access",
    OPENBOARD_BACKUP_S3_SECRET_ACCESS_KEY: "sample-secret",
  });
  const owner = mintLocalOwnerToken(new Uint8Array(42).fill(7));
  const store = fakeBucket();
  const clock = restoreClock();
  const errors: string[] = [];
  const snapshot = Promise.withResolvers<void>();
  const put = store.bucket.putStream;
  store.bucket.putStream = async (...args) => {
    await put(...args);
    snapshot.resolve();
  };
  const app = await compose(config, owner.hash, {
    deps: {
      ...clock,
      log: {
        info() {},
        error: (message) => {
          errors.push(message);
        },
      },
    },
    backupBucket: () => store.bucket,
  });
  const send = (path: string, body: string | Uint8Array<ArrayBuffer>, headers: Record<string, string>) =>
    request(app, config.publicUrl, owner.token, path, body, headers);
  return {
    ...store,
    app,
    config,
    owner,
    clock,
    errors,
    snapshot: snapshot.promise,
    send,
    post: (text: string, attachments: string[] = []) =>
      send("messages", JSON.stringify({ channel: "dev", text, attachments }), { "content-type": "application/json" }),
  };
}
