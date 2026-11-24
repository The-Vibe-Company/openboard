# Upgrade OpenBoard

Read the target [release notes](https://github.com/The-Vibe-Company/openboard/releases)
and the notes for any releases you are skipping. Check the supported upgrade
path and any required configuration changes. Record the current binary version
or image digest, the target version, the data location, and the time of your
backup. Keep both release artifacts and a copy of the deployment configuration
and secret references available for recovery.

Use an existing smoke-test board or channel. Record a known message ID, an
existing task and its state. With your usual
board credentials, repeat these checks after the upgrade:

```bash
curl --fail --silent --show-error "$ORIGIN/readyz"
ob messages "$SMOKE_CHANNEL"
ob read "$MESSAGE_ID"
ob read "$TASK_ID"
```

Set `ORIGIN` to the server origin and `BOARD_URL` to the smoke board URL. Compare
the reads to the pre-upgrade results. Then post in the smoke
channel and read the new message back. Keep credentials in their existing files
or environment variables and out of the transcript.

After [attachment support (367)](../../.veebee/tickets/367-attach-a-file-to-a-message.md)
lands, extend the smoke checks and the SQLite drill to post a file, download it
after the upgrade and compare its SHA-256 to the original.

## Local binary or single self-hosted container

1. For a container, pull the target tag from
   `ghcr.io/the-vibe-company/openboard` and record its digest. Builds from
   `main` use `main-<sha>`; versioned images are published with releases.
   Once binaries are published, download `openboard-bun-<platform>` (or `ob-bun-<platform>`)
   and `SHA256SUMS` from the same GitHub release. Verify the executable against
   its manifest entry before running it. Keep the previous artifact.
2. Stop the old process with SIGTERM (Ctrl-C also works for foreground
   `ob serve`) or stop the container with `docker stop`. Confirm it has exited.
   Copy the **entire stopped data directory** to separate storage, including
   `board.db`, any SQLite sidecars, and `blobs/` when present. The default binary
   directory is `./.openboard`, overridden by `OPENBOARD_DATA_DIR`. For Docker,
   copy the volume mounted at `/data`, for example by archiving the stopped
   named volume with a temporary container:

   ```bash
   umask 077
   docker run --rm --entrypoint /bin/tar \
     -v openboard:/data:ro "$OLD_IMAGE" -C /data -cf - . > openboard-before-upgrade.tar
   tar -tf openboard-before-upgrade.tar
   ```

3. Run `openboard migrate` with the **new** executable against the same data
   directory. For Docker, use the original volume and the new image:

   ```bash
   docker run --rm -v openboard:/data "$NEW_IMAGE" migrate
   ```

   Stop on a migration error. If there was a pending SQLite migration,
   `backups/pre-migrate-<version>.sqlite` records the database before the
   first pending migration. Keep the external directory or volume backup for
   recovery, including attachment bytes.
4. Start `ob serve` with the new executable, or recreate the container from the
   new image with the same volume, configuration and network settings. A
   single SQLite process has an interruption during this restart. Check
   `/readyz` from the same network context as your existing health check
   (the local listener binds to loopback), then run the smoke checks.
   For a bridge-networked container, check directly from its network namespace.
   Set `CONTAINER` to the new container name and `CURL_IMAGE` to a curl image
   available on that host. Use the container's automatically provisioned local
   owner for the board checks:

   ```bash
   docker run --rm --network "container:$CONTAINER" "$CURL_IMAGE" \
     --fail --silent --show-error http://127.0.0.1:8787/readyz
   docker exec "$CONTAINER" env BOARD_URL=http://127.0.0.1:8787/api/local/main \
     openboard read "$MESSAGE_ID"
   ```

   Use the same `docker exec` prefix for the other `ob` commands, replacing
   `ob` with `openboard`. Use your configured container port if it differs
   from 8787.

If recovery is needed, stop the new process. Preserve the failed directory or
volume for diagnosis. Restore the complete pre-upgrade copy into a fresh data
directory or volume and start the previous artifact against that copy. For
snapshot or bucket recovery, use the restore-capable release's
`openboard restore --from <snapshot> --to <fresh-directory>` or
`openboard restore --to <fresh-directory>` with the bucket configured
([local restore, 389](../../.veebee/tickets/389-restore-a-local-board-with-openboard-restore.md)).
Keep the attachment files with the matching database. Verify readiness and
repeat the smoke checks before reopening traffic.

## Self-hosted HA on Postgres

1. Confirm at least two healthy replicas and capture the smoke results. Take a
   consistent database backup (a provider snapshot or a custom-format
   `pg_dump`) and verify you can restore it to a separate database. Record its
   recovery point and keep deployment configuration, secret references and any
   configured backup log segments. If you need the backup to include every
   pre-upgrade write, pause writes before taking it and keep them paused until
   migration starts. Record how you will reconcile writes after the backup.
2. Run `openboard migrate` once using the target image with the same database
   configuration as the replicas. Leave the current replicas serving. The
   Postgres advisory lock serializes migration attempts. Advance only after it
   reports that the schema is current. During overlap migrations are
   expand-only, so both releases can use the schema.
3. Start a target replica and require a direct HTTP 200 from its `/readyz`
   before routing traffic to it. Remove an old replica from rotation and send
   SIGTERM so it can drain. Repeat per replica, maintaining healthy capacity
   throughout. Health probes and serving traffic should use `/readyz`.
   Clients resume event streams with their last cursor.
4. Verify the target artifact and `/readyz` on each replica and repeat the
   smoke checks through the load balancer. Keep the backup until the upgrade
   is accepted.

For failed upgrades, stop routing to the new replicas and stop writers before
restoring. OpenBoard does not support schema downgrades. Restore the
pre-upgrade Postgres backup into a separate database, keep the failed database
for diagnosis, and start the previous artifact on the restored database.
Review writes made after the recovery point before cutover. Where backup log
shipping and the restore command are available, follow
[hosted restore, 390](../../.veebee/tickets/390-restore-a-hosted-organization-from-its-backups.md)
for `openboard restore --after-dump` or `openboard restore --org <slug>`.
The organization restore applies to an organization whose rows are absent.
Check each replica and the smoke board before restoring traffic.

## Hosted service on Railway

Rehearse this on **staging** before a production upgrade. Select the OpenBoard project's
`staging` environment and its `Postgres` and `openboard` services. Confirm the
database reference, public URL, persistent secret key, signup mode and GitHub
OAuth credentials are configured. Capture the smoke checks and take and
verify the staging database backup as described above. Choose a published
`main-<sha>` image tag and load the staging-scoped project token into
`RAILWAY_TOKEN` in your environment.

From the repository root, run:

```bash
bun scripts/release/railway-deploy.ts staging "$TAG"
curl --fail --silent --show-error https://openboard-staging.up.railway.app/readyz
curl --fail --silent --show-error https://openboard-staging.up.railway.app/healthz
```

The deploy command sets the GHCR image, two replicas, `openboard migrate` as
the pre-deploy command, and `/readyz` as the gate before Railway retires the
old replicas. It reports the target tag and both replica IDs after verifying
their health. Review the migration and deployment logs, confirm the previous
deployment has retired, and run the smoke checks through the staging origin.
Record the tag, backup identifier and recovery point, the command output,
readiness, and smoke results in the PR transcript with sensitive values
omitted. If the environment has no active deployment, establish a healthy
baseline first so the rehearsal actually replaces replicas.

Production uses the release workflow after the same image digest passed the
staging gate. Before releasing, confirm the production backup and smoke
baseline. After rollout, check the migration log, replica health and version,
and the smoke results in production. If recovery is required, follow the HA
restore steps using the Railway database backup or a Postgres dump and
repoint the database reference before deploying the previous image. Starting
an earlier image against the migrated database is unsupported.

### Owner rehearsal on staging

Once the first release is published:

- [ ] Record the healthy baseline and staging database backup and recovery point.
- [ ] Follow the staging deploy steps above and verify both replacement replicas.
- [ ] Repeat the smoke checks and record the redacted transcript.

## Rehearse an SQLite upgrade with a release binary

From the checkout you plan to ship:

```bash
bun run build
bun scripts/release/upgrade-drill.ts --from v1.2.3
```

Once GitHub releases publish binaries and checksums, replace `v1.2.3` with
the prior published release tag. The drill checks its
binary against the release's checksum manifest, exercises a fresh board,
and checks the same directory with the locally built binary. Choose a pair
with a pending SQLite migration so the drill can verify its pre-migration
backup. The drill uses a disposable directory and leaves your own board alone.
