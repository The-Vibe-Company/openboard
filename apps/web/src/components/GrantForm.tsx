import type { Client } from "@the-vibe-company/openboard";
import { useId, useState } from "react";
import { type Can, formatCan, grantError, parseCan } from "../api/grants.ts";

export function GrantError({ error }: { error: unknown }) {
  return <div role="alert">{grantError(error).join("\n")}</div>;
}

type FormProps = {
  onCancel: () => void;
} & (
  | { initial: Can; onSave: (can: Can) => Promise<void> }
  | {
      connections: Awaited<ReturnType<Client["listConnections"]>>["connections"];
      onSave: (can: Can, connection: string) => Promise<void>;
    }
);

export function GrantForm(props: FormProps) {
  const id = useId();
  const [text, setText] = useState(() => ("initial" in props ? formatCan(props.initial) : ""));
  const [connection, setConnection] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending) return;
        setPending(true);
        setError(null);
        try {
          await props.onSave(parseCan(text), connection);
        } catch (error) {
          setError(error);
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset disabled={pending}>
        {"connections" in props && (
          <label>
            Connection
            <select required value={connection} onChange={(event) => setConnection(event.target.value)}>
              <option value="">Select a connection</option>
              {props.connections.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label htmlFor={id}>Permissions</label>
        <textarea
          id={id}
          aria-describedby={`${id}-help`}
          required
          rows={4}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div id={`${id}-help`}>Enter one pattern=permissions per line, for example deploys/=read,post.</div>
        <button type="submit">{"initial" in props ? "Save changes" : "Create grant"}</button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </fieldset>
      {error !== null && <GrantError error={error} />}
    </form>
  );
}
