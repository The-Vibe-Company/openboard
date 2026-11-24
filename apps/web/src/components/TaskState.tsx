import { useQuery } from "@tanstack/react-query";
import { type Task, type TaskActor, taskActorsQuery } from "../api/tasks.ts";
import { Badge } from "../ui/index.ts";
import "./TaskState.css";

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
  // Reads clear a dead lease before task.expired updates the reserved label.
  const state = task.state === "ready" && recordedState === "claimed" ? "expired" : task.state;
  return (
    <Badge className="task-state-badge" data-state={state}>
      {state === "expired" ? "expired" : taskStateText(task, holder)}
    </Badge>
  );
}

export function TaskState({
  board,
  task,
  recordedState,
}: {
  board: { org: string; board: string };
  task: Task;
  recordedState?: string;
}) {
  const { data: actors } = useQuery(taskActorsQuery(board, true));
  const maker = task.by.startsWith(`${task.owner}+`) ? actors?.get(task.by) : undefined;
  const owner = actors?.get(task.owner)?.name ?? maker?.via?.name ?? task.owner;
  const claim = task.claim;
  const holder = claim ? actors?.get(claim.actor) : undefined;
  return (
    <section className="task-details" aria-label="Task details">
      <h2>Task</h2>
      <dl>
        <dt>State</dt>
        <dd>
          <TaskStateBadge task={task} holder={holder} recordedState={recordedState} />
        </dd>
        <dt>Owner</dt>
        <dd>{owner}</dd>
        {claim && (
          <>
            <dt>Claim holder</dt>
            <dd>{claimHolderText(claim.actor, holder)}</dd>
            <dt>Until</dt>
            <dd>
              <time dateTime={claim.until} title={claim.until}>
                {new Date(claim.until).toLocaleString()}
              </time>
            </dd>
          </>
        )}
        {task.blocked && (
          <>
            <dt>Hold</dt>
            <dd>{task.blocked.kind ? `${task.blocked.kind}: ${task.blocked.reason}` : task.blocked.reason}</dd>
          </>
        )}
      </dl>
    </section>
  );
}
