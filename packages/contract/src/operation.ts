import { type SchemaOptions, type Static, type TObject, type TSchema, type TString, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { BoardError, type ErrorCode } from "./errors.ts";

/** Where an operation is mounted and which tenant it is scoped to (docs/codebase.md 4.1). */
export type Scope = "public" | "account" | "org" | "board";
export type Method = "GET" | "POST" | "PATCH" | "DELETE";

/** Kinds of tenant resources an input field may name; the isolation suite seeds one of each. */
export type RefKind =
  | "message"
  | "thread"
  | "task"
  | "taskBatch"
  | "grant"
  | "schema"
  | "file"
  | "export"
  | "schedule"
  | "webhook"
  | "inbound"
  | "delivery"
  | "watcherMatch"
  | "connection"
  | "agent"
  | "member"
  | "org"
  | "invitation"
  | "board";

/** Marks an input field that names a tenant resource: an ID of 1 to 128 characters (upstream "IDs and cursors"). */
export function Ref(kind: RefKind, options: SchemaOptions = {}): TString {
  return Type.String({ minLength: 1, maxLength: 128, ...options, "x-ref": kind });
}

/** The `Ref` kind a schema carries, if any. */
export function refKind(schema: TSchema): RefKind | undefined {
  return (schema as { "x-ref"?: RefKind })["x-ref"];
}

export interface OperationInput {
  readonly params?: TObject;
  readonly query?: TObject;
  readonly body?: TObject;
}

export interface CliSpec {
  /** `ob <command…>`: `["post"]`, `["tasks", "claim"]`. */
  readonly command: readonly string[];
  /** Input fields taken as positional arguments, in order. */
  readonly args: readonly string[];
  /** Another positional form, `(<args…> | <alternative…>)`: exactly this many positionals fill these fields instead. */
  readonly alternative?: readonly string[];
  /** Input fields taken as `--<flag>` under another name than their own, as upstream's CLI names them. */
  readonly options?: Readonly<Record<string, string>>;
  /** Input fields supplied by the CLI from local state. */
  readonly implicit?: readonly string[];
  /** Repeatable `--flag key` options, mapping each flag to the record field where that key gets a null value. */
  readonly nullEntryOptions?: Readonly<Record<string, string>>;
}

export interface McpSpec {
  readonly tool: string;
}

/** A projection turned off needs a reason (docs/codebase.md 4.1). */
type Projections =
  | { readonly cli: CliSpec; readonly mcp: McpSpec; readonly why?: string }
  | { readonly cli: CliSpec | false; readonly mcp: McpSpec | false; readonly why: string };

export type Operation<
  I extends OperationInput = OperationInput,
  O extends TSchema = TSchema,
  N extends string = string,
  S extends Scope = Scope,
> = Projections & {
  /** camelCase, verb first, unique and stable. */
  readonly name: N;
  /** Upstream route name as published in OpenAPI, when it differs from the internal name. */
  readonly operationId?: string;
  readonly summary: string;
  /** Relative to `BOARD_URL` for `board` operations; upstream's path where one exists. */
  readonly route: { readonly method: Method; readonly path: string; readonly mount?: "/api/x" };
  readonly scope: S;
  /** A board operation authenticated by a signature over its raw request body. */
  readonly auth?: S extends "board" ? "signature" : never;
  /** An account operation that also accepts an unrestricted personal bearer. */
  readonly accountBearer?: "personal";
  readonly input: I;
  /** The route accepts an omitted request body as well as a JSON body. */
  readonly bodyOptional?: true;
  /** The body has no defaults and can be validated without cloning its JSON. */
  readonly bodyDefaults?: false;
  readonly output: O;
  /** The success media type for a raw string body. Defaults to JSON. */
  readonly responseType?: "image/svg+xml" | "application/gzip";
  readonly orgPersonalToken?: true;
  readonly invalidInputCode?: ErrorCode;
  /** Report a named body array's maxItems violation before validating individual items. */
  readonly bodyArrayLimitError?: { readonly array: string; readonly code: ErrorCode; readonly message: string };
  /** Use a different code for malformed items in a named body array. */
  readonly invalidBodyItemCode?: {
    readonly array: string;
    readonly code: ErrorCode;
    readonly describe?: (input: unknown, path: string, message: string) => string | undefined;
  };
  /** Optional alternate HTTP representation, negotiated through Accept. */
  readonly eventStream?: "text/event-stream";
  /** The success status, or the boolean output field that distinguishes 201 from 200. */
  readonly status?: 200 | 201 | 202 | { readonly createdWhen: string };
  readonly errors: readonly ErrorCode[];
  readonly access: {
    readonly permission: "read" | "post" | "react" | "label" | "sync" | "manage";
    readonly channel: "fromInput" | "fromInputOrAny" | "fromMessage" | "any" | "some";
    /** The permission a call that names `re` needs in that message's channel instead of `permission`. */
    readonly re?: "read" | "post" | "react" | "label" | "sync" | "manage";
  } | null;
  readonly effects: {
    readonly readOnly: boolean;
    readonly idempotent: boolean;
    readonly emits: readonly string[];
    readonly meter?: string;
  };
  readonly upstream: boolean;
  /**
   * An upstream route this board answers as one without the feature does (docs/protocol.md "U-stub" rows): the
   * isolation suite then asks that A on A's board answer exactly as B on B's board, since no answer holds data.
   */
  readonly stub?: true;
};

export function defineOperation<
  const N extends string,
  const I extends OperationInput,
  O extends TSchema,
  const S extends Scope,
>(operation: Operation<I, O, N, S>): Operation<I, O, N, S> {
  const { scope, effects, errors } = operation;
  const codes = new Set(errors);
  if (scope === "board" && effects.emits.length > 0) codes.add("quota_exceeded");
  if ((scope === "board" || scope === "org") && !effects.readOnly && !operation.stub) codes.add("rate_limited");
  return codes.size === errors.length ? Object.freeze(operation) : Object.freeze({ ...operation, errors: [...codes] });
}

type Part<S> = S extends TObject ? Static<S> : unknown;
/** The flat input of an operation: params, query and body fields together, as the SDK takes them. */
export type InputOf<Op> =
  Op extends Operation<infer I, TSchema> ? Part<I["params"]> & Part<I["query"]> & Part<I["body"]> : never;
export type OutputOf<Op> = Op extends Operation<OperationInput, infer O> ? Static<O> : never;

/** The raw parts of a request, before validation; path params and query values are strings. */
export interface RawInput {
  readonly params?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string | readonly string[]>>;
  readonly body?: unknown;
}

const TEXT_FORMS: Readonly<Record<string, { pattern: RegExp; read: (text: string) => unknown }>> = {
  integer: { pattern: /^-?(?:0|[1-9]\d{0,15})$/, read: Number },
  number: { pattern: /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/, read: Number },
  boolean: { pattern: /^(?:true|false|1|0)$/, read: (text) => text === "true" || text === "1" },
};

/**
 * Path and query values arrive as text: a field typed integer, number or boolean takes only its plain decimal or
 * upstream boolean spelling (`true`/`false` or `1`/`0`). Anything else is left as text for validation.
 */
function fromText(schema: TObject, value: object): object {
  const entries = Object.entries(value).map(([name, field]) => {
    const form = TEXT_FORMS[String((schema.properties[name] as { type?: unknown } | undefined)?.type)];
    return [name, form && typeof field === "string" && form.pattern.test(field) ? form.read(field) : field];
  });
  return Object.fromEntries(entries);
}

/** Refuses an own `__proto__` key at any depth: cloning drops it, so it would vanish instead of being refused. */
function refuseProtoKeys(value: unknown, path: string) {
  const pending = [{ value, path, key: "" }];
  for (let next = pending.pop(); next; next = pending.pop()) {
    if (next.key === "__proto__") {
      throw new BoardError("invalid_request", `${next.path}: __proto__ is no key a board takes`);
    }
    if (typeof next.value !== "object" || next.value === null) continue;
    for (const [key, inner] of Object.entries(next.value).reverse()) {
      const at = next.path ? `${next.path}.${key}` : key;
      pending.push({ value: inner, path: at, key });
    }
  }
}

function decodePart(
  schema: TObject | undefined,
  value: unknown,
  where: string,
  convert: boolean,
  defaults = true,
  invalidItem?: Operation["invalidBodyItemCode"],
): object {
  if (!schema) {
    const empty =
      value === undefined || (typeof value === "object" && value !== null && Object.keys(value).length === 0);
    if (empty) return {};
    throw new BoardError("invalid_request", `this route takes no ${where}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    if (value !== undefined) throw new BoardError("invalid_request", `the ${where} must be a JSON object`);
  }
  refuseProtoKeys(value, "");
  const input = (value ?? {}) as object;
  const prepared = defaults ? (Value.Default(schema, Value.Clone(input)) as object) : input;
  const decoded = convert ? fromText(schema, prepared) : prepared;
  const [first] = Value.Errors(schema, decoded);
  if (first) {
    const field = first.path.replace(/^\//, "").replaceAll("/", ".") || where;
    const item = invalidItem && first.path.startsWith(`/${invalidItem.array}/`) ? invalidItem : undefined;
    throw new BoardError(
      item?.code ?? "invalid_request",
      item?.describe?.(decoded, first.path, first.message) ?? `${field}: ${first.message}`,
    );
  }
  return decoded as object;
}

function checkBodyArrayLimit(operation: Operation, body: unknown) {
  const limit = operation.bodyArrayLimitError;
  if (!limit || typeof body !== "object" || body === null || !Object.hasOwn(body, limit.array)) return;
  const value = (body as Record<string, unknown>)[limit.array];
  const max = operation.input.body?.properties[limit.array]?.maxItems;
  if (typeof max === "number" && Array.isArray(value) && value.length > max) {
    throw new BoardError(limit.code, limit.message);
  }
}

/** Validates a request's parts against an operation's input and returns the flat input, or throws `invalid_request`. */
export function decodeInput<Op extends Operation>(operation: Op, raw: RawInput): InputOf<Op> {
  try {
    checkBodyArrayLimit(operation, raw.body);
    return {
      ...decodePart(operation.input.params, raw.params, "path", true),
      ...decodePart(operation.input.query, raw.query, "query", true),
      ...decodePart(
        operation.input.body,
        raw.body,
        "body",
        false,
        operation.bodyDefaults,
        operation.invalidBodyItemCode,
      ),
    } as InputOf<Op>;
  } catch (error) {
    if (operation.invalidInputCode && error instanceof BoardError && error.code === "invalid_request") {
      throw new BoardError(operation.invalidInputCode, error.message);
    }
    throw error;
  }
}
