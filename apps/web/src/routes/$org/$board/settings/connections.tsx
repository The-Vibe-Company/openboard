import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useBlocker } from "@tanstack/react-router";
import { BoardError, type Client } from "@the-vibe-company/openboard";
import { type FormEvent, useState } from "react";
import { browserClient } from "../../../../api/client.ts";
import { SecretOnce } from "../../../../components/SecretOnce.tsx";
import { Button, Card, Field, Input, Table } from "../../../../ui/index.ts";

export const Route = createFileRoute("/$org/$board/settings/connections")({
  component: ConnectionsRoute,
});

type Created = Awaited<ReturnType<Client["createConnection"]>>;
type Access = Parameters<Client["createConnection"]>[0]["can"][string];

function parseAccess(text: string) {
  const [pattern, permissions, extra] = text.split("=").map((part) => part.trim());
  if (!pattern || !permissions || extra !== undefined) {
    throw new Error("Enter access as pattern=permissions, for example dev/=read,post.");
  }
  // The create operation validates the channel pattern and permission names.
  return { [pattern]: permissions === "all" ? "all" : (permissions.split(",").map((part) => part.trim()) as Access) };
}

function errorMessage(error: unknown, fallback: string) {
  if (!(error instanceof BoardError)) return fallback;
  if (error.code === "forbidden") return "Only board owners and organization admins manage connections";
  if (!error.hint) return error.message;
  return `${error.message.replace(/\.$/, "")}. ${error.hint}`;
}

function ConnectionsRoute() {
  const { org, board } = Route.useParams();
  return <Connections key={JSON.stringify([org, board])} org={org} board={board} />;
}

function Connections({ org, board }: { org: string; board: string }) {
  const client = browserClient(window.location.origin, { org, board });
  const list = useQuery({
    queryKey: ["connections", org, board],
    queryFn: ({ signal }) => client.listConnections({}, { signal }),
    retry: false,
  });
  const [created, setCreated] = useState<Created>();
  const [busy, setBusy] = useState(false);
  useBlocker({ shouldBlockFn: () => busy, enableBeforeUnload: false });
  const [error, setError] = useState("");
  const [revokeError, setRevokeError] = useState("");

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
    } catch (error) {
      setError(errorMessage(error, "Could not create the connection."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="connections">
      <h1 id="connections">Connections</h1>
      {list.isPending && <p role="status">Loading connections…</p>}
      {revokeError && <p role="alert">{revokeError}</p>}
      {list.isError && <ListLoadError error={list.error} retry={list.refetch} retrying={list.isFetching} />}
      {list.isSuccess && (
        <>
          <CreateConnectionForm onSubmit={create} busy={busy} />
          {error && <p role="alert">{error}</p>}
          <ConnectionList
            connections={list.data.connections}
            client={client}
            refresh={list.refetch}
            reportError={setRevokeError}
          />
        </>
      )}
      {created && (
        <CreatedSecret
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
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  busy: boolean;
}) {
  return (
    <form onSubmit={onSubmit}>
      <Card>
        <fieldset disabled={busy}>
          <Field label="Name">
            {(field) => <Input {...field} name="name" required pattern={"[a-z0-9][a-z0-9\\-]{0,62}"} />}
          </Field>
          <Field label="Access">
            {(field) => <Input {...field} name="access" required placeholder="dev/=read,post" />}
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
  connections,
  client,
  refresh,
  reportError,
}: {
  connections: Listed;
  client: Client;
  refresh: () => Promise<unknown>;
  reportError: (message: string) => void;
}) {
  const [revoking, setRevoking] = useState(false);

  async function revoke({ id, name }: Listed[number]) {
    if (revoking || !window.confirm(`Revoke "${name}" and all its claimed agents?`)) return;
    reportError("");
    setRevoking(true);
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
      setRevoking(false);
    }
  }

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
              <td>
                <Button
                  variant="danger"
                  size="small"
                  aria-label={`Revoke ${connection.name}`}
                  disabled={revoking}
                  onClick={() => void revoke(connection)}
                >
                  Revoke
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
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

function CreatedSecret({ created, onClose }: { created: Created; onClose: () => void }) {
  const {
    connection: { name },
    secret,
    env,
  } = created;
  const profile = /^[a-z][a-z0-9-]{0,31}$/.test(name) ? name : "agent";
  const instructions = [
    `BOARD_URL=${env.BOARD_URL}`,
    "",
    `ob connect ${env.BOARD_URL} --as ${profile}`,
    "Supply the secret on stdin.",
    "",
    "Environment variables for direct access",
    "# Load OPENBOARD_SECRET from your secret store before setting these variables.",
    `export BOARD_URL=${env.BOARD_URL}`,
    'export BOARD_TOKEN="$OPENBOARD_SECRET"',
    `export BOARD_PROFILE=${profile}`,
  ].join("\n");
  return <SecretOnce title="Connection created" secret={secret} instructions={instructions} onClose={onClose} />;
}
