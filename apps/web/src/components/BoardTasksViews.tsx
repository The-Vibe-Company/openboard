import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ThreadSummary } from "../api/board.ts";
import { browserClient } from "../api/client.ts";
import { sessionQuery } from "../api/session.ts";
import type { Task, TaskActor } from "../api/tasks.ts";
import { markdownPreview } from "../markdown.ts";
import { Button, Input, Textarea } from "../ui/index.ts";
import { parseLabelInput } from "./Composer.tsx";
import { claimHolderText, TaskStateBadge } from "./TaskState.tsx";

type Board = { org: string; board: string };
type TaskViewProps = { board: Board; tasks: readonly ThreadSummary[]; actors?: ReadonlyMap<string, TaskActor> };
type NewTaskDraft = { channel: string; text: string; labels: string; needs: string };

const KANBAN_COLUMNS = [
  { key: "waiting", title: "Waiting" },
  { key: "ready", title: "Ready" },
  { key: "claimed", title: "Claimed" },
  { key: "blocked", title: "Blocked" },
  { key: "done", title: "Done" },
] as const;

const INITIAL_DONE = 8;
const DONE_INCREMENT = 15;
const ACTIVE_PAGE_SIZE = 25;
const AgeClock = createContext(0);

function TaskAgeClock({ children }: { children: ReactNode }) {
  return <AgeClock.Provider value={useRelativeTimeClock()}>{children}</AgeClock.Provider>;
}

function useVisibleTasks(initial: number, increment: number) {
  const [limit, setLimit] = useState(initial);
  const list = useRef<HTMLUListElement>(null);
  const focusIndex = useRef<number | undefined>(undefined);
  const listId = useId();
  useLayoutEffect(() => {
    if (focusIndex.current === undefined || focusIndex.current >= limit) return;
    list.current?.children[focusIndex.current]?.querySelector("a")?.focus();
    focusIndex.current = undefined;
  }, [limit]);
  function show(limit: number, focus: number) {
    focusIndex.current = focus;
    setLimit(limit);
  }
  return { limit, list, listId, more: () => show(limit + increment, limit), less: () => show(initial, initial - 1) };
}

function newestTerminalFirst(a: ThreadSummary, b: ThreadSummary) {
  // Settling a task sets the root version to the transition's board event ID.
  return b.message.version - a.message.version;
}

function taskTitle(summary: ThreadSummary) {
  return markdownPreview(summary.message.text) || `Thread #${summary.message.id}`;
}

