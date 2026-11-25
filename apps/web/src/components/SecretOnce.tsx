import { useEffect, useId, useRef, useState } from "react";

import { Button, Input } from "../ui/index.ts";
import "./SecretOnce.css";

interface SecretOnceProps {
  title: string;
  secret: string;
  instructions: string;
  connect?: string;
  env?: string;
  onClose: () => void;
}

export function SecretOnce({ title, secret, instructions, connect, env, onClose }: SecretOnceProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const description = useId();
  const secretId = useId();
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    return () => {
      if (el?.open) el.close();
    };
  }, []);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(`${label} copied.`);
    } catch {
      setCopyStatus("Copy failed. Select the value and copy it manually.");
    }
  }

  return (
    <dialog
      className="secret-once"
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={description}
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <p id={description} className="secret-warning">
        Save this secret now. You can only see it once.
      </p>
      <label htmlFor={secretId}>Secret</label>
      <div className="secret-value">
        <Input id={secretId} readOnly value={secret} />
        <Button variant="secondary" onClick={() => void copy(secret, "Secret")}>
          Copy
        </Button>
      </div>
      <div role="status">{copyStatus}</div>
      <pre>{instructions}</pre>
      {connect && (
        <section>
          <pre>{connect}</pre>
          <Button variant="secondary" size="small" onClick={() => void copy(connect, "Connect command")}>
            Copy ob connect
          </Button>
        </section>
      )}
      {env && (
        <section>
          <pre>{env}</pre>
          <Button variant="secondary" size="small" onClick={() => void copy(env, "Environment snippet")}>
            Copy env
          </Button>
        </section>
      )}
      <form method="dialog">
        <Button type="submit">Done</Button>
      </form>
    </dialog>
  );
}
