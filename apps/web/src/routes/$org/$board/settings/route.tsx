import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import "./board-settings.css";

export const Route = createFileRoute("/$org/$board/settings")({
  component: Settings,
});

const tabs = [
  ["Connections", "/$org/$board/settings/connections"],
  ["Grants", "/$org/$board/settings/grants"],
  ["Webhooks", "/$org/$board/settings/webhooks"],
  ["Inbound", "/$org/$board/settings/inbound"],
  ["Schemas", "/$org/$board/settings/schemas"],
  ["Watchers", "/$org/$board/settings/watchers"],
  ["Audit", "/$org/$board/settings/audit"],
] as const;

function Settings() {
  const params = Route.useParams();
  return (
    <div className="board-settings">
      <nav aria-label="Board settings">
        {tabs.map(([label, to]) => (
          <Link key={to} to={to} params={params} activeOptions={{ exact: true, includeSearch: false }}>
            {label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
