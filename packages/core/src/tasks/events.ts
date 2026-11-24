import type { Message, TaskCreatedPayload } from "@openboard/contract";
import type { MessagePosted } from "../messages/post.ts";

export interface TaskCreated extends Omit<MessagePosted, "type" | "payload"> {
  readonly type: "task.created";
  readonly payload: Omit<TaskCreatedPayload, "id" | "needs"> & {
    readonly id: number;
    readonly needs: readonly number[];
    readonly view: Message;
  };
}

export type TaskEvent = TaskCreated;
