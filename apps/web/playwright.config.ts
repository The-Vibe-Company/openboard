import { defineConfig } from "@playwright/test";

export function hostedDatabaseUrl() {
  return process.env.OPENBOARD_TEST_DATABASE_URL;
}

export default defineConfig({
  testDir: "./e2e",
  workers: 2,
  projects: [
    { name: "local", use: { browserName: "chromium" } },
    ...(hostedDatabaseUrl() ? [{ name: "hosted", use: { browserName: "chromium" as const } }] : []),
  ],
});
