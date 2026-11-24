import { queryOptions } from "@tanstack/react-query";
import { BoardError, type Client } from "@the-vibe-company/openboard";
import { boardErrorText } from "./board.ts";
import { browserClient } from "./client.ts";

type Board = { org: string; board: string };
export type ThreadMessage = Awaited<ReturnType<Client["readThread"]>>["message"];

export function threadErrorText(error: Error) {
  return error instanceof BoardError && error.code === "message_not_found" ? "Not found" : boardErrorText(error);
}

export function threadQuery(board: Board, id: string) {
  return queryOptions({
    queryKey: ["board", board.org, board.board, "thread", id],
    retry: (failureCount, error) =>
      !(error instanceof BoardError && (error.code === "message_not_found" || error.code === "not_found")) &&
      failureCount < 2,
    queryFn: ({ signal }) => browserClient(window.location.origin, board).readThread({ id }, { signal }),
  });
}
