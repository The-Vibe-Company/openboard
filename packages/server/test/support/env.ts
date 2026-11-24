/**
 * The Postgres database the tests use when `OPENBOARD_TEST_DRIVER=postgres`, or undefined on SQLite alone. The
 * test-only twin of a config module: the env exemption for `packages/*\/test/support/env.ts` (ticket 162) does not
 * reach the server's purity rules, hence the suppressions below.
 */
export function postgresTestUrl(): string | undefined {
  // oxlint-disable-next-line no-restricted-properties -- test support env reader, docs/codebase.md 6.1
  const { OPENBOARD_TEST_DRIVER: driver, OPENBOARD_TEST_DATABASE_URL: url } = process.env;
  if (driver !== "postgres") return undefined;
  if (!url) throw new Error("OPENBOARD_TEST_DATABASE_URL is required for Postgres tests");
  return url;
}
