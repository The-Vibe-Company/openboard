import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { Client } from "@the-vibe-company/openboard";
import { useEffect, useMemo, useState } from "react";
import { boardErrorText, boardKeys } from "../../../api/board.ts";
import { browserClient } from "../../../api/client.ts";
import { followBoardActors, subscribeBoardEvents } from "../../../api/live.ts";
import { Avatar, Badge, EmptyState, Table } from "../../../ui/index.ts";
import "./tasks.css";

export const Route = createFileRoute("/$org/$board/agents")({
  component: BoardAgentsPage,
});

type Actor = Awaited<ReturnType<Client["listActors"]>>["actors"][number];
type ClaimRef = { id: string; channel: string };

function useBoardAgents(org: string, boardSlug: string) {
  const board = useMemo(() => ({ org, board: boardSlug }), [org, boardSlug]);
  const queryClient = useQueryClient();
  const claimedKey = useMemo(() => [...boardKeys.allTasks(board), "claimed-agents"], [board]);
  const actorsQuery = useQuery({
    queryKey: boardKeys.actors(board),
    queryFn: ({ signal }) => browserClient(window.location.origin, board).listActors({}, { signal }),
  });

  const claimedQuery = useQuery({
    queryKey: claimedKey,
    queryFn: ({ signal }) =>
      browserClient(window.location.origin, board).listTasks({ state: "claimed", limit: 100 }, { signal }),
  });

  useEffect(() => {
    const unsubscribe = subscribeBoardEvents(board, (event, invalidate) => {
      if (event.type === "actor.seen" || event.type.startsWith("task.")) {
        invalidate(boardKeys.actors(board));
        invalidate(claimedKey);
      }
    });
    const stopActors = followBoardActors(board, queryClient);
    return () => {
      unsubscribe();
      stopActors();
    };
  }, [board, claimedKey, queryClient]);
  const claimedByActor = useMemo(() => {
    const map = new Map<string, ClaimRef[]>();
    for (const item of claimedQuery.data?.tasks ?? []) {
      const holder = item.message.task?.claim?.actor;
      if (!holder) continue;
      const list = map.get(holder) ?? [];
      list.push({ id: item.message.id, channel: item.message.channel });
      map.set(holder, list);
    }
    return map;
  }, [claimedQuery.data]);

  return { actorsQuery, claimedQuery, claimedByActor };
}

function BoardAgentsPage() {
  const board = Route.useParams();
  const [kindFilter, setKindFilter] = useState<"all" | "agent" | "person">("all");
  const { actorsQuery, claimedQuery, claimedByActor } = useBoardAgents(board.org, board.board);
  const actors = actorsQuery.data?.actors ?? [];
  const filtered = actors.filter((actor) => {
    if (kindFilter === "all") return true;
    return kindFilter === "person" ? actor.kind === "person" : actor.kind !== "person";
  });

  return (
    <section className="board-view" aria-labelledby="board-agents-heading">
      <div className="board-view-head">
        <div>
          <h1 id="board-agents-heading">Agents &amp; Actors</h1>
          <p className="board-view-sub">
            Verified people, connections, and active agent profiles seen on this board (<code>ob actors</code>).
          </p>
        </div>
        <div className="board-view-controls">
          <fieldset className="segmented-toggle" aria-label="Filter actors">
            <button type="button" aria-pressed={kindFilter === "all"} onClick={() => setKindFilter("all")}>
              All ({actors.length})
            </button>
            <button type="button" aria-pressed={kindFilter === "agent"} onClick={() => setKindFilter("agent")}>
              Agents ({actors.filter((a) => a.kind !== "person").length})
            </button>
            <button type="button" aria-pressed={kindFilter === "person"} onClick={() => setKindFilter("person")}>
              People ({actors.filter((a) => a.kind === "person").length})
            </button>
          </fieldset>
          <Link className="org-action-link" to="/$org/$board/settings/connections" params={board}>
            Manage connections →
          </Link>
        </div>
      </div>

      {actorsQuery.isPending && <p role="status">Loading actors…</p>}
      {actorsQuery.isError && <p role="alert">{boardErrorText(actorsQuery.error)}</p>}
      {!actorsQuery.isPending && !actorsQuery.isError && filtered.length === 0 && (
        <EmptyState>
          No actors recorded yet. Connect an agent in{" "}
          <Link to="/$org/$board/settings/connections" params={board}>
            Board Settings → Connections
          </Link>
          .
        </EmptyState>
      )}
      {filtered.length > 0 && claimedQuery.isError && (
        <p role="alert">Could not load active leases. {boardErrorText(claimedQuery.error)}</p>
      )}
      {filtered.length > 0 && <ActorsTable board={board} actors={filtered} claimedByActor={claimedByActor} />}
    </section>
  );
}

function ActorsTable({
  board,
  actors,
  claimedByActor,
}: {
  board: { org: string; board: string };
  actors: readonly Actor[];
  claimedByActor: ReadonlyMap<string, ClaimRef[]>;
}) {
  return (
    <div className="settings-table">
      <Table aria-label="Board actors">
        <thead>
          <tr>
            <th scope="col">Actor</th>
            <th scope="col">Kind</th>
            <th scope="col">Via</th>
            <th scope="col">Active leases</th>
            <th scope="col">Actor ID</th>
          </tr>
        </thead>
        <tbody>
          {actors.map((actor) => {
            const claims = claimedByActor.get(actor.id) ?? [];
            return (
              <tr key={actor.id}>
                <th scope="row">
                  <span className="agent-identity">
                    <Avatar name={actor.name} src={actor.avatar ?? undefined} />
                    <span>
                      {actor.name}
                      {actor.handle && actor.handle !== actor.name && (
                        <>
                          <br />
                          <code>@{actor.handle}</code>
                        </>
                      )}
                    </span>
                  </span>
                </th>
                <td>
                  <Badge>{actor.kind}</Badge>
                </td>
                <td>{actor.via ? <code>{actor.via.name}</code> : "Direct"}</td>
                <td>
                  {claims.length > 0
                    ? claims.map((c) => (
                        <Link
                          key={c.id}
                          className="agent-lease-link"
                          to="/$org/$board/t/$id"
                          params={{ ...board, id: c.id }}
                          search={{ channel: c.channel }}
                        >
                          #{c.id}
                        </Link>
                      ))
                    : "—"}
                </td>
                <td>
                  <code>{actor.id}</code>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
