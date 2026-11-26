import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { lazy, type ReactNode, Suspense } from "react";
import { sessionQuery } from "../api/session.ts";
import "./Header.css";

const OrganizationSwitcher = lazy(() =>
  import("./HeaderControls.tsx").then(({ OrganizationSwitcher }) => ({ default: OrganizationSwitcher })),
);
const BoardSwitcher = lazy(() =>
  import("./HeaderControls.tsx").then(({ BoardSwitcher }) => ({ default: BoardSwitcher })),
);
const UserMenu = lazy(() => import("./HeaderControls.tsx").then(({ UserMenu }) => ({ default: UserMenu })));

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
          <Breadcrumb slug={org}>
            {person && <OrganizationSwitcher org={org} principal={person.principal} />}
          </Breadcrumb>
          {board && (
            <Breadcrumb slug={board}>
              {person && <BoardSwitcher org={org} board={board} principal={person.principal} />}
            </Breadcrumb>
          )}
        </nav>
      )}
      {person && csrf ? (
        <Suspense fallback={null}>
          <UserMenu person={person} csrf={csrf} />
        </Suspense>
      ) : session ? (
        <Link to="/signin" className="shell-sign-in">
          Sign in
        </Link>
      ) : null}
    </header>
  );
}

function Breadcrumb({ slug, children }: { slug: string; children?: ReactNode }) {
  return (
    <div className="shell-crumb">
      <span aria-hidden="true">/</span>
      <Suspense fallback={<span className="shell-slug">{slug}</span>}>
        {children || <span className="shell-slug">{slug}</span>}
      </Suspense>
    </div>
  );
}
