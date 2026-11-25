import { useQuery } from "@tanstack/react-query";
import { BoardError } from "@the-vibe-company/openboard";
import { type ChangeEvent, type FormEvent, type Ref, type RefObject, useId, useRef, useState } from "react";
import { browserClient } from "../api/client.ts";
import { sessionQuery } from "../api/session.ts";
import { Button, Input, PaperclipIcon, TagIcon, Textarea, XIcon } from "../ui/index.ts";
import "./Composer.css";

type Board = { org: string; board: string };
type Uploaded = { id: string; name: string; size: number };

export type ComposerDraft = { text: string; id: string; attachments?: string[]; labels?: Record<string, string> };
export type TaskComposerDraft = ComposerDraft & { needs?: string[] };

type ComposerProps = {
  ref?: Ref<HTMLFormElement>;
  board?: Board;
  allowTask?: boolean;
  onPost: (draft: ComposerDraft) => Promise<void>;
  onCreateTask?: (draft: TaskComposerDraft) => Promise<void>;
};

const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

export function parseLabelInput(raw: string): Record<string, string> | undefined {
  const entries = raw
    .split(/[,\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (entries.length === 0) return undefined;
  const labels: Record<string, string> = {};
  for (const entry of entries) {
    const eq = entry.indexOf("=");
    if (eq === -1) labels[entry] = "true";
    else {
      const key = entry.slice(0, eq).trim();
      const value = entry.slice(eq + 1).trim();
      if (key) labels[key] = value || "true";
    }
  }
  return Object.keys(labels).length ? labels : undefined;
}

function parseNeedsInput(raw: string): string[] | undefined {
  const ids = raw
    .split(/[,\s]+/)
    .map((p) => p.replace(/^#/, "").trim())
    .filter((p) => /^\d+$/.test(p));
  return ids.length ? ids : undefined;
}

function randomClientId() {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) => part.toString(16).padStart(8, "0")).join("");
}

async function dispatchComposerDraft(
  mode: "message" | "task",
  text: string,
  id: string,
  files: readonly Uploaded[],
  labelsText: string,
  needsText: string,
  onPost: ComposerProps["onPost"],
  onCreateTask: ComposerProps["onCreateTask"],
) {
  const attachments = files.length ? files.map((file) => file.id) : undefined;
  const labels = parseLabelInput(labelsText);
  const draft: ComposerDraft = { text, id, ...(attachments ? { attachments } : {}), ...(labels ? { labels } : {}) };
  if (mode === "task" && onCreateTask) {
    const needs = parseNeedsInput(needsText);
    await onCreateTask({ ...draft, ...(needs ? { needs } : {}) });
  } else {
    await onPost(draft);
  }
}

function useFileAttachments(
  board: (Board & { csrf: string }) | undefined,
  clientId: RefObject<string | null>,
  setError: (error: Error | null) => void,
) {
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [uploading, setUploading] = useState(false);

  async function onFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!board || uploading || selected.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const oversized = selected.find((file) => file.size > MAX_ATTACHMENT_BYTES);
      if (oversized) throw new Error(`"${oversized.name}" exceeds the 4 MB upload limit.`);
      const client = browserClient(window.location.origin, board);
      const uploaded = await Promise.all(
        selected.map((file) => client.upload(file, { name: file.name, type: file.type || "application/octet-stream" })),
      );
      setFiles((current) => [...current, ...uploaded]);
      clientId.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Could not upload attachment."));
    } finally {
      setUploading(false);
    }
  }

  function removeFile(id: string) {
    setFiles((current) => current.filter((file) => file.id !== id));
    clientId.current = null;
  }

  return { files, setFiles, removeFile, uploading, onFilesSelected };
}

function useComposerState({ board, onPost, onCreateTask }: Pick<ComposerProps, "board" | "onPost" | "onCreateTask">) {
  const [mode, setMode] = useState<"message" | "task">("message");
  const [showLabels, setShowLabels] = useState(false);
  const [text, setText] = useState("");
  const [labelsText, setLabelsText] = useState("");
  const [needsText, setNeedsText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const clientId = useRef<string | null>(null);
  const submitting = useRef(false);
  const { data: session, error: sessionError } = useQuery({ ...sessionQuery, enabled: Boolean(board) });
  // An explicit empty proof skips per-upload session lookups in tokenless sessions.
  const uploadBoard = board && session ? { ...board, csrf: session.csrf ?? "" } : undefined;
  const { files, setFiles, removeFile, uploading, onFilesSelected } = useFileAttachments(
    uploadBoard,
    clientId,
    setError,
  );
  const canSubmit = Boolean(text.trim() || (mode === "message" && files.length > 0));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || uploading || !canSubmit) return;
    clientId.current ??= randomClientId();
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      await dispatchComposerDraft(mode, text, clientId.current, files, labelsText, needsText, onPost, onCreateTask);
      setText("");
      setLabelsText("");
      setNeedsText("");
      setFiles([]);
      clientId.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Could not post the message."));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  const update = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    clientId.current = null;
  };
  return {
    mode,
    setMode: (next: typeof mode) => {
      if (next !== mode) clientId.current = null;
      setMode(next);
    },
    showLabels,
    setShowLabels,
    text,
    setText: update(setText),
    labelsText,
    setLabelsText: update(setLabelsText),
    needsText,
    setNeedsText: update(setNeedsText),
    files,
    removeFile,
    canSubmit,
    canAttach: Boolean(uploadBoard),
    uploading,
    pending,
    error: error ?? (board && !session ? sessionError : null),
    onFilesSelected,
    submit,
  };
}

