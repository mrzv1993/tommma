#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ROOT_DIR}/.deploy.env"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi

: "${DEPLOY_USER:?Set DEPLOY_USER (e.g. u12345)}"
: "${DEPLOY_HOST:?Set DEPLOY_HOST (e.g. u12345.beget.tech)}"
: "${DEPLOY_PATH:?Set DEPLOY_PATH (e.g. /home/u/u12345/site.ru/public_html)}"

RSYNC_SSH_PORT="${RSYNC_SSH_PORT:-22}"
RSYNC_DELETE="${RSYNC_DELETE:-1}"
SYNC_USER_EMAIL="${SYNC_USER_EMAIL:-}"

if ! command -v rsync >/dev/null 2>&1; then
  echo "Error: rsync is not installed." >&2
  exit 1
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "Error: ssh is not installed." >&2
  exit 1
fi

RSYNC_ARGS=(
  -avz
  --human-readable
  --progress
  --omit-dir-times
  --no-perms
  --no-owner
  --no-group
  --exclude ".git/"
  --exclude ".codex/"
  --exclude ".vercel/"
  --exclude ".DS_Store"
  --exclude "node_modules/"
  --exclude ".deploy.env"
  --exclude "backend/.env"
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
if [[ -n "${SYNC_USER_EMAIL}" ]]; then
  echo "Syncing user data for ${SYNC_USER_EMAIL} (local -> prod)"
  DEPLOY_USER="${DEPLOY_USER}" DEPLOY_HOST="${DEPLOY_HOST}" RSYNC_SSH_PORT="${RSYNC_SSH_PORT}" \
    "${ROOT_DIR}/scripts/sync-user-data.sh" "${SYNC_USER_EMAIL}"
fi

echo "Check: https://<your-domain>/ and https://<your-domain>/health"
