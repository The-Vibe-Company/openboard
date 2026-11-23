import { BoardError, type getMe } from "@openboard/contract";
import { credentialKind } from "../deps.ts";
import type { Handler } from "./index.ts";

export const getMeHandler: Handler<typeof getMe> = async ({ by }) => {
  const credential = by[credentialKind];
  if (!credential) throw new BoardError("unauthorized", "a local owner credential is required");
  const { actor, principal, profile } = by;
  const handle = actor.replace(/^ob:user:/, "");
  return {
    actor,
    principal,
    kind: "person",
    handle,
    name: handle,
    avatar: null,
    profile,
    expiresAt: null,
    can: { "*": ["read", "post", "react", "label", "sync", "manage"] },
    openboard: {
      org: { slug: "local", name: "Local" },
      board: { slug: "main", name: "main" },
      role: "owner",
      credential,
    },
  };
};
