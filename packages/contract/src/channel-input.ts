import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Operation, RawInput } from "./operation.ts";

const channelInput = Symbol("channel input");

export function channelString(options: { maxLength: number; pattern: string; description?: string }) {
  return Type.String({ ...options, [channelInput]: true });
}

/** Locate a rejected channel value using its schema, including optional fields and nested inputs. */
export function invalidChannelInput(operation: Operation, raw: RawInput) {
  for (const part of ["params", "query", "body"] as const) {
    const schema = operation.input[part];
    const value = raw[part];
    if (!schema || !value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const error of Value.Errors(schema, value)) {
      if ((error.schema as { [channelInput]?: boolean })[channelInput] !== true || error.value === undefined) continue;
      const path = error.path
        .slice(1)
        .split("/")
        .map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"));
      if (path.includes("__proto__")) continue;
      const accepts = (candidate: string) => Value.Check(error.schema, candidate);
      return { part, path, value: error.value as unknown, accepts };
    }
  }
}
