import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Client } from "@the-vibe-company/openboard";
import { type FormEvent, useRef, useState } from "react";
import { boardKeys, threadsQuery } from "../api/board.ts";
import { browserClient } from "../api/client.ts";
import { sessionQuery } from "../api/session.ts";
import { type Task, type TaskActor, tasksQuery } from "../api/tasks.ts";
import { threadKeys } from "../api/thread.ts";
import { Button, CheckIcon, Input, PauseIcon, PlayIcon, RefreshIcon, Select, XIcon } from "../ui/index.ts";

type Board = { org: string; board: string };
type ActiveClaim = { epoch: number; token: string };
type ActionPrompt = "block" | "cancel" | "complete" | "fail" | "assign" | null;

function actorLabel(id: string, actor?: TaskActor) {
  if (!actor) return id;
  return actor.via ? `${actor.name} via ${actor.via.name}` : actor.name;
}

async function runPromptAction(
  client: Client,
  taskId: string,
  prompt: ActionPrompt,
  text: string,
  assignee: string,
  claim: ActiveClaim | null,
  clearClaim: () => void,
) {
  if (prompt === "block") {
    await client.blockTask({ id: taskId, reason: text.trim() || "Blocked via web UI" });
  } else if (prompt === "cancel") {
    await client.cancelTask({ id: taskId, reason: text.trim() || "Canceled via web UI" });
  } else if (prompt === "complete" && claim) {
    await client.completeTask({
      id: taskId,
      epoch: claim.epoch,
      token: claim.token,
      ...(text.trim() ? { result: text.trim() } : {}),
    });
    clearClaim();
  } else if (prompt === "fail" && claim) {
    await client.failTask({
      id: taskId,
      epoch: claim.epoch,
      token: claim.token,
      reason: text.trim() || "Failed via web UI",
    });
    clearClaim();
  } else if (prompt === "assign") {
    await client.assignTask({ id: taskId, for: assignee || null });
  }
}

function useTaskActionRunner(board: Board, channel?: string) {
  const queryClient = useQueryClient();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<void>, onDone: () => void) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      onDone();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: threadKeys.all(board) }),
        queryClient.invalidateQueries({ queryKey: boardKeys.allTasks(board) }),
        ...(channel
          ? [
              queryClient.invalidateQueries({ queryKey: tasksQuery(board, channel).queryKey, exact: true }),
              queryClient.invalidateQueries({ queryKey: threadsQuery(board, channel).queryKey }),
            ]
          : []),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update task.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return { busy, error, run };
}

type TaskActionBarProps = {
  board: Board;
  taskId: string;
  channel?: string;
  task: Task;
  actors?: ReadonlyMap<string, TaskActor>;
};

