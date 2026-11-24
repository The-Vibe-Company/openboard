export function postgresTestUrl(): string | undefined {
  if (process.env.OPENBOARD_TEST_DRIVER !== "postgres") return undefined;
  const url = process.env.OPENBOARD_TEST_DATABASE_URL;
  if (!url) throw new Error("OPENBOARD_TEST_DATABASE_URL is required for Postgres tests");
  return url;
}
