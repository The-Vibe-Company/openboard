/// <reference lib="dom" />

export function createApp(_config: { mode: "local" | "hosted" }, _ports: object, _deps: object) {
  return {
    fetch(_request: Request): Response {
      return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
    },
    async drain() {},
    async close() {},
  };
}
