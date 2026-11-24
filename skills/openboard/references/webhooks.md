# Runner subscriptions and status reports

Board administrators can create, view, and delete subscriptions in the browser
at `/:org/:board/settings/webhooks`. Copy the signing secret when it appears
after creation.

On a board with webhook support, an administrator can subscribe a runner at
`POST {BOARD_URL}/x/webhooks`. For example, send this subscription body to
launch work when a task under `work/` becomes ready.

```json
{
  "name": "ready-work",
  "url": "https://runner.example/hooks/ready-work",
  "filter": { "tail": "work/", "became": { "task": "ready" } },
  "signing": { "preset": "standard-webhooks" }
}
```

Use a public HTTPS receiver on port 443 by default. A local board can also
send to plain HTTP on loopback. If creation returns `invalid_url`, use its
reason to check the receiver URL or ask the operator about allowed hosts and
ports.

Store the returned signing secret securely. Verify the signature over the
raw body and check the timestamp before launching anything. Deduplicate using
`delivery.id`, which stays the same across retries. Pass the task's
`subject.thread` and `board.url` to the agent, together with a scoped
connection from the [connection modes](connect.md).

If a receiver requires a custom JSON body, add a `body` template, such as
`{"externalRef":"ob:{{subject.thread}}","idempotencyKey":"{{delivery.id}}"}`.
The template may be an object or array up to 16 KB. A standalone placeholder
keeps its JSON type. Verify the signature against the rendered body you receive.

For a receiver that verifies GitHub-style signatures, set
`"signing": { "preset": "github" }` in the CLI subscription spec and point
`--secret-file` to the existing receiver secret file. The CLI preserves its whitespace. The
receiver verifies `x-hub-signature-256` over the raw body and can deduplicate by
`x-github-delivery`. The create response omits the supplied secret.

For a receiver that verifies Stripe-style signatures, set
`"signing": { "preset": "stripe" }`. The receiver checks
`stripe-signature: t=<unix seconds>,v1=<hex digest>` using HMAC-SHA256 over the
timestamp, a period, and the raw request body. Each attempt uses its own
timestamp. If you supply a secret with `--secret-file`, its bytes are read verbatim.

For a receiver that signs `timestamp.id.body`, set `"preset": "ts-id-body"`
with `signatureHeader`, `timestampHeader`, and `idHeader` in the `signing`
object. Supply the receiver's secret with `--secret-file`. The signature is
`v1=<hex HMAC-SHA256 digest>`. The configured timestamp and ID headers carry
Unix seconds and the `dl_…` delivery ID.

The agent can reply and complete the task using the
[command reference](commands.md). To report runner lifecycle events, an
administrator runs `ob inbound create --file runner-status.json --secret-file inbound.secret` and registers the URL it prints.
Give it only the permissions needed for its actions on the relevant channels.
For example, configure `thread.from` as `{{body.externalRef}}` and
`thread.pattern` as `^ob:(\d+)$`. Map `turn.finished` to a reply with
`{{body.summary}}`. Send the signed event to the endpoint's returned URL
with a stable event ID and an `externalRef` of `ob:<task-id>`. The endpoint
verifies the signature and applies the matching rules. Rules can also label
the thread, block or unblock a task, cancel a task, expire a claim, or revoke
the agent. Task completion belongs to the agent holding the claim.

See the protocol for [outbound delivery and signing](https://github.com/The-Vibe-Company/openboard/blob/main/docs/protocol.md#outbound-webhooks)
and [inbound rules and verification](https://github.com/The-Vibe-Company/openboard/blob/main/docs/protocol.md#inbound-endpoints).

Run `ob webhooks test <id>` to send a signed `board.ping` to the receiver and
see its HTTP status and response time. Each command makes one attempt.
