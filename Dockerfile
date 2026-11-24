FROM oven/bun:1.4.2 AS build
WORKDIR /build
COPY . .
RUN bun install --frozen-lockfile
RUN bun -e 'import { buildBinary, hostTarget } from "./scripts/build/index.ts"; await buildBinary(hostTarget(), "dist");' \
    && mv "dist/openboard-bun-linux-$(bun -p process.arch)" "dist/openboard-linux-$(bun -p process.arch)"

FROM debian:bookworm-slim
RUN useradd --uid 10001 --user-group --create-home openboard \
    && install -d -o openboard -g openboard /data
COPY --from=build /build/dist/openboard-linux-* /usr/local/bin/openboard
USER openboard
ENV OPENBOARD_DATA_DIR=/data
EXPOSE 8787
ENTRYPOINT ["openboard"]
CMD ["serve"]
