import { serve } from "bun";

// The server may use Bun, just not its SQL client (Bun.SQL); this comment names it harmlessly.
export const listen = (port: number) => serve({ port, fetch: () => new Response("ok") });
export const version = Bun.version;
