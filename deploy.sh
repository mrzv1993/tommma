#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ROOT_DIR}/.deploy.env"

if [[ "${DEPLOY_FROM_ACTIONS:-0}" != "1" && -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi

: "${DEPLOY_USER:?Set DEPLOY_USER (e.g. root)}"
: "${DEPLOY_HOST:?Set DEPLOY_HOST (e.g. 203.0.113.10)}"
: "${DEPLOY_PATH:?Set DEPLOY_PATH (e.g. /opt/tommma)}"

RSYNC_SSH_PORT="${RSYNC_SSH_PORT:-22}"
RSYNC_DELETE="${RSYNC_DELETE:-1}"
SYNC_USER_EMAIL="${SYNC_USER_EMAIL:-}"
if [[ -n "$SYNC_USER_EMAIL" ]]; then
  echo 'User-data transfer is a separate task; it is forbidden in code publication.' >&2
  exit 1
fi
DEPLOY_APPLY_SCHEMA="${DEPLOY_APPLY_SCHEMA:-0}"
BUILD_FRONTEND="${BUILD_FRONTEND:-1}"
BUILD_BACKEND="${BUILD_BACKEND:-1}"
RUN_BACKEND_DEPLOY="${RUN_BACKEND_DEPLOY:-1}"
INSTALL_BACKEND_DEPS="${INSTALL_BACKEND_DEPS:-1}"
RESTART_BACKEND="${RESTART_BACKEND:-1}"
BACKEND_SERVICE_NAME="${BACKEND_SERVICE_NAME:-tommma-backend.service}"

if ! command -v rsync >/dev/null 2>&1; then
  echo "Error: rsync is not installed." >&2
  exit 1
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "Error: ssh is not installed." >&2
  exit 1
fi

if [[ "${BUILD_FRONTEND}" == "1" ]]; then
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "Error: pnpm is not installed (required to build frontend)." >&2
    exit 1
  fi
  echo "Building frontend..."
  pnpm --dir "${ROOT_DIR}/frontend" build
fi

if [[ "${BUILD_BACKEND}" == "1" ]]; then
  echo "Building backend..."
  npm --prefix "${ROOT_DIR}/backend" run build
fi

RSYNC_ARGS=(
  -avz
  --human-readable
  --progress
  --omit-dir-times
  --no-perms
  --no-owner
  --no-group
  --exclude ".git"
  --exclude ".git/"
  --include ".codex/"
  --include ".codex/runtime/"
  --include ".codex/runtime/write_release.py"
  --exclude ".codex/**"
  --exclude ".env"
  --exclude ".env.*"
  --exclude "uploads/"
  --exclude "data/"
  --exclude ".data/"
  --exclude ".DS_Store"
  --exclude "backups/"
  --exclude "node_modules/"
  --exclude "frontend/src-tauri/target/"
  --exclude ".deploy.env"
  --exclude "backend/.env"
  --exclude ".codex-local/"
)

if [[ "${RSYNC_DELETE}" == "1" ]]; then
  RSYNC_ARGS+=(--delete)
fi

echo "Deploying ${ROOT_DIR} -> ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}"

rsync "${RSYNC_ARGS[@]}" \
  -e "ssh -p ${RSYNC_SSH_PORT}" \
  "${ROOT_DIR}/" \
  "${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}/"

echo "Done."

if [[ "${RUN_BACKEND_DEPLOY}" == "1" ]]; then
  echo "Applying backend Prisma deploy steps..."
  ssh -p "${RSYNC_SSH_PORT}" "${DEPLOY_USER}@${DEPLOY_HOST}" \
    "cd '${DEPLOY_PATH}' && if [ '${INSTALL_BACKEND_DEPS}' = '1' ]; then npm --prefix backend ci; fi && npm --prefix backend run prisma:generate && if [ '$DEPLOY_APPLY_SCHEMA' = '1' ]; then npm --prefix backend run prisma:deploy; else cd backend && npx --no-install prisma migrate status; fi"
fi

ssh -p "${RSYNC_SSH_PORT}" "${DEPLOY_USER}@${DEPLOY_HOST}" \
  "python3 '$DEPLOY_PATH/.codex/runtime/write_release.py' --product tommma --sha '${RELEASE_SHA:-$(git rev-parse HEAD)}' --frontend '$DEPLOY_PATH/frontend/dist' --marker '$DEPLOY_PATH/.release-revision'"

if [[ "${RESTART_BACKEND}" == "1" ]]; then
  echo "Restarting backend service ${BACKEND_SERVICE_NAME}..."
  ssh -p "${RSYNC_SSH_PORT}" "${DEPLOY_USER}@${DEPLOY_HOST}" \
    "if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files '${BACKEND_SERVICE_NAME}' >/dev/null 2>&1; then systemctl restart '${BACKEND_SERVICE_NAME}'; else echo 'Backend service ${BACKEND_SERVICE_NAME} not found, skipping restart.'; fi"
fi

if [[ -n "${SYNC_USER_EMAIL}" ]]; then
  echo "Syncing user data for ${SYNC_USER_EMAIL} (local -> prod)"
  DEPLOY_USER="${DEPLOY_USER}" DEPLOY_HOST="${DEPLOY_HOST}" RSYNC_SSH_PORT="${RSYNC_SSH_PORT}" \
    "${ROOT_DIR}/scripts/sync-user-data.sh" "${SYNC_USER_EMAIL}"
fi

echo "Check: https://<your-domain>/ and https://<your-domain>/api/health"
