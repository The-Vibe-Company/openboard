# syntax=docker/dockerfile:1
FROM oven/bun:1.4.3 AS build
WORKDIR /build
COPY package.json bun.lock ./
COPY apps/openboard/package.json apps/openboard/
COPY apps/web/package.json apps/web/
COPY packages/cli/package.json packages/cli/
COPY packages/contract/package.json packages/contract/
COPY packages/core/package.json packages/core/
COPY packages/driver-postgres/package.json packages/driver-postgres/
COPY packages/driver-sql/package.json packages/driver-sql/
COPY packages/driver-sqlite/package.json packages/driver-sqlite/
COPY packages/ports/package.json packages/ports/
COPY packages/sdk/package.json packages/sdk/
COPY packages/server/package.json packages/server/
COPY tools/bench/package.json tools/bench/
COPY tools/conformance/package.json tools/conformance/
COPY examples/chat-bridge/package.json examples/chat-bridge/
COPY examples/remote-routine/package.json examples/remote-routine/
COPY examples/sandboxed-agent/package.json examples/sandboxed-agent/
COPY examples/webhook-receiver/package.json examples/webhook-receiver/
RUN bun install --frozen-lockfile
COPY . .
RUN bun -e 'import { buildBinary, hostTarget } from "./scripts/build/index.ts"; await buildBinary(hostTarget(), "dist");' \
    && mv "dist/openboard-bun-linux-$(bun -p process.arch)" "dist/openboard-linux-$(bun -p process.arch)"

FROM debian:bookworm-slim
ADD --checksum=sha256:0144068502a1eddd2a0280ede10ef607d1ec592ce819940991203941564e8e76 https://www.postgresql.org/media/keys/ACCC4CF8.asc /usr/share/keyrings/postgresql.asc
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && chmod 0644 /usr/share/keyrings/postgresql.asc \
    && echo "deb [signed-by=/usr/share/keyrings/postgresql.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/postgresql.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-17 \
    && rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/postgresql.list /usr/share/keyrings/postgresql.asc
RUN useradd --uid 10001 --user-group --home-dir /data --no-create-home openboard \
    && install -d -o openboard -g openboard /data
COPY --from=build /build/dist/openboard-linux-* /usr/local/bin/openboard
USER openboard
ENV OPENBOARD_DOCKER=on \
    OPENBOARD_DATA_DIR=/data \
    OPENBOARD_HOST=0.0.0.0 \
    BOARD_URL=http://127.0.0.1:8787/api/local/main
EXPOSE 8787
ENTRYPOINT ["openboard"]
CMD ["serve"]
