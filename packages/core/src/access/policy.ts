import { BoardError, type Can } from "@openboard/contract";
import { allowedAt } from "./agents.ts";
import { profileAllowed } from "./connections.ts";
import { parseCanHeader } from "./narrow.ts";

function parseProxyScope(header: string): Can {
  // A scope written to an HTTP header must be printable ASCII.
  const invalid = "can must be a valid x-board-can scope";
  if (/[^ -~]/.test(header)) throw new BoardError("invalid_request", invalid);
  try {
    return parseCanHeader(header);
  } catch (error) {
    if (error instanceof BoardError && error.code === "invalid_scope") {
      throw new BoardError("invalid_request", invalid);
    }
    throw error;
  }
}

export function validateProxyPins(
  connection: { readonly direct: boolean; readonly profiles: readonly string[] },
  grant: Can,
  profile: string,
  header: string,
): void {
  if (!connection.direct) {
    throw new BoardError("invalid_request", "a proxy injects a direct connection's secret; claim a token instead");
  }
  if (!profileAllowed(connection.profiles, profile)) {
    throw new BoardError("invalid_request", "the profile is outside the connection's allowed profiles");
  }
  const requested = parseProxyScope(header);
  // Either side can introduce a more specific rule, including a hole in a granted subtree.
  for (const pattern of new Set([...Object.keys(grant), ...Object.keys(requested)])) {
    const allowed = allowedAt(grant, pattern);
    if (allowedAt(requested, pattern).some((permission) => !allowed.includes(permission))) {
      throw new BoardError("invalid_request", "can exceeds the connection's grant");
    }
  }
}
