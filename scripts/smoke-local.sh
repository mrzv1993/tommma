#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${BASE_URL:-http://localhost:8787}"
LOG_FILE="${TMPDIR:-/tmp}/tommma-backend-smoke.log"

cd "${ROOT_DIR}"

npm --prefix backend run dev >"${LOG_FILE}" 2>&1 &
BACKEND_PID=$!

cleanup() {
  if kill -0 "${BACKEND_PID}" >/dev/null 2>&1; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

for _ in {1..40}; do
  if curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if ! curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
  echo "Smoke bootstrap failed: backend is not reachable at ${BASE_URL}" >&2
  echo "Backend log: ${LOG_FILE}" >&2
  exit 1
fi

BASE_URL="${BASE_URL}" npm run smoke
