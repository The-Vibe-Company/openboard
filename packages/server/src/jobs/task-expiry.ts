import { expireTask, parseId } from "@openboard/core";
import type { JobHandler } from "./registry.ts";

export const taskExpiryJob: JobHandler = async (writer, { id }, now) => {
  const position = typeof id === "string" ? parseId(id) : null;
  if (position === null) throw new Error("invalid task expiry job");
  const root = await writer.taskRoot(position);
  const expiry = root && expireTask(writer.head, root, now);
  if (expiry) await writer.append([expiry]);
};
