import type { AgentClaimed, AgentRefreshed } from "./access/agents.ts";
import type { ConnectionCreated } from "./access/connections.ts";
import type { ChannelCreated } from "./channels/create.ts";
import type { MessageEdited } from "./messages/edit.ts";
import type { ActorSeen, MessagePosted } from "./messages/post.ts";

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
  | MessageEdited;
export { formatId, isoTime, parseId } from "./ids.ts";
export { decideEdit, type MessageEdited } from "./messages/edit.ts";
export type { ActorSeen, MessagePosted, MessagePostedPayload, PostCommand } from "./messages/post.ts";
export * as messages from "./messages/post.ts";
export type { CreateOrgCommand, OrgCreation, OrgEvent } from "./orgs/create.ts";
export * as orgs from "./orgs/create.ts";
