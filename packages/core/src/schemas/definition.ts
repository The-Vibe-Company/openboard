import { BoardError } from "@openboard/contract";

const types: readonly unknown[] = ["object", "array", "string", "number", "integer", "boolean", "null"];
const formats: readonly unknown[] = ["date-time", "date", "time", "email", "uri", "uuid", "hostname", "ipv4", "ipv6"];
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const subschema = (value: unknown) => object(value) || typeof value === "boolean";
const text = (value: unknown) => typeof value === "string";
const count = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0;
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const distinct = (values: unknown[]) => new Set(values).size === values.length;
const nonempty = (value: unknown): value is unknown[] => Array.isArray(value) && value.length > 0;
const schemaList = (value: unknown) => nonempty(value) && value.every(subschema);

const keywords: Readonly<Record<string, readonly [accepts: (value: unknown) => boolean, expected: string]>> = {
  $schema: [text, "a string"],
  title: [text, "a string"],
  description: [text, "a string"],
  type: [
    (value) =>
      types.includes(value) || (nonempty(value) && value.every((item) => types.includes(item)) && distinct(value)),
    "a JSON type or a non-empty list of distinct JSON types",
  ],
  properties: [(value) => object(value) && Object.values(value).every(subschema), "an object of schemas"],
  required: [
    (value) => Array.isArray(value) && value.every(text) && distinct(value),
    "a list of distinct property names",
  ],
  additionalProperties: [subschema, "a schema object or boolean"],
  items: [subschema, "a schema object or boolean"],
  minItems: [count, "a non-negative integer"],
  maxItems: [count, "a non-negative integer"],
  minLength: [count, "a non-negative integer"],
  maxLength: [count, "a non-negative integer"],
  minimum: [finite, "a finite number"],
  maximum: [finite, "a finite number"],
  exclusiveMinimum: [finite, "a finite number"],
  exclusiveMaximum: [finite, "a finite number"],
  multipleOf: [(value) => typeof value === "number" && finite(value) && value > 0, "a positive number"],
  enum: [nonempty, "a non-empty list of values"],
  const: [() => true, "a JSON value"],
  oneOf: [schemaList, "a non-empty list of schemas"],
  anyOf: [schemaList, "a non-empty list of schemas"],
  allOf: [schemaList, "a non-empty list of schemas"],
  not: [subschema, "a schema object or boolean"],
  format: [(value) => formats.includes(value), `one of ${formats.join(", ")}`],
};

function invalid(path: string, message: string): never {
  throw new BoardError("invalid_schema", `At ${JSON.stringify(path || "/")}, ${message}.`);
}

function checkText(value: string, path: string): void {
  if (value.includes("\0") || !value.isWellFormed()) invalid(path, "text contains a NUL or lone surrogate");
}

type Context = "schema" | "property names" | "literal";

/** Check the upstream structural subset and its limits on the parsed JSON tree. */
export function checkDefinition(definition: unknown): void {
  if (!object(definition) || definition.type !== "object") invalid("/type", 'the root type must be "object"');

  let nodes = 0;
  let subschemas = 0;
  function visit(value: unknown, depth: number, path: string, context: Context): void {
    if (depth > 16) invalid(path, "the definition exceeds 16 levels");
    if (++nodes > 512) invalid(path, "the definition exceeds 512 JSON nodes");
    if (typeof value === "string") checkText(value, path);
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) visit(item, depth + 1, `${path}/${index}`, context);
      return;
    }
    if (!object(value)) return;
    if (context === "schema" && ++subschemas > 64) invalid(path, "the definition exceeds 64 subschemas");

    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      checkText(key, childPath);
      if (context === "schema") {
        const rule = Object.hasOwn(keywords, key) ? keywords[key] : undefined;
        if (!rule) invalid(childPath, `keyword ${JSON.stringify(key)} is unsupported`);
        if (!rule[0](child)) invalid(childPath, `keyword ${JSON.stringify(key)} requires ${rule[1]}`);
      }
      const childContext =
        context === "literal" || (context === "schema" && (key === "enum" || key === "const"))
          ? "literal"
          : context === "schema" && key === "properties"
            ? "property names"
            : "schema";
      visit(child, depth + 1, childPath, childContext);
    }
  }

  visit(definition, 0, "", "schema");
  // The bounded walk runs first so serialization never recurses through an unbounded definition.
  if (new TextEncoder().encode(JSON.stringify(definition)).length > 32_768) {
    invalid("", "the definition exceeds 32768 bytes of JSON");
  }
}
