import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Header } from "../components/Header.tsx";

// File-route CSS side effects otherwise stay in the eager route tree.
const loadTaskStyles = () => import("./$org/$board/tasks.css");
const loadBoardSettingsStyles = () => import("./$org/$board/settings/board-settings.css");
const routeStyles: Readonly<Record<string, (() => Promise<unknown>) | undefined>> = {
  "/$org/": () => import("./$org/org.css"),
  "/$org/settings": () => import("./$org/settings/settings.css"),
  "/$org/settings/members": () => import("./$org/settings/members.css"),
  "/$org/$board": () => import("./$org/$board/shell.css"),
  "/$org/$board/": () => import("./$org/$board/channel.css"),
  "/$org/$board/tasks": loadTaskStyles,
  "/$org/$board/activity": loadTaskStyles,
  "/$org/$board/agents": loadTaskStyles,
  "/$org/$board/schedules": loadTaskStyles,
  "/$org/$board/t/$id": () => import("./$org/$board/t/thread.css"),
  "/$org/$board/settings": loadBoardSettingsStyles,
  "/$org/$board/guide": loadBoardSettingsStyles,
};

export const Route = createRootRoute({
  beforeLoad: async ({ matches }) => {
    await Promise.all(matches.map(({ routeId }) => routeStyles[routeId]?.()));
  },
  component: () => (
    <>
      <Header />
      <Outlet />
    </>
  ),
});
