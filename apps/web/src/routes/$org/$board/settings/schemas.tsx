import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BoardError, type Client } from "@the-vibe-company/openboard";
import { type FormEvent, useId, useState } from "react";
import { browserClient } from "../../../../api/client.ts";
import { sessionQuery } from "../../../../api/session.ts";
import { Badge, Button, EmptyState, Input, Table, Textarea } from "../../../../ui/index.ts";

export const Route = createFileRoute("/$org/$board/settings/schemas")({
  component: SchemasRoute,
});

type SchemaItem = Awaited<ReturnType<Client["listSchemas"]>>["schemas"][number];

const DEFAULT_SCHEMA = JSON.stringify(
  {
    type: "object",
    properties: {
      summary: { type: "string" },
      severity: { type: "string", enum: ["low", "medium", "high"] },
    },
    required: ["summary"],
    additionalProperties: false,
  },
  null,
  2,
);

function SchemasRoute() {
  const { org, board } = Route.useParams();
  return <SchemasPanel key={`${org}/${board}`} org={org} board={board} />;
}

function SchemasPanel({ org, board }: { org: string; board: string }) {
  const session = useQuery(sessionQuery);
  const client = browserClient(window.location.origin, { org, board, csrf: session.data?.csrf ?? undefined });
  const cache = useQueryClient();
  const queryKey = ["board", org, board, "schemas"];
  const query = useQuery({ queryKey, queryFn: ({ signal }) => client.listSchemas({}, { signal }) });

  const [selected, setSelected] = useState<SchemaItem | null>(null);
  const [creating, setCreating] = useState(false);
  const schemas = query.data?.schemas ?? [];

  return (
    <section aria-labelledby="schemas-heading">
      <div className="settings-drawer-head">
        <h1 id="schemas-heading">Schemas</h1>
        {session.data?.signedIn && (
          <Button size="small" onClick={() => setCreating((cur) => !cur)}>
            {creating ? "Cancel" : "Register schema"}
          </Button>
        )}
      </div>
      <p className="settings-panel-sub">
        Built-in and board-registered JSON schemas for structured fenced message payloads (<code>ob schemas</code>).
      </p>
      {creating && (
        <CreateSchemaForm
          client={client}
          onCreated={() => {
            setCreating(false);
            void cache.invalidateQueries({ queryKey });
          }}
        />
      )}
      {query.isPending && <p role="status">Loading schemas…</p>}
      {query.isError && <p role="alert">Could not load schemas.</p>}
      {!query.isPending && !query.isError && schemas.length === 0 && (
        <EmptyState>No schemas registered on this board.</EmptyState>
      )}
      {schemas.length > 0 && (
        <SchemasTable
          schemas={schemas}
          selectedId={selected?.id ?? null}
          onSelect={(schema) => setSelected((cur) => (cur?.id === schema.id ? null : schema))}
        />
      )}
      {selected && (
        <section className="settings-drawer" aria-label={`Schema ${selected.id}`}>
          <div className="settings-drawer-head">
            <h2>
              <code>{selected.id}</code>
            </h2>
            <Button variant="secondary" size="small" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
          {selected.description && <p className="settings-panel-sub">{selected.description}</p>}
          <pre className="settings-json">{JSON.stringify(selected.schema, null, 2)}</pre>
        </section>
      )}
    </section>
  );
}

function SchemasTable({
  schemas,
  selectedId,
  onSelect,
}: {
  schemas: readonly SchemaItem[];
  selectedId: string | null;
  onSelect: (schema: SchemaItem) => void;
}) {
  return (
    <div className="settings-table">
      <Table aria-label="Board schemas">
        <thead>
          <tr>
            <th scope="col">ID</th>
            <th scope="col">Origin</th>
            <th scope="col">Description</th>
            <th scope="col">Inspect</th>
          </tr>
        </thead>
        <tbody>
          {schemas.map((schema) => (
            <tr key={schema.id}>
              <th scope="row">
                <code>{schema.id}</code>
              </th>
              <td>
                <Badge>{schema.builtIn ? "Built-in" : "Custom"}</Badge>
              </td>
              <td>{schema.description ?? "—"}</td>
              <td>
                <Button variant="secondary" size="small" onClick={() => onSelect(schema)}>
                  {selectedId === schema.id ? "Hide JSON" : "Inspect"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function parseSchemaDefinition(definition: string): Record<string, unknown> {
  const schema: unknown = JSON.parse(definition);
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new Error("Schema definition must be a JSON object.");
  }
  return schema as Record<string, unknown>;
}

function CreateSchemaForm({ client, onCreated }: { client: Client; onCreated: () => void }) {
  const id = useId();
  const [name, setName] = useState("");
  const [version, setVersion] = useState("1");
  const [description, setDescription] = useState("");
  const [definition, setDefinition] = useState(DEFAULT_SCHEMA);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await client.createSchema({
        name: name.trim(),
        version: Number.parseInt(version, 10) || 1,
        ...(description.trim() ? { description: description.trim() } : {}),
        schema: parseSchemaDefinition(definition),
      });
      onCreated();
    } catch (cause) {
      setError(
        cause instanceof BoardError ? cause.message : cause instanceof Error ? cause.message : "Invalid schema.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="settings-form-card" onSubmit={submit}>
      <div className="settings-form-grid">
        <div>
          <label htmlFor={`${id}-nm`}>Schema name</label>
          <Input
            id={`${id}-nm`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="incident-report"
            required
          />
        </div>
        <div>
          <label htmlFor={`${id}-vr`}>Version</label>
          <Input
            id={`${id}-vr`}
            type="number"
            min={1}
            max={99999}
            value={version}
            onChange={(e) => setVersion(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${id}-ds`}>Description</label>
          <Input
            id={`${id}-ds`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional summary"
          />
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-df`}>JSON Schema definition</label>
        <Textarea id={`${id}-df`} value={definition} onChange={(e) => setDefinition(e.target.value)} rows={8} />
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="settings-actions-row">
        <Button type="submit" pending={busy}>
          Register immutable version
        </Button>
      </div>
    </form>
  );
}
