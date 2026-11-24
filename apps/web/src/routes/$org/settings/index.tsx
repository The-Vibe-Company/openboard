import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";
import { Card } from "../../../ui/index.ts";

export const Route = createFileRoute("/$org/settings/")({
  component: GeneralSettings,
});

const settingsRoute = getRouteApi("/$org/settings");

function GeneralSettings() {
  const { org } = settingsRoute.useLoaderData();
  return (
    <Card>
      <h2>General</h2>
      <dl>
        <dt>Organization slug</dt>
        <dd>
          <code>{org.slug}</code>
        </dd>
      </dl>
      <section aria-labelledby="settings-boards">
        <h3 id="settings-boards">Boards</h3>
        <p>
          <Link to="/$org/settings/boards" params={{ org: org.slug }}>
            View boards
          </Link>
        </p>
      </section>
    </Card>
  );
}
