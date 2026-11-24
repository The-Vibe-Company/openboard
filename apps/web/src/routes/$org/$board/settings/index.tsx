import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/$org/$board/settings/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/$org/$board/settings/connections", params, replace: true });
  },
});
