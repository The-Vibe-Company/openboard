---
id: 1068
title: Fix production pg_dump and polish the CLI and SDK
package: cli
modes: [local, hosted]
status: done
---

## What the user does

Use the production backup job with PostgreSQL 18, close a task with a single
CLI command, manage connections by name, and count tasks through the SDK.

## Done when

- The Dockerfile installs the PostgreSQL 18 client from the existing PGDG repository.
- Claim, create and renew accept integer seconds and human-readable lease durations within the existing 30–3600 second server range.
- Complete can acquire a claim and lift a hold with `--claim`. Plain completion requires a saved claim.
- Connection show, revoke and rotate accept a unique active name or a connection ID.
- The SDK exposes task counts and shares the existing connection refresh and retry.

## Out of scope

Changes to the web app, CLI utility commands, backup scheduling or the wire protocol.
