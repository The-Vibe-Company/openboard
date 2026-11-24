import type {
  Message,
  TaskBlockedPayload,
  TaskCanceledPayload,
  TaskClaimedPayload,
  TaskCompletedPayload,
  TaskCreatedPayload,
  TaskExpiredPayload,
  TaskFailedPayload,
  TaskNeedsChangedPayload,
  TaskReleasedPayload,
  TaskRenewedPayload,
  TaskReopenedPayload,
  TaskUnblockedPayload,
} from "@openboard/contract";
import type { MessagePosted } from "../messages/post.ts";

export interface TaskCreated extends Omit<MessagePosted, "type" | "payload"> {
  readonly type: "task.created";
  readonly payload: Omit<TaskCreatedPayload, "id" | "needs"> & {
    readonly id: number;
    readonly needs: readonly number[];
    readonly waitingOn?: number;
    readonly view: Message;
    /** On a keyed task start, whether the author created it without channel read access. Absent on adoption. */
    readonly blind?: boolean;
    /** The final creation records the caller's key and ordered roots for replay. */
    readonly batch?: { readonly id: string; readonly digest: string; readonly tasks: readonly string[] };
  };
}

export interface TaskClaimed extends Omit<MessagePosted, "type" | "payload"> {
  readonly type: "task.claimed";
  readonly payload: Omit<TaskClaimedPayload, "id"> & {
    readonly id: number;
    readonly untilMs: number;
    readonly tokenHash: string;
    readonly view: Message;
  };
}

export interface TaskCompleted extends Omit<MessagePosted, "type" | "payload"> {
  readonly type: "task.completed";
  readonly payload: Omit<TaskCompletedPayload, "id"> & {
    readonly id: number;
    readonly view: Message;
    readonly hasDependants?: boolean;
  };
}

export interface TaskReady extends Omit<MessagePosted, "type" | "payload"> {
  readonly type: "task.ready";
  readonly payload: { readonly id: number; readonly view: Message };
}

export interface TaskRenewed extends Omit<MessagePosted, "type" | "payload"> {
  readonly type: "task.renewed";
  readonly payload: Omit<TaskRenewedPayload, "id"> & {
    readonly id: number;
    readonly untilMs: number;
    readonly view: Message;
  };
}

export interface TaskExpired extends Omit<MessagePosted, "type" | "payload"> {
  readonly type: "task.expired";
  readonly payload: Omit<TaskExpiredPayload, "id"> & {
    readonly id: number;
    readonly view: Message & { task: NonNullable<Message["task"]> };
  };
}

export interface TaskFailed extends Omit<MessagePosted, "type" | "payload"> {
  readonly type: "task.failed";
  readonly payload: Omit<TaskFailedPayload, "id"> & {
    readonly id: number;
    readonly view: Message;
  };
}

export interface TaskReleased extends Omit<MessagePosted, "type" | "payload"> {
  readonly type: "task.released";
  readonly payload: Omit<TaskReleasedPayload, "id"> & {
    readonly id: number;
    readonly view: Message;
  };
}

export interface TaskCanceled extends Omit<MessagePosted, "type" | "payload"> {
  readonly type: "task.canceled";
  readonly payload: Omit<TaskCanceledPayload, "id"> & {
    readonly id: number;
    readonly view: Message;
  };
}

export interface TaskReopened extends Omit<MessagePosted, "type" | "payload"> {
  readonly type: "task.reopened";
  readonly payload: Omit<TaskReopenedPayload, "id"> & {
    readonly id: number;
    readonly view: Message;
  };
}

export interface TaskNeedsChanged extends Omit<MessagePosted, "type" | "payload"> {
  readonly type: "task.needs_changed";
  readonly payload: Omit<TaskNeedsChangedPayload, "id" | "needs"> & {
    readonly id: number;
    readonly needs: readonly number[];
    readonly waitingOn: number;
    readonly view: Message & { task: NonNullable<Message["task"]> };
  };
}

export interface TaskBlocked extends Omit<MessagePosted, "type" | "payload"> {
  readonly type: "task.blocked";
  readonly payload: Omit<TaskBlockedPayload, "id"> & {
    readonly id: number;
    readonly view: Message & { task: NonNullable<Message["task"]> };
  };
}

export interface TaskUnblocked extends Omit<MessagePosted, "type" | "payload"> {
  readonly type: "task.unblocked";
  readonly payload: Omit<TaskUnblockedPayload, "id"> & {
    readonly id: number;
    readonly view: Message & { task: NonNullable<Message["task"]> };
  };
}

export type TaskEvent =
  | TaskUnblocked
  | TaskBlocked
  | TaskReopened
  | TaskNeedsChanged
  | TaskCanceled
  | TaskExpired
  | TaskCreated
  | TaskClaimed
  | TaskCompleted
  | TaskReady
  | TaskFailed
  | TaskRenewed
  | TaskReleased;
