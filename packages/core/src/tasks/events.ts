import type {
  Message,
  TaskClaimedPayload,
  TaskCompletedPayload,
  TaskCreatedPayload,
  TaskExpiredPayload,
  TaskReleasedPayload,
  TaskRenewedPayload,
} from "@openboard/contract";
import type { MessagePosted } from "../messages/post.ts";

export interface TaskCreated extends Omit<MessagePosted, "type" | "payload"> {
  readonly type: "task.created";
  readonly payload: Omit<TaskCreatedPayload, "id" | "needs"> & {
    readonly id: number;
    readonly needs: readonly number[];
    readonly view: Message;
    /** On a keyed task start, whether the author created it without channel read access. Absent on adoption. */
    readonly blind?: boolean;
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
  };
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

export type TaskEvent = TaskExpired | TaskCreated | TaskClaimed | TaskCompleted | TaskRenewed | TaskReleased;
