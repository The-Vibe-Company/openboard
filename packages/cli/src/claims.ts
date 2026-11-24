import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { kill, pid } from "node:process";
import { setTimeout } from "node:timers/promises";
import { BoardError } from "@the-vibe-company/openboard";

type Claim = { readonly epoch: number; readonly until: string; readonly token: string };
type ClaimKey = { readonly boardUrl: string; readonly actor: string; readonly id: string };
type SavedClaims = Record<string, Claim>;
type ClaimChange = { readonly key: ClaimKey; readonly claim: Claim | null };

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;
const keyOf = ({ boardUrl, actor, id }: ClaimKey) => JSON.stringify([boardUrl.replace(/\/+$/, ""), actor, id]);

function readClaims(path: string): SavedClaims {
  const existing = lstatSync(path, { throwIfNoEntry: false });
  if (!existing) return {};
  if (!existing.isFile() || (existing.mode & 0o077) !== 0) throw new Error("claim file is not private");
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid claim file");
  return value as SavedClaims;
}

function ownerExited(owner: string): boolean {
  const match = /^owner-([1-9]\d*)-\.claim-lock-[A-Za-z0-9]+$/.exec(owner);
  if (!match) return false;
  const ownerPid = Number(match[1]);
  if (!Number.isSafeInteger(ownerPid) || ownerPid > 2_147_483_647) return false;
  try {
    kill(ownerPid, 0);
    return false;
  } catch (error) {
    return errorCode(error) === "ESRCH";
  }
}

/** A replacement owner installs a nonempty directory, so removing the old marker cannot remove the new lock. */
function removeOwner(lock: string, owner: string) {
  rmSync(join(lock, owner), { force: true });
  try {
    rmdirSync(lock);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(errorCode(error) ?? "")) throw error;
  }
}

async function lockClaims(lock: string): Promise<() => void> {
  const pending = mkdtempSync(join(dirname(lock), ".claim-lock-"));
  const owner = `owner-${pid}-${basename(pending)}`;
  try {
    writeFileSync(join(pending, owner), "", { mode: 0o600, flag: "wx" });
    for (let attempt = 0; attempt <= 100; attempt++) {
      try {
        renameSync(pending, lock);
        return () => removeOwner(lock, owner);
      } catch (error) {
        if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(errorCode(error) ?? "")) throw error;
      }
      try {
        for (const marker of readdirSync(lock)) {
          if (ownerExited(marker)) removeOwner(lock, marker);
        }
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
      await setTimeout(10);
    }
    throw new Error("claim credential storage is busy");
  } finally {
    rmSync(pending, { recursive: true, force: true });
  }
}

/** Validate and lock the destination before the remote write, then atomically save any returned credential. */
export async function withClaimStorage<T>(
  home: string | undefined,
  obtain: (read: (key: ClaimKey) => Claim | undefined) => Promise<{ result: T; entry?: ClaimChange }>,
  unlockDuringWrite = false,
): Promise<T> {
  if (!home) throw new BoardError("invalid_request", "HOME is required to store a task claim");
  const path = join(home, ".config", "openboard", "claims.json");
  let release: (() => void) | undefined;
  let temp: string | undefined;
  try {
    let claims: SavedClaims;
    let file: string;
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      release = await lockClaims(`${path}.lock`);
      claims = readClaims(path);
      temp = mkdtempSync(join(dirname(path), ".claims-"));
      file = join(temp, "claims.json");
      writeFileSync(file, "", { mode: 0o600, flag: "wx" });
    } catch {
      throw new BoardError("invalid_request", "could not prepare task claim storage");
    }

    if (unlockDuringWrite) {
      release?.();
      release = undefined;
    }

    const { result, entry } = await obtain((key) => claims[keyOf(key)]);
    if (!entry) return result;
    try {
      if (unlockDuringWrite) {
        release = await lockClaims(`${path}.lock`);
        claims = readClaims(path);
      }
      const key = keyOf(entry.key);
      if (entry.claim === null) delete claims[key];
      else if ((claims[key]?.epoch ?? 0) <= entry.claim.epoch) claims[key] = entry.claim;
      else return result;
      writeFileSync(file, JSON.stringify(claims));
      renameSync(file, path);
    } catch {
      throw new BoardError(
        "invalid_request",
        entry.claim === null
          ? "could not remove the saved task claim credential"
          : "the task was claimed but its credential could not be stored",
      );
    }
    return result;
  } finally {
    try {
      if (temp) rmSync(temp, { recursive: true, force: true });
    } finally {
      release?.();
    }
  }
}
