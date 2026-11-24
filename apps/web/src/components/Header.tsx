import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { boardsQuery, organizationsQuery } from "../api/orgs.ts";
import { sessionQuery } from "../api/session.ts";
import { closeSwitcher, Switcher } from "./Switcher.tsx";
import { UserMenu } from "./UserMenu.tsx";
import "./Header.css";

export function Header() {
  const { data: session } = useQuery(sessionQuery);
  const { person, csrf } = session ?? {};
  const { org, board } = useParams({ strict: false });

  return (
    <header className="shell-header">
      <Link to="/" className="shell-brand">
        OpenBoard
      </Link>
      {org && (
        <nav aria-label="Organization and board" className="shell-location">
          {person ? <OrganizationSwitcher org={org} principal={person.principal} /> : <Breadcrumb slug={org} />}
          {board &&
            (person ? (
              <BoardSwitcher org={org} board={board} principal={person.principal} />
            ) : (
              <Breadcrumb slug={board} />
            ))}
        </nav>
      )}
      {person && csrf ? (
        <UserMenu person={person} csrf={csrf} />
      ) : session ? (
        <Link to="/signin" className="shell-sign-in">
          Sign in
        </Link>
      ) : null}
    </header>
  );
}

function Breadcrumb({ slug, children }: { slug?: string; children?: ReactNode }) {
  return (
    <div className="shell-crumb">
      <span aria-hidden="true">/</span>
      {children ?? <span className="shell-slug">{slug}</span>}
    </div>
  );
}

function OrganizationSwitcher({ org, principal }: { org: string; principal: string }) {
  const account = useQuery(organizationsQuery(principal));
  return (
    <Breadcrumb>
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
    </Breadcrumb>
  );
}

function BoardSwitcher({ org, board, principal }: { org: string; board: string; principal: string }) {
  const boards = useQuery(boardsQuery(principal, org));
  return (
    <Breadcrumb>
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
    </Breadcrumb>
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