export function Composer({ ref, board, allowTask, onPost, onCreateTask }: ComposerProps) {
  const messageId = useId();
  const s = useComposerState({ board, onPost, onCreateTask });
  const isTask = Boolean(allowTask && s.mode === "task");

  return (
    <form ref={ref} className="composer" onSubmit={s.submit}>
      <div className="composer-head">
        <label htmlFor={messageId} className="composer-label">
          Message
        </label>
        {allowTask && onCreateTask && (
          <fieldset className="composer-mode" aria-label="Post type">
            <button type="button" aria-pressed={s.mode === "message"} onClick={() => s.setMode("message")}>
              Message
            </button>
            <button type="button" aria-pressed={s.mode === "task"} onClick={() => s.setMode("task")}>
              Task
            </button>
          </fieldset>
        )}
      </div>
      <Textarea
        id={messageId}
        rows={3}
        placeholder={
          isTask ? "Describe the task… First line becomes the task title" : "Write a message… Markdown supported"
        }
        value={s.text}
        readOnly={s.pending}
        onChange={(e) => s.setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      {(isTask || s.showLabels) && (
        <ComposerExtras
          isTask={isTask}
          pending={s.pending}
          labelsText={s.labelsText}
          needsText={s.needsText}
          onLabels={s.setLabelsText}
          onNeeds={s.setNeedsText}
        />
      )}
      <ComposerAttachments files={s.files} onRemove={s.removeFile} />
      <ComposerFooter
        hasBoard={Boolean(board)}
        isTask={isTask}
        showLabels={s.showLabels}
        uploading={s.uploading}
        pending={s.pending}
        canSubmit={s.canSubmit}
        canAttach={s.canAttach}
        onFilesSelected={s.onFilesSelected}
        onToggleLabels={() => s.setShowLabels((cur) => !cur)}
      />
      {s.error && (
        <div role="alert">
          <div>{s.error.message}</div>
          {s.error instanceof BoardError && s.error.hint && <div>{s.error.hint}</div>}
        </div>
      )}
    </form>
  );
}

function ComposerExtras({
  isTask,
  pending,
  labelsText,
  needsText,
  onLabels,
  onNeeds,
}: {
  isTask: boolean;
  pending: boolean;
  labelsText: string;
  needsText: string;
  onLabels: (value: string) => void;
  onNeeds: (value: string) => void;
}) {
  const labelsId = useId();
  const needsId = useId();
  return (
    <div className="composer-extras">
      <div>
        <label htmlFor={labelsId}>Labels (comma-separated key=value)</label>
        <Input
          id={labelsId}
          placeholder="stage=review, priority=high"
          value={labelsText}
          disabled={pending}
          onChange={(e) => onLabels(e.currentTarget.value)}
        />
      </div>
      {isTask && (
        <div>
          <label htmlFor={needsId}>Depends on task IDs</label>
          <Input
            id={needsId}
            placeholder="e.g. 12, 15"
            value={needsText}
            disabled={pending}
            onChange={(e) => onNeeds(e.currentTarget.value)}
          />
        </div>
      )}
    </div>
  );
}

function ComposerAttachments({ files, onRemove }: { files: readonly Uploaded[]; onRemove: (id: string) => void }) {
  if (files.length === 0) return null;
  return (
    <ul className="composer-attachments" aria-label="Pending attachments">
      {files.map((file) => (
        <li key={file.id} className="composer-attachment-chip">
          <span>{file.name}</span>
          <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onRemove(file.id)}>
            <XIcon width={12} height={12} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function ComposerFooter({
  hasBoard,
  isTask,
  showLabels,
  uploading,
  pending,
  canSubmit,
  canAttach,
  onFilesSelected,
  onToggleLabels,
}: {
  hasBoard: boolean;
  isTask: boolean;
  showLabels: boolean;
  uploading: boolean;
  pending: boolean;
  canSubmit: boolean;
  canAttach: boolean;
  onFilesSelected: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  onToggleLabels: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <div className="composer-footer">
      <div className="composer-tools">
        {hasBoard && (
          <>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="composer-file-input"
              onChange={(e) => void onFilesSelected(e)}
            />
            <button
              type="button"
              className="composer-tool-btn"
              disabled={pending || uploading || !canAttach}
              onClick={() => fileInput.current?.click()}
            >
              <PaperclipIcon width={14} height={14} /> {uploading ? "Uploading…" : "Attach"}
            </button>
          </>
        )}
        <button type="button" className="composer-tool-btn" aria-pressed={showLabels} onClick={onToggleLabels}>
          <TagIcon width={14} height={14} /> Labels
        </button>
        <span className="composer-hint">
          <kbd>⌘</kbd>+<kbd>↵</kbd> to {isTask ? "create" : "post"}
        </span>
      </div>
      <Button type="submit" pending={pending} disabled={uploading || !canSubmit}>
        {pending ? (isTask ? "Creating…" : "Posting…") : isTask ? "Create task" : "Post"}
      </Button>
    </div>
  );
}
