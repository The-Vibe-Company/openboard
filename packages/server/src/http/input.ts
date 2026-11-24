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

export async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
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
