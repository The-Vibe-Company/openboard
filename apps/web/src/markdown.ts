import { createElement, type ReactNode } from "react";
import type { ThreadMessage } from "./api/thread.ts";

type Mention = NonNullable<ThreadMessage["mentions"]>[number];

const actorId = String.raw`[^\[\]\s]+`;
const actorReference = String.raw`@\[${actorId}\]`;
const ordinaryAt = String.raw`@(?!\[${actorId}\])`;

// Keep stored references together inside labels and emphasis, where they can contain delimiters.
const inlineTokens = new RegExp(
  [
    String.raw`<[^<>\n]*>`,
    "`(?<code>[^`\\n]+)`",
    String.raw`@\[(?<actor>${actorId})\]`,
    String.raw`(?<image>!?)\[(?<label>(?:${actorReference}|${ordinaryAt}|[^@\[\]\n])+)\]\((?<url>(?:[^()\s]|\([^()\s]*\))+)\)`,
    String.raw`\*\*(?<bold>[^*\n]+)\*\*`,
    String.raw`(?<![\p{L}\p{N}_])_(?<italic>(?:${actorReference}|${ordinaryAt}|[^@_\n])+)_(?![\p{L}\p{N}_])`,
  ].join("|"),
  "gu",
);

const previewLiterals = /<[^<>]*>|(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)|\uFFFC/g;
const previewEmphasis = /\*\*((?:\*(?!\*)|[^*])+?)\*\*|(?<![\p{L}\p{N}_])_([^_]+)_(?![\p{L}\p{N}_])/gu;

export function markdownPreview(text: string): string {
  const [firstLine = ""] = text.split(/\r\n?|\n/, 1);
  const line = firstLine.replace(/^(?:[ \t]*(?:#{1,6}(?:[ \t]+|$)|>[ \t]*|(?:[-*+]|\d{1,9}\.)[ \t]+))+/, "");
  // Emphasis can surround code without interpreting the contents of the code span.
  const literals: string[] = [];
  const masked = line.replace(previewLiterals, (token, _fence: string | undefined, code: string | undefined) => {
    literals.push(code ?? token);
    return "\uFFFC";
  });
  let index = 0;
  return stripPreviewEmphasis(masked)
    .replace(/\uFFFC/g, () => literals[index++] ?? "")
    .trim();
}

function stripPreviewEmphasis(line: string): string {
  return line.replace(previewEmphasis, (token, bold: string | undefined, italic: string | undefined) => {
    const content = bold ?? italic;
    return content === undefined ? token : stripPreviewEmphasis(content);
  });
}

function resolveMention(token: string, id: string, handles: ReadonlyMap<string, string>): string {
  const handle = handles.get(id);
  return handle === undefined ? token : `@${handle}`;
}

function httpsUrl(destination: string): string | undefined {
  if (!/^https:\/\//i.test(destination)) return;
  const url = URL.parse(destination);
  if (url?.protocol === "https:") return url.href;
}

function inline(text: string, handles: ReadonlyMap<string, string>): ReactNode[] {
  const nodes: ReactNode[] = [];
  let plain = "";
  let offset = 0;
  for (const { 0: token, index, groups } of text.matchAll(inlineTokens)) {
    plain += text.slice(offset, index);
    offset = index + token.length;
    const { code, actor, image, label, url, bold, italic } = groups ?? {};
    const href = url && image === "" ? httpsUrl(url) : undefined;
    const key = index;
    let element: ReactNode;
    if (code !== undefined) element = createElement("code", { key }, code);
    else if (href && label !== undefined) {
      const caption = label.replace(new RegExp(String.raw`@\[(${actorId})\]`, "gu"), (token, id: string) =>
        resolveMention(token, id, handles),
      );
      element = createElement("a", { key, href, target: "_blank", rel: "noopener noreferrer nofollow" }, caption);
    } else if (bold !== undefined) element = createElement("strong", { key }, inline(bold, handles));
    else if (italic !== undefined) element = createElement("em", { key }, inline(italic, handles));
    else {
      plain += actor === undefined ? token : resolveMention(token, actor, handles);
      continue;
    }
    if (plain) nodes.push(plain);
    plain = "";
    nodes.push(element);
  }
  plain += text.slice(offset);
  if (plain) nodes.push(plain);
  return nodes;
}

function fence(line: string) {
  return /^ {0,3}(`{3,})([^`]*)$/.exec(line);
}

function heading(line: string) {
  return /^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/.exec(line);
}

function listItem(line: string) {
  return /^ {0,3}(?:[-*+]|(\d{1,9})\.)[ \t]+(.+)$/.exec(line);
}

export function renderMarkdown(text: string, mentions: readonly Mention[] = []): ReactNode[] {
  const handles = new Map(mentions.flatMap(({ actor }) => (actor ? [[actor.id, actor.handle]] : [])));
  const lines = text.split(/\r\n?|\n/);
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const key = index;
    const line = lines[index++] ?? "";
    if (!line.trim()) continue;

    const opening = fence(line)?.[1];
    if (opening) {
      const start = index;
      while (index < lines.length && !isClosingFence(lines[index] ?? "", opening.length)) index++;
      blocks.push(createElement("pre", { key }, createElement("code", null, lines.slice(start, index).join("\n"))));
      index++;
      continue;
    }

    const [, hashes, title] = heading(line) ?? [];
    if (hashes) {
      const text = (title ?? "").replace(/(?:^|[ \t]+)#+[ \t]*$/, "").trim();
      blocks.push(createElement(`h${hashes.length}`, { key }, inline(text, handles)));
      continue;
    }

    const first = listItem(line);
    if (first) {
      const ordered = first[1] !== undefined;
      const items = [createElement("li", { key }, inline(first[2] ?? "", handles))];
      for (let next = listItem(lines[index] ?? ""); next && (next[1] !== undefined) === ordered; ) {
        items.push(createElement("li", { key: index }, inline(next[2] ?? "", handles)));
        index++;
        next = listItem(lines[index] ?? "");
      }
      blocks.push(createElement(ordered ? "ol" : "ul", { key, start: ordered ? Number(first[1]) : undefined }, items));
      continue;
    }

    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (!next.trim() || fence(next) || heading(next) || listItem(next)) break;
      index++;
    }
    blocks.push(createElement("p", { key }, inline(lines.slice(key, index).join("\n"), handles)));
  }
  return blocks;
}

function isClosingFence(line: string, width: number): boolean {
  const closing = fence(line);
  return (closing?.[1]?.length ?? 0) >= width && !closing?.[2]?.trim();
}
