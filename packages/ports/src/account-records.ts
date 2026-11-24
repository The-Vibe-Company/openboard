import type { Can, Named } from "@openboard/contract";

/** A person (docs/auth.md "Organizations, boards, people"): one `users` row, independent of providers and orgs. */
export interface PersonRecord {
  /** `u_<base32>`; the principal is `ob:user:<id>`. */
  readonly id: string;
  /** The provider login at the last sign-in. */
  readonly handle: string;
  readonly name: string;
  /** The verified email the provider gave, if any. */
  readonly email: string | null;
  readonly avatar: string | null;
  /** The providers the person signs in with, sorted: `["github"]`. */
  readonly providers: readonly string[];
}

/** A provider's word on who signed in; only `subject` identifies them (docs/auth.md "Sign-in providers"). */
export interface IdentityRecord {
  readonly provider: string;
  readonly subject: string;
  readonly login: string;
  readonly name: string;
  /** Only a verified email; null otherwise. */
  readonly email: string | null;
  readonly avatar: string | null;
}

/** One sign-in: the identity, and the session it opens, kept by the SHA-256 (hex) of its cookie value. */
export interface SignInRecord {
  readonly identity: IdentityRecord;
  /** Whether an identity no person holds yet makes a new person (sign-up), with the ID `newPersonId`. */
  readonly admitNew: boolean;
  /** An invitation to redeem atomically if sign-in creates a person, even when unconditional admission is off. */
  readonly invitationHash?: Uint8Array;
  readonly newPersonId: string;
  readonly session: { readonly idHash: string; readonly csrf: string; readonly expiresAt: number };
  readonly now: number;
}

/** The person signed in, with the organization slug if this sign-in redeemed an invitation. */
export type SignedInPerson = PersonRecord & { readonly invitedOrg?: string };

/** A session that is not revoked, of a person who is not disabled; its times are checked by the caller. */
export interface SessionRecord {
  readonly person: PersonRecord;
  readonly csrf: string;
  readonly seenAt: number;
  readonly expiresAt: number;
}

interface DeviceTokenIssue {
  readonly id: string;
  readonly tokenHash: string;
  readonly now: number;
  readonly expiresAt: number;
}

type DevicePoll = { status: "missing" | "pending" | "too_soon" } | { status: "issued"; org: Named; boards: Named[] };

export interface DeviceView {
  /** Start a device request and prune prior expired requests using the supplied clock. */
  startDevice(
    deviceHash: string,
    userCode: string,
    clientName: string,
    now: number,
    expiresAt: number,
    can?: Can,
  ): Promise<void>;
  /** Read the display metadata of an unused, live code. */
  previewDevice(userCode: string, now: number): Promise<{ clientName: string; expiresAt: number; can?: Can } | null>;
  /** Only a current member of the named organization can approve an unused, live code. */
  approveDevice(userCode: string, org: string, personId: string, now: number): Promise<boolean>;
  /** Poll a device capability; consume approval and issue its token in one transaction. */
  pollDevice(deviceHash: string, minInterval: number, issue: DeviceTokenIssue): Promise<DevicePoll>;
}
