import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type Task, type TaskActor, taskActorsQuery } from "../api/tasks.ts";
import { Badge } from "../ui/index.ts";
import { TaskActionBar } from "./TaskActions.tsx";
import "./TaskState.css";

type Board = { org: string; board: string };

export function claimHolderText(id: string, actor?: TaskActor) {
  if (!actor) return id;
  return actor.via ? `${actor.name} via ${actor.via.name}` : actor.name;
}

export function taskStateText(task: Pick<Task, "state" | "claim">, holder?: TaskActor) {
  if (task.state !== "claimed" || !task.claim) return task.state;
  return `claimed by ${claimHolderText(task.claim.actor, holder)}`;
}

export function TaskStateBadge({
  task,
  holder,
  recordedState,
}: {
  task: Pick<Task, "state" | "claim">;
  holder?: TaskActor;
  recordedState?: string;
}) {
  const state = task.state === "ready" && recordedState === "claimed" ? "expired" : task.state;
  return (
    <Badge className="task-state-badge" data-state={state}>
      {state === "expired" ? "expired" : taskStateText(task, holder)}
    </Badge>
  );
}

export function TaskState({
  board,
  taskId,
  channel,
  task,
  recordedState,
}: {
  board: Board;
  taskId?: string;
  channel?: string;
  task: Task;
  recordedState?: string;
}) {
  const { data: actors } = useQuery(taskActorsQuery(board, true));
  const maker = task.by.startsWith(`${task.owner}+`) ? actors?.get(task.by) : undefined;
  const owner = actors?.get(task.owner)?.name ?? maker?.via?.name ?? task.owner;
  const holder = task.claim ? actors?.get(task.claim.actor) : undefined;
  const assignee = task.for ? actors?.get(task.for) : undefined;

  return (
    <section className="task-details" aria-label="Task details">
      <h2>Task</h2>
      <TaskDetailsList
        board={board}
        task={task}
        owner={owner}
        holder={holder}
        assignee={assignee}
        recordedState={recordedState}
      />
      {taskId && <TaskActionBar board={board} taskId={taskId} channel={channel} task={task} actors={actors} />}
    </section>
  );
}

function TaskDetailsList({
  board,
  task,
  owner,
  holder,
  assignee,
  recordedState,
}: {
  board: Board;
  task: Task;
  owner: string;
  holder?: TaskActor;
  assignee?: TaskActor;
  recordedState?: string;
}) {
  return (
    <dl>
      <dt>State</dt>
      <dd>
        <TaskStateBadge task={task} holder={holder} recordedState={recordedState} />
      </dd>
      <dt>Owner</dt>
      <dd>{owner}</dd>
      {task.for && (
        <>
          <dt>Assigned</dt>
          <dd>{claimHolderText(task.for, assignee)}</dd>
        </>
      )}
      {task.claim && (
        <>
          <dt>Claim holder</dt>
          <dd>{claimHolderText(task.claim.actor, holder)}</dd>
          <dt>Until</dt>
          <dd>
            <time dateTime={task.claim.until} title={task.claim.until}>
              {new Date(task.claim.until).toLocaleString()}
            </time>
          </dd>
        </>
      )}
      {task.needs.length > 0 && (
        <>
          <dt>Needs</dt>
          <dd className="task-needs">
            {task.needs.map((need) => (
              <Link key={need} to="/$org/$board/t/$id" params={{ ...board, id: need }} search={true}>
                #{need}
              </Link>
            ))}
          </dd>
        </>
      )}
      {task.blocked && (
        <>
          <dt>Hold</dt>
          <dd>{task.blocked.kind ? `${task.blocked.kind}: ${task.blocked.reason}` : task.blocked.reason}</dd>
        </>
      )}
      {task.result && (
        <>
          <dt>Result</dt>
          <dd>{task.result}</dd>
        </>
      )}
      {task.reason && (
        <>
          <dt>Reason</dt>
          <dd>{task.reason}</dd>
        </>
      )}
    </dl>
  );
}
