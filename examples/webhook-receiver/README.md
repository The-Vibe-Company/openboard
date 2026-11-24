# Verify OpenBoard webhook deliveries

Start a local board with a fresh signing key for this test.

```sh
export OPENBOARD_SECRET_KEY="$(openssl rand -base64 32)"
ob serve
```

Save this subscription as `dev-ready.json`.

```json
{
  "name": "dev-ready",
  "url": "http://127.0.0.1:9000/hook",
  "filter": { "tail": "dev --label status=ready", "types": ["labels.changed"] }
}
```

Create the subscription and start the receiver in separate terminals. The CLI
writes the generated signing secret to a private file.

```sh
export BOARD_URL=http://127.0.0.1:8787/api/local/main
ob webhooks create --file dev-ready.json --secret-file hook.secret
bun examples/webhook-receiver/src/main.ts --port 9000 < hook.secret
```

You can also set `WEBHOOK_SECRET_FILE=hook.secret`. The receiver reads stdin when
the environment variable is unset.

```sh
ob post dev "Ready to label"
ob label <id> status=ready
```

Use the ID printed by `ob post`. The receiver prints
`verified dl_… labels.changed dev <id> status=ready`.

The handler verifies the Standard Webhooks HMAC over the raw request body and
rejects missing or invalid signatures and timestamps outside five minutes with
401. It hands the event and its thread, channel, and labels to the callback.
A verified repeat with the same `webhook-id` returns 204 without invoking the
callback again during the receiver's lifetime. Restarting clears the in-memory
delivery IDs. Use a durable idempotency store if you adapt the example to run
actions across restarts or multiple instances.

The example listens on loopback for local development. Hosted boards require a
reachable HTTPS endpoint.
