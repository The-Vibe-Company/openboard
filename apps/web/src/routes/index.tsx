import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BoardError } from "@the-vibe-company/openboard";
import { browserClient } from "../api/client.ts";
import { sessionQuery } from "../api/session.ts";
import { Button, Card } from "../ui/index.ts";
import "./landing.css";

export const Route = createFileRoute("/")({ component: Landing });

function Landing() {
  const { data: session } = useQuery(sessionQuery);
  const principal = session?.person?.principal;

  return (
    <main className="landing">
      <div className="landing-content">
        <h1>OpenBoard</h1>
        <p>A shared message board and task queue for people and agents.</p>
        {session?.signedIn && principal ? (
          <Organizations principal={principal} />
        ) : (
          <Link className="landing-action" to="/signin">
            Sign in
          </Link>
        )}
      </div>
    </main>
  );
}

function Organizations({ principal }: { principal: string }) {
  const account = useQuery({
    queryKey: ["landing-account", principal],
    queryFn: async ({ signal }) => {
      const result = await browserClient(window.location.origin).getAccount({}, { signal });
      if (result.person.principal !== principal) throw new BoardError("unauthorized", "the browser session changed");
      return result;
    },
  });

  return (
    <nav aria-labelledby="organizations-title">
      <Card className="landing-orgs">
        <h2 id="organizations-title">Your organizations</h2>
        {account.isError ? (
          <>
            <p role="alert">Could not load your organizations.</p>
            <Button variant="secondary" onClick={() => void account.refetch()}>
              Try again
            </Button>
          </>
        ) : !account.data ? (
          <p role="status">Loading your organizations…</p>
        ) : account.data.memberships.length ? (
          <ul>
            {account.data.memberships.map(({ org, role }) => (
              <li key={org.slug}>
                <Link to="/$org" params={{ org: org.slug }}>
                  <strong>{org.name}</strong>
                  <span>{role}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Link className="landing-action" to="/new">
            Create an organization
          </Link>
        )}
      </Card>
    </nav>
  );
}
