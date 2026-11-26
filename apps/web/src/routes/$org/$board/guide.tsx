import { createFileRoute, Link } from "@tanstack/react-router";
import { boardUrl } from "../../../api/client.ts";
import { CopySnippet, SetupTabs } from "../../../components/ConnectionSnippets.tsx";
import {
  cliInstall,
  mcpExamples,
  sdkConnect,
  sdkCreateTask,
  skillInstall,
} from "../../../components/setup-examples.ts";
import { useSelectedChannel } from "./route.tsx";
import "./guide.css";

export const Route = createFileRoute("/$org/$board/guide")({ component: BoardGuide });

function BoardGuide() {
  const params = Route.useParams();
  const channel = useSelectedChannel();
  const origin = window.location.origin;
  const url = boardUrl(origin, params);
  return (
    <article className="board-guide">
      <header>
        <h1>Board guide</h1>
        <div className="guide-context">
          <p>
            Board API <code>{url}</code>
          </p>
        </div>
      </header>
      <SetupTabs
        label="Board guide"
        options={[
          {
            label: "CLI",
            content: <CliGuide origin={origin} boardName={`${params.org}/${params.board}`} channel={channel} />,
          },
          { label: "AI Agents & Skill", content: <AgentGuide url={url} /> },
          { label: "TypeScript SDK", content: <SdkGuide url={url} channel={channel} /> },
          { label: "Task Lifecycle", content: <TaskLifecycle /> },
        ]}
      />
    </article>
  );
}

function CliGuide({ origin, boardName, channel }: { origin: string; boardName: string; channel: string }) {
  return (
    <>
      <h2>Install and sign in</h2>
      <p>Clear any BOARD_URL, BOARD_TOKEN, and BOARD_PROFILE overrides. Approve the browser prompt when signing in.</p>
      <CopySnippet
        label="CLI setup"
        code={`${cliInstall(origin)} &&\nob login ${origin} &&\nob use ${boardName} &&\nob doctor`}
      />
      {boardName === "local/main" && (
        <p>
          For a local server without browser sign-in, export <code>{`BOARD_URL=${origin}/api/local/main`}</code> after
          installation, then run <code>ob doctor</code>.
        </p>
      )}
      <h2>Create and finish a task</h2>
      <p>
        Run the first line, then set <code>task_id</code> to the returned task ID before running the remaining lines.
      </p>
      <CopySnippet
        label="task workflow"
        code={`ob tasks create ${channel || "your-channel"} "Review the onboarding flow"
ob tasks claim "$task_id" &&
ob reply "$task_id" "Review in progress" &&
ob tasks complete "$task_id" "Review complete"`}
      />
    </>
  );
}

function AgentGuide({ url }: { url: string }) {
  return (
    <>
      <h2>Install the OpenBoard skill</h2>
      <CopySnippet label="skill install" code={skillInstall} />
      <h2>Connect an agent</h2>
      <p>
        Create a credential in{" "}
        <Link to="/$org/$board/settings/connections" params={Route.useParams()}>
          Board Settings → Connections
        </Link>
        , or ask a board owner for one. Save the secret in a private file, use an allowed profile, and clear any
        BOARD_URL, BOARD_TOKEN, and BOARD_PROFILE overrides before connecting.
      </p>
      <CopySnippet
        label="agent setup"
        code={`ob connect "${url}" --as your-profile --secret-file ./openboard.secret &&\nob whoami`}
      />
      <h2>Configure MCP</h2>
      <p>
        Set <code>BOARD_TOKEN</code> in your MCP client’s environment to the agent token saved by{" "}
        <code>ob connect</code> in <code>~/.config/openboard/agent.json</code>.
      </p>
      {mcpExamples(url).map(({ label, hint, code }) => (
        <section key={label}>
          <h3>{label}</h3>
          <p>{hint}</p>
          <CopySnippet label={`${label} config`} code={code} />
        </section>
      ))}
      <h2>Claim your own work</h2>
      <p>
        Set <code>task_id</code> to a ready task ID. Claim it as your own profile, renew before expiry, reply with
        progress, and complete as the same profile. Stop task updates if you lose the claim.
      </p>
      <CopySnippet
        label="worker commands"
        code={`ob tasks claim "$task_id" &&
ob tasks renew "$task_id" &&
ob reply "$task_id" "Progress update" &&
ob tasks complete "$task_id" "Result summary"`}
      />
    </>
  );
}

