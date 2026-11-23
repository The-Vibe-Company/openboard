import { Type } from "@sinclair/typebox";
import { Discovery } from "../entities/discovery.ts";
import { defineOperation } from "../operation.ts";

/** Discovery answers from the URL alone, for any well-formed board path, so it never says whether a board exists (D35). */
export const discoverBoard = defineOperation({
  name: "discoverBoard",
  operationId: "discovery",
  summary: "Read where a board says it is: its URL and audience, and the protocol version it speaks. No token.",
  route: { method: "GET", path: "/" },
  scope: "public",
  input: {},
  output: Discovery,
  errors: [],
  access: null,
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: false,
  why: "Clients read discovery themselves when they connect to a board; it is not something a person or agent asks for.",
  upstream: true,
});

export const getOpenApi = defineOperation({
  name: "getOpenApi",
  operationId: "openapi",
  summary: "Fetch the board's OpenAPI description.",
  route: { method: "GET", path: "/openapi.json" },
  scope: "public",
  input: {},
  output: Type.Object(
    {
      openapi: Type.Literal("3.1.0"),
      info: Type.Object({ title: Type.String(), version: Type.String() }),
      paths: Type.Record(Type.String(), Type.Object({}, { additionalProperties: true })),
    },
    { additionalProperties: true },
  ),
  errors: [],
  access: null,
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: false,
  why: "This is a machine-readable API description for tooling.",
  upstream: true,
});
