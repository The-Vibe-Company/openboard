import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BoardError, type Client } from "@the-vibe-company/openboard";
import { useState } from "react";
import { browserClient } from "../../../../api/client.ts";
import { sessionQuery } from "../../../../api/session.ts";
import { webhookError } from "../../../../api/webhooks.ts";
import { SecretOnce } from "../../../../components/SecretOnce.tsx";
import { WebhookForm } from "../../../../components/WebhookForm.tsx";
import { Badge, Button, Table } from "../../../../ui/index.ts";

export const Route = createFileRoute("/$org/$board/settings/webhooks")({
  component: WebhooksRoute,
});

type Listed = Awaited<ReturnType<Client["listWebhooks"]>>["webhooks"];
type Delivery = Awaited<ReturnType<Client["listWebhookDeliveries"]>>["deliveries"][number];

function WebhooksRoute() {
  const { org, board } = Route.useParams();
  const session = useQuery(sessionQuery);
  const { person, csrf } = session.data ?? {};
  if (session.isPending) return <p role="status">Loading session…</p>;
  if (!person || !csrf) return <p role="alert">Sign in to manage webhooks.</p>;
  return (
    <WebhooksPage
      key={JSON.stringify([org, board, person.principal, csrf])}
      client={browserClient(window.location.origin, { org, board, csrf })}
      queryKey={["board", org, board, "webhooks", person.principal]}
    />
  );
}

function WebhooksPage({ client, queryKey }: { client: Client; queryKey: string[] }) {
  const cache = useQueryClient();
  const list = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      try {
        return { value: await client.listWebhooks({}, { signal }) };
      } catch (error) {
        if (error instanceof BoardError && [401, 403, 404].includes(error.status)) return { denial: error };
        throw error;
      }
    },
    retry: false,
  });
  const [secret, setSecret] = useState<string>();
  const refresh = () => cache.invalidateQueries({ queryKey });
  const denial = list.data?.denial;
  const error = denial ?? list.error;
  const webhooks = list.data?.value?.webhooks;

  return (
    <section aria-labelledby="webhooks-heading">
      <h1 id="webhooks-heading">Webhooks</h1>
      {list.isPending && <p role="status">Loading webhooks…</p>}
      {error && (
        <>
          <p role="alert">{webhookError(error, "Could not load webhooks.")}</p>
          {!denial && (
            <Button variant="secondary" pending={list.isFetching} onClick={() => void refresh()}>
              Retry loading webhooks
            </Button>
          )}
        </>
      )}
      {webhooks && (
        <>
          <WebhookForm
            create={async (request) => {
              const created = await client.createWebhook(request);
              setSecret(created.secret);
              void refresh();
            }}
          />
          <WebhookList webhooks={webhooks} client={client} refresh={refresh} />
        </>
      )}
      {secret !== undefined && (
        <SecretOnce
          title="Webhook created"
          secret={secret}
          instructions="Use this signing secret to verify deliveries at your receiver."
          onClose={() => setSecret(undefined)}
        />
      )}
    </section>
  );
}

function formatPing(name: string, d: { ok: boolean; status: number | null; ms: number; error?: string }) {
  return d.ok
    ? `Ping to "${name}" succeeded (${d.status ?? "ok"}, ${d.ms}ms).`
    : `Ping to "${name}" failed (${d.error ?? d.status ?? "error"}, ${d.ms}ms).`;
}

function useWebhookActions(client: Client, refresh: () => Promise<void>) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Listed[number] | null>(null);
  const [pingResult, setPingResult] = useState("");
  const [error, setError] = useState("");
  async function act(id: string, fallback: string, fn: () => Promise<void>) {
    if (busyId) return;
    setError("");
    setBusyId(id);
    try {
      await fn();
    } catch (cause) {
      setError(webhookError(cause, fallback));
    } finally {
      setBusyId(null);
    }
  }
  return {
    busy: busyId !== null,
    selected,
    setSelected,
    pingResult,
    error,
    toggle: (w: Listed[number]) =>
      void act(w.id, "Could not update the webhook.", async () => {
        await client.updateWebhook({ id: w.id, enabled: !w.enabled });
        await refresh();
      }),
    ping: (w: Listed[number]) =>
      void act(w.id, "Could not test the webhook.", async () => {
        setPingResult("");
        const { delivery } = await client.testWebhook({ id: w.id });
        setPingResult(formatPing(w.name, delivery));
      }),
    remove: (w: Listed[number]) => {
      if (!window.confirm(`Delete webhook "${w.name}"?`)) return;
      void act(w.id, "Could not delete the webhook.", async () => {
        await client.deleteWebhook({ id: w.id });
        if (selected?.id === w.id) setSelected(null);
        await refresh();
      });
    },
  };
}

