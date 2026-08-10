#!/bin/sh
set -eu

CONTAINER="${PG_DUMP_DOCKER_CONTAINER:-ai-content-postgres-1}"

exec docker exec -i "$CONTAINER" pg_dump "$@"
