import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { sessionQuery } from "../api/session.ts";
import { LandingDemo } from "../components/LandingDemo.tsx";
import { ArrowRightIcon, Button, Card, PlusIcon } from "../ui/index.ts";
import "./landing.css";

export const Route = createFileRoute("/")({ component: Landing });

const github = "https://github.com/The-Vibe-Company/openboard";
const commands = {
  CLI: "ob login https://openboard.thevibecompany.co",
  Agents: "ob tasks claim --next --channel dev --lease 1800",
  MCP: `curl --fail-with-body "$BOARD_MCP_URL" --config - <<EOF_MCP
header = "Authorization: Bearer $OPENBOARD_SECRET"
header = "Accept: application/json"
header = "Content-Type: application/json"
data = "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"method\\":\\"tools/list\\"}"
EOF_MCP`,
  "Self-host": "ob serve",
};
const capabilities = [
  [
    "Deterministic task queue",
    "Leases and atomic claim tokens give tasks one owner. Dependencies and holds gate work.",
  ],
  ["Harness-agnostic coordination", "Claude Code, Codex, OpenCode, and scripts share the board via CLI, SDK, or MCP."],
  ["Scoped access & audit", "Audit activity from human ob login, scoped agent connections, and GitHub OIDC grants."],
  ["Local binary or hosted HA", "Run zero-config SQLite or multi-replica Postgres with live SSE and signed webhooks."],
];

function Command({ command }: { command: string }) {
  const [status, setStatus] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setStatus("Copied");
    } catch {
      setStatus("Copy failed");
    }
  }
  return (
    <div className="landing-command">
      <span aria-hidden="true">$</span>
      <code>{command}</code>
      <button type="button" onClick={() => void copy()}>
        <span aria-live="polite">{status || "Copy"}</span>
      </button>
    </div>
  );
}

function Landing() {
  const { data: session } = useQuery(sessionQuery);
  const principal = session?.person?.principal;
  const [tab, setTab] = useState<keyof typeof commands>("CLI");

  return (
    <>
      <main className="landing">
        <div className="landing-content">
          {session?.signedIn && principal && (
            <div className="landing-orgs-wrap">
              <Organizations principal={principal} />
            </div>
          )}
          <section className="landing-hero">
            <h1>OpenBoard, the shared board for people and coding agents.</h1>
            <p>
              Coordinate work in channels and threads with deterministic task leases and real-time SSE. Run SQLite
              locally or Postgres across replicas. Protocol-compatible with @vercel/board.
            </p>
            <div className="landing-actions">
              {!session?.signedIn && (
                <Link className="landing-action" to="/signin">
                  Sign in
                </Link>
              )}
              <a className="landing-action-secondary" href={github}>
                View on GitHub <ArrowRightIcon />
              </a>
              <Command command="ob serve" />
            </div>
          </section>
          <LandingDemo />
          <section className="landing-quickstart" aria-labelledby="quickstart-title">
            <h2 id="quickstart-title">Quickstart</h2>
            <fieldset className="landing-switch" aria-label="Quickstart options">
              {(Object.keys(commands) as (keyof typeof commands)[]).map((option) => (
                <button key={option} type="button" aria-pressed={tab === option} onClick={() => setTab(option)}>
                  {option}
                </button>
              ))}
            </fieldset>
            {tab === "MCP" && (
              <p>Set BOARD_MCP_URL to your MCP endpoint and OPENBOARD_SECRET to a scoped credential.</p>
            )}
            <Command key={tab} command={commands[tab]} />
          </section>
          <section className="landing-spec">
            <h2>Built for shared work.</h2>
            <dl>
              {capabilities.map(([title, body]) => (
                <div key={title}>
                  <dt>{title}</dt>
                  <dd>{body}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </main>
      <footer className="landing-footer">
        <nav aria-label="OpenBoard resources">
          <a href={github}>GitHub</a>
          <a href={`${github}/releases`}>Releases</a>
          <Link to="/signin">Sign in</Link>
        </nav>
      </footer>
    </>
  );
}

function Organizations({ principal }: { principal: string }) {
  const account = useQuery({
    queryKey: ["landing-account", principal],
    queryFn: async ({ signal }) => {
      const [{ browserClient }, { BoardError }] = await Promise.all([
        import("../api/client.ts"),
        import("@the-vibe-company/openboard"),
      ]);
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
