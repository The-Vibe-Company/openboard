import {
  type Attachment,
  BoardError,
  ERRORS,
  type InputOf,
  isErrorCode,
  type NextStep,
  type Operation,
  type OutputOf,
  operations,
  PROFILE_HEADER,
  type postMessage,
  type receiveInboundEvent,
} from "@openboard/contract";
import { addFacades } from "./facades.ts";

type Contracted = (typeof operations)[number];

type UploadBytes = Uint8Array<ArrayBuffer> | ArrayBuffer | Blob;
type UploadOptions = { readonly name: string; readonly type?: string };
type PostInput = InputOf<typeof postMessage> & ({ text: string } | { attachments: [string, ...string[]] });
export type CallOptions = { readonly signal?: AbortSignal };
type SignedCallOptions = CallOptions & {
  readonly signed: {
    readonly headers: NonNullable<RequestInit["headers"]>;
    readonly body: string | Uint8Array<ArrayBuffer> | ArrayBuffer | Blob;
  };
};

/** One method per contract operation: `client.postMessage({ channel, text })` (docs/codebase.md 4.2). */
export type Client = {
  readonly [Op in Contracted as Op["name"]]: Op["name"] extends "upload"
    ? (bytes: UploadBytes, options: UploadOptions & CallOptions) => Promise<Attachment>
    : Op["name"] extends "download"
      ? (id: string, options?: CallOptions) => Promise<Response>
      : (
          input: Op["name"] extends "postMessage" ? PostInput : InputOf<Op>,
          ...options: Op["name"] extends typeof receiveInboundEvent.name
            ? [options: SignedCallOptions]
            : [options?: CallOptions]
        ) => Promise<OutputOf<Op>>;
};

export type BoardClient = ReturnType<typeof addFacades>;

export interface ClientOptions {
  /** `BOARD_URL`: `http://127.0.0.1:8787/api/local/main`. */
  readonly url: string;
  readonly token?: string;
  /** CSRF value from the browser's session for writes. */
  readonly csrf?: string;
  /** `BOARD_PROFILE`: write as this profile of the token's principal, sent as `x-board-profile`. */
  readonly profile?: string;
  readonly fetch?: (request: Request) => Promise<Response>;
}

const fieldsOf = (schema: { properties: object } | undefined) => new Set(Object.keys(schema?.properties ?? {}));

/** The request an operation's flat input makes: path params in the path, query fields in the query, the rest in the body. */
export function requestOf(
  operation: Operation,
  input: Readonly<Record<string, unknown>>,
  options: ClientOptions,
  signal?: AbortSignal,
  signed?: SignedCallOptions["signed"],
  binary?: UploadOptions & { readonly bytes: UploadBytes },
) {
  const params = fieldsOf(operation.input.params);
  const query = fieldsOf(operation.input.query);
  const path = operation.route.path.replace(/:([A-Za-z]+)/g, (_, name: string) =>
    encodeURIComponent(String(input[name] ?? "")),
  );
  const platformMount = operation.scope === "org" || operation.scope === "account" ? "/api/x" : operation.route.mount;
  const url = platformMount
    ? new URL(platformMount + path, options.url)
    : new URL(`${options.url.replace(/\/+$/, "")}${path}`);
  if (operation.auth === "signature") {
    if (!signed) throw new TypeError("a signed operation requires headers and a raw body");
    return new Request(url, { method: operation.route.method, ...signed, signal });
  }
  const body: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(input)) {
    if (value === undefined || params.has(name)) continue;
    if (!query.has(name)) body[name] = value;
    else if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(name, String(item));
    } else url.searchParams.set(name, String(value));
  }
  const headers: Record<string, string> = { accept: operation.responseType ?? "application/json" };
  const token = options.token;
  if (
    token &&
    (!platformMount ||
      operation.auth === "operator" ||
      operation.orgPersonalToken !== undefined ||
      (operation.accountBearer && token.startsWith("obp_")))
  ) {
    headers.authorization = `Bearer ${token}`;
  }
  if (!platformMount && options.profile) headers[PROFILE_HEADER] = options.profile;
  if (operation.route.method !== "GET" && options.csrf) {
    headers["x-ob-csrf"] = options.csrf;
  }
  if (operation.input.binary) {
    if (!binary) throw new TypeError("a binary operation requires a byte body");
    headers["content-type"] = binary.type ?? "application/octet-stream";
    headers["x-board-filename"] = encodeURIComponent(binary.name);
    return new Request(url, { method: operation.route.method, headers, signal, body: binary.bytes });
  }
  if (!operation.input.body) return new Request(url, { method: operation.route.method, headers, signal });
  headers["content-type"] = "application/json";
  return new Request(url, { method: operation.route.method, headers, signal, body: JSON.stringify(body) });
}

