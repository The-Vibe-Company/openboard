import { Discovery } from "../entities/discovery.ts";
import { defineOperation } from "../operation.ts";

/** Discovery answers from the URL alone, for any well-formed board path, so it never says whether a board exists (D35). */
export const discoverBoard = defineOperation({
  name: "discoverBoard",
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
