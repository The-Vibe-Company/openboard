export function postgresTestUrl(): string | undefined {
  if (process.env.OPENBOARD_TEST_DRIVER !== "postgres") return undefined;
  const url = process.env.OPENBOARD_TEST_DATABASE_URL;
  if (!url) throw new Error("OPENBOARD_TEST_DATABASE_URL is required for Postgres tests");
  return url;
}

/**
 * The Postgres the RLS bench (`bench/rls.ts`) creates its scratch database on. Unlike the tests it needs no
 * `OPENBOARD_TEST_DRIVER`: running the bench is the request.
 */
export function postgresBenchUrl(): string {
  const url = process.env.OPENBOARD_TEST_DATABASE_URL;
  if (!url) throw new Error("OPENBOARD_TEST_DATABASE_URL is required: a Postgres the bench may create databases on");
  return url;
}
