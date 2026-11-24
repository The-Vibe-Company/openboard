# Bridge OpenBoard support threads to chat

Run one bridge process per board and chat destination. The bridge forwards new
roots in `support`. Replies under their counterparts in chat become OpenBoard
replies written as `chat-<user id>` through the bridge's connection.

## Configure the platform adapter

Use the owner's chat app or an adapter with these two operations:

- Receive a JSON POST at the incoming URL with `{"boardThread":"4","text":"Need help"}`.
  Return `{"thread":"platform-thread-id"}` after creating the thread. For each
  `Idempotency-Key` header value, return the same thread ID on retries. The
  bridge uses the board's `webhook-id` as that key and records the resulting
  link on disk before acknowledging the board.
- For a human reply to a bridged thread, POST
  `{"type":"chat.reply","thread":"platform-thread-id","user":"alice-7","text":"I can help"}`
  to the bridge's `/chat` endpoint. Use a unique, stable `webhook-id` per reply
  and sign each attempt with the platform's own Standard Webhooks secret.
  Set `webhook-timestamp` to epoch seconds and `webhook-signature` to
  `v1,<base64 HMAC-SHA256>` over `{id}.{timestamp}.{raw body}` using the
  decoded `whsec_` key. Use a stable, unique `user` ID per person, with 1–27
  lowercase ASCII letters, digits or hyphens. Map external IDs into that format
  without merging distinct users.
  The bridge returns 204 for accepted replies and duplicates, 401 for an
  invalid signature, 400 for a malformed reply, 409 while the thread link is
  missing and 503 for temporary processing failures. Retry 409 and 503
  with the same event ID and a fresh timestamp.

## Run against a board

Set `BOARD_URL` to the board's API URL and authenticate the CLI as the board
owner (or an identity with `manage` in `support`). On staging, put a TLS reverse
proxy in front of the bridge's loopback listener and expose `/board` and `/chat`.
Set `BRIDGE_BOARD_HOOK` to that public HTTPS `/board` URL.

From the repository root, with Bun and `ob` installed:

```sh
umask 077
bridge_dir=$(mktemp -d)
ob connections create chat-bridge --direct --can 'support=read,post' \
  --profiles 'chat-*' --secret-file "$bridge_dir/connection.secret"
cat > "$bridge_dir/webhook.json" <<EOF_WEBHOOK
{"name":"chat-bridge","url":"$BRIDGE_BOARD_HOOK","filter":{"tail":"support","types":["message.posted"]},"signing":{"preset":"standard-webhooks"}}
EOF_WEBHOOK
ob webhooks create --file "$bridge_dir/webhook.json" --secret-file "$bridge_dir/board.secret"
```

Put the platform's `whsec_` secret in a private file and set
`OPENBOARD_CHAT_SECRET_FILE` to its path. Set `OPENBOARD_CHAT_INCOMING_URL` to
the adapter's incoming URL.

```sh
export OPENBOARD_WEBHOOK_SECRET_FILE="$bridge_dir/board.secret"
export OPENBOARD_BRIDGE_LINKS_FILE="$bridge_dir/links.json"
bun examples/chat-bridge/src/main.ts < "$bridge_dir/connection.secret"
```

Keep the links file on persistent storage and reuse it on restart. Use a
separate private directory for each bridge. The listener defaults to port
9000. Set `OPENBOARD_BRIDGE_PORT` to override it.

In another terminal, with the same board URL and CLI authentication:

```sh
ob post support "Need help from chat"
# Reply under the new thread in chat, then read the actual board thread ID.
ob read 4 # Replace 4 with the ID printed by ob post.
```

## Exercise the recipe locally

Use a fresh local `ob serve` and set `BOARD_URL=http://127.0.0.1:8787/api/local/main`,
`BRIDGE_BOARD_HOOK=http://127.0.0.1:9000/board`, and
`OPENBOARD_CHAT_INCOMING_URL=http://127.0.0.1:9001/incoming` in the setup
shell. Export `BOARD_URL` and `OPENBOARD_CHAT_INCOMING_URL`. Create the bridge
credentials as above, then generate a local platform secret and run the
loopback fake before launching the bridge:

```sh
export OPENBOARD_CHAT_SECRET_FILE="$bridge_dir/chat.secret"
bun -e 'console.log("whsec_" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"))' > "$OPENBOARD_CHAT_SECRET_FILE"
bun examples/chat-bridge/test/support/fake-platform.ts &
```

After posting, the fake prints the platform thread ID. Use that actual ID in
place of `chat-4` below, and use the board post's ID for `ob read`.

```sh
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:9001/reply/chat-4
ob read 4
```
