import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { BoardError } from "@the-vibe-company/openboard";
import { browserClient } from "./client.ts";
import { sessionQuery } from "./session.ts";

function checkPrincipal(client: QueryClient, expected: string, actual: string | undefined) {
  if (actual === expected) return;
  void client.invalidateQueries(sessionQuery);
  throw new BoardError("unauthorized", "The browser session changed.");
}

export const organizationsQuery = (principal: string) =>
  queryOptions({
    queryKey: ["shell-organizations", principal],
    queryFn: async ({ client, signal }) => {
      const account = await browserClient(window.location.origin)
        .getAccount({}, { signal })
        .catch((error: unknown) => {
          if (error instanceof BoardError && error.code === "unauthorized") void client.invalidateQueries(sessionQuery);
          throw error;
        });
      checkPrincipal(client, principal, account.person.principal);
      return account;
    },
    retry: false,
  });

export const boardsQuery = (principal: string, org: string) =>
  queryOptions({
    queryKey: ["organization-boards", org, principal],
    queryFn: async ({ client, signal }) => {
      const browser = browserClient(window.location.origin);
      // A session cookie can change in another tab while the header still shows the old identity.
      const checkSession = async () => {
        const session = await browser.getSession({}, { signal });
        checkPrincipal(client, principal, session.person?.principal);
      };
      await checkSession();
      try {
        return await browser.listBoards({ org }, { signal });
      } finally {
        await checkSession();
      }
    },
    retry: false,
  });
