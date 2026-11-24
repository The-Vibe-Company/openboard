import { BoardError, type Named } from "@openboard/contract";
import type { OrgEvent } from "./create.ts";

/** Board slugs the organization's own routes take (docs/protocol.md "URLs"): `/<org>/settings`, `/api/x/…`. */
export const RESERVED_BOARD_SLUGS: readonly string[] = Object.freeze(["x", "settings"]);

/** The board as asked for, once the contract has checked the slug's shape and the name's length. */
export interface CreateBoardCommand {
  readonly slug: string;
  readonly name: string;
}

/** What creating a board writes: the board, and its `ob.board.created` event, numbered by the store. */
export interface BoardCreation {
  readonly board: Named;
  readonly event: Omit<OrgEvent, "id">;
}

/**
 * A new board of the organization, recorded as `ob.board.created` by `by`. A reserved slug is 400 `reserved_slug`; a
 * name that is only spaces is 400 `invalid_request`. Whether the slug is taken is the store's to say, under its lock.
 */
export function decideCreateBoard(
  command: CreateBoardCommand,
  { by, now }: { readonly by: string; readonly now: number },
): BoardCreation {
  if (RESERVED_BOARD_SLUGS.includes(command.slug)) {
    throw new BoardError("reserved_slug", `${command.slug} is reserved and cannot name a board`, {
      hint: `Pick another slug; ${RESERVED_BOARD_SLUGS.join(" and ")} are taken by the organization's own routes.`,
    });
  }
  const name = command.name.trim();
  if (name === "") {
    throw new BoardError("invalid_request", "the board needs a name", {
      hint: 'Send a name with at least one visible character: {"slug":"ops","name":"Ops"}.',
    });
  }
  const board = { slug: command.slug, name };
  return { board, event: { type: "ob.board.created", at: now, actor: by, payload: { board } } };
}

/** The default board goes with its organization. */
export function requireDeletableBoard(slug: string): void {
  if (slug === "main") {
    throw new BoardError("invalid_request", "the default board cannot be deleted", {
      hint: "Delete the organization instead.",
    });
  }
}
