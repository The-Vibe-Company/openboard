import type { ThreadMessage } from "../api/thread.ts";
import { renderMarkdown } from "../markdown.ts";
import { Avatar } from "../ui/index.ts";
import "./MessageView.css";
import "./markdown.css";

export function MessageView({ message }: { message: ThreadMessage }) {
  const author = message.author?.name ?? message.from ?? message.by.profile ?? message.by.actor;
  const labels = Object.entries(message.labels);
  const reactions = Object.entries(message.reactions);
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
      </header>
      {message.deleted ? (
        <p>
          <em>Message deleted</em>
        </p>
      ) : (
        <div className="thread-message-text">{renderMarkdown(message.text, message.mentions)}</div>
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
