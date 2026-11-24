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
  | "grant"
  | "schema"
  | "file"
  | "schedule"
  | "webhook"
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
  /** Input fields taken as `--<flag>` under another name than their own, as upstream's CLI names them. */
  readonly options?: Readonly<Record<string, string>>;
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
  readonly input: I;
  readonly output: O;
  /** Optional alternate HTTP representation, negotiated through Accept. */
  readonly eventStream?: "text/event-stream";
  /** The success status, or the boolean output field that distinguishes 201 from 200. */
  readonly status?: 200 | 201 | { readonly createdWhen: string };
  readonly errors: readonly ErrorCode[];
  readonly access: {
    readonly permission: "read" | "post" | "react" | "label" | "manage";
    readonly channel: "fromInput" | "fromInputOrAny" | "fromMessage" | "any";
  } | null;
  readonly effects: {
    readonly readOnly: boolean;
    readonly idempotent: boolean;
    readonly emits: readonly string[];
    readonly meter?: string;
  };
  readonly upstream: boolean;
};

export function defineOperation<
  const N extends string,
  const I extends OperationInput,
  O extends TSchema,
  const S extends Scope,
>(operation: Operation<I, O, N, S>): Operation<I, O, N, S> {
  return Object.freeze(operation);
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
  boolean: { pattern: /^(?:true|false)$/, read: (text) => text === "true" },
};

/**
 * Path and query values arrive as text: a field typed integer, number or boolean takes only its plain decimal or
 * `true`/`false` spelling. Anything else is left as text, so validation refuses it (`limit=1e2` is not 100).
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
  if (typeof value !== "object" || value === null) return;
  for (const [key, inner] of Object.entries(value)) {
    const at = path ? `${path}.${key}` : key;
    if (key === "__proto__") throw new BoardError("invalid_request", `${at}: __proto__ is no key a board takes`);
    refuseProtoKeys(inner, at);
  }
}

function decodePart(schema: TObject | undefined, value: unknown, where: string, convert: boolean): object {
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
  const copy = Value.Default(schema, Value.Clone(value ?? {}));
  const decoded = convert ? fromText(schema, copy as object) : copy;
  const [first] = Value.Errors(schema, decoded);
  if (first) {
    const field = first.path.replace(/^\//, "").replaceAll("/", ".") || where;
    throw new BoardError("invalid_request", `${field}: ${first.message}`);
  }
  return decoded as object;
}

/** Validates a request's parts against an operation's input and returns the flat input, or throws `invalid_request`. */
export function decodeInput<Op extends Operation>(operation: Op, raw: RawInput): InputOf<Op> {
  return {
    ...decodePart(operation.input.params, raw.params, "path", true),
    ...decodePart(operation.input.query, raw.query, "query", true),
    ...decodePart(operation.input.body, raw.body, "body", false),
  } as InputOf<Op>;
}
