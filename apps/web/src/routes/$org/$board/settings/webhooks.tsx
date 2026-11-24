import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BoardError, type Client } from "@the-vibe-company/openboard";
import { useState } from "react";
import { browserClient } from "../../../../api/client.ts";
import { sessionQuery } from "../../../../api/session.ts";
import { webhookError } from "../../../../api/webhooks.ts";
import { SecretOnce } from "../../../../components/SecretOnce.tsx";
import { WebhookForm } from "../../../../components/WebhookForm.tsx";
import { Button, Table } from "../../../../ui/index.ts";

export const Route = createFileRoute("/$org/$board/settings/webhooks")({
  component: WebhooksRoute,
});

type Listed = Awaited<ReturnType<Client["listWebhooks"]>>["webhooks"];

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

function WebhookList({
  webhooks,
  client,
  refresh,
}: {
  webhooks: Listed;
  client: Client;
  refresh: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  async function remove({ id, name }: Listed[number]) {
    if (deleting || !window.confirm(`Delete webhook "${name}"?`)) return;
    setError("");
    setDeleting(true);
    try {
      await client.deleteWebhook({ id });
      await refresh();
    } catch (error) {
      setError(webhookError(error, "Could not delete the webhook."));
    } finally {
      setDeleting(false);
    }
  }

  if (webhooks.length === 0) return <p>No webhooks yet.</p>;
  return (
    <>
      {error && <p role="alert">{error}</p>}
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
            {webhooks.map((webhook) => (
              <tr key={webhook.id}>
                <th scope="row">
                  {webhook.name}
                  <br />
                  <code>{webhook.url}</code>
                </th>
                <td className="webhook-status">{webhook.enabled ? "Enabled" : "Disabled"}</td>
                <td>
                  <Button
                    variant="danger"
                    size="small"
                    aria-label={`Delete ${webhook.name}`}
                    disabled={deleting}
                    onClick={() => void remove(webhook)}
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </>
  );
}
