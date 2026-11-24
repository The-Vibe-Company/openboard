import { useEffect, useId, useRef, useState } from "react";

import { Button, Input } from "../ui/index.ts";
import "./SecretOnce.css";

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
  const secretId = useId();
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
    <dialog
      className="secret-once"
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={description}
      onClose={onClose}
    >
      <h2 id={titleId}>{title}</h2>
      <p id={description} className="secret-warning">
        Save this secret now. You can only see it once.
      </p>
      <label htmlFor={secretId}>Secret</label>
      <Input id={secretId} readOnly value={secret} />
      <Button variant="secondary" onClick={copy}>
        Copy
      </Button>
      <p role="status">{copyStatus}</p>
      <pre>{instructions}</pre>
      <form method="dialog">
        <Button type="submit">Done</Button>
      </form>
    </dialog>
  );
}
