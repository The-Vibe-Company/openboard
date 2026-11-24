import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/$org/")({
  beforeLoad: ({ params }) => {
    // Dedicated front routes are reserved even before their pages ship.
    if (["account", "device", "invite", "new", "signin"].includes(params.org)) throw notFound();
    throw redirect({ to: "/$org/$board", params: { org: params.org, board: "main" }, replace: true });
  },
});
