import type {
  Actor,
  Author,
  Channel,
  ClaimedAgent,
  Connection,
  Invitation,
  InvitationRole,
  Message,
  Named,
  Role,
  Thread,
  ThreadSummary,
} from "@openboard/contract";
import type {
  BoardCreation,
  BoardEvent,
  Grant,
  MessageDeleted,
  MessageEdited,
  MessagePosted,
  messages,
  OrgCreation,
} from "@openboard/core";

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

/** A person (docs/auth.md "Organizations, boards, people"): one `users` row, independent of providers and orgs. */
export interface PersonRecord {
  /** `u_<base32>`; the principal is `ob:user:<id>`. */
  readonly id: string;
  /** The provider login at the last sign-in. */
  readonly handle: string;
  readonly name: string;
  /** The verified email the provider gave, if any. */
  readonly email: string | null;
  readonly avatar: string | null;
  /** The providers the person signs in with, sorted: `["github"]`. */
  readonly providers: readonly string[];
}

/** A provider's word on who signed in; only `subject` identifies them (docs/auth.md "Sign-in providers"). */
export interface IdentityRecord {
  readonly provider: string;
  readonly subject: string;
  readonly login: string;
  readonly name: string;
  /** Only a verified email; null otherwise. */
  readonly email: string | null;
  readonly avatar: string | null;
}

/** One sign-in: the identity, and the session it opens, kept by the SHA-256 (hex) of its cookie value. */
export interface SignInRecord {
  readonly identity: IdentityRecord;
  /** Whether an identity no person holds yet makes a new person (sign-up), with the ID `newPersonId`. */
  readonly admitNew: boolean;
  readonly newPersonId: string;
  readonly session: { readonly idHash: string; readonly csrf: string; readonly expiresAt: number };
  readonly now: number;
}

/** A session that is not revoked, of a person who is not disabled; its times are checked by the caller. */
export interface SessionRecord {
  readonly person: PersonRecord;
  readonly csrf: string;
  readonly seenAt: number;
  readonly expiresAt: number;
}

/** A new organization, as core decided it, created by the person `personId` (`u_…`) at `now`. */
export interface CreateOrgRecord extends OrgCreation {
  readonly personId: string;
  readonly now: number;
}

/** A person's membership of an organization that is not deleted. */
export interface MembershipRecord {
  readonly org: Named;
  readonly role: Role;
}

/** A person's membership of the board's organization, with the organization and the board they reach. */
export interface BoardMemberRecord {
  readonly role: Role;
  readonly org: Named;
  readonly board: Named;
}

/** The organization a request may touch, minted only by the tenant resolver. */
export interface OrgScope {
  readonly orgId: number;
  readonly [minted]: "org";
}

export interface OrgView {
  listMembers(): Promise<{ principal: string; role: Role }[]>;
  /** Changes the role and records its audit event together. Null when the target is outside this organization. */
  changeMemberRole(record: {
    readonly personId: string;
    readonly targetId: string;
    readonly role: Role;
    readonly at: number;
  }): Promise<{ principal: string; role: Role } | null>;
  /** Stores the invitation and audit event together. False if the creator no longer has admin rights here. */
  createInvitation(record: {
    readonly invitation: Invitation;
    readonly tokenHash: Uint8Array;
    readonly personId: string;
    readonly at: number;
    readonly expiresAt: number;
  }): Promise<boolean>;
  /**
   * In one transaction, under the person `personId`'s admin membership locked: marks the organization's invitation
   * `id` revoked at `at` and records `ob.invitation.revoked`. Nothing is written when the person is no longer an owner
   * or admin (`not_admin`), the organization has no such invitation (`not_found`), or it was already accepted or
   * revoked (`used`).
   */
  revokeInvitation(id: string, personId: string, at: number): Promise<"revoked" | "not_admin" | "not_found" | "used">;
  /** The organization's boards that are not deleted, by slug. */
  listBoards(): Promise<Named[]>;
  /**
   * In one transaction, under the organization's row and the creator's admin membership locked: the board, its grant
   * IDs g1 to g3 kept for the seeded grants as every board's are, and its event at the organization's next event ID.
   * Nothing is written when the person `personId` (`u_…`) is no longer an owner or admin (`not_admin`) or a board of
   * the organization, deleted or not, already has the slug (`slug_taken`).
   */
  createBoard(creation: BoardCreation, personId: string): Promise<"created" | "not_admin" | "slug_taken">;
}

