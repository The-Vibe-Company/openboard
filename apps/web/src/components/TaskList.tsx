import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { ThreadFilters, ThreadSummary } from "../api/board.ts";
import { channelAllTasksQuery, matchesTask, taskActorsQuery, tasksQuery } from "../api/tasks.ts";
import { markdownPreview } from "../markdown.ts";
import { TaskStateBadge } from "./TaskState.tsx";
import "./TaskList.css";

type Board = { org: string; board: string };

export function useChannelTasks(board: Board, channel: string, filters?: ThreadFilters) {
  const query = useInfiniteQuery(tasksQuery(board, channel));
  const allTasks = useQuery(channelAllTasksQuery(board, channel));
  const open = query.data?.pages.flatMap((page) => page.tasks) ?? [];
  const all = allTasks.data?.tasks ?? open;
  const terminal = ["completed", "failed", "canceled"];
  const done = all.filter(({ message }) => terminal.includes(message.task?.state ?? "")).reverse();
  const loaded = [...new Map([...open, ...all].map((row) => [row.message.id, row])).values()];
  const visibleOpen = filters ? loaded.filter((row) => !done.includes(row) && matchesTask(row, filters)) : open;
  const visibleDone = filters ? done.filter((row) => matchesTask(row, filters)) : done;
  const hasTasks = open.length + done.length > 0;
  const count = query.hasNextPage ? `${open.length}+` : open.length;
  const ready = query.isSuccess && allTasks.isSuccess;
  return { open: visibleOpen, done: visibleDone, count, hasTasks, query, ready };
}

type TaskListProps = {
  board: Board;
  query?: ReturnType<typeof useChannelTasks>["query"];
  tasks: ThreadSummary[];
  done?: boolean;
  manage?: () => void;
  children?: ReactNode;
};

function TaskList({ board, query, tasks, done, manage, children }: TaskListProps) {
  const count = query?.hasNextPage ? `${tasks.length}+` : tasks.length;
  const title = done ? "Completed tasks" : "Open tasks";
  const claims = tasks.some(({ message }) => message.task?.claim);
  const { data: actors } = useQuery(taskActorsQuery(board, claims));

  return (
    <section className="channel-tasks" aria-label="Tasks">
      <div className="channel-tasks-header">
        <div className="channel-tasks-title">
          <h2>{title}</h2>
          <span className="channel-tasks-count">{count}</span>
        </div>
        {manage && (
          <button type="button" onClick={manage}>
            Manage tasks →
          </button>
        )}
      </div>
      {tasks.length > 0 && (
        <ol aria-label={title}>
          {tasks.map(({ message, replies }) => {
            const task = message.task;
            if (!task) return null;
            const title = markdownPreview(message.text, message.mentions) || `Thread #${message.id}`;
            const detail = done && markdownPreview(task.result || task.reason || "");
            const replyCount = `${replies} ${replies === 1 ? "reply" : "replies"}`;
            return (
              <li key={message.id}>
                <span className="channel-task-id">#{message.id}</span>
                <Link
                  className="channel-task-link"
                  to="/$org/$board/t/$id"
                  params={{ ...board, id: message.id }}
                  search={true}
                >
                  {title}
                </Link>
                {Object.entries(message.labels)
                  .filter(([key]) => !key.startsWith("board."))
                  .slice(0, 2)
                  .map(([key, value]) => (
                    <span className="channel-task-label" key={key}>
                      {key}={value}
                    </span>
                  ))}
                <TaskStateBadge
                  task={task}
                  holder={task.claim ? actors?.get(task.claim.actor) : undefined}
                  recordedState={message.labels["board.task"]}
                />
                {done && <small>{replyCount}</small>}
                {detail && <span className="channel-task-detail">{detail}</span>}
              </li>
            );
          })}
        </ol>
      )}
      {query?.isError && <p role="alert">Could not load tasks.</p>}
      {query?.hasNextPage && (
        <button
          type="button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
        >
          {query.isFetchingNextPage ? "Loading tasks…" : "Load more tasks"}
        </button>
      )}
      {children}
    </section>
  );
}

const taskOptions = ["Open", "Done", "All"] as const;
const taskStates = taskOptions.map((state) => [state, state] as const);
export type TaskFilter = (typeof taskOptions)[number];

export function channelTaskLists(
  board: Board,
  channel: string,
  tasks: ReturnType<typeof useChannelTasks>,
  filter: TaskFilter | undefined,
  select: (filter: TaskFilter) => void,
  manage: (filter: TaskFilter) => void,
) {
  const { open, done, query } = tasks;
  const showOpen = filter ? filter !== "Done" : open.length > 0 || done.length > 0 || query.isError;
  const manageTasks = filter ? undefined : () => manage("Open");
  const history = !filter && done.length > 0 && (
    <div className="channel-task-history">
      ✓ {done.length} completed in #{channel} ·{" "}
      <button type="button" onClick={() => manage("Done")}>
        View history →
      </button>
    </div>
  );
  return (
    <>
      {filter && channelPills("Task states", taskStates, filter, select)}
      {showOpen && (
        <TaskList board={board} tasks={open} query={query} manage={manageTasks}>
          {history}
        </TaskList>
      )}
      {filter && filter !== "Open" && <TaskList board={board} tasks={done} done />}
    </>
  );
}

export function channelPills<T extends string>(
  label: string,
  options: readonly (readonly [T, string])[],
  value: T,
  select: (value: T) => void,
) {
  return (
    <fieldset className="tasks-pills" aria-label={label}>
      {options.map(([key, text]) => (
        <button key={key} type="button" className="tasks-pill" aria-pressed={value === key} onClick={() => select(key)}>
          {text}
        </button>
      ))}
    </fieldset>
  );
}
