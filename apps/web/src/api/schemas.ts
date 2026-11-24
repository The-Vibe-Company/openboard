import { queryOptions } from "@tanstack/react-query";
import { browserClient } from "./client.ts";

export function schemaQuery(board: { org: string; board: string }, id: string) {
  return queryOptions({
    queryKey: ["board", board.org, board.board, "schema", id],
    queryFn: async ({ signal }) => {
      const { schema } = await browserClient(window.location.origin, board).readSchema({ id }, { signal });
      return schema.schema;
    },
    staleTime: Infinity,
  });
}
