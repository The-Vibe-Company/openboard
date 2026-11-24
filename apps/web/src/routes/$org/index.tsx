import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/$org/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/$org/$board", params: { org: params.org, board: "main" }, replace: true });
  },
});
