import type { Logger } from "./deps.ts";

const sensitiveKey =
  /token|secret|authorization|cookie|password|signature|signing[-_]?key|body|^text$|message[-_]?text/i;

export interface JsonLoggerOptions {
  /** The clock each line's `t` is read from, in epoch milliseconds. */
  readonly now: () => number;
  /** Where each line goes; standard output unless a test collects them. */
  readonly write?: (line: string) => void;
}

/** The server's one logger (docs/codebase.md 5.4): one JSON object per line, `{ "t", "level", "msg", ...fields }`. */
export function jsonLogger(options: JsonLoggerOptions): Logger {
  const write = options.write ?? ((line: string) => console.log(line));
  const emit = (level: string) => (msg: string, fields: Readonly<Record<string, unknown>>) =>
    write(
      JSON.stringify({ t: options.now(), level, msg, ...fields }, (key, value) =>
        sensitiveKey.test(key) ? undefined : value,
      ),
    );
  return { info: emit("info"), error: emit("error") };
}

/** What the request line says about one answer; filled in by the pipeline as each part becomes known. */
export interface RequestFields {
  /** The method and path, without the query: the request until request IDs arrive. */
  req: string;
  /** The contract operation the route matched, or null when none did. */
  op: string | null;
  /** The organization slug the path names, or null outside a board. */
  org: string | null;
  /** Who the request was authenticated as, or null before authentication. */
  actor: string | null;
}

/** The one `info` line per request: the fields above, the answer's status and the time it took. */
export function logRequest(log: Logger, fields: RequestFields, status: number, ms: number): void {
  log.info("request", { ...fields, status, ms });
}
