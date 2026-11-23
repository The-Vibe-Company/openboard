import { createOpenApi } from "@openboard/server";

const path = "packages/server/openapi.json";
const target = new URL(`../../${path}`, import.meta.url);
const formatted = Bun.spawnSync(
  [process.execPath, "x", "--no-install", "biome", "format", `--stdin-file-path=${path}`],
  {
    stdin: Buffer.from(JSON.stringify(createOpenApi())),
    stderr: "inherit",
  },
);
if (!formatted.success) throw new Error(`Could not format ${path}`);
await Bun.write(target, formatted.stdout);
console.log(`Wrote ${path}`);
