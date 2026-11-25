import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BoardError, type Client } from "@the-vibe-company/openboard";
import { browserClient } from "../../../../api/client.ts";
import { sessionQuery } from "../../../../api/session.ts";
import { Badge, EmptyState, Table } from "../../../../ui/index.ts";

export const Route = createFileRoute("/$org/$board/settings/watchers")({
  component: WatchersRoute,
});

type WatcherReg = Awaited<ReturnType<Client["listWatchers"]>>["watchers"][number];

function WatchersRoute() {
  const { org, board } = Route.useParams();
  const session = useQuery(sessionQuery);
  const { person, csrf } = session.data ?? {};
  if (session.isPending) return <p role="status">Loading session…</p>;
  if (!person || !csrf) return <p role="alert">Sign in to inspect board watchers.</p>;
  return <WatchersPanel org={org} board={board} csrf={csrf} principal={person.principal} />;
}

function WatchersPanel({
  org,
  board,
  csrf,
  principal,
}: {
  org: string;
  board: string;
  csrf: string;
  principal: string;
}) {
  const query = useQuery({
    queryKey: ["board", org, board, "watchers", principal],
    queryFn: ({ signal }) => browserClient(window.location.origin, { org, board, csrf }).listWatchers({}, { signal }),
    retry: false,
  });

  const watchers = query.data?.watchers ?? [];

  return (
    <section aria-labelledby="watchers-heading">
      <h1 id="watchers-heading">Watchers</h1>
      <p className="settings-panel-sub">
        Active watcher registrations listening for matching events across channels and labels.
      </p>
      {query.isPending && <p role="status">Loading watchers…</p>}
      {query.isError && (
        <p role="alert">{query.error instanceof BoardError ? query.error.message : "Could not load watchers."}</p>
      )}
      {!query.isPending && !query.isError && watchers.length === 0 && (
        <EmptyState>No watcher registrations active on this board.</EmptyState>
      )}
      {watchers.length > 0 && <WatchersTable watchers={watchers} />}
    </section>
  );
}

function WatchersTable({ watchers }: { watchers: readonly WatcherReg[] }) {
  return (
    <div className="settings-table">
      <Table aria-label="Board watchers">
        <thead>
          <tr>
            <th scope="col">Owner</th>
            <th scope="col">Watches</th>
            <th scope="col">Sync targets</th>
            <th scope="col">Hash</th>
          </tr>
        </thead>
        <tbody>
          {watchers.map((reg) => {
            const entries = Object.entries(reg.watch);
            return (
              <tr key={`${reg.owner}-${reg.hash}`}>
                <th scope="row">
                  <code>{reg.owner}</code>
                </th>
                <td>
                  {entries.length === 0
                    ? "—"
                    : entries.map(([name, spec]) => (
                        <div key={name}>
                          <strong>{name}</strong>: <code>{spec.tail}</code>
                        </div>
                      ))}
                </td>
                <td>
                  {reg.sync.length === 0
                    ? "—"
                    : reg.sync.map((s) => (
                        <Badge key={`${s.platform}-${s.key}`}>
                          {s.platform}:{s.key}
                        </Badge>
                      ))}
                </td>
                <td>
                  <code>{reg.hash.slice(0, 12)}</code>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
