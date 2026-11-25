# Restore OpenBoard

Keep the source backups and the failed volume for diagnosis. Record the
incident time, selected backup, replay count, last recovered writes, and the
time the service became available again. Supply credentials through environment
variables or secret files.

## Lost local disk

1. Stop OpenBoard. On the replacement disk, select an empty directory and
   configure the original `OPENBOARD_BACKUP_S3_*` settings.
2. Run `openboard restore --to /data/openboard`. Restore selects the newest
   usable snapshot, replays contiguous shipped segments, and verifies backed
   up attachments. For a standalone SQLite snapshot use
   `openboard restore --from /backup/backups/snapshot.sqlite --to /data/openboard`.
   Keep the original blob store in `/backup/blobs/`, beside `/backup/backups/`,
   so restore can copy attachments into the destination.
3. Restore the original signing key before startup. Set
   `OPENBOARD_SECRET_KEY_FILE` to the preserved encoded key outside the data
   directory, or restore the raw local `~/.config/openboard/secret-key` file
   with mode 0600 if local startup generated it. Set
   `OPENBOARD_DATA_DIR=/data/openboard` and start `ob serve`. Confirm
   `/readyz`, read recent messages, and download a known attachment. Confirm
   connections and any signing configuration before reopening traffic.
   If the original key was lost, supply a new key and recreate webhooks and
   inbound endpoints that used credentials encrypted with the old key.
   Update the corresponding senders and receivers with the replacement
   credentials before reopening traffic.

For a point-in-time restore from the bucket, add `--at <ISO time>`. The cutoff
is exclusive. Before resuming writes on that history, configure a different
bucket and copy the source `org/1/blobs/sha256/` and `org/1/attachments/`
objects to it so the next snapshot can reference shipped attachments. Keep the
source bucket available for further recovery.

## Lost hosted organization

1. Stop all hosted OpenBoard replicas and retain the organization slug and
   its `org/<id>/` backup prefix. Configure `OPENBOARD_DATABASE_URL` for the
   surviving database and the original `OPENBOARD_BACKUP_S3_*` settings.
2. Run `openboard restore --org <slug>`. The command requires the surviving
   organization mapping and refuses an organization that still contains data
   or was hard-purged.
3. Start the replicas, check `/readyz`, and verify the organization's boards,
   membership, recent messages and attachments. Check a second organization
   before reopening traffic.

## Lost hosted database volume

1. Stop all OpenBoard replicas. Provision a fresh Postgres database and
   identify the newest usable `dumps/<YYYY-MM-DD>.dump` in the original backup
   bucket. Download it to a restricted recovery directory.
2. Set the libpq connection environment for the empty database
   (`PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` and a protected `PGPASSFILE`).
   Run `pg_restore --no-password --single-transaction --exit-on-error --no-owner --no-privileges --dbname "$PGDATABASE" /backup/latest.dump`.
3. Set `OPENBOARD_DATABASE_URL` to the restored database and configure the
   original bucket. Run `openboard restore --after-dump`. Replay starts at the
   log positions recorded in the dump. Accounts come from the dump, so replay
   can grant membership only to accounts present there. Check recent account
   changes, sessions and pending deliveries as part of recovery.
4. Configure the replicas to use the restored database and the original
   `OPENBOARD_SECRET_KEY` or `OPENBOARD_SECRET_KEY_FILE`. Start them and verify
   `/readyz`, recent events, attachments and access on representative boards
   before reopening traffic.

For provider-managed volume backups, follow [Railway's volume restore
procedure](https://docs.railway.com/volumes/backups#how-to-restore-a-backup).

## Repeat the drill

From the repository root after `bun install`, run
`bun scripts/ops/restore-drill.ts local --fake-bucket`. Omit `--fake-bucket`
to use a dedicated empty MinIO bucket configured with
`OPENBOARD_BACKUP_S3_*`. The local drill removes its temporary data directory
after killing the writer. The loopback fake exercises the same shipping and
restore path without measuring network or real bucket latency.

For hosted mode, populate a scratch Postgres source named
`openboard_drill_source` or `openboard_drill_source_<suffix>` with a test
organization and board. Use test-only data and disable real integration
destinations before starting the source or restoring its dump. Give the
drill a board bearer token with read and post access. Provision a fresh
target database named `openboard_restore_drill` or
`openboard_restore_drill_<suffix>` and keep both databases exclusive to
the drill while it runs. Install a compatible `pg_restore` and `pg_dump`
on the runner. Set:

- `OPENBOARD_DATABASE_URL` and `OPENBOARD_DRILL_TARGET_DATABASE_URL`
  to the distinct scratch databases. Each supports a `_FILE` equivalent.
  Use TCP URLs with an explicit user and an optional `sslmode` query parameter.
- `OPENBOARD_DRILL_BOARD` to the test board's `org/board` path and
  `OPENBOARD_DRILL_TOKEN_FILE` to a protected file with the board bearer token.
- `OPENBOARD_SECRET_KEY` or `OPENBOARD_SECRET_KEY_FILE` to the source's
  application key.

Run `bun scripts/ops/restore-drill.ts hosted --fake-bucket` with loopback
Postgres addresses for a disposable loopback S3 server. The drill waits for
the source's scheduled `pg_dump` to reach that bucket before starting its
workload.

For staging, set `OPENBOARD_BACKUP_S3_*` to a bucket dedicated to the scratch
source named `openboard-restore-drill` or `openboard-restore-drill-<suffix>`.
Run the scratch source with shipping enabled until its daily dump
is available, then stop all its replicas. The drill credential must already
be in the dump. Run `bun scripts/ops/restore-drill.ts hosted`. In both
configurations the drill writes to the test board, kills its writer,
downloads the latest dump, restores it to the target, and replays the later
segments. The source and target databases are retained for inspection.

Save the command's output. Both modes write for 60 seconds and compare
acknowledged test posts with recovered post events. RPO reports the number
lost and the age of the oldest missing acknowledgement at the kill. RTO
times restore itself, including the dump download and load in hosted mode.
It excludes provisioning, application restart and verification. A missing
acknowledgement older than 10 seconds fails the drill.
