import { BoardError, type getConnectionPolicy, type Operation, operations } from "@openboard/contract";
import { validateProxyPins } from "@openboard/core";
import { refuseClaimedConfiguration } from "../../auth/tokens.ts";
import { requireManager } from "../connections.ts";
import type { Handler } from "../index.ts";

function gatewayRoute(operation: Operation, probe: Request): boolean {
  const { path, method, mount } = operation.route;
  if (mount || (operation.scope !== "board" && operation.scope !== "public")) return false;
  if (/^\/(?:x|grants|watchers|sync|inbox|webhooks|wake)(?:\/|$)/.test(path)) return false;
  if (path === "/schemas" && method === "POST") return false;
  try {
    refuseClaimedConfiguration(probe, operation);
    return true;
  } catch (error) {
    if (error instanceof BoardError && error.code === "forbidden") return false;
    throw error;
  }
}

function gatewayRoutes(boardUrl: string) {
  const { pathname } = new URL(boardUrl);
  // The guard checks only the bearer prefix. This is a marker, not a credential.
  const probe = new Request(boardUrl, { headers: { authorization: "Bearer obt_" } });
  const routes = operations
    .filter((operation) => gatewayRoute(operation, probe))
    .map(({ route: { method, path } }) => ({ method, path: path === "/" ? pathname : pathname + path }));
  return [...routes, { method: "POST", path: pathname.replace(/^\/api\//, "/mcp/") }];
}

export const getConnectionPolicyHandler: Handler<typeof getConnectionPolicy> = async (ctx, { id, profile, can }) => {
  requireManager(ctx, "read a connection's gateway policy");
  const record = await ctx.board.connection(id);
  if (!record) throw new BoardError("not_found", "no such active connection on this board");
  validateProxyPins(record.connection, record.effectiveCan, profile, can);
  return {
    env: { BOARD_URL: ctx.boardUrl, BOARD_TOKEN: "<placeholder>", BOARD_PROFILE: profile },
    headers: { authorization: `Bearer \${OPENBOARD_SECRET}`, "x-board-profile": profile, "x-board-can": can },
    routes: gatewayRoutes(ctx.boardUrl),
  };
};
