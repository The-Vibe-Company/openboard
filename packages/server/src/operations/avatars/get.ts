import { BoardError, type getAvatar } from "@openboard/contract";
import type { Handler } from "../index.ts";

const avatars: Readonly<Partial<Record<string, string>>> = {
  agent:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#344155"/><path d="m16 6 10 10-10 10L6 16z" fill="#fff"/></svg>',
  bot: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#344155"/><path d="M16 7v5" stroke="#fff" stroke-width="2"/><rect x="7" y="12" width="18" height="13" rx="4" fill="#fff"/><circle cx="12" cy="18" r="2" fill="#344155"/><circle cx="20" cy="18" r="2" fill="#344155"/></svg>',
  ci: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#344155"/><path d="m8 16 5 5 11-11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  person:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#344155"/><circle cx="16" cy="11" r="4" fill="#fff"/><path d="M8 25a8 8 0 0 1 16 0z" fill="#fff"/></svg>',
};

export const getAvatarHandler: Handler<typeof getAvatar> = async (_ctx, { name }) => {
  const avatar = Object.hasOwn(avatars, name) ? avatars[name] : undefined;
  if (avatar === undefined) throw new BoardError("not_found", "no such avatar");
  return avatar;
};
