import type { CanInput } from "@openboard/contract";

export interface BoardGrantReads {
  /** The board's active grants naming this member, their linked identity, or all users. */
  personGrants(personId: string): Promise<CanInput[]>;
}

export interface BoardGrantWriter {
  /** The next grant number, read under the board's write lock. */
  nextGrant(): Promise<number>;
}
