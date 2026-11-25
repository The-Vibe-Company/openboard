import { BoardError, decodeInput, type Operation, type RawInput } from "@openboard/contract";
import { rejectedInput } from "./errors.ts";

/** Array query fields take one element per occurrence. Scalar fields retain the last value. */
export function readQuery(operation: Operation, params: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = Object.fromEntries(params);
  if (operation.input.query) {
    for (const [name, schema] of Object.entries(operation.input.query.properties)) {
      if (schema.type === "array" && params.has(name)) query[name] = params.getAll(name);
    }
  }
  return query;
}

const MAX_JSON_BODY_BYTES = 1024 * 1024;

export async function readBoundedText(request: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<string> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BoardError("too_large", "JSON request bodies are limited to 1 MiB");
  }
  if (!request.body) {
    const text = await request.text();
    if (Buffer.byteLength(text) > maxBytes) {
      throw new BoardError("too_large", "JSON request bodies are limited to 1 MiB");
    }
    return text;
  }
  const reader = request.body.getReader();
  const sink = new Bun.ArrayBufferSink();
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return new TextDecoder().decode(new Uint8Array(sink.end()));
      length += value.byteLength;
      if (length > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new BoardError("too_large", "JSON request bodies are limited to 1 MiB");
      }
      sink.write(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function readBody(request: Request): Promise<unknown> {
  const text = await readBoundedText(request);
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) throw new BoardError("invalid_request", "the body is not JSON");
    throw error;
  }
}

export function validate<Op extends Operation>(operation: Op, raw: RawInput) {
  try {
    return decodeInput(operation, raw);
  } catch (error) {
    throw rejectedInput(error, operation, raw);
  }
}
