import { BoardError } from "@openboard/contract";

/** Keys under it are the board's own: no client write sets or unsets one (upstream `03-http.md` "Tasks"). */
const RESERVED_LABEL_PREFIX = "board.";
/** Upstream's label key rule (`03-http.md` value table): up to 64 characters, never a name every object has. */
const KEY = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const OBJECT_KEYS = new Set(["constructor", "prototype"]);
const LABEL_VALUE_MAX = 256;

/** Refuses a label key a write cannot set: a malformed one, `constructor` or `prototype`, or one under `board.`. */
export function checkLabelKey(key: string) {
  if (!KEY.test(key) || OBJECT_KEYS.has(key)) {
    throw new BoardError(
      "invalid_request",
      `labels.${key}: a label key is 1 to 64 of a-z, 0-9, ".", "_" and "-", starts with a letter or digit, and is not constructor or prototype`,
    );
  }
  if (key.startsWith(RESERVED_LABEL_PREFIX)) {
    throw new BoardError("reserved_label", `labels.${key}: the board writes labels under ${RESERVED_LABEL_PREFIX}`);
  }
}

/** Refuses a label value the board cannot keep: over 256 characters, a control character, or a lone surrogate. */
export function checkLabelValue(key: string, value: string) {
  if (value.length > LABEL_VALUE_MAX) {
    throw new BoardError("invalid_request", `labels.${key}: a label value is up to ${LABEL_VALUE_MAX} characters`);
  }
  if (/\p{Cc}/u.test(value) || !value.isWellFormed()) {
    throw new BoardError("invalid_request", `labels.${key}: label value has a control character or a lone surrogate`);
  }
}

/** Refuses labels a write cannot set, by upstream's value table; each key holds one value. */
export function checkLabels(labels: Readonly<Record<string, string>>) {
  for (const [key, value] of Object.entries(labels)) {
    checkLabelKey(key);
    checkLabelValue(key, value);
  }
}
