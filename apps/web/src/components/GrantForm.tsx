import { BoardError, type Client } from "@the-vibe-company/openboard";
import { useState } from "react";
import { type Can, formatCan, grantError, parseCan } from "../api/grants.ts";
import { Button, Card, Field, Select, Textarea } from "../ui/index.ts";
import "./GrantForm.css";

export function GrantError({ error }: { error: unknown }) {
  return <span role="alert">{grantError(error).join("\n")}</span>;
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
  const [text, setText] = useState(() => ("initial" in props ? formatCan(props.initial) : ""));
  const [connection, setConnection] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ value: unknown; permissions: boolean }>();
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending) return;
        setPending(true);
        setError(undefined);
        let parsed = false;
        try {
          const can = parseCan(text);
          parsed = true;
          await props.onSave(can, connection);
        } catch (error) {
          const permissions =
            !parsed || (error instanceof BoardError && ["invalid_grant", "grant_empty"].includes(error.code));
          setError({ value: error, permissions });
        } finally {
          setPending(false);
        }
      }}
    >
      <Card className="grant-form">
        <fieldset disabled={pending}>
          {"connections" in props && (
            <Field label="Connection">
              {(field) => (
                <Select {...field} required value={connection} onChange={(event) => setConnection(event.target.value)}>
                  <option value="">Select a connection</option>
                  {props.connections.map(({ id, name }) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field
            label="Permissions"
            hint="Enter one pattern=permissions per line, for example deploys/=read,post."
            error={error?.permissions && <GrantError error={error.value} />}
          >
            {(field) => (
              <Textarea
                {...field}
                required
                rows={4}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  if (error?.permissions) setError(undefined);
                }}
              />
            )}
          </Field>
          <div>
            <Button type="submit" pending={pending}>
              {"initial" in props ? "Save changes" : "Create grant"}
            </Button>
            <Button variant="secondary" onClick={props.onCancel}>
              Cancel
            </Button>
          </div>
          {error && !error.permissions && <GrantError error={error.value} />}
        </fieldset>
      </Card>
    </form>
  );
}
