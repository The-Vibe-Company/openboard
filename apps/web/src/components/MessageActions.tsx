import { useState } from "react";
import { Button, EditIcon, Input, SmileIcon, TagIcon, TrashIcon } from "../ui/index.ts";

export type ActiveTool = "react" | "label" | "edit" | null;
const QUICK_EMOJIS = [
  { name: "thumbs_up", glyph: "👍" },
  { name: "eyes", glyph: "👀" },
  { name: "rocket", glyph: "🚀" },
  { name: "white_check_mark", glyph: "✅" },
  { name: "tada", glyph: "🎉" },
  { name: "heart", glyph: "❤️" },
] as const;

export function MessageToolbar({
  tool,
  busy,
  onToggle,
  onDelete,
}: {
  tool: ActiveTool;
  busy: boolean;
  onToggle: (next: Exclude<ActiveTool, null>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="message-toolbar" data-active={tool !== null}>
      <button
        type="button"
        className="message-tool-btn"
        title="Add reaction"
        aria-label="Add reaction"
        onClick={() => onToggle("react")}
      >
        <SmileIcon width={14} height={14} />
      </button>
      <button
        type="button"
        className="message-tool-btn"
        title="Manage labels"
        aria-label="Manage labels"
        onClick={() => onToggle("label")}
      >
        <TagIcon width={14} height={14} />
      </button>
      <button
        type="button"
        className="message-tool-btn"
        title="Edit message"
        aria-label="Edit message"
        onClick={() => onToggle("edit")}
      >
        <EditIcon width={14} height={14} />
      </button>
      <button
        type="button"
        className="message-tool-btn"
        data-danger="true"
        title="Delete message"
        aria-label="Delete message"
        disabled={busy}
        onClick={onDelete}
      >
        <TrashIcon width={14} height={14} />
      </button>
    </div>
  );
}

export function MessageReactTool({ busy, onReact }: { busy: boolean; onReact: (emoji: string) => Promise<boolean> }) {
  const [customEmoji, setCustomEmoji] = useState("");
  return (
    <div className="message-inline-panel">
      {QUICK_EMOJIS.map(({ name, glyph }) => (
        <button
          key={name}
          type="button"
          className="message-emoji-btn"
          title={name}
          aria-label={`React with ${name}`}
          disabled={busy}
          onClick={() => void onReact(name)}
        >
          {glyph}
        </button>
      ))}
      <Input
        aria-label="Custom emoji"
        placeholder="shortcode (e.g. eyes, +1)"
        value={customEmoji}
        disabled={busy}
        onChange={(event) => setCustomEmoji(event.currentTarget.value)}
      />
      <Button
        type="button"
        size="small"
        pending={busy}
        disabled={!customEmoji.trim()}
        onClick={async () => {
          if (await onReact(customEmoji.trim().toLowerCase())) setCustomEmoji("");
        }}
      >
        Add
      </Button>
    </div>
  );
}

export function MessageLabelTool({
  busy,
  onLabel,
  onClose,
}: {
  busy: boolean;
  onLabel: (key: string, value: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [labelKey, setLabelKey] = useState("");
  const [labelValue, setLabelValue] = useState("");
  return (
    <form
      className="message-inline-panel"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !labelKey.trim() || !(await onLabel(labelKey.trim(), labelValue.trim()))) return;
        setLabelKey("");
        setLabelValue("");
      }}
    >
      <Input
        aria-label="Label key"
        placeholder="key (e.g. stage)"
        value={labelKey}
        disabled={busy}
        onChange={(event) => setLabelKey(event.currentTarget.value)}
      />
      <Input
        aria-label="Label value"
        placeholder="value (blank to unset)"
        value={labelValue}
        disabled={busy}
        onChange={(event) => setLabelValue(event.currentTarget.value)}
      />
      <Button type="submit" size="small" pending={busy} disabled={!labelKey.trim()}>
        Apply
      </Button>
      <Button type="button" size="small" variant="secondary" disabled={busy} onClick={onClose}>
        Close
      </Button>
    </form>
  );
}
