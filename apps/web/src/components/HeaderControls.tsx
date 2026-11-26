import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { boardsQuery, organizationsQuery } from "../api/orgs.ts";
import { closeSwitcher, Switcher } from "./Switcher.tsx";

export { UserMenu } from "./UserMenu.tsx";

export function OrganizationSwitcher({ org, principal }: { org: string; principal: string }) {
  const account = useQuery(organizationsQuery(principal));
  return (
    <Switcher label={`Switch organization: ${org}`} trigger={<SwitcherLabel slug={org} />}>
      {account.isPending && <p role="status">Loading organizations…</p>}
      {account.isError && <p role="alert">Could not load organizations.</p>}
      {!account.isError &&
        account.data?.memberships.map(({ org: organization }) => (
          <Link
            key={organization.slug}
            to="/$org"
            params={{ org: organization.slug }}
            onClick={closeSwitcher}
            aria-current={organization.slug === org ? "true" : undefined}
          >
            {organization.name}
          </Link>
        ))}
    </Switcher>
  );
}

export function BoardSwitcher({ org, board, principal }: { org: string; board: string; principal: string }) {
  const boards = useQuery(boardsQuery(principal, org));
  return (
    <Switcher label={`Switch board: ${board}`} trigger={<SwitcherLabel slug={board} />}>
      {boards.isPending && <p role="status">Loading boards…</p>}
      {boards.isError && <p role="alert">Could not load boards.</p>}
      {!boards.isError &&
        boards.data?.boards.map((entry) => (
          <Link
            key={entry.slug}
            to="/$org/$board"
            params={{ org, board: entry.slug }}
            search={{}}
            onClick={closeSwitcher}
            aria-current={entry.slug === board ? "true" : undefined}
          >
            {entry.name}
          </Link>
        ))}
      <Link to="/$org/settings/boards" params={{ org }} onClick={closeSwitcher}>
        Manage boards
      </Link>
    </Switcher>
  );
}

function SwitcherLabel({ slug }: { slug: string }) {
  return (
    <>
      <span className="shell-slug">{slug}</span>
      <span aria-hidden="true" className="shell-chevron" />
    </>
  );
}
