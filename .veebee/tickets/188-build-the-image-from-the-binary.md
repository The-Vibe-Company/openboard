---
id: 188
title: Build the image from the binary
milestone: M6-high-availability
package: tools
writes:
  - Dockerfile
  - .dockerignore
  - apps/openboard/src/serve.ts
conformance: []
modes: [hosted]
depends_on: [183, 187]
status: done
claimed_by: codex
issue: 268
---

## What the user does
As an operator, I run OpenBoard from one container image that holds only the compiled binary.

## Done when
- [x] `bun run build && docker build -t openboard:dev .` succeeds, and `docker run --rm --entrypoint id openboard:dev -u` prints a user ID other than 0
- [x] `docker run --rm -p 8787:8787 -e OPENBOARD_DATABASE_URL=postgres://openboard:openboard@host.docker.internal:55432/openboard openboard:dev` serves hosted mode: `curl http://127.0.0.1:8787/api/acme/main` answers discovery from the host, and `docker stop` ends the container within 10 s

## Out of scope
- Local mode in a container on one volume, and its listening address (M7, 213).
- Pushing the image to GHCR (190) and multi-arch publishing with a release (M7, 194).

## Notes
- docs/codebase.md 7.2: build stage `oven/bun:<pinned>`, runtime `debian:bookworm-slim`, non-root, copies only `dist/openboard-linux-<arch>` to `/usr/local/bin/openboard`, `ENV OPENBOARD_DATA_DIR=/data`, `VOLUME /data`, `EXPOSE 8787`, `ENTRYPOINT ["openboard"]`, `CMD ["serve"]`.
- `apps/openboard/src/serve.ts` listens on `127.0.0.1` only. Hosted mode must listen on all interfaces (a container, Railway); local mode keeps loopback. The docs name no variable for the address (docs/codebase.md 5.5), so this ticket changes hosted mode only; how a local-mode container listens is the owner's call before 213.
- `docker stop` sends `SIGTERM`: the drain of 183 runs.
- Depends on 183 because both change `apps/openboard/src/serve.ts`.
