---
id: 948
title: Fix task counts and pagination
package: web
modes: [local, hosted]
status: done
---

## Done when

- The OpenBoard task counts operation reports exact counts for a board, channel or subtree under the same read grants as the task list.
- The Queue uses server-side state filtering and cursor pagination and refreshes counts on live task changes.
- The Board loads all active tasks independently of terminal history.
- Driver, HTTP and browser regressions cover tenant scoping, effective states and a board with more than 100 completed tasks.
