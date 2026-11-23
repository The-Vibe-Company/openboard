import { type discoverBoard, type getOpenApi, UPSTREAM_VERSION } from "@openboard/contract";
import manifest from "../../package.json" with { type: "json" };
import { createOpenApi } from "../http/openapi.ts";
import type { Handler } from "./index.ts";

/** `openboard/<version> (board-protocol <upstream version>)`; every manifest carries the one shared version. */
const VERSION = `openboard/${manifest.version} (board-protocol ${UPSTREAM_VERSION})`;

/** Where the board says it is: built from the URL alone, so it answers alike for a board that does not exist (D35). */
export const discoverBoardHandler: Handler<typeof discoverBoard> = async (ctx) => ({
  version: VERSION,
  url: ctx.boardUrl,
  audience: ctx.boardUrl,
  team_id: null,
  project_id: null,
  sync: [],
});

export const getOpenApiHandler: Handler<typeof getOpenApi> = async () => createOpenApi();
