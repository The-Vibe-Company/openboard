type Board = { org: string; board: string };

export const boardKeys = {
  channels: ({ org, board }: Board) => ["board", org, board, "channels"] as const,
  threads: ({ org, board }: Board) => ["board", org, board, "threads"] as const,
  allTasks: ({ org, board }: Board) => ["board", org, board, "all-tasks"] as const,
  schedules: ({ org, board }: Board) => ["board", org, board, "schedules"] as const,
  activity: ({ org, board }: Board) => ["board", org, board, "activity"] as const,
  actors: ({ org, board }: Board) => ["board", org, board, "actors"] as const,
};
