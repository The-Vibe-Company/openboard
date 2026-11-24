import { type Static, Type } from "@sinclair/typebox";

/** A signed-in person as they see themselves (docs/auth.md "Organizations, boards, people"). */
export const Person = Type.Object({
  /** `ob:user:u_<base32>`, independent of the provider and of organizations. */
  principal: Type.String(),
  /** The provider login at the last sign-in. */
  handle: Type.String(),
  name: Type.String(),
  /** The verified email the provider gave, if any. */
  email: Type.Union([Type.String(), Type.Null()]),
  avatar: Type.Union([Type.String(), Type.Null()]),
  /** The providers this person signs in with: `["github"]`. */
  providers: Type.Array(Type.String()),
});
export type Person = Static<typeof Person>;

/** A way to sign in this server offers: open `start` in the browser. */
export const SignInProvider = Type.Object({
  id: Type.String(),
  start: Type.String(),
});
export type SignInProvider = Static<typeof SignInProvider>;

/**
 * The browser's session (docs/protocol.md "Route inventory: accounts and organizations"): who is signed in, the CSRF
 * value cookie-authenticated writes send as `x-ob-csrf`, and the providers to sign in with.
 */
export const SessionState = Type.Object({
  signedIn: Type.Boolean(),
  person: Type.Union([Person, Type.Null()]),
  csrf: Type.Union([Type.String(), Type.Null()]),
  providers: Type.Array(SignInProvider),
});
export type SessionState = Static<typeof SessionState>;

/** The public lookup ID for a personal token. */
export const PersonalTokenId = Type.String({ pattern: "^pt_[a-z2-7]{16}$" });

/** Personal token metadata visible only to its holder. */
export const PersonalToken = Type.Object({
  id: PersonalTokenId,
  name: Type.String(),
  org: Type.String(),
  createdAt: Type.Integer(),
  expiresAt: Type.Integer(),
  revokedAt: Type.Union([Type.Integer(), Type.Null()]),
});
export type PersonalToken = Static<typeof PersonalToken>;
