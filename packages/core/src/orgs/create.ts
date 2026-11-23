import { BoardError, type Named } from "@openboard/contract";

/** The organization as asked for, once the contract has checked the slug's shape and the name's length. */
export interface CreateOrgCommand {
  readonly name: string;
  readonly slug: string;
}

/** An organization event (docs/data-model.md `org_events`): audit only, never served on a board's feed. */
export interface OrgEvent {
  /** The organization's own counter: a new organization's events are 1, 2, …. */
  readonly id: number;
  readonly type: "ob.org.created" | "ob.board.created";
  readonly at: number;
  /** The principal who acted, `ob:user:u_…`. */
  readonly actor: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** What one organization creation writes, in one transaction (docs/auth.md "Sign-up and sign-in"). */
export interface OrgCreation {
  readonly org: Named;
  readonly role: "owner";
  readonly board: Named;
  readonly events: readonly OrgEvent[];
}

/** Every organization starts with this board. */
export const FIRST_BOARD: Named = Object.freeze({ slug: "main", name: "main" });

/**
 * A new organization: `by` owns it and it gets the board `main`, recorded as `ob.org.created` then
 * `ob.board.created`. A name that is only spaces is 400 `invalid_request`.
 */
export function decideCreate(command: CreateOrgCommand, { by, now }: { readonly by: string; readonly now: number }) {
  const name = command.name.trim();
  if (name === "") {
    throw new BoardError("invalid_request", "the organization needs a name", {
      hint: 'Send a name with at least one visible character: {"name":"Acme","slug":"acme"}.',
    });
  }
  const org = { slug: command.slug, name };
  const board = { ...FIRST_BOARD };
  const events: OrgEvent[] = [
    { id: 1, type: "ob.org.created", at: now, actor: by, payload: { org, owner: by } },
    { id: 2, type: "ob.board.created", at: now, actor: by, payload: { board } },
  ];
  const creation: OrgCreation = { org, role: "owner", board, events };
  return creation;
}
