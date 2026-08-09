#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${ROOT_DIR}/backend"

echo "==> Generating Prisma client"
npm run db:generate

echo "==> Applying Prisma migrations"
npm run db:migrate

echo "==> Database initialization finished"
echo "==> Next: run 'npm run db:bootstrap-admin -- --username admin --password <your-password> --email admin@example.com --name 管理员'"
echo "==> Then run '../scripts/check-first-run.sh' from the project root to verify first-run readiness"
