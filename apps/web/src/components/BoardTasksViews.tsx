import { Link } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import type { ThreadSummary } from "../api/board.ts";
import { browserClient } from "../api/client.ts";
import type { TaskActor } from "../api/tasks.ts";
import { markdownPreview } from "../markdown.ts";
import { Badge, Button, Input, Textarea } from "../ui/index.ts";
import { parseLabelInput } from "./Composer.tsx";
import { TaskStateBadge } from "./TaskState.tsx";

type Board = { org: string; board: string };
type NewTaskDraft = { channel: string; text: string; labels: string; needs: string };

const KANBAN_COLUMNS = [
  { key: "waiting", title: "Waiting", states: ["waiting"] },
  { key: "ready", title: "Ready", states: ["ready"] },
  { key: "claimed", title: "Claimed", states: ["claimed"] },
  { key: "blocked", title: "Blocked", states: ["blocked"] },
  { key: "done", title: "Done", states: ["completed", "failed", "canceled"] },
] as const;

function taskTitle(summary: ThreadSummary) {
  return markdownPreview(summary.message.text) || `Thread #${summary.message.id}`;
}

async function submitTaskDraft(board: Board, draft: NewTaskDraft) {
  const labels = parseLabelInput(draft.labels);
  const needs = draft.needs
    .split(/[,\s]+/)
    .map((id) => id.replace(/^#/, "").trim())
    .filter((id) => /^\d+$/.test(id));
  await browserClient(window.location.origin, board).createTask({
    channel: draft.channel,
    text: draft.text,
    ...(labels ? { labels } : {}),
    ...(needs.length ? { needs } : {}),
  });
}

function TaskField({
  id,
  label,
  placeholder,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <Input
        id={id}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </div>
  );
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
  return (
    <>
      <div className="tasks-new-grid">
        <TaskField
          id={`${id}-ch`}
          label="Channel"
          placeholder={defaultChannel}
          value={draft.channel}
          disabled={disabled}
          onChange={(channel) => onChange({ channel })}
        />
        <TaskField
          id={`${id}-lb`}
          label="Labels (key=value)"
          placeholder="priority=high, area=web"
          value={draft.labels}
          disabled={disabled}
          onChange={(labels) => onChange({ labels })}
        />
        <TaskField
          id={`${id}-nd`}
          label="Depends on (task IDs)"
          placeholder="e.g. 12, 18"
          value={draft.needs}
          disabled={disabled}
          onChange={(needs) => onChange({ needs })}
        />
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
      await submitTaskDraft(board, { ...draft, channel: draft.channel.trim() || defaultChannel });
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

export function TasksKanban({
  board,
  tasks,
  actors,
}: {
  board: Board;
  tasks: readonly ThreadSummary[];
  actors?: ReadonlyMap<string, TaskActor>;
}) {
  return (
    <section className="tasks-kanban" aria-label="Task board">
      {KANBAN_COLUMNS.map((col) => {
        const items = tasks.filter(
          (item) => item.message.task && (col.states as readonly string[]).includes(item.message.task.state),
        );
        return (
          <section key={col.key} className="tasks-column" aria-label={col.title}>
            <div className="tasks-column-head">
              <h2>{col.title}</h2>
              <Badge>{items.length}</Badge>
            </div>
            <ul className="tasks-column-list">
              {items.map((item) => {
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
                      <TaskStateBadge task={task} holder={holder} recordedState={item.message.labels["board.task"]} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </section>
  );
}

export function TasksQueue({
  board,
  tasks,
  actors,
}: {
  board: Board;
  tasks: readonly ThreadSummary[];
  actors?: ReadonlyMap<string, TaskActor>;
}) {
  return (
    <ul className="tasks-queue-list" aria-label="Task queue">
      {tasks.map((item) => {
        const task = item.message.task;
        if (!task) return null;
        const holder = task.claim ? actors?.get(task.claim.actor) : undefined;
        return (
          <li key={item.message.id}>
            <Link
              className="tasks-queue-row"
              to="/$org/$board/t/$id"
              params={{ ...board, id: item.message.id }}
              search={{ channel: item.message.channel }}
            >
              <div className="tasks-queue-main">
                <span className="tasks-card-title">{taskTitle(item)}</span>
                <div className="tasks-card-meta">
                  <span>#{item.message.id}</span>
                  <span>#{item.message.channel}</span>
                  {task.needs.length > 0 && <span>needs {task.needs.map((n) => `#${n}`).join(", ")}</span>}
                </div>
              </div>
              <div className="tasks-queue-right">
                <TaskStateBadge task={task} holder={holder} recordedState={item.message.labels["board.task"]} />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
