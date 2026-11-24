import type {
  Actor,
  Author,
  Can,
  CanInput,
  Channel,
  ClaimedAgent,
  Connection,
  DeletedBoard,
  DeletedOrg,
  GrantLevel,
  Invitation,
  InvitationRole,
  listMembers,
  ManagedConnection,
  MentionActor,
  Message,
  Named,
  OutputOf,
  PersonalToken,
  Role,
  SchemaView,
} from "@openboard/contract";
import type {
  BoardCreation,
  BoardEvent,
  Grant,
  messages,
  OrgCreation,
  OrgQuotaOverrides,
  QuotaOutcome,
} from "@openboard/core";
import type { DeviceView, PersonRecord, SessionRecord, SignedInPerson, SignInRecord } from "./account-records.ts";
import type { BoardMessageReads, ChannelMessagesQuery, ChannelsQuery } from "./board-message-reads.ts";
import type { CommittedEvents } from "./broadcaster.ts";
import type { Bucket, OrgLogMaintenance } from "./bucket.ts";
import type { BoardGrantReads, BoardGrantWriter } from "./grants.ts";
import type { BoardInboundReads, BoardInboundWriter } from "./inbound/index.ts";
import type { BoardJobWriter, JobLease, Jobs } from "./jobs.ts";
import type { OidcKeyStore } from "./oidc-keys.ts";
import type { OperatorReads, OperatorWrites } from "./operator.ts";
import type { OrgExports } from "./org/exports.ts";
import type { OrgAuditRecord } from "./org-audit-record.ts";
import type { BoardTaskReads, BoardTaskWriter } from "./tasks.ts";
import type { BoardKeys, BoardScope, OrgScope } from "./tenant-scope.ts";
import type { BoardWatcherReads, BoardWatcherWriter } from "./watchers.ts";
import type { BoardWebhookReads, BoardWebhookWriter } from "./webhooks/index.ts";

export type { BoardKeys, BoardScope, OrgScope } from "./tenant-scope.ts";

/** A board configuration event (`ob.*`, visibility 2), as stored: its payload may hold hashes the audit strips. */
export type AuditRecord = Extract<BoardEvent, { readonly visibility: 2 }>;

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

interface RateView {
  /** Consume one attempt in this scope's fixed window, or return the retry delay in seconds. */
  takeRate(key: string, limit: number, windowMs: number, now: number): Promise<number | undefined>;
}

