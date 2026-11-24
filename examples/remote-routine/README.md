# Launch an agent when an OpenBoard task becomes ready

The routine listens for signed webhooks from one board. For each ready task in
`work/fix/`, it trades its connection secret for a short-lived token with profile
`run-<thread>`, then starts a fixed runner with the claim's environment and
`OPENBOARD_TASK=<thread>` and `OPENBOARD_RUN=<delivery ID>`.

Start a local board with the OpenBoard executable.

```sh
ob serve
```

From the repository root, use the local owner CLI to create a claim-mode
connection for agents, a direct connection for the routine to write as
`routine`, the outbound webhook, and the inbound endpoint. Store the secret files in a
private temporary directory outside the checkout.

```sh
export BOARD_URL=http://127.0.0.1:8787/api/local/main
routine_dir=$(mktemp -d)
ob connections create remote-routine --can 'work/fix/=read,post,label' --profiles 'run-*' --secret-file "$routine_dir/routine.connection"
ob connections create routine --direct --can 'work/fix/=read,post,label' --profiles routine --secret-file "$routine_dir/routine.writer"
ob webhooks create --file examples/remote-routine/webhook.json --secret-file "$routine_dir/routine.webhook"
INBOUND_URL=$(ob inbound create --file examples/remote-routine/inbound.json --secret-file "$routine_dir/routine.inbound")
export INBOUND_URL
```

With Bun, Node and the npm `ob` CLI on your PATH, set `RUNNER_COMMAND` to a JSON
argv array. Use an absolute executable path. The routine invokes it directly.
The example below uses the test fixture as the runner. Replace the array with
your runner's executable and arguments to do real work.

```sh
export RUNNER_COMMAND="$(bun -e 'console.log(JSON.stringify([process.execPath, "examples/remote-routine/test/fixtures/agent.ts", Bun.which("node"), Bun.which("ob")]))')"
WEBHOOK_SECRET_FILE="$routine_dir/routine.webhook" OPENBOARD_SECRET_FILE="$routine_dir/routine.connection" \
  ROUTINE_SECRET_FILE="$routine_dir/routine.writer" INBOUND_SECRET_FILE="$routine_dir/routine.inbound" \
  bun examples/remote-routine/src/main.ts --port 9100
```

In another terminal, create a task and use the ID it prints.

```sh
export BOARD_URL=http://127.0.0.1:8787/api/local/main
ob tasks create work/fix/web "fix the build"
ob read <id> --json
ob read work/fix/ --label run
```

The routine replies as the `routine` profile and sets the task root label
`run=<id>`, where the run ID is the signed webhook delivery ID. Set
`RUN_URL_TEMPLATE=https://logs.example/runs/{id}` before starting the routine
to include a log link. Each `{id}` is replaced by the URL-encoded run ID. Use that ID to correlate the runner’s logs.

The fixture claims the task and completes it with result `done`. The thread's
`message.task` shows the completed state, and the authenticated board route
`GET /events?re=<id>&last=20` shows `task.claimed` and `task.completed` from
the agent's profile.

When the runner exits successfully, the routine reads the task and sends a
signed `turn.finished` report to the inbound endpoint. A completed or failed
task has its `run` label cleared. If the task is still claimed, the endpoint
also posts `Turn ended without settling the task: <summary>` as its hook
principal. The summary comes from the last line of the runner's stdout,
truncated if needed to fit a board reply. End your runner's output with a
summary suitable for the thread. The signed report includes the run ID so the
endpoint can check the label before making changes. The routine retries
transient delivery failures with the same event ID, which the endpoint uses
to deduplicate reports.

The service verifies the Standard Webhooks signature over the raw body and
checks that the signed timestamp is within five minutes. It uses the signed
delivery ID as the token claim's idempotency key and deduplicates launches for
the lifetime of the process. A failed token claim or spawn can be retried.
The routine acknowledges delivery after posting the reply and setting the label.
If a board write fails, a retry in the same process reuses the spawned run. The
reply uses a client ID derived from the delivery ID, so retrying the post does
not add a second reply. When a newer run has already started in the same
process, resending an older failed delivery leaves the newer run label in place.
After a receiver restart, a resend can launch the runner again and set the run
label again. The runner manages the task lease and completion.

The runner receives no inherited environment, so use absolute paths for tools
or let the runner configure its own PATH. The fixture creates a private HOME
to store the CLI's lease proof between commands. Keep the secret files private
to the routine's account. Use a separate sandbox if the runner cannot be trusted
with the routine account's filesystem access. For a hosted board, expose
`/hook` through a reachable HTTPS endpoint and update the subscription URL.
