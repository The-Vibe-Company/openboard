import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BoardError, type Client } from "@the-vibe-company/openboard";
import { type FormEvent, useId, useState } from "react";
import { browserClient } from "../../../../api/client.ts";
import { sessionQuery } from "../../../../api/session.ts";
import { SecretOnce } from "../../../../components/SecretOnce.tsx";
import { Badge, Button, EmptyState, Input, Select, Table, Textarea } from "../../../../ui/index.ts";

export const Route = createFileRoute("/$org/$board/settings/inbound")({
  component: InboundRoute,
});

type InboundItem = Awaited<ReturnType<Client["listInbound"]>>["inbound"][number];

const DEFAULT_RULES = JSON.stringify(
  [{ when: { "body.action": "opened" }, do: [{ reply: "Inbound event received." }] }],
  null,
  2,
);

function formatError(error: unknown, fallback: string) {
  return error instanceof BoardError ? error.message : error instanceof Error ? error.message : fallback;
}

function InboundRoute() {
  const { org, board } = Route.useParams();
  const session = useQuery(sessionQuery);
  const { person, csrf } = session.data ?? {};
  if (session.isPending) return <p role="status">Loading session…</p>;
  if (!person || !csrf) return <p role="alert">Sign in to manage inbound endpoints.</p>;
  return (
    <InboundPage
      key={JSON.stringify([org, board, person.principal, csrf])}
      client={browserClient(window.location.origin, { org, board, csrf })}
      queryKey={["board", org, board, "inbound", person.principal]}
    />
  );
}

function useInboundList(client: Client, queryKey: string[]) {
  return useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      try {
        return { value: await client.listInbound({}, { signal }) };
      } catch (error) {
        if (error instanceof BoardError && [401, 403, 404].includes(error.status)) return { denial: error };
        throw error;
      }
    },
    retry: false,
  });
}

