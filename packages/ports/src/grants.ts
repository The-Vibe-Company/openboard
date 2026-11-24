import type { CanInput, GrantView } from "@openboard/contract";

export interface BoardGrantReads {
  /** The board's active grants naming this member, their linked identity, or all users. */
  personGrants(personId: string): Promise<CanInput[]>;
  /** Every unrevoked grant on the board, oldest first, with the starting grants g1 to g3 that no row holds. */
  listGrants(): Promise<GrantView[]>;
}

export interface BoardGrantWriter {
  /** The next grant number, read under the board's write lock. */
  nextGrant(): Promise<number>;
}
