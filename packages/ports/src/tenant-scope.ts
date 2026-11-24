declare const minted: unique symbol;

/**
 * The board a request may touch. Only the server's tenant resolver mints one, after matching the path against the
 * credential (docs/codebase.md 4.4, D33); views take a scope, never a bare ID.
 */
export interface BoardScope {
  readonly orgId: number;
  readonly boardId: number;
  readonly [minted]: true;
}

/** The internal keys of a board a path names. */
export interface BoardKeys {
  readonly orgId: number;
  readonly boardId: number;
}

/** The organization a request may touch, minted only by the tenant resolver. */
export interface OrgScope {
  readonly orgId: number;
  readonly [minted]: "org";
}
