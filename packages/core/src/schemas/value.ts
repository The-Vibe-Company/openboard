import { matchesFormat } from "./formats.ts";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function hasType(value: unknown, type: unknown) {
  switch (type) {
    case "integer":
      return Number.isInteger(value);
    case "array":
      return Array.isArray(value);
    case "object":
      return object(value);
    case "null":
      return value === null;
    default:
      return typeof value === type;
  }
}

function shown(value: unknown) {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 40 ? text.slice(0, 39) + "…" : text;
}

function alternatives(values: unknown[]) {
  const first = values.slice(0, 6).map(shown);
  if (values.length > 6) return `one of ${first.join(", ")}, …`;
  if (first.length <= 2) return first.join(" or ");
  return `${first.slice(0, -1).join(", ")}, or ${first.at(-1)}`;
}

function stringProblem(schema: Record<string, unknown>, value: string, at: string) {
  const { minLength, maxLength, format, pattern } = schema;
  const length = [...value].length;
  if (typeof minLength === "number" && length < minLength) return `${at} must be at least ${minLength} characters`;
  if (typeof maxLength === "number" && length > maxLength) return `${at} must be at most ${maxLength} characters`;
  if (typeof format === "string" && !matchesFormat(format, value)) {
    return `${at} must be ${/^[aeiu]/.test(format) ? "an" : "a"} ${format}`;
  }
  if (typeof pattern === "string" && !new RegExp(pattern, "u").test(value)) return `${at} must match ${pattern}`;
  return null;
}

function numberProblem(schema: Record<string, unknown>, value: number, at: string) {
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf } = schema;
  if (typeof minimum === "number" && value < minimum) return `${at} must be at least ${minimum}`;
  if (typeof maximum === "number" && value > maximum) return `${at} must be at most ${maximum}`;
  if (typeof exclusiveMinimum === "number" && value <= exclusiveMinimum)
    return `${at} must be above ${exclusiveMinimum}`;
  if (typeof exclusiveMaximum === "number" && value >= exclusiveMaximum)
    return `${at} must be below ${exclusiveMaximum}`;
  if (typeof multipleOf === "number" && !Number.isInteger(value / multipleOf))
    return `${at} must be a multiple of ${multipleOf}`;
  return null;
}

function arrayProblem(schema: Record<string, unknown>, value: unknown[], at: string) {
  const { minItems, maxItems, items } = schema;
  const subject = at || "it";
  if (typeof minItems === "number" && value.length < minItems) return `${subject} must have at least ${minItems} items`;
  if (typeof maxItems === "number" && value.length > maxItems) return `${subject} must have at most ${maxItems} items`;
  if (items === undefined) return null;
  const count = Array.isArray(items) ? Math.min(value.length, items.length) : value.length;
  for (let index = 0; index < count; index++) {
    const problem = visit(Array.isArray(items) ? items[index] : items, value[index], `${at}[${index}]`);
    if (problem !== null) return problem;
  }
  return null;
}

function objectProblem(schema: Record<string, unknown>, value: Record<string, unknown>, at: string) {
  const path = (name: string) => (at ? `${at}.${name}` : name);
  const { required, additionalProperties, properties } = schema;
  if (Array.isArray(required)) {
    for (const name of required) {
      if (typeof name === "string" && !Object.hasOwn(value, name)) return `${path(name)} is missing`;
    }
  }
  for (const [name, child] of Object.entries(value)) {
    const known = object(properties) && Object.hasOwn(properties, name);
    if (!known && additionalProperties === false) return `${path(name)} isn't one of its fields`;
    const problem = visit(known ? properties[name] : additionalProperties, child, path(name));
    if (problem !== null) return problem;
  }
  return null;
}

function combinationProblem(schema: Record<string, unknown>, value: unknown, at: string) {
  const subject = at || "it";
  if (Array.isArray(schema.allOf)) {
    for (const child of schema.allOf) {
      const problem = visit(child, value, at);
      if (problem !== null) return problem;
    }
  }
  for (const keyword of ["anyOf", "oneOf"]) {
    const choices = schema[keyword];
    if (!Array.isArray(choices)) continue;
    const problems = choices.map((child) => visit(child, value, at));
    const matched = problems.filter((problem) => problem === null).length;
    if (matched === 0) {
      if (problems.length === 1) return problems[0]!;
      return `${subject} matches none of the ${choices.length} it can be: ${[...new Set(problems)].slice(0, 4).join("; ")}`;
    }
    if (keyword === "oneOf" && matched > 1)
      return `${subject} matches ${matched} of the ${choices.length} it can be, and must match one`;
  }
  return schema.not !== undefined && visit(schema.not, value, at) === null
    ? `${subject} matches what it must not`
    : null;
}

function visit(schema: unknown, value: unknown, at: string): string | null {
  const subject = at || "it";
  if (schema === false) return `${subject} isn't allowed`;
  if (!object(schema)) return null;
  const { type } = schema;
  const types = Array.isArray(type) ? type : [type];
  if (type !== undefined && !types.some((entry) => hasType(value, entry))) {
    const names = types.map((entry) =>
      entry === "null" ? "null" : `${/^[aeio]/.test(String(entry)) ? "an" : "a"} ${entry}`,
    );
    return `${subject} must be ${names.join(" or ")}`;
  }
  // Compare against the literal so recursion is bounded by the definition's depth.
  if (Object.hasOwn(schema, "const") && !sameLiteral(schema.const, value))
    return `${subject} must be ${shown(schema.const)}`;
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => sameLiteral(entry, value))) {
    return `${subject} must be ${alternatives(schema.enum)}`;
  }
  let problem: string | null = null;
  if (typeof value === "string") problem = stringProblem(schema, value, subject);
  else if (typeof value === "number") problem = numberProblem(schema, value, subject);
  else if (Array.isArray(value)) problem = arrayProblem(schema, value, at);
  else if (object(value)) problem = objectProblem(schema, value, at);
  return problem ?? combinationProblem(schema, value, at);
}

function sameLiteral(literal: unknown, value: unknown): boolean {
  if (literal === value) return true;
  if (Array.isArray(literal)) {
    return (
      Array.isArray(value) && literal.length === value.length && literal.every((item, i) => sameLiteral(item, value[i]))
    );
  }
  if (!object(literal) || !object(value)) return false;
  const keys = Object.keys(literal);
  return (
    keys.length === Object.keys(value).length &&
    keys.every((key) => Object.hasOwn(value, key) && sameLiteral(literal[key], value[key]))
  );
}

/** Return the first violation in upstream's field-oriented wording. */
export function checkValue(schema: Record<string, unknown> | boolean, value: unknown): string | null {
  return visit(schema, value, "");
}
