import { afterAll } from "bun:test";
import { shareTemplate } from "./drivers.ts";

// One migrated template for the whole run on Postgres, dropped when the run ends (bunfig.toml `[test] preload`).
afterAll(shareTemplate());
