import { type Attachment, BoardError, type Message } from "@openboard/contract";
import type { SettledMentions } from "../../messages/mentions.ts";
import { actorSeen, type PostContext } from "../../messages/post.ts";
import { decideCreateTask, type MakeTaskState } from "../create.ts";
import { checkNeeds, needPositions } from "../needs.ts";

type Entry = Omit<Parameters<typeof decideCreateTask>[1], "channel" | "id"> & {
  files?: readonly Attachment[];
  key?: string;
  needs?: readonly (string | { key: string })[];
};

function batchLinks(entries: readonly Entry[]) {
  const keys = new Map<string, number>();
  for (const [index, { key }] of entries.entries()) {
    if (key === undefined) continue;
    if (keys.has(key)) throw new BoardError("invalid_needs", `Duplicate batch key ${key}.`);
    keys.set(key, index);
  }
  const links = entries.map(({ needs = [] }) => [
    ...new Set(
      needs.flatMap((need) => {
        if (typeof need === "string") return [];
        const index = keys.get(need.key);
        if (index === undefined) throw new BoardError("invalid_needs", `Unknown batch key ${need.key}.`);
        return [index];
      }),
    ),
  ]);
  const active = new Set<number>();
  const checked = new Set<number>();
  function visit(index: number) {
    if (checked.has(index)) return;
    if (active.has(index)) throw new BoardError("invalid_needs", "A batch task would wait for itself.");
    active.add(index);
    for (const need of links[index] ?? []) visit(need);
    active.delete(index);
    checked.add(index);
  }
  for (const index of links.keys()) visit(index);
  return keys;
}

export function batchNeedPositions(entries: readonly Entry[]) {
  return needPositions(
    entries.flatMap(({ needs = [] }) => needs.filter((need): need is string => typeof need === "string")),
  );
}

export function decideTaskBatch(
  { head, actor }: Pick<MakeTaskState, "head" | "actor">,
  channel: string,
  entries: readonly Entry[],
  context: PostContext & { blind: boolean },
  existing: readonly Message[],
  canRead: (root: Message) => boolean,
  mentions: readonly (SettledMentions | undefined)[],
  key?: { id: string; digest: string },
) {
  const keys = batchLinks(entries);
  const seen = actorSeen(actor, context, head + 1);
  let next = (seen?.id ?? head) + 1;
  // Plan positions in input order. The only extra event after a creation is for
  // a task with prerequisites that were all complete before the batch.
  const positions = entries.map(({ needs = [] }) => {
    const outside = needPositions(needs.filter((need): need is string => typeof need === "string"));
    const internal = needs.some((need) => typeof need !== "string");
    const { waitingOn } = checkNeeds(outside, existing, canRead);
    const position = next;
    next += 2 + Number(!internal && outside.length > 0 && waitingOn === 0);
    return { position, waitingOn };
  });
  const decisions = entries.map((entry, index) => {
    const plan = positions[index];
    if (!plan) throw new Error("missing batch position");
    const needs = new Set<number>();
    for (const need of entry.needs ?? []) {
      const position =
        typeof need === "string" ? Number(needPositions([need])[0]) : positions[keys.get(need.key) ?? -1]?.position;
      if (position === undefined) throw new Error("missing batch prerequisite");
      needs.add(position);
    }
    const waitingOn = plan.waitingOn + [...needs].filter((id) => id > head).length;
    return decideCreateTask(
      { head: plan.position - 1 },
      { ...entry, channel },
      { ...context, attachments: entry.files, needs: { ids: [...needs], waitingOn } },
      mentions[index],
    );
  });
  const events = [...(seen ? [seen] : []), ...decisions.flatMap(({ events }) => events)];
  const tasks = decisions.map(({ task }) => task);
  const finalRoot = tasks.at(-1)?.id;
  return {
    tasks,
    events: events.map((event) =>
      event.type === "task.created" && key
        ? {
            ...event,
            payload: {
              ...event.payload,
              blind: context.blind,
              ...(String(event.message) === finalRoot ? { batch: { ...key, tasks: tasks.map(({ id }) => id) } } : {}),
            },
          }
        : event,
    ),
  };
}
