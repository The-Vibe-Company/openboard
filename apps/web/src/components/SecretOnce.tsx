import { useEffect, useId, useRef, useState } from "react";

interface SecretOnceProps {
  title: string;
  secret: string;
  instructions: string;
  onClose: () => void;
}

export function SecretOnce({ title, secret, instructions, onClose }: SecretOnceProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const description = useId();
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopyStatus("Secret copied.");
    } catch {
      setCopyStatus("Copy failed. Select the secret and copy it manually.");
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={description} onClose={onClose}>
      <h2 id={titleId}>{title}</h2>
      <p id={description}>Save this secret now. You can only see it once.</p>
      <label>
        Secret
        <input readOnly value={secret} size={40} style={{ display: "block", maxWidth: "100%" }} />
      </label>
      <button type="button" onClick={copy}>
        Copy
      </button>
      <p role="status">{copyStatus}</p>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{instructions}</pre>
      <form method="dialog">
        <button type="submit">Done</button>
      </form>
    </dialog>
  );
}
