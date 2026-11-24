---
id: 213
title: Pass the local score from a self-host container on one volume
milestone: M7-hosted-deploy
package: app
writes:
  - Dockerfile
  - apps/openboard/src/serve.ts
  - apps/openboard/src/config.ts
  - apps/openboard/test/config.test.ts
  - docs/codebase.md
  - docs/auth.md
  - docs/decisions.md
conformance: []
modes: [local]
depends_on: [188, 192, 199, 211, 212]
status: done
claimed_by: codex
issue: 374
---

## What the user does
As someone self-hosting OpenBoard, I run one container on one volume and it passes the same conformance checks as `ob serve` on my laptop.

## Done when
- [ ] `bun run build && docker build -t openboard:dev . && docker run -d --name ob -p 8787:8787 -v openboard:/data openboard:dev` serves local mode: `curl http://127.0.0.1:8787/api/local/main` answers discovery from the host, and a post made before `docker restart ob` is still read after it
- [ ] a direct connection created inside the container with the owner token file (`docker exec ob openboard connections create conformance --can '*=all' --direct --secret-file /data/conformance.secret`), its secret copied out with `docker cp` and never printed, lets `bun run conformance --url http://127.0.0.1:8787/api/local/main < conformance.secret` exit 0 with every check `tools/conformance/score.json` lists under `local`
- [ ] `docker exec ob ls /data/backups` lists the snapshots of 212

## Out of scope
- Hosted mode in the container (188); several containers on one Postgres (docs/codebase.md 7.6, "Self-hosted HA": no new code).
- Moving a board from local to Postgres (M15, 392, 393).

## Notes
- docs/codebase.md 7.2 and 7.6, docs/project.md M7 "Done when" (a self-host container on one volume passes `bun run conformance --url` with the local score), D43 (the conformance credential).
- Local mode listens on loopback (`apps/openboard/src/serve.ts`), which a container's port mapping cannot reach; 188 left how a local-mode container listens to the owner. Proposal for the owner, to confirm before this ticket is claimed: a variable `OPENBOARD_HOST` (default `127.0.0.1` in local mode, all interfaces in hosted mode) that the image sets to `0.0.0.0`, documented in docs/codebase.md 5.5 and recorded in docs/decisions.md. The local owner token then guards a reachable port, which is why the variable is explicit and not a default.
- `--url` and the secret on stdin come from 192.
- Depends on 199 (`apps/openboard/src/serve.ts`) and 211 (`Dockerfile`), which change the same files.
