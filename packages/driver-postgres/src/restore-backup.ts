import { ATTACHMENT_ID_PATTERN, BoardError } from "@openboard/contract";
import type { BackupBoard, BackupMembership, Bucket } from "@openboard/ports";

export function invalid(message: string): never {
  throw new BoardError("invalid_request", message);
}

export async function backupKeys(bucket: Bucket, prefix: string) {
  const keys: string[] = [];
  for await (const key of bucket.list(prefix)) {
    if (!key.startsWith(prefix)) invalid(`Unexpected backup key outside ${prefix}`);
    keys.push(key);
  }
  return keys;
}

export async function objects(bucket: Bucket, key: string) {
  return (await bucket.read(key)) ?? invalid(`Missing backup object ${key}`);
}

export async function manifest(bucket: Bucket, orgId: number) {
  const prefix = `org/${orgId}/boards/`;
  const latest = (await backupKeys(bucket, prefix))
    .filter((key) => /^\d+\.json$/.test(key.slice(prefix.length)))
    .sort((a, b) => Number(b.slice(prefix.length, -5)) - Number(a.slice(prefix.length, -5)))[0];
  if (!latest) return;
  const value = (await new Response(await objects(bucket, latest)).json()) as {
    orgId?: unknown;
    slug?: unknown;
    boards?: BackupBoard[];
    members?: BackupMembership[];
  } | null;
  if (value?.orgId !== orgId || typeof value.slug !== "string" || !Array.isArray(value.boards))
    invalid(`Invalid board manifest ${latest}`);
  const ids = new Set<number>();
  const slugs = new Set<string>();
  for (const board of value.boards) {
    if (
      !board ||
      !Number.isSafeInteger(board.id) ||
      board.id < 1 ||
      typeof board.slug !== "string" ||
      typeof board.name !== "string" ||
      !Number.isSafeInteger(board.createdAt) ||
      (board.deletedAt !== null && !Number.isSafeInteger(board.deletedAt)) ||
      ids.has(board.id) ||
      slugs.has(board.slug)
    )
      invalid(`Invalid board manifest ${latest}`);
    ids.add(board.id);
    slugs.add(board.slug);
  }
  const members = value.members ?? [];
  if (
    !Array.isArray(members) ||
    members.some(
      (member) =>
        !member ||
        typeof member.principal !== "string" ||
        typeof member.invitedBy !== "string" ||
        !Number.isSafeInteger(member.createdAt),
    )
  )
    invalid(`Invalid memberships in manifest ${latest}`);
  return { slug: value.slug, boards: value.boards, members };
}

export async function* shippedEvents<T extends { id: number; at: number }>(
  bucket: Bucket,
  orgId: number,
  boardId: number,
  head: number,
  legacy: boolean,
) {
  const prefix = `org/${orgId}/${boardId ? `board/${boardId}` : "log"}/`;
  const ranges = (await backupKeys(bucket, prefix))
    .map((key) => {
      const match = /^(\d+)-(\d+)\.ndjson\.gz$/.exec(key.slice(prefix.length));
      const first = Number(match?.[1]);
      const last = Number(match?.[2]);
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first)
        invalid(`Invalid backup segment key ${key}`);
      return { key, first, last };
    })
    .sort((a, b) => a.first - b.first || b.last - a.last);
  for (const { key, first, last } of ranges) {
    if (last <= head) continue;
    if (first > head + 1) invalid(`Missing backup segment covering event ${head + 1} before ${key}`);
    const bytes = await new Response(await objects(bucket, key)).arrayBuffer();
    let previous = first - 1;
    const events: T[] = [];
    try {
      const content = new TextDecoder("utf-8", { fatal: true }).decode(Bun.gunzipSync(bytes));
      for (const line of content.trimEnd().split("\n")) {
        const event = JSON.parse(line) as T & {
          org_id?: number;
          board_id?: number;
          v?: number;
          type?: unknown;
          payload?: unknown;
          actor?: unknown;
        };
        if (
          !Number.isSafeInteger(event.id) ||
          event.id <= previous ||
          event.id > last ||
          !Number.isSafeInteger(event.at) ||
          typeof event.type !== "string" ||
          typeof event.actor !== "string" ||
          !event.payload ||
          typeof event.payload !== "object" ||
          !(
            (event.org_id === orgId && event.board_id === boardId) ||
            (legacy && !("org_id" in event) && !("board_id" in event))
          ) ||
          (boardId ? event.v !== 1 : event.id !== previous + 1)
        )
          throw new Error("Invalid event");
        previous = event.id;
        if (event.id > head) events.push(event);
      }
    } catch {
      invalid(`Invalid event in backup segment ${key}`);
    }
    // Compaction and timeline changes can leave holes inside a shipped board range.
    if (previous !== last) invalid(`Incomplete backup segment ${key}`);
    yield events;
    head = last;
  }
}

export async function attachmentBackup(bucket: Bucket, orgId: number, boardId: number, id: string) {
  if (!ATTACHMENT_ID_PATTERN.test(id)) invalid("Invalid attachment ID in backup");
  const key = `org/${orgId}/attachments/${boardId}/${id}.json`;
  const body = await bucket.read(key);
  if (!body) return null;
  const value = (await new Response(body).json()) as {
    sha256: string;
    uploader: string;
    at: number;
    gcEnqueued: number | null;
    shippedAt: number;
  } | null;
  if (
    !value ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    typeof value.uploader !== "string" ||
    !Number.isSafeInteger(value.at) ||
    !Number.isSafeInteger(value.shippedAt) ||
    ![null, 0, 1].includes(value.gcEnqueued)
  )
    invalid(`Invalid attachment metadata ${key}`);
  return value;
}
