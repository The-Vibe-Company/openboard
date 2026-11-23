CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards (id)
);
