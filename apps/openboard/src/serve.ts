import process from "node:process";
import type { Config } from "./config.ts";
import { compose } from "./compose.ts";

const HOST = "127.0.0.1";

/** `ob serve`: the local board on loopback; prints its `BOARD_URL` and runs until interrupted. */
export async function serve(config: Config): Promise<void> {
  const app = compose(config);
  const server = Bun.serve({ hostname: HOST, port: config.port, fetch: app.fetch });
  process.stdout.write(`BOARD_URL=http://${HOST}:${server.port}/api/local/main\n`);
  const stop = async () => {
    await server.stop();
    await app.close();
    process.exit(130);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
