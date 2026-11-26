import { queryOptions, useMutation } from "@tanstack/react-query";
import type { SessionState } from "@openboard/contract";

export async function fetchSession(
  signal: AbortSignal,
  send: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<SessionState> {
  const response = await send("/api/x/session", { credentials: "same-origin", redirect: "error", signal });
  if (!response.ok) throw new Error(`Could not load the session (HTTP ${response.status}).`);
  return response.json();
}

export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: ({ signal }) => fetchSession(signal),
});

export function useSignOut() {
  return useMutation({
    mutationFn: async (csrf: string) => {
      const response = await fetch("/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        redirect: "error",
        headers: { "x-ob-csrf": csrf },
      });
      if (!response.ok) throw new Error("Could not sign out. Try again.");
    },
    onSuccess: () => {
      // End the document session so protected board data leaves the query cache.
      window.location.replace("/");
    },
  });
}
