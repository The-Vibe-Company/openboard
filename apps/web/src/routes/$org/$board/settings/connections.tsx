import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useBlocker } from "@tanstack/react-router";
import { BoardError, type Client } from "@the-vibe-company/openboard";
import { type FormEvent, useState } from "react";
import { boardUrl as resolveBoardUrl, browserClient } from "../../../../api/client.ts";
import { sessionQuery } from "../../../../api/session.ts";
import { connectionProfile, ConnectionSetup, NewConnectionSecret } from "../../../../components/ConnectionSnippets.tsx";
import { AccessPresets } from "../../../../components/GrantForm.tsx";
import { SecretOnce } from "../../../../components/SecretOnce.tsx";
import { Button, Card, Field, Input, Table, Textarea } from "../../../../ui/index.ts";

export const Route = createFileRoute("/$org/$board/settings/connections")({
  component: ConnectionsRoute,
});

type Created = Awaited<ReturnType<Client["createConnection"]>>;
type Rotated = Awaited<ReturnType<Client["rotateConnection"]>>;
type Access = Parameters<Client["createConnection"]>[0]["can"][string];

function parseAccess(text: string) {
  const rules = new Map<string, Access>();
  for (const rule of text
    .split(/[;\n]/)
    .map((rule) => rule.trim())
    .filter(Boolean)) {
    const [pattern, permissions, extra] = rule.split("=").map((part) => part.trim());
    if (!pattern || !permissions || extra !== undefined) {
      throw new Error("Enter access as pattern=permissions, for example dev/=read,post.");
    }
    if (rules.has(pattern)) throw new Error(`Enter access for ${pattern} only once.`);
    // The create operation validates the channel pattern and permission names.
    rules.set(pattern, permissions === "all" ? "all" : (permissions.split(",").map((part) => part.trim()) as Access));
  }
  if (!rules.size) throw new Error("Enter at least one access rule.");
  return Object.fromEntries(rules);
}

function errorMessage(error: unknown, fallback: string) {
  if (!(error instanceof BoardError)) return fallback;
  if (error.code === "forbidden") return "Only board owners and organization admins manage connections";
  if (!error.hint) return error.message;
  return `${error.message.replace(/\.$/, "")}. ${error.hint}`;
}

function ConnectionsRoute() {
  const { org, board } = Route.useParams();
  const boardUrl = resolveBoardUrl(window.location.origin, { org, board });
  return <Connections key={JSON.stringify([org, board])} {...{ org, board, boardUrl }} />;
}