function WebhookList({
  webhooks,
  client,
  refresh,
}: {
  webhooks: Listed;
  client: Client;
  refresh: () => Promise<void>;
}) {
  const actions = useWebhookActions(client, refresh);
  if (webhooks.length === 0) return <p>No webhooks yet.</p>;
  return (
    <>
      {actions.error && <p role="alert">{actions.error}</p>}
      {actions.pingResult && (
        <p className="settings-ping-status" role="status">
          {actions.pingResult}
        </p>
      )}
      <div className="settings-table">
        <Table aria-label="Webhooks">
          <thead>
            <tr>
              <th scope="col">Webhook</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {webhooks.map((w) => (
              <WebhookRow
                key={w.id}
                webhook={w}
                busy={actions.busy}
                showingDeliveries={actions.selected?.id === w.id}
                onToggle={() => actions.toggle(w)}
                onPing={() => actions.ping(w)}
                onToggleDeliveries={() => actions.setSelected((cur) => (cur?.id === w.id ? null : w))}
                onDelete={() => actions.remove(w)}
              />
            ))}
          </tbody>
        </Table>
      </div>
      {actions.selected && (
        <WebhookDeliveriesDrawer webhook={actions.selected} client={client} onClose={() => actions.setSelected(null)} />
      )}
    </>
  );
}

function WebhookRow({
  webhook,
  busy,
  showingDeliveries,
  onToggle,
  onPing,
  onToggleDeliveries,
  onDelete,
}: {
  webhook: Listed[number];
  busy: boolean;
  showingDeliveries: boolean;
  onToggle: () => void;
  onPing: () => void;
  onToggleDeliveries: () => void;
  onDelete: () => void;
}) {
  return (
    <tr>
      <th scope="row">
        {webhook.name}
        <br />
        <code>{webhook.url}</code>
      </th>
      <td className="webhook-status">
        {webhook.enabled ? "Enabled" : "Disabled"}
        {webhook.disabledReason ? ` (${webhook.disabledReason})` : ""}
      </td>
      <td>
        <div className="settings-actions-row">
          <Button variant="secondary" size="small" disabled={busy} onClick={onToggle}>
            {webhook.enabled ? "Disable" : "Enable"}
          </Button>
          <Button variant="secondary" size="small" disabled={busy} onClick={onPing}>
            Test
          </Button>
          <Button variant="secondary" size="small" onClick={onToggleDeliveries}>
            {showingDeliveries ? "Hide deliveries" : "Deliveries"}
          </Button>
          <Button
            variant="danger"
            size="small"
            aria-label={`Delete ${webhook.name}`}
            disabled={busy}
            onClick={onDelete}
          >
            Delete
          </Button>
        </div>
      </td>
    </tr>
  );
}

function WebhookDeliveriesDrawer({
  webhook,
  client,
  onClose,
}: {
  webhook: Listed[number];
  client: Client;
  onClose: () => void;
}) {
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryError, setRetryError] = useState("");
  const query = useQuery({
    queryKey: ["webhook-deliveries", webhook.id],
    queryFn: ({ signal }) => client.listWebhookDeliveries({ id: webhook.id, limit: 50 }, { signal }),
    retry: false,
  });

  async function retry(dl: string) {
    if (retrying) return;
    setRetrying(dl);
    setRetryError("");
    try {
      await client.retryWebhookDelivery({ id: webhook.id, dl });
      await query.refetch();
    } catch (cause) {
      setRetryError(webhookError(cause, "Could not retry delivery."));
    } finally {
      setRetrying(null);
    }
  }

  const deliveries = query.data?.deliveries ?? [];

  return (
    <section className="settings-drawer" aria-label={`Deliveries for ${webhook.name}`}>
      <div className="settings-drawer-head">
        <h2>Deliveries — {webhook.name}</h2>
        <div className="settings-actions-row">
          <Button variant="secondary" size="small" onClick={() => void query.refetch()}>
            Refresh
          </Button>
          <Button variant="secondary" size="small" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      {retryError && <p role="alert">{retryError}</p>}
      {query.isPending && <p role="status">Loading deliveries…</p>}
      {query.isError && <p role="alert">{webhookError(query.error, "Could not load deliveries.")}</p>}
      {!query.isPending && !query.isError && deliveries.length === 0 && <p>No deliveries recorded yet.</p>}
      {deliveries.length > 0 && (
        <DeliveriesTable deliveries={deliveries} retrying={retrying} onRetry={(dl) => void retry(dl)} />
      )}
    </section>
  );
}

function DeliveriesTable({
  deliveries,
  retrying,
  onRetry,
}: {
  deliveries: readonly Delivery[];
  retrying: string | null;
  onRetry: (dl: string) => void;
}) {
  return (
    <div className="settings-table">
      <Table aria-label="Webhook deliveries">
        <thead>
          <tr>
            <th scope="col">ID</th>
            <th scope="col">State</th>
            <th scope="col">Attempts</th>
            <th scope="col">Status / Error</th>
            <th scope="col">Created</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map((d) => (
            <tr key={d.id}>
              <td>
                <code>{d.id}</code>
              </td>
              <td>
                <Badge>{d.state}</Badge>
              </td>
              <td>{d.attempt}</td>
              <td>
                {d.lastStatus ?? "—"}
                {d.lastError ? ` (${d.lastError})` : ""}
              </td>
              <td>
                <time dateTime={d.createdAt}>{new Date(d.createdAt).toLocaleString()}</time>
              </td>
              <td>
                {d.state === "dead" ? (
                  <Button variant="secondary" size="small" disabled={retrying === d.id} onClick={() => onRetry(d.id)}>
                    {retrying === d.id ? "Retrying…" : "Retry"}
                  </Button>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
