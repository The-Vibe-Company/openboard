import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { BoardError } from "@the-vibe-company/openboard";
import { browserClient } from "../../../api/client.ts";
import "./settings.css";

export const Route = createFileRoute("/$org/settings")({
  loader: async ({ params, abortController }) => {
    const client = browserClient(window.location.origin);
    const account = await client.getAccount({}, { signal: abortController.signal });
    const membership = account.memberships.find(({ org }) => org.slug === params.org);
    if (!membership) throw new BoardError("not_found", "Organization not found");
    return membership;
  },
  component: OrganizationSettings,
  pendingComponent: () => <p role="status">Loading organization settings…</p>,
  errorComponent: ({ error }) => (
    <p role="alert">{error instanceof BoardError ? error.message : "Could not load organization settings."}</p>
  ),
});

function OrganizationSettings() {
  const { org } = Route.useLoaderData();
  const params = { org: org.slug };
  const exact = { exact: true, includeSearch: false };

  return (
    <main className="organization-settings">
      <h1>{org.name}</h1>
      <div className="settings-layout">
        <nav aria-label="Organization settings" className="settings-tabs">
          <Link to="/$org/settings" params={params} activeOptions={exact}>
            General
          </Link>
          <Link to="/$org/settings/members" params={params} activeOptions={exact}>
            Members
          </Link>
          <Link to="/$org/settings/boards" params={params} activeOptions={exact}>
            Boards
          </Link>
        </nav>
        <div className="settings-content">
          <Outlet />
        </div>
      </div>
    </main>
  );
}
