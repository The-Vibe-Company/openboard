import { BoardError, CHANNEL_PATH_MAX, isChannelPath, type NextStep } from "@openboard/contract";

export function correctedChannel(value: unknown, accepts: (path: string) => boolean): string | undefined {
  if (typeof value !== "string") return undefined;
  const corrected = value.trim().toLowerCase().replace(/^\/+/, "").replace(/\s+/g, "-");
  return accepts(corrected) ? corrected : undefined;
}

/** A channel or a subtree filter with its trailing slash. */
export function isChannelOrSubtree(value: string): boolean {
  return isChannelPath(value.replace(/\/$/, ""));
}

export function channelInputError(
  code: "invalid_request" | "invalid_grant" | "bad_watcher",
  hint: string,
  next: NextStep,
): BoardError {
  return new BoardError(
    code,
    `channel: use lowercase letters, digits, hyphens and underscores, with / between levels. Start each level with a letter or digit and keep the path within ${CHANNEL_PATH_MAX} characters.`,
    { reason: "invalid_channel", hint, next: [next] },
  );
}

export const GRANT_SYNTAX_HINT =
  "Write can as pattern=permissions: `*=all`, `dev/=read,post`; permissions are read, post, react, label, sync, manage.";

/** Carries the bad key to the HTTP edge, where the operation and the submitted grant are available. */
export class InvalidGrantPattern extends BoardError {
  readonly pattern: string;
  readonly corrected: string | undefined;

  constructor(pattern: string) {
    const corrected = correctedChannel(pattern, isChannelOrSubtree);
    super("invalid_grant", `${JSON.stringify(pattern)} is not *, a channel, or a channel/`, {
      reason: "invalid_channel",
      hint: corrected ? `Use the corrected pattern ${corrected}. ${GRANT_SYNTAX_HINT}` : GRANT_SYNTAX_HINT,
      next: [{ kind: "run", argv: ["ob", "grants", "--help"] }],
    });
    this.pattern = pattern;
    this.corrected = corrected;
  }
}
