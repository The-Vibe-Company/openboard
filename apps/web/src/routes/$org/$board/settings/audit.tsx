import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BoardError, type Client } from "@the-vibe-company/openboard";
import { useState } from "react";
import { browserClient } from "../../../../api/client.ts";
import { sessionQuery } from "../../../../api/session.ts";
import { Badge, Button, EmptyState, Table } from "../../../../ui/index.ts";

export const Route = createFileRoute("/$org/$board/settings/audit")({
  component: BoardAuditRoute,
});

type AuditItem = Awaited<ReturnType<Client["readBoardAudit"]>>["events"][number];

function BoardAuditRoute() {
  const { org, board } = Route.useParams();
  const session = useQuery(sessionQuery);
  const { person, csrf } = session.data ?? {};
  if (session.isPending) return <p role="status">Loading session…</p>;
  if (!person || !csrf) return <p role="alert">Sign in to inspect the board audit log.</p>;
  return <BoardAuditPanel org={org} board={board} csrf={csrf} principal={person.principal} />;
}

function BoardAuditPanel({
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
  const [after, setAfter] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState<string | null>(null);
  const client = browserClient(window.location.origin, { org, board, csrf });

  const query = useQuery({
    queryKey: ["board", org, board, "audit", principal, after ?? "start"],
    queryFn: ({ signal }) => client.readBoardAudit({ ...(after ? { after } : {}), limit: 50 }, { signal }),
    retry: false,
  });

  const events: AuditItem[] = query.data?.events ?? [];
  const nextCursor = query.data?.cursor;

  return (
    <section aria-labelledby="board-audit-heading">
      <div className="settings-drawer-head">
        <h1 id="board-audit-heading">Audit log</h1>
        <div className="settings-actions-row">
          {after && (
            <Button variant="secondary" size="small" onClick={() => setAfter(undefined)}>
              First page
            </Button>
          )}
          <Button variant="secondary" size="small" onClick={() => void query.refetch()}>
            Refresh
          </Button>
        </div>
      </div>
      <p className="settings-panel-sub">
        Administrative changes on this board — connections, agents, grants, webhooks, inbound rules, schedules, and
        schemas (<code>ob audit</code>).
      </p>
      {query.isPending && <p role="status">Loading audit log…</p>}
      {query.isError && (
        <p role="alert">
          {query.error instanceof BoardError ? query.error.message : "Could not load the board audit log."}
        </p>
      )}
      {!query.isPending && !query.isError && events.length === 0 && (
        <EmptyState>No audit events recorded yet.</EmptyState>
      )}
      {events.length > 0 && (
        <AuditTable
          events={events}
          expanded={expanded}
          onToggle={(cursor) => setExpanded((cur) => (cur === cursor ? null : cursor))}
          nextCursor={nextCursor && events.length >= 50 ? nextCursor : undefined}
          onNextPage={(cursor) => setAfter(cursor)}
        />
      )}
    </section>
  );
}

function AuditTable({
  events,
  expanded,
  onToggle,
  nextCursor,
  onNextPage,
}: {
  events: readonly AuditItem[];
  expanded: string | null;
  onToggle: (cursor: string) => void;
  nextCursor?: string;
  onNextPage: (cursor: string) => void;
}) {
  return (
    <>
      <div className="settings-table">
        <Table aria-label="Board audit log">
          <thead>
            <tr>
              <th scope="col">Event</th>
              <th scope="col">Actor</th>
              <th scope="col">Timestamp</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr key={ev.cursor}>
                <th scope="row">
                  <Badge>{ev.type}</Badge>
                </th>
                <td>
                  <code>{ev.actor}</code>
                </td>
                <td>
                  <time dateTime={ev.createdAt}>{new Date(ev.createdAt).toLocaleString()}</time>
                </td>
                <td>
                  <Button variant="secondary" size="small" onClick={() => onToggle(ev.cursor)}>
                    {expanded === ev.cursor ? "Hide" : "Payload"}
                  </Button>
                  {expanded === ev.cursor && <pre className="settings-json">{JSON.stringify(ev.payload, null, 2)}</pre>}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      {nextCursor && (
        <div className="settings-actions-row">
          <Button variant="secondary" size="small" onClick={() => onNextPage(nextCursor)}>
            Next page →
          </Button>
        </div>
      )}
    </>
  );
}
