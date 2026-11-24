import type { Pipeline } from "./pipeline.ts";
import { matchRoute } from "./router.ts";
import { boardPath } from "./scope.ts";

export const REQUEST_ID = "x-request-id";
const echoable = /^[\x21-\x7e]{1,128}$/;

/** Signed routes can use any configured signing header, including x-request-id. */
export function requestIdOf(
  request: Request,
  pathname: string,
  pipeline: Pick<Pipeline, "deps" | "config" | "routes">,
) {
  if (request.headers.has(REQUEST_ID)) {
    const path = boardPath(pathname, pipeline.config.mode);
    if (!path || matchRoute(pipeline.routes, request.method, path.rest)?.operation.auth !== "signature") {
      const given = request.headers.get(REQUEST_ID);
      if (given !== null && echoable.test(given)) return given;
    }
  }
  return pipeline.deps.requestId();
}