/** Reads and writes that belong to no tenant: resolving the board a path names, people and their sessions. */
export interface PlatformView {
  /** The board `orgSlug/boardSlug` names, or null when either is unknown or deleted. */
  findBoard(orgSlug: string, boardSlug: string): Promise<BoardKeys | null>;
  /**
   * In one transaction: the person holding the identity, their details refreshed from it, or a new person when
   * `admitNew`; then the session. Null, and no session, when the identity is new and not admitted, or the person is
   * disabled.
   */
  signIn(record: SignInRecord): Promise<PersonRecord | null>;
  /** The session whose cookie value hashes to `idHash`, or null when none, revoked, or its person is disabled. */
  session(idHash: string): Promise<SessionRecord | null>;
  /** Records that the session was used at `now`, for its idle lifetime. */
  touchSession(idHash: string, now: number): Promise<void>;
  /** Revokes the session at `now` (sign-out), so it signs in no one again; a session already revoked keeps its time. */
  revokeSession(idHash: string, now: number): Promise<void>;
  /** Revoke every session of the person identified by their public ID. */
  revokeAllSessions(personId: string, now: number): Promise<void>;
  /**
   * In one transaction: reject an existing active membership with `already_in_org`, or create the
   * organization, the person's owner membership, the board and the organization's events.
   */
  createOrg(record: CreateOrgRecord): Promise<void>;
  /** The person's memberships of organizations that are not deleted, by organization slug. */
  memberships(personId: string): Promise<MembershipRecord[]>;
  /** The tenant resolver checks the signed-in person's membership before minting an organization scope. */
  orgMembership(slug: string, personId: string): Promise<{ orgId: number; role: Role } | null>;
  /**
   * Redeems the exact token hash and records the membership and audit event in one transaction.
   * Throws `already_in_org` when the person already belongs to an organization (v1 allows one, D34), and
   * `invitation_used` when the invitation was revoked.
   */
  acceptInvitation(tokenHash: Uint8Array, personId: string, at: number): Promise<MembershipRecord | null>;
  /** A capability lookup: only the exact token hash selects an invitation, returning preview fields. */
  invitationPreview(tokenHash: Uint8Array): Promise<{
    orgName: string;
    role: InvitationRole;
    expiresAt: number;
    used: boolean;
  } | null>;
}

/** One board-locked transaction: the head is read under the lock, events go at `head + 1…` and are folded. */
export interface BoardWriter {
  readonly head: number;
  /** The exact channel path and counts as seen under this write lock. */
  channel(path: string): Promise<Channel | null>;
  /** The message at log position `id`, read under the lock, or null when no message has that ID. */
  replyTarget(id: number): Promise<messages.ReplyTarget | null>;
  /** The message view at log position `id`, read under the write lock. */
  message(id: number): Promise<Message | null>;
  /** The first reply in the thread of root `thread` after log position `after`, deleted or not, read under the lock. */
  newerReply(thread: number, after: number): Promise<number | null>;
  /** The message posted under the client ID, as the board holds it, read under the lock; null when none was. */
  clientPost(clientId: string): Promise<Message | null>;
  /** The ID the board's next grant takes, read under this write lock. */
  nextGrant(): Promise<number>;
  /** Whether a connection of this board, revoked or not, has the name. */
  connectionNamed(name: string): Promise<boolean>;
  /** The connection of this board with the ID, read under the lock, or null when the board has none with it. */
  connection(id: string): Promise<ConnectionRecord | null>;
  /** The agent of this board with the ID, read under the lock, or null when the board has none with it. */
  agent(id: string): Promise<AgentRecord | null>;
  /** The agent associated with this connection's claim key, including expired and revoked agents. */
  agentByClaimKey(connection: string, key: string): Promise<{ record: AgentRecord; revoked: boolean } | null>;
  /**
   * The unrevoked agent of the connection pinned to the profile (any case) whose token expires last, with that expiry
   * in epoch milliseconds, read under the lock; null when the connection has none.
   */
  profileHolder(connection: string, profile: string): Promise<{ id: string; tokenExpires: number } | null>;
  /** The board's record of the actor `write` named, read with the lock; null when it has none or none was named. */
  readonly actor: Actor | null;
  append(events: readonly BoardEvent[]): Promise<void>;
}