function Connections({ org, board, boardUrl }: { org: string; board: string; boardUrl: string }) {
  const { data: session } = useQuery(sessionQuery);
  const client = browserClient(window.location.origin, { org, board, csrf: session?.csrf ?? undefined });
  const list = useQuery({
    queryKey: ["connections", org, board],
    queryFn: ({ signal }) => client.listConnections({}, { signal }),
    retry: false,
  });
  const [created, setCreated] = useState<Created | Rotated>();
  const [busy, setBusy] = useState(false);
  useBlocker({ shouldBlockFn: () => busy || Boolean(created), enableBeforeUnload: false });
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [access, setAccess] = useState("");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || created) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name")).trim();
    let can: ReturnType<typeof parseAccess>;
    try {
      can = parseAccess(String(data.get("access")));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Enter access as pattern=permissions.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      setCreated(await client.createConnection({ name, can, direct: true }));
      form.reset();
      setAccess("");
    } catch (error) {
      setError(errorMessage(error, "Could not create the connection."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="connections">
      <h1 id="connections">Connections</h1>
      <p className="settings-access-intro">
        For personal CLI access, run <code>ob login {window.location.origin}</code>. Connections give coding agents and
        CI scoped, long-lived credentials.
      </p>
      {list.isPending && <p role="status">Loading connections…</p>}
      {actionError && <p role="alert">{actionError}</p>}
      {list.isError && <ListLoadError error={list.error} retry={list.refetch} retrying={list.isFetching} />}
      {list.isSuccess && (
        <>
          <CreateConnectionForm onSubmit={create} busy={busy} access={access} setAccess={setAccess} />
          {error && <p role="alert">{error}</p>}
          <ConnectionList
            boardUrl={boardUrl}
            connections={list.data.connections}
            client={client}
            refresh={list.refetch}
            reportError={setActionError}
            busy={busy || Boolean(created)}
            setBusy={setBusy}
            showSecret={setCreated}
          />
        </>
      )}
      {created && (
        <CreatedSecret
          boardUrl={boardUrl}
          created={created}
          onClose={() => {
            setCreated(undefined);
            void list.refetch();
          }}
        />
      )}
    </section>
  );
}

function CreateConnectionForm({
  onSubmit,
  busy,
  access,
  setAccess,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  busy: boolean;
  access: string;
  setAccess: (value: string) => void;
}) {
  return (
    <form onSubmit={onSubmit}>
      <Card className="settings-access-form">
        <fieldset disabled={busy}>
          <Field label="Name">
            {(field) => <Input {...field} name="name" required pattern={"[a-z0-9][a-z0-9\\-]{0,62}"} />}
          </Field>
          <AccessPresets value={access} onSelect={setAccess} />
          <Field
            label="Access"
            hint={
              <>
                <code>*</code> all channels · <code>dev/</code> prefix · <code>general</code> exact. Permissions: all,
                read, post, react, label, sync, manage. Separate rules with a newline or semicolon.
              </>
            }
          >
            {(field) => (
              <Textarea
                {...field}
                name="access"
                required
                rows={2}
                placeholder="dev/=read,post"
                value={access}
                onChange={(event) => setAccess(event.target.value)}
              />
            )}
          </Field>
          <div>
            <Button type="submit" pending={busy}>
              Create connection
            </Button>
          </div>
        </fieldset>
      </Card>
    </form>
  );
}

function ListLoadError({
  error,
  retry,
  retrying,
}: {
  error: unknown;
  retry: () => Promise<unknown>;
  retrying: boolean;
}) {
  return (
    <>
      <p role="alert">{errorMessage(error, "Could not load connections.")}</p>
      <Button variant="secondary" pending={retrying} onClick={() => void retry()}>
        Retry loading connections
      </Button>
    </>
  );
}

type Listed = Awaited<ReturnType<Client["listConnections"]>>["connections"];

function ConnectionList({
  boardUrl,
  connections,
  client,
  refresh,
  reportError,
  busy,
  setBusy,
  showSecret,
}: {
  boardUrl: string;
  connections: Listed;
  client: Client;
  refresh: () => Promise<unknown>;
  reportError: (message: string) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  showSecret: (rotated: Rotated) => void;
}) {
  if (connections.length === 0) return <p>No connections yet.</p>;
  return (
    <div className="settings-table">
      <Table aria-label="Active connections">
        <thead>
          <tr>
            <th scope="col">Connection</th>
            <th scope="col">Activity</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {connections.map((connection) => (
            <tr key={connection.id}>
              <th scope="row">
                <span>{connection.name}</span>
                <br />
                <code>{connection.secretHint}</code>
              </th>
              <ConnectionActivity connection={connection} />
              <ConnectionActions
                {...{ boardUrl, connection, client, refresh, reportError, busy, setBusy, showSecret }}
              />
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function ConnectionActions({
  boardUrl,
  connection,
  client,
  refresh,
  reportError,
  busy,
  setBusy,
  showSecret,
}: {
  boardUrl: string;
  connection: Listed[number];
  client: Client;
  refresh: () => Promise<unknown>;
  reportError: (message: string) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  showSecret: (rotated: Rotated) => void;
}) {
  const { id, name } = connection;

  async function rotate() {
    if (busy) return;
    reportError("");
    setBusy(true);
    try {
      showSecret(await client.rotateConnection({ id }));
    } catch (error) {
      reportError(errorMessage(error, "Could not rotate the connection secret."));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (busy || !window.confirm(`Revoke "${name}" and all its claimed agents?`)) return;
    reportError("");
    setBusy(true);
    try {
      try {
        await client.revokeConnection({ id });
      } catch (error) {
        if (!(error instanceof BoardError) || error.code !== "not_found") throw error;
        reportError("This connection no longer exists");
      }
      await refresh();
    } catch (error) {
      reportError(errorMessage(error, "Could not revoke the connection."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <td>
      <Button
        variant="secondary"
        size="small"
        aria-label={`Rotate ${name}`}
        disabled={busy}
        onClick={() => void rotate()}
      >
        Rotate
      </Button>
      <Button variant="danger" size="small" aria-label={`Revoke ${name}`} disabled={busy} onClick={() => void revoke()}>
        Revoke
      </Button>
      <ConnectionSetup {...{ boardUrl, name, profiles: connection.profiles }} />
    </td>
  );
}

function ConnectionActivity({ connection }: { connection: Listed[number] }) {
  return (
    <td>
      <div>
        Last used:{" "}
        {connection.lastUsedAt ? (
          <time dateTime={connection.lastUsedAt}>{new Date(connection.lastUsedAt).toLocaleString()}</time>
        ) : (
          "Never"
        )}
      </div>
      <div>
        Live agents: {connection.agents.length ? connection.agents.map((agent) => agent.profile).join(", ") : "None"}
      </div>
    </td>
  );
}

function CreatedSecret({
  boardUrl,
  created,
  onClose,
}: {
  boardUrl: string;
  created: Created | Rotated;
  onClose: () => void;
}) {
  const {
    connection: { name, direct, profiles },
    secret,
    env,
  } = created;
  if (!("previousUntil" in created)) {
    return <NewConnectionSecret setup={{ boardUrl, name, profiles }} secret={secret} onClose={onClose} />;
  }
  const profile = connectionProfile(name, profiles);
  const connect = `ob connect ${env.BOARD_URL} --as ${profile} --secret-file ~/.config/openboard/${name}.secret`;
  const exports = [
    "# Load OPENBOARD_SECRET from your secret store before setting these variables.",
    `export BOARD_URL=${env.BOARD_URL}`,
    'export BOARD_TOKEN="$OPENBOARD_SECRET"',
    `export BOARD_PROFILE=${profile}`,
  ].join("\n");
  return (
    <SecretOnce
      title="Connection rotated"
      secret={secret}
      instructions={`BOARD_URL=${env.BOARD_URL}`}
      connect={connect}
      env={direct ? exports : undefined}
      onClose={onClose}
    />
  );
}
