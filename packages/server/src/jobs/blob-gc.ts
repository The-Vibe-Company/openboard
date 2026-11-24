import type { ExternalBoardJobHandler } from "./registry.ts";

export const blobGcJob: ExternalBoardJobHandler = {
  runBoard: (board, job, lease) => board.collectAttachment(job.id, lease),
};