export function TaskActionBar({ board, taskId, channel, task, actors }: TaskActionBarProps) {
  const { data: session } = useQuery(sessionQuery);
  const { busy, error, run } = useTaskActionRunner(board, channel);
  const [claim, setClaim] = useState<ActiveClaim | null>(null);
  const [prompt, setPrompt] = useState<ActionPrompt>(null);
  const [text, setText] = useState("");
  const [assignee, setAssignee] = useState(task.for ?? "");

  if (!session?.signedIn || !session.csrf) return null;
  const client = browserClient(window.location.origin, { ...board, csrf: session.csrf });
  const reset = () => {
    setPrompt(null);
    setText("");
  };
  const claimNow = () =>
    void run(async () => {
      const res = await client.claimTask({ id: taskId });
      setClaim({ epoch: res.claim.epoch, token: res.claim.token });
    }, reset);
  const releaseNow = () => {
    if (!claim) return;
    void run(async () => {
      await client.releaseTask({ id: taskId, epoch: claim.epoch, token: claim.token });
      setClaim(null);
    }, reset);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => runPromptAction(client, taskId, prompt, text, assignee, claim, () => setClaim(null)), reset);
  };

  return (
    <>
      <TaskActionsRow
        task={task}
        claim={claim}
        busy={busy}
        onClaim={claimNow}
        onRelease={releaseNow}
        onUnblock={() =>
          void run(async () => {
            await client.unblockTask({ id: taskId });
          }, reset)
        }
        onReopen={() =>
          void run(async () => {
            await client.reopenTask({ id: taskId });
          }, reset)
        }
        onOpenPrompt={(next) => {
          if (next === "assign") setAssignee(task.for ?? "");
          setPrompt(next);
        }}
      />
      {prompt && (
        <TaskPromptForm
          prompt={prompt}
          text={text}
          assignee={assignee}
          actors={actors}
          busy={busy}
          onText={setText}
          onAssignee={setAssignee}
          onDismiss={() => setPrompt(null)}
          onSubmit={onSubmit}
        />
      )}
      {error && (
        <p className="task-action-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function TaskActionsRow({
  task,
  claim,
  busy,
  onClaim,
  onRelease,
  onUnblock,
  onReopen,
  onOpenPrompt,
}: {
  task: Task;
  claim: ActiveClaim | null;
  busy: boolean;
  onClaim: () => void;
  onRelease: () => void;
  onUnblock: () => void;
  onReopen: () => void;
  onOpenPrompt: (next: ActionPrompt) => void;
}) {
  const isOpen = ["ready", "waiting", "claimed", "blocked"].includes(task.state);
  const canReopen = ["failed", "canceled"].includes(task.state);
  const hasLocalLease = task.state === "claimed" && claim !== null && task.epoch === claim.epoch;

  return (
    <div className="task-actions">
      {task.state === "ready" && (
        <Button size="small" pending={busy} onClick={onClaim}>
          <PlayIcon width={14} height={14} /> Claim
        </Button>
      )}
      {hasLocalLease && (
        <>
          <Button size="small" disabled={busy} onClick={() => onOpenPrompt("complete")}>
            <CheckIcon width={14} height={14} /> Complete
          </Button>
          <Button size="small" variant="danger" disabled={busy} onClick={() => onOpenPrompt("fail")}>
            <XIcon width={14} height={14} /> Fail
          </Button>
          <Button size="small" variant="secondary" disabled={busy} onClick={onRelease}>
            Release
          </Button>
        </>
      )}
      {task.state === "blocked" && (
        <Button size="small" pending={busy} onClick={onUnblock}>
          Unblock
        </Button>
      )}
      {isOpen && task.state !== "blocked" && (
        <Button size="small" variant="secondary" disabled={busy} onClick={() => onOpenPrompt("block")}>
          <PauseIcon width={14} height={14} /> Hold
        </Button>
      )}
      {isOpen && (
        <>
          <Button size="small" variant="secondary" disabled={busy} onClick={() => onOpenPrompt("assign")}>
            Assign
          </Button>
          <Button size="small" variant="secondary" disabled={busy} onClick={() => onOpenPrompt("cancel")}>
            Cancel task
          </Button>
        </>
      )}
      {canReopen && (
        <Button size="small" variant="secondary" pending={busy} onClick={onReopen}>
          <RefreshIcon width={14} height={14} /> Reopen
        </Button>
      )}
    </div>
  );
}

function TaskPromptForm({
  prompt,
  text,
  assignee,
  actors,
  busy,
  onText,
  onAssignee,
  onDismiss,
  onSubmit,
}: {
  prompt: Exclude<ActionPrompt, null>;
  text: string;
  assignee: string;
  actors?: ReadonlyMap<string, TaskActor>;
  busy: boolean;
  onText: (value: string) => void;
  onAssignee: (value: string) => void;
  onDismiss: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const placeholders: Record<Exclude<ActionPrompt, null | "assign">, string> = {
    complete: "Optional completion result summary…",
    block: "Why is this task held?",
    fail: "Failure reason…",
    cancel: "Optional cancellation reason…",
  };
  return (
    <form className="task-action-form" onSubmit={onSubmit}>
      {prompt === "assign" ? (
        <Select
          aria-label="Assign task to"
          value={assignee}
          disabled={busy}
          onChange={(event) => onAssignee(event.currentTarget.value)}
        >
          <option value="">Unassigned</option>
          {[...(actors?.values() ?? [])].map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actorLabel(actor.id, actor)}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          aria-label={prompt === "complete" ? "Completion result" : "Reason"}
          placeholder={placeholders[prompt]}
          value={text}
          disabled={busy}
          onChange={(event) => onText(event.currentTarget.value)}
        />
      )}
      <Button type="submit" size="small" pending={busy}>
        Confirm
      </Button>
      <Button type="button" size="small" variant="secondary" disabled={busy} onClick={onDismiss}>
        Dismiss
      </Button>
    </form>
  );
}