function InboundPage({ client, queryKey }: { client: Client; queryKey: string[] }) {
  const cache = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string>();
  const [selected, setSelected] = useState<InboundItem | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const list = useInboundList(client, queryKey);
  const refresh = () => cache.invalidateQueries({ queryKey });
  const error = list.data?.denial ?? list.error;
  const items = list.data?.value?.inbound;

  async function remove(item: InboundItem) {
    if (deleting || !window.confirm(`Delete inbound endpoint "${item.name}"?`)) return;
    setDeleting(item.id);
    setActionError("");
    try {
      await client.deleteInbound({ id: item.id });
      if (selected?.id === item.id) setSelected(null);
      await refresh();
    } catch (cause) {
      setActionError(formatError(cause, "Could not delete inbound endpoint."));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <section aria-labelledby="inbound-heading">
      <div className="settings-drawer-head">
        <h1 id="inbound-heading">Inbound endpoints</h1>
        {items && (
          <Button size="small" onClick={() => setCreating((cur) => !cur)}>
            {creating ? "Cancel" : "New inbound endpoint"}
          </Button>
        )}
      </div>
      <p className="settings-panel-sub">
        Signed HTTP receivers that route external payloads into board replies, labels, reactions, or task actions.
      </p>
      {list.isPending && <p role="status">Loading inbound endpoints…</p>}
      {error && <p role="alert">{formatError(error, "Could not load inbound endpoints.")}</p>}
      {actionError && <p role="alert">{actionError}</p>}
      {creating && (
        <InboundForm
          client={client}
          onCreated={(createdSecret) => {
            setCreating(false);
            if (createdSecret) setSecret(createdSecret);
            void refresh();
          }}
        />
      )}
      {items && items.length === 0 && !creating && <EmptyState>No inbound endpoints configured yet.</EmptyState>}
      {items && items.length > 0 && (
        <InboundTable
          items={items}
          selectedId={selected?.id ?? null}
          deleting={deleting}
          onSelect={(item) => setSelected((cur) => (cur?.id === item.id ? null : item))}
          onDelete={(item) => void remove(item)}
        />
      )}
      {selected && <InboundReceivedDrawer item={selected} client={client} onClose={() => setSelected(null)} />}
      {secret !== undefined && (
        <SecretOnce
          title="Inbound endpoint created"
          secret={secret}
          instructions="Configure your external sender with this verification secret."
          onClose={() => setSecret(undefined)}
        />
      )}
    </section>
  );
}

function InboundTable({
  items,
  selectedId,
  deleting,
  onSelect,
  onDelete,
}: {
  items: readonly InboundItem[];
  selectedId: string | null;
  deleting: string | null;
  onSelect: (item: InboundItem) => void;
  onDelete: (item: InboundItem) => void;
}) {
  return (
    <div className="settings-table">
      <Table aria-label="Inbound endpoints">
        <thead>
          <tr>
            <th scope="col">Endpoint</th>
            <th scope="col">Verify</th>
            <th scope="col">Rules</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <th scope="row">
                {item.name}
                <br />
                <code>{item.url}</code>
              </th>
              <td>
                <Badge>{item.verify.preset ?? item.verify.algorithm ?? "hmac"}</Badge>
              </td>
              <td>{item.rules.length}</td>
              <td>
                <div className="settings-actions-row">
                  <Button variant="secondary" size="small" onClick={() => onSelect(item)}>
                    {selectedId === item.id ? "Hide receipts" : "Received"}
                  </Button>
                  <Button variant="danger" size="small" disabled={deleting === item.id} onClick={() => onDelete(item)}>
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

type InboundDraft = {
  name: string;
  channel: string;
  threadFrom: string;
  threadPattern: string;
  preset: string;
  rulesJson: string;
};

function InboundFields({
  id,
  draft,
  onChange,
}: {
  id: string;
  draft: InboundDraft;
  onChange: (patch: Partial<InboundDraft>) => void;
}) {
  return (
    <>
      <div className="settings-form-grid">
        <div>
          <label htmlFor={`${id}-name`}>Name</label>
          <Input
            id={`${id}-name`}
            value={draft.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="github-pr"
            required
          />
        </div>
        <div>
          <label htmlFor={`${id}-ch`}>Allowed channel</label>
          <Input
            id={`${id}-ch`}
            value={draft.channel}
            onChange={(e) => onChange({ channel: e.target.value })}
            placeholder="general or *"
          />
        </div>
        <div>
          <label htmlFor={`${id}-pr`}>Signing preset</label>
          <Select id={`${id}-pr`} value={draft.preset} onChange={(e) => onChange({ preset: e.target.value })}>
            <option value="standard-webhooks">standard-webhooks</option>
            <option value="github">github</option>
            <option value="stripe">stripe</option>
            <option value="ts-id-body">ts-id-body</option>
          </Select>
        </div>
        <div>
          <label htmlFor={`${id}-fr`}>Thread selector path</label>
          <Input
            id={`${id}-fr`}
            value={draft.threadFrom}
            onChange={(e) => onChange({ threadFrom: e.target.value })}
            placeholder="body.thread"
          />
        </div>
        <div>
          <label htmlFor={`${id}-pt`}>Thread regex pattern</label>
          <Input
            id={`${id}-pt`}
            value={draft.threadPattern}
            onChange={(e) => onChange({ threadPattern: e.target.value })}
            placeholder="(\d+)"
          />
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-rl`}>Rules (JSON array)</label>
        <Textarea
          id={`${id}-rl`}
          value={draft.rulesJson}
          onChange={(e) => onChange({ rulesJson: e.target.value })}
          rows={6}
        />
      </div>
    </>
  );
}

function InboundForm({ client, onCreated }: { client: Client; onCreated: (secret?: string) => void }) {
  const id = useId();
  const [draft, setDraft] = useState<InboundDraft>({
    name: "",
    channel: "general",
    threadFrom: "body.thread",
    threadPattern: "(\\d+)",
    preset: "standard-webhooks",
    rulesJson: DEFAULT_RULES,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const created = await client.createInbound({
        name: draft.name.trim(),
        can: { [draft.channel.trim() || "*"]: ["read", "post"] },
        thread: { from: draft.threadFrom.trim(), pattern: draft.threadPattern.trim() },
        verify: { preset: draft.preset },
        rules: JSON.parse(draft.rulesJson),
      });
      onCreated(created.secret);
    } catch (cause) {
      setError(formatError(cause, "Could not create inbound endpoint."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="settings-form-card" onSubmit={submit}>
      <InboundFields id={id} draft={draft} onChange={(patch) => setDraft((cur) => ({ ...cur, ...patch }))} />
      {error && <p role="alert">{error}</p>}
      <div className="settings-actions-row">
        <Button type="submit" pending={busy}>
          Create inbound endpoint
        </Button>
      </div>
    </form>
  );
}

function InboundReceivedDrawer({ item, client, onClose }: { item: InboundItem; client: Client; onClose: () => void }) {
  const query = useQuery({
    queryKey: ["inbound-received", item.id],
    queryFn: ({ signal }) => client.listInboundReceived({ id: item.id, limit: 50 }, { signal }),
    retry: false,
  });
  const events = query.data?.events ?? [];

  return (
    <section className="settings-drawer" aria-label={`Received events for ${item.name}`}>
      <div className="settings-drawer-head">
        <h2>Received — {item.name}</h2>
        <div className="settings-actions-row">
          <Button variant="secondary" size="small" onClick={() => void query.refetch()}>
            Refresh
          </Button>
          <Button variant="secondary" size="small" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      {query.isPending && <p role="status">Loading receipts…</p>}
      {query.isError && <p role="alert">{formatError(query.error, "Could not load received events.")}</p>}
      {!query.isPending && events.length === 0 && <p>No received events in the last 7 days.</p>}
      {events.length > 0 && (
        <div className="settings-table">
          <Table aria-label="Inbound receipts">
            <thead>
              <tr>
                <th scope="col">Event ID</th>
                <th scope="col">Status</th>
                <th scope="col">Matched rules</th>
                <th scope="col">At</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.eventId}>
                  <td>
                    <code>{ev.eventId}</code>
                  </td>
                  <td>
                    <Badge>{ev.status}</Badge>
                  </td>
                  <td>{ev.matched.length ? ev.matched.join(", ") : "None"}</td>
                  <td>
                    <time dateTime={ev.at}>{new Date(ev.at).toLocaleString()}</time>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </section>
  );
}
