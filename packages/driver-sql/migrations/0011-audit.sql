-- Reading a board's audit (docs/auth.md "Audit"): its configuration events (`ob.*`, visibility 2) in log order.
-- Postgres syntax; driver-sqlite renders it. Expand-only: one new partial index, built concurrently on Postgres so
-- board writes go on (docs/architecture.md "Migrations without downtime"). It holds only configuration events, so
-- messages and reactions do not pay for it.

CREATE INDEX CONCURRENTLY events_audit ON events (board_id, id) WHERE visibility = 2;
