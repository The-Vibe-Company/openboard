import { agents, boards, connections, decideCreateTask, decideInvitation, messages, orgs } from "@openboard/core";
import type { BoardView, OrgView, Store } from "../src/index.ts";
import { testOrgScope, testScope } from "./index.ts";

export const at = 1_700_000_000_000;
const DAY = 86_400_000;

/** One organization of the storage isolation suite: its views, and the IDs and names of what it holds. */
export interface StoreTenant {
  readonly personId: string;
  readonly actor: string;
  readonly board: BoardView;
  readonly org: OrgView;
  /** Its last message, a root; when B's, an ID A's board never reaches. */
  readonly message: number;
  readonly clientId: string;
  readonly task: number;
  readonly channel: string;
  readonly connection: string;
  readonly agent: string;
  readonly claimKey: string;
  readonly invitation: string;
  readonly tokenHash: string;
  /** Text every name and message of this tenant carries. */
  readonly marker: string;
}

const hex = (digit: string) => digit.repeat(64);

async function signUp(store: Store, login: string, digit: string): Promise<string> {
  const personId = `u_${digit.repeat(16)}`;
  const identity = { provider: "github", subject: digit, login, name: login, email: null, avatar: null };
  const session = { idHash: hex(digit), csrf: `csrf-${digit}`, expiresAt: at + DAY };
  await store.platform().signIn({ identity, admitNew: true, newPersonId: personId, session, now: at });
  return personId;
}

function post(board: BoardView, actor: string, channel: string, text: string, id: string) {
  const by = { actor, principal: actor, profile: null };
  return board.write(async (writer) => {
    const decided = messages.decidePost({ head: writer.head }, { channel, text, id }, { by, now: at });
    await writer.append(decided.events);
    return Number(decided.message.id);
  });
}

/** A connection named after the tenant and an agent claimed with it, decided as the server does under the lock. */
async function connectAndClaim(board: BoardView, actor: string, marker: string, digit: string) {
  const by = { actor, principal: actor, profile: null };
  const secret = { id: `cn_${digit.repeat(16)}`, hash: hex(digit === "a" ? "c" : "d"), hint: `…${digit.repeat(4)}` };
  const connection = await board.write(async (writer) => {
    const state = { head: writer.head, nextGrant: await writer.nextGrant(), nameTaken: false };
    const command = { name: `${marker}-fleet`, can: { "*": "all" as const } };
    const decided = connections.decideCreate(state, command, { by, now: at, secret });
    await writer.append(decided.events);
    return decided.connection;
  });
  const claimKey = `${marker}-claim`;
  const token = { id: `ag_${digit.repeat(16)}`, hash: hex(digit === "a" ? "e" : "f") };
  const claiming = {
    ...connection,
    profiles: ["*"],
    tokenTtl: 3600,
    tokenMax: DAY / 1000,
    claims: { max: null, used: 0 },
  };
  await board.write(async (writer) => {
    const context = { by: { ...by, actor: connection.principal, principal: connection.principal }, now: at };
    const command = { profile: marker, idempotencyKey: claimKey };
    const decided = agents.decideClaim({ head: writer.head, holder: null }, command, {
      ...context,
      connection: claiming,
      token,
    });
    await writer.append(decided.events);
  });
  return { connection: connection.id, agent: token.id, claimKey };
}

/** A personal token of the person for their organization, through an approved device sign-in. */
async function personalToken(store: Store, org: string, personId: string, digit: string): Promise<string> {
  const tokenHash = hex(digit === "a" ? "1" : "2");
  const platform = store.platform();
  await platform.startDevice(tokenHash, `code-${digit}`, "laptop", at, at + DAY);
  if (!(await platform.approveDevice(`code-${digit}`, org, personId, at))) throw new Error("device not approved");
  const issue = { id: `pt_${digit.repeat(16)}`, tokenHash, now: at, expiresAt: at + DAY };
  if ((await platform.pollDevice(tokenHash, 0, issue)).status !== "issued") throw new Error("no personal token");
  return tokenHash;
}

/** An organization `slug` owned by a new person, its board `main` holding `posts` messages, a connection, an agent. */
export async function storeTenant(store: Store, slug: string, digit: string, posts: number): Promise<StoreTenant> {
  const marker = `${slug}-only`;
  const personId = await signUp(store, `${slug}-owner`, digit);
  const actor = `ob:user:${personId}`;
  await store
    .platform()
    .createOrg({ ...orgs.decideCreate({ slug, name: marker }, { by: actor, now: at }), personId, now: at });
  const keys = await store.platform().findBoard(slug, "main");
  const member = await store.platform().orgMembership(slug, personId);
  if (!keys || !member) throw new Error(`seed: ${slug}/main is missing`);
  const board = store.board(testScope(keys));
  const org = store.org(testOrgScope(member.orgId));
  const channel = `${marker}-dev`;
  let message = 0;
  for (let index = 0; index < posts; index++) {
    message = await post(board, actor, channel, `${marker} note ${index}`, `${marker}-${index}`);
  }
  const task = await board.write(async (writer) => {
    const by = { actor, principal: actor, profile: null };
    const decided = decideCreateTask({ head: writer.head }, { channel, text: `${marker} task` }, { by, now: at });
    await writer.append(decided.events);
    return Number(decided.task.id);
  });
  const claimed = await connectAndClaim(board, actor, marker, digit);
  const invitation = `inv_${digit.repeat(16)}`;
  const record = decideInvitation({ role: "member" }, { by: actor, id: invitation, now: at });
  const tokenHash = new Uint8Array(32).fill(digit.charCodeAt(0));
  if (!(await org.createInvitation({ ...record, personId, at, tokenHash }))) throw new Error("seed: no invitation");
  const personal = await personalToken(store, slug, personId, digit);
  const clientId = `${marker}-${posts - 1}`;
  return {
    personId,
    actor,
    board,
    org,
    message,
    clientId,
    task,
    channel,
    ...claimed,
    invitation,
    tokenHash: personal,
    marker,
  };
}

/** A board creation for `slug`, as core decides it, by `actor`. */
export function boardCreation(slug: string, actor: string) {
  return boards.decideCreateBoard({ slug, name: slug }, { by: actor, now: at });
}