export interface ChannelsQuery {
  /** Only the channels whose path starts with it. */
  readonly prefix?: string;
  /** Only the channels whose path sorts after it. */
  readonly after?: string;
  readonly limit: number;
}

export interface ChannelMessagesQuery {
  readonly channel: string;
  /** Only the messages after this log position, the first `limit` of them. */
  readonly after?: number;
  readonly limit: number;
}

/** A connection as stored, with its grant and the SHA-256 (hex) of its secret, which is never stored itself. */
export interface ConnectionRecord {
  readonly connection: Connection;
  readonly grant: Grant;
  readonly secretHash: string;
  /** A claimed token's lifetime and hard cap, in seconds. */
  readonly tokenTtl: number;
  readonly tokenMax: number;
  /** How many claims its secret makes before it is spent (null: no limit), and how many it made. */
  readonly claims: { readonly max: number | null; readonly used: number };
}

/** An agent claimed with a connection's secret, with its connection and the SHA-256 (hex) of its token. */
export interface AgentRecord {
  readonly agent: ClaimedAgent;
  readonly connection: {
    readonly id: string;
    readonly name: string;
    readonly profiles: readonly string[];
    /** The connection's token lifetime in seconds, which a refresh grants again. */
    readonly tokenTtl: number;
  };
  /** The pinned profile as the claim spelled it, which is how it is shown. */
  readonly profile: string;
  readonly tokenHash: string;
  /** Epoch milliseconds of `agent.expiresAt`, and of `agent.hardExpiresAt`, past which none of its tokens refreshes. */
  readonly tokenExpires: number;
  readonly hardExpires: number;
  /** The token the last refresh replaced: its SHA-256 (hex), and the epoch milliseconds it works until. */
  readonly previous: { readonly tokenHash: string; readonly until: number } | null;
}

/** One board's storage; every statement it runs is bound to its scope. */
export interface BoardView {
  /**
   * Locks the board, runs `fn`, and commits what it appended, or rolls everything back if it throws. With `actor`,
   * the board's record of that actor is read at the start of the write, after the lock.
   */
  write<T>(fn: (writer: BoardWriter) => Promise<T>, actor?: string): Promise<T>;
  /** Every actor the board has seen write, by handle then ID, and the board head at the time of the read. */
  listActors(): Promise<{ actors: Actor[]; head: number }>;
  /** The channel's first `limit` messages after `after`, or its latest `limit`, oldest first. Null if `after` exceeds the board head. */
  channelMessages(query: ChannelMessagesQuery): Promise<Message[] | null>;
  /** The author's post by client ID, as it landed, or null if it is missing or belongs to another author. */
  ownClientPost(clientId: string, by: Author): Promise<Message | null>;
  /** The agent of this board with the ID, or null when the board has none with it. */
  agent(id: string): Promise<AgentRecord | null>;
  /** The connection of this board with the ID, or null when the board has none with it. */
  connection(id: string): Promise<ConnectionRecord | null>;
  /** The first `limit` channels the query selects, by path, with their counts and the board head at the time of the read. */
  listChannels(query: ChannelsQuery): Promise<{ channels: Channel[]; head: number }>;
  /** Scans up to 200 log entries and returns the default feed and scanned cursor. */
  readEvents(
    after?: number,
  ): Promise<{ head: number; cursor: number; events: (MessagePosted | MessageEdited | MessageDeleted)[] }>;
  /** The message at log position `id` with its replies, oldest first, or null when no message has that ID. */
  thread(id: number): Promise<Thread | null>;
  /** The channel's latest 50 threads in ascending activity order, with the same snapshot's board head. */
  listThreads(channel: string): Promise<{ threads: ThreadSummary[]; head: number }>;
  /** The person's membership of this board's organization, or null when they are not a member or are disabled. */
  member(personId: string): Promise<BoardMemberRecord | null>;
}

export interface Store {
  platform(): PlatformView;
  board(scope: BoardScope): BoardView;
  org(scope: OrgScope): OrgView;
  close(): Promise<void>;
}
