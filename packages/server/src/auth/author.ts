import type { MessageAuthor } from "@openboard/contract";
import { connectionOf, type Principal, profileName } from "../deps.ts";

/**
 * Who `by` is, for people to read (upstream's `author`): a connection by its name (`workflow`, D45), the local owner
 * by its handle (`person`), and a profile of either as an `agent` shown through it, "fixer-2 via laptop".
 */
export function authorOf(by: Principal): MessageAuthor {
  const connection = by[connectionOf];
  const handle = connection ? connection.name : by.principal.replace(/^ob:user:/, "");
  if (by.profile === null) {
    return { kind: connection ? "workflow" : "person", handle, name: handle, avatar: null };
  }
  return {
    kind: "agent",
    handle: `${handle}/${by.profile}`,
    name: by[profileName] ?? by.profile,
    avatar: null,
    via: { name: handle, environment: null },
  };
}
