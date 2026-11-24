import { type Client, createClient } from "@the-vibe-company/openboard";

/** A same-origin client for the current session and the board named by the route. */
export function browserClient(
  origin: string,
  board = { org: "local", board: "main" },
  send: (request: Request, init: RequestInit) => Promise<Response> = fetch,
): Client {
  const url = new URL(`/api/${encodeURIComponent(board.org)}/${encodeURIComponent(board.board)}`, origin);
  const fetchSession = (request: Request) => send(request, { credentials: "same-origin", redirect: "error" });
  const session = createClient({ url: url.href, fetch: fetchSession });
  return createClient({
    url: url.href,
    fetch: async (request) => {
      if (request.method !== "GET") {
        const { csrf } = await session.getSession({}, { signal: request.signal });
        if (csrf) request.headers.set("x-ob-csrf", csrf);
      }
      return fetchSession(request);
    },
  });
}
