import { type Static, Type } from "@sinclair/typebox";

/**
 * What `GET {BOARD_URL}/` answers with no token (docs/protocol.md "Discovery"): `url` and `audience` are the board URL
 * the request named; the organization slug is the team ID. The board has no project and syncs nowhere.
 */
export const Discovery = Type.Object({
  version: Type.String(),
  url: Type.String(),
  audience: Type.String(),
  team_id: Type.String(),
  project_id: Type.Null(),
  sync: Type.Array(Type.Unknown(), { maxItems: 0 }),
});
export type Discovery = Static<typeof Discovery>;
