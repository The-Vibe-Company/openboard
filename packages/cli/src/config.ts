/** What `ob`'s client commands read from the environment: upstream's `BOARD_URL` and `BOARD_TOKEN`. */
export interface ClientConfig {
  readonly boardUrl: string | undefined;
  readonly token: string | undefined;
}

/** The only place the CLI reads its environment (docs/codebase.md 5.5); `env` is handed in by the caller. */
export function clientConfig(env: Readonly<Record<string, string | undefined>>): ClientConfig {
  return { boardUrl: env.BOARD_URL || undefined, token: env.BOARD_TOKEN || undefined };
}