function isNextStep(value: unknown): value is NextStep {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  switch (value.kind) {
    case "run":
      return (
        (!("description" in value) || typeof value.description === "string") &&
        "argv" in value &&
        Array.isArray(value.argv) &&
        value.argv.length > 0 &&
        value.argv.every((arg: unknown) => typeof arg === "string")
      );
    case "call":
      return "operation" in value && typeof value.operation === "string" && "input" in value;
    case "wait":
      return "seconds" in value && typeof value.seconds === "number" && value.seconds >= 0;
    case "read":
      return "url" in value && typeof value.url === "string";
    default:
      return false;
  }
}

// The contract constrains server-side statuses. An SDK error records the actual HTTP response.
export class ResponseError extends BoardError {
  override readonly status: number;

  constructor(status: number, ...args: ConstructorParameters<typeof BoardError>) {
    super(...args);
    this.status = status;
  }
}

function errorFields(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The board's answer, or its error envelope thrown as a `BoardError`. */
export async function answerOf(response: Response, responseType?: Operation["responseType"]): Promise<unknown> {
  if (response.ok && responseType !== undefined) {
    if (responseType === "application/octet-stream") return response;
    const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (mediaType !== responseType)
      throw new ResponseError(response.status, "remote_error", `the board did not answer with ${responseType}`);
    if (responseType === "application/gzip") {
      if (!response.body) throw new ResponseError(response.status, "remote_error", "the board did not send an archive");
      return response.body;
    }
    return response.text();
  }
  const text = await response.text().catch((error: unknown) => {
    if (response.ok) throw error;
    throw new ResponseError(
      response.status,
      "remote_error",
      `could not read the board's HTTP ${response.status} response`,
    );
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new ResponseError(
      response.status,
      "remote_error",
      `the board answered ${response.status} with something that is not JSON`,
    );
  }
  if (response.ok) return parsed;
  const body = errorFields(errorFields(parsed).error);
  const code = typeof body.code === "string" && isErrorCode(body.code) ? body.code : "remote_error";
  const message = typeof body.message === "string" ? body.message : `the board answered ${response.status}`;
  const [first, second] = Array.isArray(body.next) ? body.next.slice(0, 2).filter(isNextStep) : [];
  throw new ResponseError(response.status, code, message, {
    ...(typeof body.hint === "string" ? { hint: body.hint } : {}),
    ...(typeof body.reason === "string" && ERRORS[code].reasons.includes(body.reason) ? { reason: body.reason } : {}),
    ...(first === undefined ? {} : { next: second === undefined ? [first] : [first, second] }),
  });
}

/** Sends the request; a board that does not answer is upstream's `unreachable`, not a transport exception. */
export async function reach(send: (request: Request) => Promise<Response>, request: Request): Promise<Response> {
  try {
    return await send(request);
  } catch (error) {
    if (error instanceof BoardError) throw error;
    if (!(error instanceof TypeError || (error instanceof Error && "code" in error))) throw error;
    throw new BoardError("unreachable", `the board at ${new URL(request.url).origin} did not answer: ${error.message}`);
  }
}

/** A typed client of one board; it reads no environment and keeps no state between calls. */
export function createClient(options: ClientOptions): BoardClient {
  if (!URL.canParse(options.url)) throw new TypeError(`not a board URL: ${options.url}`);
  const send = options.fetch ?? ((request: Request) => fetch(request));
  const methods = operations.map((operation) => {
    if ("binary" in operation.input)
      return [
        operation.name,
        async (bytes: UploadBytes, request: UploadOptions & CallOptions) => {
          const response = await reach(
            send,
            requestOf(operation, {}, options, request.signal, undefined, { bytes, ...request }),
          );
          return ((await answerOf(response)) as { attachment: Attachment }).attachment;
        },
      ];
    if (operation.responseType === "application/octet-stream")
      return [
        operation.name,
        async (id: string, request?: CallOptions) =>
          answerOf(await reach(send, requestOf(operation, { id }, options, request?.signal)), operation.responseType),
      ];
    return [
      operation.name,
      async (input: Readonly<Record<string, unknown>>, request?: CallOptions & Partial<SignedCallOptions>) =>
        answerOf(
          await reach(send, requestOf(operation, input, options, request?.signal, request?.signed)),
          operation.responseType,
        ),
    ];
  });
  return addFacades(Object.fromEntries(methods) as Client);
}
