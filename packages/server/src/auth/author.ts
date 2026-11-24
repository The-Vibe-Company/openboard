import type { MessageAuthor } from "@openboard/contract";
import { connectionOf, memberOf, type Principal, profileAvatar, profileName, workloadOf } from "../deps.ts";

/**
 * Who `by` is, for people to read (upstream's `author`): a connection by its name (`workflow`, D45), the local owner
 * by its handle (`person`), a signed-in person as their sign-in shows them (`person`), and a profile of any of them as
 * an `agent` shown through it, "fixer-2 via laptop".
 */
export function authorOf(by: Principal): MessageAuthor {
  const connection = by[connectionOf];
  const member = by[memberOf];
  const workload = by[workloadOf];
  const handle =
    connection?.name ??
    (workload?.kind === "github" ? workload.repository : undefined) ??
    member?.handle ??
    by.principal.replace(/^ob:user:/, "");
  if (by.profile === null) {
    if (member) return { kind: "person", handle, name: member.name, avatar: member.avatar };
    return { kind: connection || by[workloadOf] ? "workflow" : "person", handle, name: handle, avatar: null };
  }
  return {
    kind: "agent",
    handle: `${handle}/${by.profile}`,
    name: by[profileName] ?? by.profile,
    avatar: by[profileAvatar] ?? null,
    via: { name: handle, environment: null },
  };
}
