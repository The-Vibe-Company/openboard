import { expect, test } from "bun:test";
import { postgresText } from "../src/db.ts";
import { render } from "../src/sql.ts";
import { threadStatements } from "../src/views/threads.ts";

test.each([
  [threadStatements.listThreads, threadStatements.listFilteredThreads],
  [threadStatements.listThreadsAfter, threadStatements.listFilteredThreadsAfter],
  [threadStatements.listSubtreeThreads, threadStatements.listFilteredSubtreeThreads],
  [threadStatements.listSubtreeThreadsAfter, threadStatements.listFilteredSubtreeThreadsAfter],
])("thread list uses independent scoped probes only with search filters", (plain, search) => {
  const unfiltered = render(plain, postgresText);
  const filtered = render(search, postgresText).text.replace(/\s+/g, " ");
  const sqlite = render(search, { ...postgresText, name: "sqlite", placeholder: () => "?" });
  expect(sqlite.text).toContain(
    "FROM messages AS hit INDEXED BY messages_re WHERE hit.board_id = ? AND hit.re = root.id",
  );
  expect(unfiltered.text).not.toContain("EXISTS");
  expect(unfiltered.text).not.toContain(" AS hit");
  expect(unfiltered.names).not.toContain("text");
  expect(filtered).toMatch(
    /FROM messages AS hit WHERE hit\.board_id = \$\d+ AND hit\.id = root\.id AND .* UNION ALL SELECT 1 FROM messages AS hit WHERE hit\.board_id = \$\d+ AND hit\.re = root\.id AND /,
  );
});
