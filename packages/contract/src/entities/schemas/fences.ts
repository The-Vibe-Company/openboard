interface BlockFence {
  id: string;
  source: string;
  start: number;
  end: number;
  closed: boolean;
}

function opening(line: string) {
  const match = /^ {0,3}(~{3,}|\x60{3,})(.*)$/.exec(line);
  if (!match || (match[1]!.startsWith("\x60") && match[2]!.includes("\x60"))) return null;
  return { marker: match[1]!, info: match[2]!.trim() };
}

type Fence = NonNullable<ReturnType<typeof opening>>;
function closes(line: string, fence: Fence) {
  const marker = /^ {0,3}(~{3,}|\x60{3,})[ \t]*$/.exec(line)?.[1];
  return marker !== undefined && marker[0] === fence.marker[0] && marker.length >= fence.marker.length;
}

const QUOTE = /^ {0,3}>[ \t]?/;
const ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?: {1,4}|\t|$)/;
const INTERRUPT = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|([-*_])(?:[ \t]*\1){2,}[ \t]*$|<)/;

function plain(line: string) {
  return line.trim() !== "" && !opening(line) && !QUOTE.test(line) && !ITEM.test(line) && !INTERRUPT.test(line);
}

function containerLines() {
  let kind: "quote" | "item" | null = null;
  let indent = 0;
  let fence: Fence | null = null;
  let paragraph = false;

  return (line: string) => {
    const quote = QUOTE.exec(line);
    let inner: string;
    if (quote) {
      if (kind !== "quote") fence = null;
      kind = "quote";
      inner = line.slice(quote[0].length);
    } else if (kind === "item" && (!line.trim() || line.length - line.trimStart().length >= indent)) {
      inner = line.slice(indent);
    } else if (kind && paragraph && !fence && plain(line)) {
      inner = line;
    } else {
      const item = ITEM.exec(line);
      fence = null;
      kind = item ? "item" : null;
      if (!item) return false;
      indent = item[0].length + Number(item[0].length === line.length);
      inner = line.slice(indent);
    }
    fence = fence ? (closes(inner, fence) ? null : fence) : opening(inner);
    paragraph = !fence && plain(inner);
    return true;
  };
}

/** Find top-level structured fences and keep the original UTF-16 source offsets. */
export function findBlockFences(text: string): BlockFence[] {
  if (!text.includes("json#")) return [];
  const blocks: BlockFence[] = [];
  const inContainer = containerLines();
  let active: (Fence & { start: number; content: number }) | null = null;
  const emit = (fence: NonNullable<typeof active>, end: number, sourceEnd: number, closed: boolean) => {
    const id = /^json#(\S*)/.exec(fence.info)?.[1];
    if (id !== undefined)
      blocks.push({ id, source: text.slice(fence.content, sourceEnd), start: fence.start, end, closed });
  };

  for (let start = 0; start <= text.length; ) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline;
    const line = text.slice(start, end).replace(/\r$/, "");
    if (active) {
      if (closes(line, active)) {
        emit(active, start + line.length, start - 1, true);
        active = null;
      }
    } else if (!inContainer(line)) {
      const fence = opening(line);
      if (fence) active = { ...fence, start, content: Math.min(end + 1, text.length) };
    }
    if (newline === -1) break;
    start = newline + 1;
  }
  if (active) emit(active, text.length, text.length, false);
  return blocks;
}
