import type { openStore } from "./support/drivers.ts";

export type TestStore = ReturnType<typeof openStore>;
