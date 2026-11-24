-- Keep the connection's original grant addressable after an edit moves its principals.
-- Rows from older versions capture their original grant before the first relevant edit.
ALTER TABLE connections ADD COLUMN origin_grant BIGINT;