async function submitTaskDraft(board: Board, draft: NewTaskDraft, csrf: string | undefined) {
  const labels = parseLabelInput(draft.labels);
  const needs = draft.needs
    .split(/[,\s]+/)
    .map((id) => id.replace(/^#/, "").trim())
    .filter((id) => /^\d+$/.test(id));
  await browserClient(window.location.origin, { ...board, csrf }).createTask({
    channel: draft.channel,
    text: draft.text,
    ...(labels ? { labels } : {}),
    ...(needs.length ? { needs } : {}),
  });
}

function NewTaskFields({
  id,
  draft,
  defaultChannel,
  disabled,
  onChange,
}: {
  id: string;
  draft: NewTaskDraft;
  defaultChannel: string;
  disabled: boolean;
  onChange: (patch: Partial<NewTaskDraft>) => void;
}) {
  const fields = [
    ["channel", "ch", "Channel", defaultChannel],
    ["labels", "lb", "Labels (key=value)", "priority=high, area=web"],
    ["needs", "nd", "Depends on (task IDs)", "e.g. 12, 18"],
  ] as const;
  return (
    <>
      <div className="tasks-new-grid">
        {fields.map(([field, suffix, label, placeholder]) => (
          <div key={field}>
            <label htmlFor={`${id}-${suffix}`}>{label}</label>
            <Input
              id={`${id}-${suffix}`}
              placeholder={placeholder}
              value={draft[field]}
              disabled={disabled}
              onChange={(e) => onChange({ [field]: e.currentTarget.value })}
            />
          </div>
        ))}
      </div>
      <div>
        <label htmlFor={`${id}-tx`}>Task description</label>
        <Textarea
          id={`${id}-tx`}
          rows={3}
          placeholder="First line becomes the title. Markdown supported."
          value={draft.text}
          disabled={disabled}
          onChange={(e) => onChange({ text: e.currentTarget.value })}
        />
      </div>
    </>
  );
}

export function NewTaskForm({
  board,
  defaultChannel,
  onCancel,
  onCreated,
}: {
  board: Board;
  defaultChannel: string;
  onCancel: () => void;
  onCreated: () => Promise<void>;
}) {
  const { data: session } = useQuery(sessionQuery);
  const id = useId();
  const [draft, setDraft] = useState<NewTaskDraft>({ channel: "", text: "", labels: "", needs: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.text.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await submitTaskDraft(
        board,
        { ...draft, channel: draft.channel.trim() || defaultChannel },
        session?.csrf ?? undefined,
      );
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create task.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="tasks-new-form" onSubmit={submit}>
      <NewTaskFields
        id={id}
        draft={draft}
        defaultChannel={defaultChannel}
        disabled={submitting}
        onChange={(patch) => setDraft((cur) => ({ ...cur, ...patch }))}
      />
      {error && <p role="alert">{error}</p>}
      <div className="tasks-new-actions">
        <Button type="submit" size="small" pending={submitting} disabled={!draft.text.trim()}>
          Create task
        </Button>
        <Button type="button" size="small" variant="secondary" disabled={submitting} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function useRelativeTimeClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function RelativeAge({ date, now }: { date: string; now?: number }) {
  const clock = useContext(AgeClock);
  const seconds = Math.max(0, Math.floor(((now ?? clock) - Date.parse(date)) / 1000));
  const age =
    seconds < 60
      ? `${seconds}s`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)}m`
        : seconds < 86400
          ? `${Math.floor(seconds / 3600)}h`
          : `${Math.floor(seconds / 86400)}d`;
  return (
    <time dateTime={date} title={date}>
      {age}
    </time>
  );
}

function TaskLabels({ labels }: { labels: ThreadSummary["message"]["labels"] }) {
  return Object.entries(labels)
    .filter(([key]) => key !== "board.task")
    .map(([key, value]) => (
      <span key={key} className="board-ledger-chip" title={`${key}=${value}`}>
        {key}={value}
      </span>
    ));
}

const STATE_MARKS: Partial<Record<Task["state"], string>> = {
  completed: "m4 6.5 1.5 1.5 3.5-3.5",
  blocked: "M5 4.5v4m3-4v4",
  canceled: "m4 9 5-5",
  failed: "m4.5 4.5 4 4m0-4-4 4",
};

function QueueState({ state, recordedState }: { state: Task["state"]; recordedState?: string }) {
  return (
    <span className="tasks-queue-state">
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor">
        <circle cx="6.5" cy="6.5" r="5.5" strokeDasharray={state === "waiting" ? "2 1.5" : undefined} />
        {state === "claimed" && <circle cx="6.5" cy="6.5" r="1.5" fill="currentColor" />}
        {STATE_MARKS[state] && <path d={STATE_MARKS[state]} />}
      </svg>
      {state === "ready" && recordedState === "claimed" ? "expired" : state}
    </span>
  );
}

function isTerminal(state: string) {
  return state === "completed" || state === "failed" || state === "canceled";
}

export function TasksKanban({ board, tasks, actors }: TaskViewProps) {
  const columns = useMemo(() => {
    const groups: Record<string, ThreadSummary[]> = { waiting: [], ready: [], claimed: [], blocked: [], done: [] };
    for (const item of tasks) {
      const state = item.message.task?.state;
      if (state) groups[isTerminal(state) ? "done" : state]?.push(item);
    }
    groups.done?.sort(newestTerminalFirst);
    return groups;
  }, [tasks]);
  return (
    <section className="tasks-kanban" aria-label="Task board">
      {KANBAN_COLUMNS.map((column) => (
        <TasksColumn key={column.key} column={column} board={board} items={columns[column.key] ?? []} actors={actors} />
      ))}
    </section>
  );
}

function TasksColumn({
  column,
  board,
  items,
  actors,
}: {
  column: (typeof KANBAN_COLUMNS)[number];
  board: Board;
  items: readonly ThreadSummary[];
  actors?: ReadonlyMap<string, TaskActor>;
}) {
  const done = column.key === "done";
  const initial = done ? INITIAL_DONE : ACTIVE_PAGE_SIZE;
  const { limit, list, listId, more, less } = useVisibleTasks(initial, done ? DONE_INCREMENT : ACTIVE_PAGE_SIZE);
  const remaining = items.length - limit;
  return (
    <section className="tasks-column" aria-label={column.title}>
      <div className="tasks-column-head">
        <h2>{column.title}</h2>
        <span>{items.length}</span>
      </div>
      <ul className="tasks-column-list" id={listId} ref={list}>
        {items.slice(0, limit).map((item) => {
          const task = item.message.task;
          if (!task) return null;
          const holder = task.claim ? actors?.get(task.claim.actor) : undefined;
          return (
            <li key={item.message.id}>
              <Link
                className="tasks-card"
                to="/$org/$board/t/$id"
                params={{ ...board, id: item.message.id }}
                search={{ channel: item.message.channel }}
              >
                <span className="tasks-card-title">{taskTitle(item)}</span>
                <div className="tasks-card-meta">
                  <span>#{item.message.id}</span>
                  <span>#{item.message.channel}</span>
                  {item.replies > 0 && <span>{item.replies} replies</span>}
                </div>
                <TaskLabels labels={item.message.labels} />
                <TaskStateBadge task={task} holder={holder} recordedState={item.message.labels["board.task"]} />
              </Link>
            </li>
          );
        })}
      </ul>
      {remaining > 0 && (
        <button type="button" className="tasks-column-more" aria-controls={listId} onClick={more}>
          Show more ({remaining} more)
        </button>
      )}
      {done && limit > initial && (
        <button type="button" className="tasks-column-more" aria-controls={listId} onClick={less}>
          Show less
        </button>
      )}
    </section>
  );
}

export function TasksQueue({
  board,
  tasks,
  actors,
  stateFilter,
}: TaskViewProps & { stateFilter: Task["state"] | "open" | "all" }) {
  const { limit, list, listId, more } = useVisibleTasks(ACTIVE_PAGE_SIZE, ACTIVE_PAGE_SIZE);
  const terminal = isTerminal(stateFilter);
  const ordered = useMemo(() => (terminal ? tasks.toSorted(newestTerminalFirst) : tasks), [terminal, tasks]);
  const remaining = ordered.length - limit;
  const rows = (
    <ul className="tasks-queue-list" aria-label="Task queue" id={listId} ref={list}>
      {ordered.slice(0, limit).map((item) => {
        const task = item.message.task;
        if (!task) return null;
        const { id, channel, labels, createdAt } = item.message;
        const title = taskTitle(item);
        const status = task.claim
          ? `by ${claimHolderText(task.claim.actor, actors?.get(task.claim.actor))}`
          : task.needs.length
            ? `needs ${task.needs.map((need) => `#${need}`).join(", ")}`
            : "";
        return (
          <li key={item.message.id}>
            <Link
              className="tasks-queue-row"
              to="/$org/$board/t/$id"
              params={{ ...board, id: item.message.id }}
              search={{ channel: item.message.channel }}
            >
              <QueueState state={task.state} recordedState={labels["board.task"]} />
              <div className="tasks-queue-main">
                <span className="tasks-queue-id">#{id}</span>
                <span className="tasks-card-title" title={title}>
                  {title}
                </span>
                <TaskLabels labels={labels} />
              </div>
              <span className="tasks-queue-status" title={status}>
                {status}
              </span>
              <span className="tasks-queue-channel" title={`#${channel}`}>
                #{channel}
              </span>
              <RelativeAge date={createdAt} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
  return (
    <TaskAgeClock>
      {rows}
      {remaining > 0 && (
        <button type="button" className="tasks-load-more" aria-controls={listId} onClick={more}>
          Show more ({remaining} remaining)
        </button>
      )}
    </TaskAgeClock>
  );
}
