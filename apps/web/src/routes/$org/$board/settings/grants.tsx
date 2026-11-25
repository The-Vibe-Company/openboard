import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BoardError, type Client, principalFlags } from "@the-vibe-company/openboard";
import { useState } from "react";
import { browserClient } from "../../../../api/client.ts";
import { addConnectionGrant, type Can, formatCan, type Grant, grantList } from "../../../../api/grants.ts";
import { sessionQuery } from "../../../../api/session.ts";
import { GrantError, GrantForm } from "../../../../components/GrantForm.tsx";
import { Button, Table } from "../../../../ui/index.ts";

export const Route = createFileRoute("/$org/$board/settings/grants")({
  component: GrantsRoute,
});

function GrantsRoute() {
  const { org, board } = Route.useParams();
  const { data: session } = useQuery(sessionQuery);
  const client = browserClient(window.location.origin, { org, board, csrf: session?.csrf ?? undefined });
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
    <section aria-labelledby="grants-heading">
      <h1 id="grants-heading">Grants</h1>
      <p className="settings-access-intro">
        Grants define which channels connections, users, and CI identities can access and what they can do there.
      </p>
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
            <Button onClick={() => setAdding(true)}>Add grant</Button>
          )}
          {grants.length === 0 ? (
            <p>No grants.</p>
          ) : (
            <div className="settings-table">
              <Table aria-label="Grants">
                <thead>
                  <tr>
                    <th scope="col">Grant</th>
                    <th scope="col">Principals and permissions</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {grants.map((grant) => (
                    <tr key={grant.id} aria-label={grant.id}>
                      <th scope="row">
                        <h2>{grant.id}</h2>
                      </th>
                      <td>
                        <code>{grant.principals.map(principalFlags).join(" ")}</code>
                        <pre>{formatCan(grant.can)}</pre>
                      </td>
                      <GrantActions grant={grant} client={client} refresh={refresh} />
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </>
      )}
    </section>
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
        <Button onClick={onCancel}>Cancel</Button>
      )}
    </>
  );
}

function GrantActions({ grant, client, refresh }: { grant: Grant; client: Client; refresh: () => Promise<void> }) {
  const [mode, setMode] = useState<"edit" | "revoke" | null>(null);
  const revoke = useMutation({
    mutationFn: () => client.revokeGrant({ id: grant.id }),
    onSuccess: refresh,
  });
  return (
    <td>
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
          <Button variant="danger" pending={revoke.isPending} onClick={() => revoke.mutate()}>
            Confirm revoke
          </Button>
          <Button
            variant="secondary"
            disabled={revoke.isPending}
            onClick={() => {
              revoke.reset();
              setMode(null);
            }}
          >
            Cancel
          </Button>
          {revoke.isError && <GrantError error={revoke.error} />}
        </>
      )}
      {mode === null && (
        <>
          <Button variant="secondary" onClick={() => setMode("edit")}>
            Edit
          </Button>
          <Button variant="danger" onClick={() => setMode("revoke")}>
            Revoke
          </Button>
        </>
      )}
    </td>
  );
}
