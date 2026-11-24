import { type Client, createClient } from "@the-vibe-company/openboard";

export function boardUrl(origin: string, { org, board }: { org: string; board: string }) {
  return new URL(`/api/${encodeURIComponent(org)}/${encodeURIComponent(board)}`, origin).href;
}

/** A same-origin client for the current session and the board named by the route. */
export function browserClient(
  origin: string,
  { org = "local", board = "main", csrf }: { org?: string; board?: string; csrf?: string } = {},
  send: (request: Request, init: RequestInit) => Promise<Response> = fetch,
): Client {
  const url = boardUrl(origin, { org, board });
  const fetchSession = (request: Request) => send(request, { credentials: "same-origin", redirect: "error" });
  // A displayed session can bind writes to its proof even if another tab changes the cookie.
  if (csrf !== undefined) return createClient({ url, fetch: fetchSession, csrf });
  const session = createClient({ url, fetch: fetchSession });
  return createClient({
    url,
    fetch: async (request) => {
      if (request.method !== "GET") {
        const { csrf } = await session.getSession({}, { signal: request.signal });
        if (csrf) request.headers.set("x-ob-csrf", csrf);
      }
      return fetchSession(request);
    },
  });
}
