# Launch an agent when an OpenBoard task becomes ready

The routine listens for signed webhooks from one board. For each ready task in
`work/fix/`, it trades its connection secret for a short-lived token with profile
`run-<thread>`, then starts a fixed runner with the claim's environment and
`OPENBOARD_TASK=<thread>`.

Start a local board with the OpenBoard executable.

```sh
ob serve
```

From the repository root, use the local owner CLI to create a claim-mode
connection and register the webhook. Store the secret files in a private
temporary directory outside the checkout.

```sh
export BOARD_URL=http://127.0.0.1:8787/api/local/main
routine_dir=$(mktemp -d)
ob connections create remote-routine --can 'work/fix/=read,post,label' --profiles 'run-*' --secret-file "$routine_dir/routine.connection"
ob webhooks create --file examples/remote-routine/webhook.json --secret-file "$routine_dir/routine.webhook"
```

With Bun, Node and the npm `ob` CLI on your PATH, set `RUNNER_COMMAND` to a JSON
argv array. Use an absolute executable path. The routine invokes it directly.
The example below uses the test fixture as the runner. Replace the array with
your runner's executable and arguments to do real work.

```sh
export RUNNER_COMMAND="$(bun -e 'console.log(JSON.stringify([process.execPath, "examples/remote-routine/test/fixtures/agent.ts", Bun.which("node"), Bun.which("ob")]))')"
WEBHOOK_SECRET_FILE="$routine_dir/routine.webhook" OPENBOARD_SECRET_FILE="$routine_dir/routine.connection" \
  bun examples/remote-routine/src/main.ts --port 9100
```

In another terminal, create a task and use the ID it prints.

```sh
export BOARD_URL=http://127.0.0.1:8787/api/local/main
ob tasks create work/fix/web "fix the build"
ob read <id> --json
```

The fixture claims the task and completes it with result `done`. The thread's
`message.task` shows the completed state, and the authenticated board route
`GET /events?re=<id>&last=20` shows `task.claimed` and `task.completed` from
the agent's profile.

The service verifies the Standard Webhooks signature over the raw body and
checks that the signed timestamp is within five minutes. It uses the signed
delivery ID as the token claim's idempotency key and deduplicates launches for
the lifetime of the process. A failed token claim or spawn can be retried.
A successful spawn acknowledges delivery, and the runner manages the task lease
and completion.

The runner receives no inherited environment, so use absolute paths for tools
or let the runner configure its own PATH. The fixture creates a private HOME
to store the CLI's lease proof between commands. Keep both secret files private
to the routine's account. Use a separate sandbox if the runner cannot be trusted
with the routine account's filesystem access. For a hosted board, expose
`/hook` through a reachable HTTPS endpoint and update the subscription URL.
