import type { Writable } from "node:stream";

/** Resolves false when the reader closes the pipe or the command is interrupted. */
export function writeLine(stream: Writable, line: string, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted || stream.destroyed) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    const stop = () => finish(false);
    const drain = () => finish(true);
    const cleanup = () => {
      stream.off("drain", drain);
      signal.removeEventListener("abort", stop);
    };
    const finish = (written: boolean) => {
      cleanup();
      resolve(written);
    };
    const release = () => {
      stream.off("error", error);
      stream.off("close", close);
    };
    const close = () => {
      release();
      finish(false);
    };
    const error = (cause: NodeJS.ErrnoException) => {
      release();
      cleanup();
      if (cause.code === "EPIPE") resolve(false);
      else reject(cause);
    };
    stream.once("error", error);
    stream.once("close", close);
    signal.addEventListener("abort", stop, { once: true });
    try {
      const ready = stream.write(`${line}\n`, (cause) => {
        // Writable emits the error after invoking this callback.
        if (cause) return;
        release();
        if (ready) finish(true);
      });
      if (!ready) stream.once("drain", drain);
    } catch (cause) {
      error(cause as NodeJS.ErrnoException);
    }
  });
}
