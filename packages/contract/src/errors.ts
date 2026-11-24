import { type Static, Type } from "@sinclair/typebox";

/**
 * Every error code the board answers, with its HTTP status (docs/codebase.md 5.3). Upstream's codes are kept verbatim:
 * every code of `docs/04-reference/03-http.md` (its "Errors" table and the codes its sections name); OpenBoard's own are
 * those of docs/protocol.md "Error envelope". A code listed under two statuses takes the first unless the thrower
 * names the other.
 */
const CODES = {
  400: [
    "invalid_request",
    "text_too_long",
    "invalid_cursor",
    "invalid_after",
    "invalid_profile",
    "invalid_scope",
    "message_deleted",
    "reserved_label",
    "invalid_needs",
    "batch_too_large",
    "invalid_from",
    "not_a_target",
    "bad_watcher",
    "invalid_block",
    "schema_not_found",
    "invalid_schema",
    "invalid_schema_id",
    "too_many_schemas",
    "size_mismatch",
    "platform_error",
    "invalid_target",
    "unsupported",
    "invalid_grant",
    "not_in_grant",
    "grant_empty",
    "invalid_url",
    "invalid_signing",
    "invalid_rule",
    "reserved_slug",
  ],
  401: ["unauthorized", "bad_signature"],
  403: [
    "forbidden",
    "task_not_owned",
    "private_channel",
    "shared_channel",
    "not_in_channel",
    "not_a_project",
    "join_disabled",
    "invitation_email_mismatch",
  ],
  404: [
    "not_found",
    "message_not_found",
    "schedule_not_found",
    "attachment_not_found",
    "post_not_found",
    "not_a_task",
    "batch_not_found",
    "schema_not_found",
    "thread_not_found",
    "no_registration",
    "no_match",
    "no_item",
    "not_synced_here",
    "channel_not_found",
    "grant_not_found",
  ],
  409: [
    "schema_immutable",
    "reserved_schema",
    "duplicate_id",
    "label_conflict",
    "revision_conflict",
    "newer_message",
    "already_a_task",
    "task_claimed",
    "task_assigned",
    "task_waiting",
    "task_blocked",
    "task_finished",
    "claim_lost",
    "already_synced",
    "not_synced",
    "sync_key_taken",
    "not_uploaded",
    "stale_lease",
    "grant_lockout",
    "channel_granted",
    "profile_taken",
    "already_in_org",
    "slug_taken",
    "last_owner",
  ],
  410: ["secret_spent", "invitation_used"],
  413: ["too_large"],
  429: ["ratelimited", "rate_limited", "quota_exceeded"],
  500: ["no_store", "internal"],
  501: [
    "no_scheduler",
    "no_tasks",
    "no_files",
    "no_schemas",
    "no_direct_uploads",
    "not_supported",
    "no_verifier",
    "no_wake_by_path",
    "no_wake_by_url",
    "no_grants",
  ],
  502: ["no_client", "list_failed", "unreachable", "remote_error"],
  503: ["unavailable"],
} as const;

export type ErrorCode = (typeof CODES)[keyof typeof CODES][number];

export interface ErrorSpec {
  /** The statuses this code is answered with; the first is the default. */
  readonly statuses: readonly number[];
  /** Stable finer causes an agent can branch on. */
  readonly reasons: readonly string[];
}

/** Finer causes per code; a code absent here takes no `reason`. */
const REASONS: Partial<Record<ErrorCode, readonly string[]>> = {
  quota_exceeded: ["boards", "members", "connections", "stored_bytes", "daily_events"],
  invalid_request: ["invalid_channel"],
  invalid_grant: ["invalid_channel"],
  bad_watcher: ["invalid_channel"],
};

function catalog(): Readonly<Record<ErrorCode, ErrorSpec>> {
  const statuses = new Map<ErrorCode, number[]>();
  for (const [status, codes] of Object.entries(CODES)) {
    for (const code of codes) statuses.set(code, [...(statuses.get(code) ?? []), Number(status)]);
  }
  const entries = [...statuses].map(([code, list]) => [
    code,
    Object.freeze({ statuses: list, reasons: REASONS[code] ?? [] }),
  ]);
  return Object.freeze(Object.fromEntries(entries));
}

export const ERRORS = catalog();

/** A way out of an error (docs/codebase.md 5.3). */
const NextStep = Type.Union([
  Type.Object({ kind: Type.Literal("run"), argv: Type.Unsafe<readonly string[]>(Type.Array(Type.String())) }),
  Type.Object({ kind: Type.Literal("call"), operation: Type.String(), input: Type.Unknown() }),
  Type.Object({ kind: Type.Literal("wait"), seconds: Type.Number() }),
  Type.Object({ kind: Type.Literal("read"), url: Type.String() }),
]);
export type NextStep = Readonly<Static<typeof NextStep>>;

const ErrorBody = Type.Object({
  code: Type.String(),
  message: Type.String(),
  reason: Type.Optional(Type.String()),
  hint: Type.Optional(Type.String()),
  next: Type.Optional(Type.Unsafe<readonly NextStep[]>(Type.Array(NextStep, { maxItems: 2 }))),
});
export type ErrorBody = Readonly<Static<typeof ErrorBody>>;
export const ErrorEnvelope = Type.Object({ error: ErrorBody });

export interface BoardErrorOptions {
  readonly reason?: string;
  readonly hint?: string;
  readonly next?: readonly [NextStep] | readonly [NextStep, NextStep];
  /** One of the code's other statuses (`schema_not_found` is 400 on a write and 404 on a read). */
  readonly status?: number;
}

/** An expected failure, answered as upstream's envelope `{ error: { code, message, hint } }` plus `reason` and `next`. */
export class BoardError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly reason: string | undefined;
  readonly hint: string | undefined;
  readonly next: readonly NextStep[] | undefined;

  constructor(code: ErrorCode, message: string, options: BoardErrorOptions = {}) {
    super(message);
    this.name = "BoardError";
    const spec = ERRORS[code];
    if (options.status !== undefined && !spec.statuses.includes(options.status)) {
      throw new TypeError(`${code} is never answered with ${options.status}`);
    }
    if (options.reason !== undefined && !spec.reasons.includes(options.reason)) {
      throw new TypeError(`${code} has no reason ${options.reason}`);
    }
    this.code = code;
    this.status = options.status ?? spec.statuses[0] ?? 500;
    this.reason = options.reason;
    this.hint = options.hint;
    this.next = options.next;
  }

  /** The `error` object of the wire envelope. */
  body(): ErrorBody {
    return {
      code: this.code,
      message: this.message,
      ...(this.reason === undefined ? {} : { reason: this.reason }),
      ...(this.hint === undefined ? {} : { hint: this.hint }),
      ...(this.next === undefined ? {} : { next: this.next }),
    };
  }
}

export function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(ERRORS, value);
}
