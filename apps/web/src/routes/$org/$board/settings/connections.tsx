import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BoardError, type Client } from "@the-vibe-company/openboard";
import { type FormEvent, useState } from "react";
import { browserClient } from "../../../../api/client.ts";
import { SecretOnce } from "../../../../components/SecretOnce.tsx";

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
  const [error, setError] = useState("");

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
    <section style={{ maxWidth: "42rem", margin: "2rem auto", padding: "0 1rem" }} aria-labelledby="connections">
      <h2 id="connections">Connections</h2>
      {list.isPending && <p role="status">Loading connections…</p>}
      {list.isError && <p role="alert">{errorMessage(list.error, "Could not load connections.")}</p>}
      {list.isSuccess && (
        <>
          <form onSubmit={create}>
            <p>
              <label>
                Name <input name="name" required pattern={"[a-z0-9][a-z0-9\\-]{0,62}"} />
              </label>
            </p>
            <p>
              <label>
                Access <input name="access" required placeholder="dev/=read,post" />
              </label>
            </p>
            <button type="submit" disabled={busy}>
              Create connection
            </button>
          </form>
          {error && <p role="alert">{error}</p>}
          <ConnectionList connections={list.data.connections} />
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

type Listed = Awaited<ReturnType<Client["listConnections"]>>["connections"];

function ConnectionList({ connections }: { connections: Listed }) {
  if (connections.length === 0) return <p>No connections yet.</p>;
  return (
    <ul aria-label="Active connections">
      {connections.map(({ id, name, secretHint }) => (
        <li key={id} style={{ overflowWrap: "anywhere" }}>
          {name} <code>{secretHint}</code>
        </li>
      ))}
    </ul>
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
