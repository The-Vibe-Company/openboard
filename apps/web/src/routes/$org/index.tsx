import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { BoardError, createClient } from "@the-vibe-company/openboard";
import { browserClient } from "../../api/client.ts";
import { Card, EmptyState } from "../../ui/index.ts";
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
      return { name: "Local", boards: [{ slug: "main", name: "Main" }] };
    }
    const client = browserClient(origin);
    const [{ memberships }, { boards }] = await Promise.all([
      client.getAccount({}, { signal }),
      client.listBoards({ org: params.org }, { signal }),
    ]);
    const membership = memberships.find(({ org }) => org.slug === params.org);
    if (!membership) throw notFound();
    return { name: membership.org.name, boards };
  },
  component: Organization,
  pendingComponent: () => <p role="status">Loading boards…</p>,
  errorComponent: ({ error }) => (
    <p role="alert">{error instanceof BoardError ? error.message : "Could not load organization."}</p>
  ),
});

function Organization() {
  const { org } = Route.useParams();
  const { name, boards } = Route.useLoaderData();
  return (
    <main className="organization-overview">
      <h1>{name}</h1>
      <section aria-labelledby="organization-boards">
        <h2 id="organization-boards">Boards</h2>
        {boards.length === 0 ? (
          <EmptyState>No boards yet.</EmptyState>
        ) : (
          <ul>
            {boards.map((board) => (
              <li key={board.slug}>
                <Link to="/$org/$board" params={{ org, board: board.slug }}>
                  <Card>
                    <h3>{board.name}</h3>
                    <code>{board.slug}</code>
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