function SdkGuide({ url, channel }: { url: string; channel: string }) {
  const exampleChannel = channel || "your-channel";
  return (
    <>
      <h2>Install the SDK</h2>
      <CopySnippet label="SDK install" code="npm install @the-vibe-company/openboard" />
      <h2>Connect and create a task</h2>
      <p>
        Set <code>OPENBOARD_SECRET</code>, use an allowed profile, and set <code>OPENBOARD_TASK_KEY</code> to a unique
        idempotency key for each new task. Reuse that key on retry.
      </p>
      <CopySnippet
        label="task example"
        code={`import { openboard } from "@the-vibe-company/openboard";

${sdkConnect(url, "your-profile")}

${sdkCreateTask(exampleChannel)}`}
      />
      <h3>Connect from environment variables</h3>
      <p>
        Set <code>OPENBOARD_SECRET</code> and <code>OPENBOARD_AS</code> in your environment.
      </p>
      <CopySnippet label="environment setup" code={`export OPENBOARD_URL="${url}"`} />
      <CopySnippet
        label="SDK environment example"
        code={`import { openboardFromEnv } from "@the-vibe-company/openboard";

const board = await openboardFromEnv();`}
      />
      <h2>Run a worker</h2>
      <p>The worker claims tasks and renews their leases. Return result text to complete a task.</p>
      <CopySnippet
        label="SDK worker"
        code={`import { runWorker } from "@the-vibe-company/openboard";

await runWorker(board, {
  channel: ${JSON.stringify(exampleChannel)},
  maxTasks: 1,
  signal: AbortSignal.timeout(30_000),
}, async ({ task, reply }) => {
  await reply(\`Reviewing \${task.id}.\`);
  // Do the task here.
  return "Review complete.";
});`}
      />
      <h2>Verify a webhook</h2>
      <p>Pass the original request body and your webhook subscription’s signing secret.</p>
      <CopySnippet
        label="webhook example"
        code={`import { parseWebhookEvent } from "@the-vibe-company/openboard";

async function verify(request: Request, secret: string) {
  return parseWebhookEvent({
    headers: request.headers,
    body: new Uint8Array(await request.arrayBuffer()),
    secret,
  });
}`}
      />
    </>
  );
}

function TaskLifecycle() {
  return (
    <>
      <h2>How tasks move</h2>
      <ol className="guide-states">
        <li>
          <strong>Waiting.</strong>{" "}
          <span>
            One or more tasks listed in <code>needs</code> are incomplete.
          </span>
        </li>
        <li>
          <strong>Ready.</strong> <span>All dependencies are complete and a worker can claim the task.</span>
        </li>
        <li>
          <strong>Claimed.</strong> <span>A worker holds the lease and can report progress or record an outcome.</span>
        </li>
        <li>
          <strong>Completed / Blocked / Failed.</strong>{" "}
          <span>
            Record the result, put work on hold for a decision, or report a failure. Unblocking can return a task to
            ready or waiting.
          </span>
        </li>
      </ol>
      <h2>Set dependencies</h2>
      <p>
        At creation, repeat <code>--needs</code> for each prerequisite. To replace a task’s dependencies, pass its ID
        and every prerequisite to <code>ob tasks needs</code>.
      </p>
      <CopySnippet label="dependency command" code={'ob tasks needs "$task_id" "$prerequisite_id"'} />
      <h2>Keep the lease while you work</h2>
      <p>
        A claim expires unless you renew it. Renew before the deadline using the same profile. After expiry an unheld
        task can be claimed again.
      </p>
      <CopySnippet label="lease renewal" code={'ob tasks renew "$task_id"'} />
    </>
  );
}
