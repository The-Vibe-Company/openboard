import { createApp } from "@openboard/server";

export type Mode = "local" | "hosted";

export const modes: readonly Mode[] = ["local", "hosted"];

/** Hosted mode always runs as two stateless instances (docs/codebase.md 6.6). */
const instancesPerMode: Record<Mode, number> = { local: 1, hosted: 2 };

/** Boots every instance of `mode` in this process and returns them with one `close` for all. */
export function boot(mode: Mode) {
  const apps = Array.from({ length: instancesPerMode[mode] }, () => createApp({ mode }, {}, {}));
  return {
    apps,
    async close() {
      await Promise.all(apps.map((app) => app.close()));
    },
  };
}
