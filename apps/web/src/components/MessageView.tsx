import { findBlockFences } from "@openboard/contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, Fragment, useState } from "react";
import { boardKeys } from "../api/board.ts";
import { browserClient } from "../api/client.ts";
import { sessionQuery } from "../api/session.ts";
import { type ThreadMessage, threadKeys } from "../api/thread.ts";
import { markdownCodeRanges, renderMarkdown } from "../markdown.ts";
import { Avatar, Button, Textarea } from "../ui/index.ts";
import { BlockView } from "./BlockView.tsx";
import { type ActiveTool, MessageLabelTool, MessageReactTool, MessageToolbar } from "./MessageActions.tsx";
import "./MessageView.css";
import "./markdown.css";

type Board = { org: string; board: string };
const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentHref(board: Board, id: string): string {
  return `/api/${encodeURIComponent(board.org)}/${encodeURIComponent(board.board)}/attachments/${encodeURIComponent(id)}`;
}

function useMessageActions(board: Board, message: ThreadMessage) {
  const { data: session } = useQuery(sessionQuery);
  const queryClient = useQueryClient();
  const [tool, setTool] = useState<ActiveTool>(null);
  const [editText, setEditText] = useState(message.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canInteract = Boolean(session?.signedIn && session.csrf && !message.deleted);
  const principal = session?.person?.principal;
  const client = () => browserClient(window.location.origin, { ...board, csrf: session?.csrf ?? undefined });

  async function mutate(work: () => Promise<void>): Promise<boolean> {
    if (!session?.csrf || busy) return false;
    setBusy(true);
    setError("");
    try {
      await work();
      setTool(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: threadKeys.all(board) }),
        queryClient.invalidateQueries({ queryKey: boardKeys.threads(board) }),
      ]);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return {
    tool,
    setTool,
    editText,
    setEditText,
    busy,
    error,
    canInteract,
    toggleReaction: (emoji: string) => {
      const remove = principal ? (message.reactions[emoji] ?? []).includes(principal) : false;
      return mutate(async () => {
        await client().reactToMessage({ id: message.id, emoji, ...(remove ? { remove: true } : {}) });
      });
    },
    setLabel: (key: string, value: string) =>
      mutate(async () => {
        await client().labelMessage({
          id: message.id,
          ...(value === "" ? { unset: [key] } : { set: { [key]: value } }),
        });
      }),
    saveEdit: (event: FormEvent) => {
      event.preventDefault();
      if (!editText.trim()) return;
      void mutate(async () => {
        await client().editMessage({ id: message.id, text: editText });
      });
    },
    deleteMsg: () => {
      if (!window.confirm("Delete this message?")) return;
      void mutate(async () => {
        await client().deleteMessage({ id: message.id });
      });
    },
  };
}

export function MessageView({ message, board }: { message: ThreadMessage; board: Board }) {
  const actions = useMessageActions(board, message);
  const author = message.author?.name ?? message.from ?? message.by.profile ?? message.by.actor;

  return (
    <article className="thread-message">
      <header>
        <Avatar name={author} />
        <strong>{author}</strong>
        <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time>
        {message.editedAt && (
          <span className="message-edited" title={new Date(message.editedAt).toLocaleString()}>
            edited
          </span>
        )}
        {actions.canInteract && (
          <MessageToolbar
            tool={actions.tool}
            busy={actions.busy}
            onToggle={(next) => {
              if (next === "edit") actions.setEditText(message.text);
              actions.setTool((cur) => (cur === next ? null : next));
            }}
            onDelete={actions.deleteMsg}
          />
        )}
      </header>
      <MessageContent
        message={message}
        board={board}
        editing={actions.tool === "edit"}
        editText={actions.editText}
        busy={actions.busy}
        onEditText={actions.setEditText}
        onCancelEdit={() => actions.setTool(null)}
        onSubmitEdit={actions.saveEdit}
      />
      {actions.tool === "react" && <MessageReactTool busy={actions.busy} onReact={actions.toggleReaction} />}
      {actions.tool === "label" && (
        <MessageLabelTool busy={actions.busy} onLabel={actions.setLabel} onClose={() => actions.setTool(null)} />
      )}
      {actions.error && (
        <div className="message-action-error" role="alert">
          {actions.error}
        </div>
      )}
      <MessageAttachments board={board} attachments={message.deleted ? [] : message.attachments} />
      <MessageMeta
        labels={Object.entries(message.labels)}
        reactions={Object.entries(message.reactions)}
        canInteract={actions.canInteract}
        busy={actions.busy}
        onToggleReaction={actions.toggleReaction}
      />
    </article>
  );
}

function MessageContent({
  message,
  board,
  editing,
  editText,
  busy,
  onEditText,
  onCancelEdit,
  onSubmitEdit,
}: {
  message: ThreadMessage;
  board: Board;
  editing: boolean;
  editText: string;
  busy: boolean;
  onEditText: (value: string) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (event: FormEvent) => void;
}) {
  if (editing) {
    return (
      <form className="message-inline-panel" onSubmit={onSubmitEdit}>
        <Textarea
          rows={3}
          aria-label="Edit message text"
          value={editText}
          disabled={busy}
          onChange={(event) => onEditText(event.currentTarget.value)}
        />
        <Button type="submit" size="small" pending={busy} disabled={!editText.trim()}>
          Save
        </Button>
        <Button type="button" size="small" variant="secondary" disabled={busy} onClick={onCancelEdit}>
          Cancel
        </Button>
      </form>
    );
  }
  if (message.deleted) {
    return (
      <p>
        <em>Message deleted</em>
      </p>
    );
  }
  return <div className="thread-message-text">{messageBody(message, board)}</div>;
}

function MessageAttachments({ board, attachments }: { board: Board; attachments: ThreadMessage["attachments"] }) {
  if (attachments.length === 0) return null;
  return (
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
  );
}

function MessageMeta({
  labels,
  reactions,
  canInteract,
  busy,
  onToggleReaction,
}: {
  labels: [string, string][];
  reactions: [string, string[]][];
  canInteract: boolean;
  busy: boolean;
  onToggleReaction: (emoji: string) => Promise<boolean>;
}) {
  return (
    <>
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
              {canInteract ? (
                <button
                  type="button"
                  className="message-reaction-chip"
                  disabled={busy}
                  onClick={() => void onToggleReaction(emoji)}
                >
                  {emoji} {actors.length}
                </button>
              ) : (
                <>
                  {emoji} {actors.length}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
