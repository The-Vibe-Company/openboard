import { queryOptions, useMutation } from "@tanstack/react-query";
import { browserClient } from "./client.ts";

export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: ({ signal }) => browserClient(window.location.origin).getSession({}, { signal }),
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
