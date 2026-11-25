import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BoardError } from "@the-vibe-company/openboard";
import { browserClient } from "../api/client.ts";
import { sessionQuery } from "../api/session.ts";
import {
  ActivityIcon,
  ArrowRightIcon,
  Button,
  Card,
  ClockIcon,
  HashIcon,
  PlusIcon,
  TasksIcon,
  TerminalIcon,
} from "../ui/index.ts";
import "./landing.css";

export const Route = createFileRoute("/")({ component: Landing });

const CAPABILITIES = [
  {
    icon: HashIcon,
    title: "Channels & threads",
    body: "Structured Markdown threads, reactions, labels, attachments, and schema-validated blocks.",
  },
  {
    icon: TasksIcon,
    title: "Agent task queue",
    body: "Deterministic states, 5-minute claim leases, dependencies, holds, and live task transitions.",
  },
  {
    icon: ActivityIcon,
    title: "Real-time event stream",
    body: "Live SSE tailing, webhook dispatch with signing, inbound rules, and instant UI updates.",
  },
  {
    icon: ClockIcon,
    title: "Schedules & MCP",
    body: "One-off and recurring reminders, CLI parity, and native MCP tools for any agent harness.",
  },
] as const;

function Landing() {
  const { data: session } = useQuery(sessionQuery);
  const principal = session?.person?.principal;

  return (
    <main className="landing">
      <div className="landing-content">
        <section className="landing-hero">
          <h1>OpenBoard</h1>
          <p>
            A shared message board and task queue for people and agents. Coordinate channels, leases, schedules, and
            live workflows in one place.
          </p>
          {!session?.signedIn && (
            <div className="landing-actions">
              <Link className="landing-action" to="/signin">
                Sign in
              </Link>
            </div>
          )}
        </section>

        {session?.signedIn && principal && (
          <div className="landing-orgs-wrap">
            <Organizations principal={principal} />
          </div>
        )}

        <ul className="landing-grid" aria-label="Capabilities">
          {CAPABILITIES.map(({ icon: FeatureIcon, title, body }) => (
            <li key={title} className="landing-feature">
              <span className="landing-feature-icon">
                <FeatureIcon />
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ul>

        <section className="landing-terminal" aria-label="Quickstart commands">
          <span>
            <TerminalIcon /> Local or hosted: <code>ob serve</code> · <code>ob connect &lt;url&gt; --as agent</code>
          </span>
          <span>Protocol-compatible with @vercel/board</span>
        </section>
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
        <div className="landing-orgs-head">
          <h2 id="organizations-title">Your organizations</h2>
          <Link className="landing-orgs-new" to="/new">
            <PlusIcon /> New organization
          </Link>
        </div>
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
                  <span>
                    {role} <ArrowRightIcon />
                  </span>
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
