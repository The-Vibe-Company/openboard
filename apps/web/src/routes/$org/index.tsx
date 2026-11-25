import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { BoardError, createClient } from "@the-vibe-company/openboard";
import { browserClient } from "../../api/client.ts";
import { ArrowRightIcon, Card, EmptyState, PlusIcon, SettingsIcon } from "../../ui/index.ts";
import "./org.css";

export const Route = createFileRoute("/$org/")({
  beforeLoad: ({ params }) => {
    // Dedicated front routes are reserved even before their pages ship.
    if (["account", "device", "invite", "new", "signin"].includes(params.org)) throw notFound();
  },
  loader: async ({ params, abortController }) => {
    const origin = window.location.origin;
    const signal = abortController.signal;
    if (params.org === "local") {
      // The implicit local board has no account membership. Only local mode serves the /api alias.
      await createClient({ url: new URL("/api", origin).href }).discoverBoard({}, { signal });
      return { name: "Local", boards: [{ slug: "main", name: "Main" }], isLocal: true };
    }
    const client = browserClient(origin);
    const [{ memberships }, { boards }] = await Promise.all([
      client.getAccount({}, { signal }),
      client.listBoards({ org: params.org }, { signal }),
    ]);
    const membership = memberships.find(({ org }) => org.slug === params.org);
    if (!membership) throw notFound();
    return { name: membership.org.name, boards, isLocal: false };
  },
  component: Organization,
  pendingComponent: () => <p role="status">Loading boards…</p>,
  errorComponent: ({ error }) => (
    <p role="alert">{error instanceof BoardError ? error.message : "Could not load organization."}</p>
  ),
});

function Organization() {
  const { org } = Route.useParams();
  const { name, boards, isLocal } = Route.useLoaderData();
  return (
    <main className="organization-overview">
      <div className="org-header">
        <div>
          <h1>{name}</h1>
          <span className="org-slug">/{org}</span>
        </div>
        {!isLocal && (
          <div className="org-header-actions">
            <Link className="org-action-link" to="/$org/settings/boards" params={{ org }}>
              <PlusIcon /> Manage boards
            </Link>
            <Link className="org-action-link" to="/$org/settings" params={{ org }}>
              <SettingsIcon /> Org settings
            </Link>
          </div>
        )}
      </div>
      <section aria-labelledby="organization-boards">
        <h2 id="organization-boards">Boards</h2>
        {boards.length === 0 ? (
          <EmptyState>No boards yet.</EmptyState>
        ) : (
          <ul>
            {boards.map((board) => (
              <li key={board.slug}>
                <Link to="/$org/$board" params={{ org, board: board.slug }}>
                  <Card className="org-board-card">
                    <div>
                      <h3>{board.name}</h3>
                      <code>
                        {org}/{board.slug}
                      </code>
                    </div>
                    <div className="org-board-card-foot">
                      <span>Open board</span>
                      <ArrowRightIcon />
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
