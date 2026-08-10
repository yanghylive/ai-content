#!/usr/bin/env bash
set -euo pipefail

CONTAINER="${PSQL_DOCKER_CONTAINER:-${PG_DUMP_DOCKER_CONTAINER:-ai-content-postgres-1}}"

ARGS=()
INPUT_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--file)
      shift
      if [[ $# -eq 0 ]]; then
        echo "psql-docker-wrapper: missing file after -f/--file" >&2
        exit 2
      fi
      INPUT_FILE="$1"
      ;;
    --file=*)
      INPUT_FILE="${1#--file=}"
      ;;
    *)
      ARGS+=("$1")
      ;;
  esac
  shift
done

if [[ -n "$INPUT_FILE" ]]; then
  exec docker exec -i "$CONTAINER" psql "${ARGS[@]}" < "$INPUT_FILE"
fi

exec docker exec -i "$CONTAINER" psql "${ARGS[@]}"
