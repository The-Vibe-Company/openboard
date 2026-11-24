import { Generator, getConfig } from "@tanstack/router-generator";
import { routerOptions } from "../router.options.ts";

/**
 * Writes `src/routeTree.gen.ts` from `src/routes/`, as the Vite plugin does on `dev` and `build`. The file is not
 * committed (every new page would otherwise conflict on it), so `typecheck` runs this first.
 */
const root = `${import.meta.dir}/..`;
await new Generator({ config: getConfig(routerOptions, root), root }).run();
