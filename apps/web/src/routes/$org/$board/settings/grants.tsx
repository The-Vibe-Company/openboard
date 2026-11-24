import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BoardError, type Client, principalFlags } from "@the-vibe-company/openboard";
import { useState } from "react";
import { browserClient } from "../../../../api/client.ts";
import { addConnectionGrant, type Can, formatCan, type Grant, grantList } from "../../../../api/grants.ts";
import { GrantError, GrantForm } from "../../../../components/GrantForm.tsx";
import "./grants.css";

export const Route = createFileRoute("/$org/$board/settings/grants")({
  component: GrantsRoute,
});

function GrantsRoute() {
  const { org, board } = Route.useParams();
  const client = browserClient(window.location.origin, { org, board });
  return <GrantsPage key={JSON.stringify([org, board])} client={client} org={org} board={board} />;
}

function GrantsPage({ client, org, board }: { client: Client; org: string; board: string }) {
  const queryClient = useQueryClient();
  const key = ["board", org, board, "grants"];
  const list = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => grantList(() => client.listGrants({}, { signal })),
    retry: false,
  });
  const [adding, setAdding] = useState(false);
  const error = list.data?.denial ?? list.error;
  const grants = list.data?.value?.grants;
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  return (
    <main className="grant-settings">
      <h1>Grants</h1>
      {list.isPending && <p role="status">Loading grants…</p>}
      {error &&
        (error instanceof BoardError && error.code === "forbidden" ? (
          <p role="alert">Only board owners and organization admins manage grants</p>
        ) : (
          <GrantError error={error} />
        ))}
      {grants && (
        <>
          {adding ? (
            <NewGrant client={client} org={org} board={board} onCancel={() => setAdding(false)} refresh={refresh} />
          ) : (
            <button type="button" onClick={() => setAdding(true)}>
              Add grant
            </button>
          )}
          {grants.length === 0 && <p>No grants.</p>}
          {grants.map((grant) => (
            <GrantEntry key={grant.id} grant={grant} client={client} refresh={refresh} />
          ))}
        </>
      )}
    </main>
  );
}

function NewGrant({
  client,
  org,
  board,
  onCancel,
  refresh,
}: {
  client: Client;
  org: string;
  board: string;
  onCancel: () => void;
  refresh: () => Promise<void>;
}) {
  const list = useQuery({
    queryKey: ["board", org, board, "grant-connections"],
    queryFn: ({ signal }) => grantList(() => client.listConnections({}, { signal })),
    retry: false,
  });
  const error = list.data?.denial ?? list.error;
  const connections = list.data?.value?.connections;
  return (
    <>
      {error && <GrantError error={error} />}
      {list.isPending && <p role="status">Loading connections…</p>}
      {connections?.length === 0 && <p role="status">No active connections.</p>}
      {connections?.length ? (
        <GrantForm
          connections={connections}
          onCancel={onCancel}
          onSave={async (can, connection) => {
            await addConnectionGrant(client, connection, can);
            await refresh();
            onCancel();
          }}
        />
      ) : (
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      )}
    </>
  );
}

function GrantEntry({ grant, client, refresh }: { grant: Grant; client: Client; refresh: () => Promise<void> }) {
  const [mode, setMode] = useState<"edit" | "revoke" | null>(null);
  const revoke = useMutation({
    mutationFn: () => client.revokeGrant({ id: grant.id }),
    onSuccess: refresh,
  });
  return (
    <section aria-label={grant.id}>
      <h2>{grant.id}</h2>
      <p>
        <code>{grant.principals.map(principalFlags).join(" ")}</code>
      </p>
      <pre>{formatCan(grant.can)}</pre>
      {mode === "edit" && (
        <GrantForm
          initial={grant.can}
          onCancel={() => setMode(null)}
          onSave={async (can: Can) => {
            await client.updateGrant({ id: grant.id, can });
            await refresh();
            setMode(null);
          }}
        />
      )}
      {mode === "revoke" && (
        <>
          <p>Revoke grant {grant.id}?</p>
          <button type="button" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
            Confirm revoke
          </button>
          <button
            type="button"
            disabled={revoke.isPending}
            onClick={() => {
              revoke.reset();
              setMode(null);
            }}
          >
            Cancel
          </button>
          {revoke.isError && <GrantError error={revoke.error} />}
        </>
      )}
      {mode === null && (
        <>
          <button type="button" onClick={() => setMode("edit")}>
            Edit
          </button>
          <button type="button" onClick={() => setMode("revoke")}>
            Revoke
          </button>
        </>
      )}
    </section>
  );
}
