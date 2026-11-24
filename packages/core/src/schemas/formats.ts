// The registry supports this subset of the upstream full-mode formats.
function date(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day > 0 && day <= (lengths[month - 1] ?? 0);
}

function time(value: string) {
  const match = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:z|[+-]\d{2}(?::?\d{2})?)?$/i.exec(value);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  return (hour <= 23 && minute <= 59 && second <= 59) || (hour === 23 && minute === 59 && second === 60);
}

function ipv4(value: string, allowPadding: boolean) {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every(
      (part) => /^\d{1,3}$/.test(part) && Number(part) <= 255 && (allowPadding || part.length === 1 || part[0] !== "0"),
    )
  );
}

function ipv6(value: string, allowPaddedIpv4 = false) {
  const sides = value.split("::");
  if (sides.length > 2) return false;
  const groups = sides.flatMap((side) => (side === "" ? [] : side.split(":")));
  const tail = groups.at(-1);
  const embedded = tail !== undefined && tail.includes(".");
  if (embedded && (!value.endsWith(tail) || !ipv4(tail, allowPaddedIpv4))) return false;
  if (embedded) groups.pop();
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return false;
  const count = groups.length + (embedded ? 2 : 0);
  return sides.length === 2 ? count < 8 : count === 8;
}

function authority(value: string) {
  const match = /^(?:[a-z0-9._~!$&'()*+,;=:%-]*@)?(?:\[([^\]]+)\]|([a-z0-9._~!$&'()*+,;=%-]*))(?::\d*)?$/i.exec(value);
  if (!match) return false;
  const literal = match[1];
  return literal === undefined || ipv6(literal, true) || /^v[0-9a-f]+\.[a-z0-9._~!$&'()*+,;=:-]+$/i.test(literal);
}

function uri(value: string) {
  const match = /^[a-z][a-z0-9+.-]*:([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i.exec(value);
  if (!match || /%(?![0-9a-f]{2})/i.test(value)) return false;
  const [, location = "", query = "", fragment = ""] = match;
  if (![query, fragment].every((part) => /^[a-z0-9._~!$&'()*+,;=:@%/?-]*$/i.test(part))) return false;
  const path = /^[a-z0-9._~!$&'()*+,;=:@%/-]*$/i;
  const host = /^\/\/?([^/]*)(.*)$/.exec(location);
  if (host && authority(host[1]!) && path.test(host[2]!)) return true;
  // The format also accepts one slash with an empty authority and then an ordinary path.
  return location.length > 0 && path.test(location);
}

export function matchesFormat(format: string, value: string): boolean {
  switch (format) {
    case "date":
      return date(value);
    case "time":
      return time(value);
    case "date-time": {
      const parts = value.split(/[t\s]/i);
      return parts.length === 2 && date(parts[0]!) && time(parts[1]!);
    }
    case "email":
      return /^[a-z0-9!#$%&'*+/=?^_\x60{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_\x60{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(
        value,
      );
    case "uri":
      return uri(value);
    case "uuid":
      return /^(?:urn:uuid:)?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
    case "hostname": {
      const name = value.replace(/\.$/, "");
      return (
        name.length <= 253 && name.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
      );
    }
    case "ipv4":
      return ipv4(value, true);
    case "ipv6":
      return ipv6(value);
    default:
      return true;
  }
}
