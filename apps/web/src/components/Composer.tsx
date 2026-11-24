import { BoardError } from "@the-vibe-company/openboard";
import { type FormEvent, useRef, useState } from "react";
import "./Composer.css";

type ComposerProps = {
  onPost: (draft: { text: string; id: string }) => Promise<void>;
};

export function Composer({ onPost }: ComposerProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const clientId = useRef<string | null>(null);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !text.trim()) return;

    // Keep the same ID for an unchanged draft if the write needs to be retried.
    clientId.current ??= Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) =>
      part.toString(16).padStart(8, "0"),
    ).join("");
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      await onPost({ text, id: clientId.current });
      setText("");
      clientId.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Could not post the message."));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <form className="composer" onSubmit={submit}>
      <label>
        Message
        <textarea
          rows={3}
          value={text}
          readOnly={pending}
          onChange={(event) => {
            setText(event.currentTarget.value);
            clientId.current = null;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
      </label>
      <button type="submit" disabled={pending || !text.trim()}>
        {pending ? "Posting…" : "Post"}
      </button>
      {error && (
        <div role="alert">
          <div>{error.message}</div>
          {error instanceof BoardError && error.hint && <div>{error.hint}</div>}
        </div>
      )}
    </form>
  );
}
