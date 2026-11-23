import type { AgentClaimed, AgentRefreshed } from "./access/agents.ts";
import type { ConnectionCreated } from "./access/connections.ts";
import type { ChannelCreated } from "./channels/create.ts";
import type { MessageDeleted } from "./messages/delete.ts";
import type { MessageEdited } from "./messages/edit.ts";
import type { ActorSeen, MessagePosted } from "./messages/post.ts";
import type { ReactionAdded, ReactionRemoved } from "./messages/reactions.ts";

export type {
  AgentClaimed,
  AgentRefreshed,
  ClaimCommand,
  ClaimingConnection,
  MintedToken,
  RefreshingAgent,
} from "./access/agents.ts";
export * as agents from "./access/agents.ts";
export type { ConnectionCreated, ConnectionState, MintedSecret } from "./access/connections.ts";
export * as connections from "./access/connections.ts";
export type { Grant, GrantPrincipal } from "./access/grants.ts";
export * as grants from "./access/grants.ts";
export * as channels from "./channels/create.ts";
export type { ChannelCreated };
export type BoardEvent =
  | ActorSeen
  | AgentClaimed
  | AgentRefreshed
  | ChannelCreated
  | ConnectionCreated
  | MessagePosted
  | MessageEdited
  | MessageDeleted
  | ReactionAdded
  | ReactionRemoved;
export { formatId, isoTime, parseId } from "./ids.ts";
export { decideDelete, type MessageDeleted } from "./messages/delete.ts";
export { decideEdit, type MessageEdited } from "./messages/edit.ts";
export type { ActorSeen, MessagePosted, MessagePostedPayload, PostCommand } from "./messages/post.ts";
export * as messages from "./messages/post.ts";
export {
  canonicalEmoji,
  decideReaction,
  type ReactionAdded,
  type ReactionRemoved,
  type ReactionState,
} from "./messages/reactions.ts";
export type { CreateOrgCommand, OrgCreation, OrgEvent } from "./orgs/create.ts";
export { decideInvitation, previewInvite } from "./orgs/invite.ts";
export type { BoardCreation, CreateBoardCommand } from "./orgs/boards.ts";
export * as boards from "./orgs/boards.ts";
export * as orgs from "./orgs/create.ts";
