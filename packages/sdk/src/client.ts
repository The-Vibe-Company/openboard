import {
  BoardError,
  ERRORS,
  type ErrorBody,
  type InputOf,
  isErrorCode,
  type NextStep,
  type Operation,
  type OutputOf,
  operations,
} from "@openboard/contract";

type Contracted = (typeof operations)[number];

/** One method per contract operation: `client.postMessage({ channel, text })` (docs/codebase.md 4.2). */
export type Client = {
  readonly [Op in Contracted as Op["name"]]: (input: InputOf<Op>) => Promise<OutputOf<Op>>;
};

export interface ClientOptions {
  /** `BOARD_URL`: `http://127.0.0.1:8787/api/local/main`. */
  readonly url: string;
  readonly token?: string;
  readonly fetch?: (request: Request) => Promise<Response>;
}

const fieldsOf = (schema: { properties: object } | undefined) => new Set(Object.keys(schema?.properties ?? {}));

/** The request an operation's flat input makes: path params in the path, query fields in the query, the rest in the body. */
function requestOf(base: string, operation: Operation, input: Readonly<Record<string, unknown>>, token?: string) {
  const params = fieldsOf(operation.input.params);
  const query = fieldsOf(operation.input.query);
  const path = operation.route.path.replace(/:([A-Za-z]+)/g, (_, name: string) =>
    encodeURIComponent(String(input[name] ?? "")),
  );
  const url = new URL(`${base.replace(/\/+$/, "")}${path}`);
  const body: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(input)) {
    if (value === undefined || params.has(name)) continue;
    if (query.has(name)) url.searchParams.set(name, String(value));
    else body[name] = value;
  }
  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (!operation.input.body) return new Request(url, { method: operation.route.method, headers });
  headers["content-type"] = "application/json";
  return new Request(url, { method: operation.route.method, headers, body: JSON.stringify(body) });
}

function isNextStep(value: unknown): value is NextStep {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  switch (value.kind) {
    case "run":
      return (
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

/** The board's answer, or its error envelope thrown as a `BoardError`. */
async function answerOf(response: Response): Promise<unknown> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new BoardError("remote_error", `the board answered ${response.status} with something that is not JSON`);
  }
  if (response.ok) return parsed;
  const body = (parsed as { error?: Partial<ErrorBody> }).error ?? {};
  const code = typeof body.code === "string" && isErrorCode(body.code) ? body.code : "remote_error";
  const message = typeof body.message === "string" ? body.message : `the board answered ${response.status}`;
  const [first, second] = Array.isArray(body.next) ? body.next.slice(0, 2).filter(isNextStep) : [];
  throw new BoardError(code, message, {
    ...(body.hint === undefined ? {} : { hint: body.hint }),
    ...(body.reason !== undefined && ERRORS[code].reasons.includes(body.reason) ? { reason: body.reason } : {}),
    ...(first === undefined ? {} : { next: second === undefined ? [first] : [first, second] }),
  });
}

/** Sends the request; a board that does not answer is upstream's `unreachable`, not a transport exception. */
async function reach(send: (request: Request) => Promise<Response>, request: Request): Promise<Response> {
  try {
    return await send(request);
  } catch (error) {
    if (!(error instanceof TypeError || (error instanceof Error && "code" in error))) throw error;
    throw new BoardError("unreachable", `the board at ${new URL(request.url).origin} did not answer: ${error.message}`);
  }
}

/** A typed client of one board; it reads no environment and keeps no state between calls. */
export function createClient(options: ClientOptions): Client {
  if (!URL.canParse(options.url)) throw new TypeError(`not a board URL: ${options.url}`);
  const send = options.fetch ?? ((request: Request) => fetch(request));
  const methods = operations.map((operation) => [
    operation.name,
    async (input: Readonly<Record<string, unknown>>) =>
      answerOf(await reach(send, requestOf(options.url, operation, input, options.token))),
  ]);
  return Object.freeze(Object.fromEntries(methods)) as Client;
}
