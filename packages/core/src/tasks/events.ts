import type { Message, TaskCreatedPayload } from "@openboard/contract";
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

export type TaskEvent = TaskCreated;
