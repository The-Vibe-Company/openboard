import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/$org/settings/")({
  component: GeneralSettings,
});

function GeneralSettings() {
  const { org } = Route.useParams();
  return (
    <section aria-labelledby="settings-boards">
      <h2 id="settings-boards">Boards</h2>
      <a href={`/${encodeURIComponent(org)}/settings/boards`}>View boards</a>
    </section>
  );
}
