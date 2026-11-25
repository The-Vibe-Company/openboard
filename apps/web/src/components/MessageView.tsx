import { findBlockFences } from "@openboard/contract";
import { Fragment } from "react";
import type { ThreadMessage } from "../api/thread.ts";
import { markdownCodeRanges, renderMarkdown } from "../markdown.ts";
import { Avatar } from "../ui/index.ts";
import { BlockView } from "./BlockView.tsx";
import "./MessageView.css";
import "./markdown.css";

type Board = { org: string; board: string };

function matchesBlock(
  block: unknown,
  id: string,
): block is { schema: string; version: number; data: Record<string, unknown> } {
  if (!block || typeof block !== "object" || !("schema" in block) || !("version" in block) || !("data" in block))
    return false;
  const { schema, version, data } = block;
  return (
    typeof schema === "string" &&
    typeof version === "number" &&
    id === `${schema}@${version}` &&
    data !== null &&
    typeof data === "object" &&
    !Array.isArray(data)
  );
}

function messageBody(message: ThreadMessage, board: Board) {
  const { text, mentions, blocks } = message;
  if (!blocks?.length) return renderMarkdown(text, mentions);
  const fences = findBlockFences(text);
  if (fences.length !== blocks.length) return renderMarkdown(text, mentions);

  const code = markdownCodeRanges(text);
  let codeIndex = 0;
  const parts = [];
  let cursor = 0;
  for (const [index, { id, source, start, end, closed }] of fences.entries()) {
    const block = blocks[index];
    while ((code[codeIndex]?.end ?? Infinity) <= start) codeIndex++;
    const range = code[codeIndex];
    if (!closed || !matchesBlock(block, id) || (range && range.start < start)) continue;
    parts.push(
      <Fragment key={start}>
        {renderMarkdown(text.slice(cursor, start), mentions)}
        <BlockView id={id} data={block.data} source={source} board={board} />
      </Fragment>,
    );
    cursor = end;
  }
  return [...parts, <Fragment key={text.length}>{renderMarkdown(text.slice(cursor), mentions)}</Fragment>];
}

const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentHref(board: Board, id: string): string {
  return `/api/${encodeURIComponent(board.org)}/${encodeURIComponent(board.board)}/attachments/${encodeURIComponent(id)}`;
}

export function MessageView({ message, board }: { message: ThreadMessage; board: Board }) {
  const author = message.author?.name ?? message.from ?? message.by.profile ?? message.by.actor;
  const labels = Object.entries(message.labels);
  const reactions = Object.entries(message.reactions);
  const attachments = message.deleted ? [] : message.attachments;
  return (
    <article className="thread-message">
      <header>
        <Avatar name={author} src={message.author?.avatar ?? undefined} />
        <strong>{author}</strong>
        <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time>
        {message.editedAt && (
          <span className="message-edited" title={new Date(message.editedAt).toLocaleString()}>
            edited
          </span>
        )}
      </header>
      {message.deleted ? (
        <p>
          <em>Message deleted</em>
        </p>
      ) : (
        <div className="thread-message-text">{messageBody(message, board)}</div>
      )}
      {attachments.length > 0 && (
        <ul className="thread-message-attachments" aria-label="Attachments">
          {attachments.map((file) => {
            const href = attachmentHref(board, file.id);
            const inlineImage = INLINE_IMAGE_TYPES.has(file.type.toLowerCase());
            return (
              <li key={file.id} className={inlineImage ? "attachment-item attachment-image" : "attachment-item"}>
                {inlineImage && (
                  <a className="attachment-preview" href={href} target="_blank" rel="noopener noreferrer">
                    <img src={href} alt={file.name} loading="lazy" />
                  </a>
                )}
                <a className="attachment-chip" href={href} download={file.name}>
                  <span className="attachment-name">{file.name}</span>
                  <span className="attachment-size">{formatBytes(file.size)}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {labels.length > 0 && (
        <ul className="thread-message-metadata" aria-label="Labels">
          {labels.map(([key, value]) => (
            <li key={key}>
              {key}={value}
            </li>
          ))}
        </ul>
      )}
      {reactions.length > 0 && (
        <ul className="thread-message-metadata" aria-label="Reactions">
          {reactions.map(([emoji, actors]) => (
            <li key={emoji}>
              {emoji} {actors.length}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
