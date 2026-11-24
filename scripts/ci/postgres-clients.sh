#!/usr/bin/env bash
set -euo pipefail

# Use the client in the existing Postgres service container, which pins the server major.
service="$1"
[[ "$service" =~ ^[a-f0-9]{64}$ ]]
clients="${2:-${RUNNER_TEMP:?}/openboard-pg-client}"
printf -v docker_path %q "$(command -v docker)"
mkdir -p "$clients"
for client in pg_dump pg_restore; do
  {
    printf '#!/bin/bash\n'
    # The dump subprocess receives only database env. Keep the Docker connection selected by the test harness.
    for name in HOME PATH DOCKER_HOST DOCKER_CONTEXT DOCKER_CONFIG DOCKER_TLS DOCKER_TLS_VERIFY DOCKER_CERT_PATH XDG_RUNTIME_DIR SSH_AUTH_SOCK; do
      if value=$(printenv "$name"); then
        printf 'export %s=%q\n' "$name" "$value"
      fi
    done
    printf 'export PGPORT=5432\n'
    printf 'exec %s exec -i --env PGHOST --env PGPORT --env PGUSER --env PGPASSWORD --env PGDATABASE %s %s "$@"\n' \
      "$docker_path" "$service" "$client"
  } > "$clients/$client"
  chmod +x "$clients/$client"
done
if [[ -n "${GITHUB_PATH:-}" ]]; then
  echo "$clients" >> "$GITHUB_PATH"
fi