export interface OrgView extends RateView, OrgLogMaintenance, OrgExports {
  /** Consume a backfill lease and fill one batch under the board lock. */
  backfillBoardOrgIds(boardId: number, jobId: string, lease: JobLease, now: number): Promise<boolean>;
  deleteOrg(personId: string, at: number, admit?: () => void): Promise<DeletedOrg>;
  listMembers(): Promise<OutputOf<typeof listMembers>["members"]>;
  /** The organization's first `limit` events after its event ID `after`, oldest first, and the last event ID read first. */
  auditEvents(after: number, limit: number): Promise<{ events: OrgAuditRecord[]; head: number }>;
  /**
   * Changes the role and records its audit event together. Throws `last_owner` if the change would leave no owner.
   * Returns null when the target is outside this organization.
   */
  changeMemberRole(record: {
    readonly personId: string;
    readonly targetId: string;
    readonly role: Role;
    readonly at: number;
    readonly admit?: () => void;
  }): Promise<{ principal: string; role: Role } | null>;
  /** Removes a member and records its audit event together, preserving the last owner and the person's sessions. */
  removeMember(record: {
    readonly personId: string;
    readonly targetId: string;
    readonly at: number;
    readonly admit?: () => void;
  }): Promise<{ principal: string } | null>;
  /** Stores the invitation and audit event together. False if the creator no longer has admin rights here. */
  createInvitation(record: {
    readonly invitation: Invitation;
    readonly tokenHash: Uint8Array;
    readonly personId: string;
    readonly at: number;
    readonly expiresAt: number;
    readonly admit?: () => void;
  }): Promise<boolean>;
  /**
   * In one transaction, under the person `personId`'s admin membership locked: marks the organization's invitation
   * `id` revoked at `at` and records `ob.invitation.revoked`. Nothing is written when the person is no longer an owner
   * or admin (`not_admin`), the organization has no such invitation (`not_found`), or it was already accepted or
   * revoked (`used`).
   */
  revokeInvitation(
    id: string,
    personId: string,
    at: number,
    admit?: () => void,
  ): Promise<"revoked" | "not_admin" | "not_found" | "used">;
  /** The organization's boards that are not deleted, by slug. */
  listBoards(): Promise<Named[]>;
  /**
   * In one transaction, under the organization's row and the creator's admin membership locked: the board, its grant
   * IDs g1 to g3 kept for the seeded grants as every board's are, and its event at the organization's next event ID.
   * Nothing is written when the person `personId` (`u_…`) is no longer an owner or admin (`not_admin`) or a board of
   * the organization, deleted or not, already has the slug (`slug_taken`), or the board quota is exhausted.
   */
  createBoard(
    creation: BoardCreation,
    personId: string,
    admit?: () => void,
  ): Promise<"created" | "not_admin" | "slug_taken" | QuotaOutcome>;
  /** Marks a board deleted and appends its audit event under the organization lock. */
  deleteBoard(slug: string, personId: string, at: number, admit?: () => void): Promise<DeletedBoard>;
}

/** Reads and writes that belong to no tenant: resolving the board a path names, people and their sessions. */
export interface PlatformView extends RateView, OidcKeyStore, OperatorReads, OperatorWrites, DeviceView {
  /** At startup, enqueue board-scoped work for any rows still missing their organization. */
  queueBoardOrgBackfill(now: number, signal?: AbortSignal): Promise<void>;
  /** Maintenance scan of unpurged organization IDs with unshipped events in ascending order. */
  shippingOrgs(after: number, limit: number): Promise<number[]>;
  accountPersonalToken(hash: string, now: number): Promise<{ personId: string; restricted: boolean } | null>;
  /** List metadata for the person's tokens across organizations, including revocation timestamps. */
  listPersonalTokens(personId: string): Promise<PersonalToken[]>;
  /** Revoke an owned token, preserving its first revocation time. Null if the person does not own the ID. */
  revokePersonalToken(personId: string, id: string, now: number): Promise<number | null>;
  /** Resolve a board in a live organization, optionally distinguishing its tombstone from an unknown slug. */
  findBoard(
    orgSlug: string,
    boardSlug: string,
    includeDeleted?: boolean,
  ): Promise<(BoardKeys & { deleted?: true }) | null>;
  /**
   * In one transaction: the person holding the identity, their details refreshed from it, or a new person when
   * `admitNew` or a live invitation admits them. A supplied invitation is redeemed for a new person before opening
   * their session. Null when the identity is new and not admitted, or the person is disabled.
   */
  signIn(record: SignInRecord): Promise<SignedInPerson | null>;
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
  /** Replaces the count quota overrides for one organization; false when the organization is absent. */
  setOrgQuotas(orgId: number, overrides: OrgQuotaOverrides): Promise<boolean>;
  /** The person's memberships of organizations that are not deleted, by organization slug. */
  memberships(personId: string): Promise<MembershipRecord[]>;
  /** The tenant resolver checks the signed-in person's membership before minting an organization scope. */
  orgMembership(slug: string, personId: string): Promise<{ orgId: number; role: Role } | null>;
  /**
   * Redeems the exact token hash and records the membership and audit event in one transaction. An exhausted member
   * quota leaves the invitation unconsumed.
   * Throws `already_in_org` when the person already belongs to an organization (v1 allows one, D34), and
   * `invitation_used` when the invitation was already accepted, revoked, or expired at `at` (single use, 7 days).
   */
  acceptInvitation(
    tokenHash: Uint8Array,
    personId: string,
    at: number,
  ): Promise<MembershipRecord | QuotaOutcome | null>;
  /** A capability lookup: only the exact token hash selects an invitation, returning preview fields. */
  invitationPreview(tokenHash: Uint8Array): Promise<{
    orgName: string;
    role: InvitationRole;
    expiresAt: number;
    used: boolean;
  } | null>;
}

