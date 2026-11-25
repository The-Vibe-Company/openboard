import type { Logger } from "./deps.ts";

const sensitiveKey =
  /token|secret|authorization|cookie|password|signature|signing[-_]?key|body|^text$|message[-_]?text/i;

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface JsonLoggerOptions {
  /** The clock each line's `t` is read from, in epoch milliseconds. */
  readonly now: () => number;
  /** Minimum severity emitted; defaults to `"info"`. */
  readonly level?: LogLevel;
  /** Where each line goes; standard output unless a test collects them. */
  readonly write?: (line: string) => void;
}

/** Extract a concise, safe error message for structured operational logs. */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;
}

/** The server's one logger (docs/codebase.md 5.4): one JSON object per line, `{ "t", "level", "msg", ...fields }`. */
export function jsonLogger(options: JsonLoggerOptions): Logger {
  const write = options.write ?? ((line: string) => console.log(line));
  const suppressInfo = options.level === "warn" || options.level === "error";
  const emit = (level: string) => (msg: string, fields: Readonly<Record<string, unknown>>) =>
    write(
      JSON.stringify({ t: options.now(), level, msg, ...fields }, (key, value) =>
        sensitiveKey.test(key) ? undefined : value,
      ),
    );
  return {
    info: suppressInfo ? () => {} : emit("info"),
    error: emit("error"),
  };
}

/** `log` with `fields` added to every line it prints, so each line of one request carries its request ID. */
export function withFields(log: Logger, fields: Readonly<Record<string, unknown>>): Logger {
  return {
    info: (message, more) => log.info(message, { ...fields, ...more }),
    error: (message, more) => log.error(message, { ...fields, ...more }),
  };
}

/** What the request line says about one answer; filled in by the pipeline as each part becomes known. */
export interface RequestFields {
  /** The method and path, without the query. */
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
