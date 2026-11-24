import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
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
  const { pathname } = useLocation();
  const base = `/${encodeURIComponent(org.slug)}/settings`;
  const links = [
    { label: "General", href: base },
    { label: "Members", href: `${base}/members` },
    { label: "Boards", href: `${base}/boards` },
  ];

  return (
    <main className="organization-settings">
      <h1>{org.name}</h1>
      <nav aria-label="Organization settings">
        {links.map(({ href, label }) => (
          <a key={href} href={href} aria-current={pathname.replace(/\/$/, "") === href ? "page" : undefined}>
            {label}
          </a>
        ))}
      </nav>
      <Outlet />
    </main>
  );
}