/** One board-locked transaction: the head is read under the lock, events go at `head + 1…` and are folded. */
export interface BoardWriter
  extends BoardTaskWriter,
    BoardGrantWriter,
    BoardJobWriter,
    BoardWatcherWriter,
    BoardInboundWriter,
    BoardWebhookWriter {
  readonly head: number;
  schema(id: string): Promise<SchemaView | null>;
  schemaCount(): Promise<number>;
  /** The actors available to resolve handles under the write lock. */
  mentionActors(handles: ReadonlySet<string>): Promise<MentionActor[]>;
  /** Check the selected message versions that established candidate visibility before the lock. */
  unchangedMentionEvidence(proofs: readonly MentionEvidence[]): Promise<ReadonlySet<string>>;
  /** The actors who wrote in a thread, including writers of deleted messages. */
  threadWriters(thread: number): Promise<ReadonlySet<string>>;
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
  /** Whether a connection of this board, revoked or not, has the name. */
  connectionNamed(name: string): Promise<boolean>;
  /** An exhausted connection quota under this board write lock, or null when capacity remains. */
  connectionQuota(): Promise<QuotaOutcome | null>;
  /** The unrevoked connection of this board with the ID, read under the lock, or null when the board has none with it. */
  connection(id: string): Promise<ConnectionRecord | null>;
  /** The unrevoked agent of this board with the ID, read under the lock, or null when the board has none with it. */
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

/** A connection as stored, with its grant and the SHA-256 (hex) of its secret, which is never stored itself. */
export interface ConnectionRecord {
  readonly connection: Connection;
  readonly grant: Grant;
  /** The active grants used to resolve effectiveCan, with their closest rank for this connection. */
  readonly grantCans: AgentRecord["grantCans"];
  readonly effectiveCan: Can;
  readonly secretHash: string;
  /** The secret the last rotation replaced: its SHA-256 (hex), and the epoch milliseconds it works until; or null. */
  readonly previous: { readonly secretHash: string; readonly until: number } | null;
  /** A claimed token's lifetime and hard cap, in seconds. */
  readonly tokenTtl: number;
  readonly tokenMax: number;
  /** How many claims its secret makes before it is spent (null: no limit), and how many it made. */
  readonly claims: { readonly max: number | null; readonly used: number };
}

/** An agent claimed with a connection's secret, with its connection and the SHA-256 (hex) of its token. */
export interface AgentRecord {
  readonly agent: ClaimedAgent;
  readonly grantCans: readonly { can: CanInput; level: GrantLevel; capped: false }[];
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

export interface MentionEvidence {
  readonly actor: string;
  readonly channel: string;
  readonly id: number;
  readonly version: number;
  readonly reference: string | null;
}

/** One board's storage; every statement it runs is bound to its scope. */
export interface BoardView
  extends RateView,
    BoardMessageReads,
    BoardTaskReads,
    BoardGrantReads,
    BoardWatcherReads,
    BoardInboundReads,
    BoardWebhookReads {
  /**
   * Wake when a write advances this board past the cursor, with the head it reached and its events when in memory.
   * Returns an unsubscribe.
   */
  subscribeEvents(
    fromPosition: number,
    wake: (committed: CommittedEvents | undefined, head: number) => void,
    invalidated?: () => void,
  ): () => void;
  /** Look up a personal credential in scope. A known but unusable token returns "inactive"; a scope miss returns null. */
  personalToken(
    tokenHash: string,
    now: number,
  ): Promise<
    | (Pick<PersonRecord, "id" | "handle" | "name" | "avatar"> & {
        tokenName: string;
        expiresAt: number;
        can?: Can;
        boardBound?: true;
      })
    | "inactive"
    | null
  >;
  /** Display names and slugs for this board and its organization. */
  identity(): Promise<{ org: Named; board: Named }>;
  schema(id: string): Promise<SchemaView | null>;
  schemas(): Promise<SchemaView[]>;
  /**
   * Locks the board, runs `fn`, and commits what it appended, or rolls everything back if it throws. With `actor`,
   * the board's record of that actor is read under the lock. With `taskId`, the initial message and claim proof
   * for that position can be loaded with the lock and reused by the writer's read methods.
   */
  write<T>(fn: (writer: BoardWriter) => Promise<T>, actor?: string, taskId?: number | null): Promise<T>;
  /** Candidate authors, reactors and possible prose references, from one snapshot outside the write lock. */
  mentionEvidence(handles: ReadonlySet<string>): Promise<MentionEvidence[]>;
  /** Actor candidates for one feed's author and mention filters, using the board's current names. */
  findFilterActors(
    author?: string,
    mention?: { readonly id: string; readonly handle?: string },
  ): Promise<Pick<Actor, "id" | "kind" | "handle">[]>;
  /** Every actor the board has seen write, by handle then ID, and the board head at the time of the read. */
  listActors(): Promise<{ actors: Actor[]; head: number }>;
  /** The channel's first `limit` messages after `after`, or its latest `limit`, oldest first. Null if `after` exceeds the board head. */
  channelMessages(query: ChannelMessagesQuery): Promise<Message[] | null>;
  /** The author's post by client ID, as it landed, or null if it is missing or belongs to another author. */
  ownClientPost(clientId: string, by: Author): Promise<Message | null>;
  /** The unrevoked agent of this board with the ID, or null when the board has none with it. */
  agent(id: string): Promise<AgentRecord | null>;
  /** The unrevoked connection of this board with the ID, or null when the board has none with it. */
  connection(id: string): Promise<ConnectionRecord | null>;
  /**
   * The board's unrevoked connections by name, each with its agents unrevoked and whose token lives at `now` (epoch
   * milliseconds), and the time of its latest event; never a secret or a secret's hash.
   */
  listConnections(now: number): Promise<ManagedConnection[]>;
  /** One unrevoked connection of this board as `listConnections` shows it, or null when the board has none with it. */
  managedConnection(id: string, now: number): Promise<ManagedConnection | null>;
  /** The first `limit` channels the query selects, by path, with their counts and the board head at the time of the read. */
  listChannels(query: ChannelsQuery): Promise<{ channels: Channel[]; head: number }>;
  /**
   * The board's first `limit` configuration events (`ob.*`) after log position `after`, oldest first, and the head read
   * with them.
   */
  auditEvents(after: number, limit: number): Promise<{ events: AuditRecord[]; head: number }>;
  /** The person's membership of this board's organization, or null when they are not a member or are disabled. */
  member(personId: string): Promise<BoardMemberRecord | null>;
}

/** Ensure an archive exists, returning false when another instance holds the dump lock. */
export type DatabaseDump = (bucket: Bucket, key: string, signal: AbortSignal) => Promise<boolean>;

export interface Store {
  readonly jobs: Jobs;
  readonly dumpIfMissing?: DatabaseDump;
  /** Query storage and report whether its schema meets this instance's migration level. */
  schemaReady(): Promise<boolean>;
  platform(): PlatformView;
  board(scope: BoardScope): BoardView;
  org(scope: OrgScope): OrgView;
  close(): Promise<void>;
}

export type { ChannelMessagesQuery, ChannelsQuery, ThreadPosition } from "./board-message-reads.ts";
