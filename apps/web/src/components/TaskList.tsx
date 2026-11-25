import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { taskActorsQuery, tasksQuery } from "../api/tasks.ts";
import { TaskStateBadge } from "./TaskState.tsx";
import "./TaskList.css";

export function useChannelTasks(board: { org: string; board: string }, channel: string) {
  return useInfiniteQuery(tasksQuery(board, channel));
}

export function TaskList({
  board,
  query,
}: {
  board: { org: string; board: string };
  query: ReturnType<typeof useChannelTasks>;
}) {
  const tasks = query.data?.pages.flatMap((page) => page.tasks) ?? [];
  const { data: actors } = useQuery(
    taskActorsQuery(
      board,
      tasks.some(({ message }) => Boolean(message.task?.claim)),
    ),
  );
  if (tasks.length === 0 && !query.isError) return null;

  return (
    <section className="channel-tasks" aria-label="Tasks">
      <div className="channel-tasks-header">
        <div className="channel-tasks-title">
          <h2>Open tasks</h2>
          {tasks.length > 0 && <span className="channel-tasks-count">{tasks.length}</span>}
        </div>
        <Link className="channel-tasks-all" to="/$org/$board/tasks" params={board}>
          All tasks →
        </Link>
      </div>
      {tasks.length > 0 && (
        <ol aria-label="Open tasks">
          {tasks.map(({ message }) => {
            const task = message.task;
            if (!task) return null;
            const title = message.text.split(/\r?\n/, 1)[0]?.trim() || `Thread #${message.id}`;
            return (
              <li key={message.id}>
                <span className="channel-task-id" aria-hidden="true">
                  #{message.id}
                </span>
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
              </li>
            );
          })}
        </ol>
      )}
      {query.isError && <p role="alert">Could not load tasks.</p>}
      {query.hasNextPage && (
        <button type="button" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>
          {query.isFetchingNextPage ? "Loading tasks…" : "Load more tasks"}
        </button>
      )}
    </section>
  );
}
