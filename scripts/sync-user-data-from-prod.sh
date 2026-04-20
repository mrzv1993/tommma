#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <user-email>" >&2
  exit 1
fi

USER_EMAIL="$1"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_ENV_FILE="${ROOT_DIR}/backend/.env"

: "${DEPLOY_USER:?Set DEPLOY_USER in environment (.deploy.env)}"
: "${DEPLOY_HOST:?Set DEPLOY_HOST in environment (.deploy.env)}"

SSH_PORT="${RSYNC_SSH_PORT:-22}"

if [[ ! -f "${LOCAL_ENV_FILE}" ]]; then
  echo "Local backend env not found: ${LOCAL_ENV_FILE}" >&2
  exit 1
fi

LOCAL_DATABASE_URL="$(grep -E '^DATABASE_URL=' "${LOCAL_ENV_FILE}" | sed 's/^DATABASE_URL=//')"
if [[ -z "${LOCAL_DATABASE_URL}" ]]; then
  echo "DATABASE_URL is empty in ${LOCAL_ENV_FILE}" >&2
  exit 1
fi
LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL%%\?*}"

REMOTE_DATABASE_URL="$(ssh -p "${SSH_PORT}" "${DEPLOY_USER}@${DEPLOY_HOST}" "grep -E '^DATABASE_URL=' /opt/tommma/backend/.env | sed 's/^DATABASE_URL=//'" | tr -d '\r')"
if [[ -z "${REMOTE_DATABASE_URL}" ]]; then
  echo "Failed to read remote DATABASE_URL from /opt/tommma/backend/.env" >&2
  exit 1
fi
REMOTE_DATABASE_URL="${REMOTE_DATABASE_URL%%\?*}"

TMP_TASKS="/tmp/tommma_sync_tasks_from_prod.csv"
TMP_EARNINGS="/tmp/tommma_sync_earnings_from_prod.csv"

echo "Export remote tasks/earnings for ${USER_EMAIL}"
ssh -p "${SSH_PORT}" "${DEPLOY_USER}@${DEPLOY_HOST}" \
  "psql '${REMOTE_DATABASE_URL}' -c \"\\copy (SELECT id,title,column_id,date_key,recurrence_parent_id,recurrence,completed,created_at_ms,actual_seconds,session_seconds,session_started_at_ms,subtasks::text FROM tasks WHERE user_id=(SELECT id FROM users WHERE email='${USER_EMAIL}' LIMIT 1) ORDER BY created_at_ms) TO '${TMP_TASKS}' WITH (FORMAT csv, HEADER true)\""
ssh -p "${SSH_PORT}" "${DEPLOY_USER}@${DEPLOY_HOST}" \
  "psql '${REMOTE_DATABASE_URL}' -c \"\\copy (SELECT id,date_key,project_name,amount_cents FROM daily_earnings WHERE user_id=(SELECT id FROM users WHERE email='${USER_EMAIL}' LIMIT 1) ORDER BY date_key,project_name) TO '${TMP_EARNINGS}' WITH (FORMAT csv, HEADER true)\""

echo "Download csv from remote host ${DEPLOY_HOST}"
scp -P "${SSH_PORT}" "${DEPLOY_USER}@${DEPLOY_HOST}:${TMP_TASKS}" "${DEPLOY_USER}@${DEPLOY_HOST}:${TMP_EARNINGS}" /tmp/

echo "Import local tasks/earnings for ${USER_EMAIL}"
psql "${LOCAL_DATABASE_URL}" <<SQL
BEGIN;

CREATE TEMP TABLE sync_tasks (
  id varchar(64),
  title varchar(255),
  column_id varchar(32),
  date_key varchar(10),
  recurrence_parent_id varchar(64),
  recurrence varchar(16),
  completed boolean,
  created_at_ms bigint,
  actual_seconds integer,
  session_seconds integer,
  session_started_at_ms bigint,
  subtasks_text text
) ON COMMIT DROP;

CREATE TEMP TABLE sync_earnings (
  id varchar(64),
  date_key varchar(10),
  project_name varchar(120),
  amount_cents integer
) ON COMMIT DROP;

\copy sync_tasks FROM '/tmp/tommma_sync_tasks_from_prod.csv' WITH (FORMAT csv, HEADER true)
\copy sync_earnings FROM '/tmp/tommma_sync_earnings_from_prod.csv' WITH (FORMAT csv, HEADER true)

DELETE FROM tasks
WHERE user_id = (SELECT id FROM users WHERE email = '${USER_EMAIL}' LIMIT 1);

INSERT INTO tasks (
  id,
  user_id,
  title,
  column_id,
  date_key,
  recurrence_parent_id,
  recurrence,
  completed,
  created_at_ms,
  actual_seconds,
  session_seconds,
  session_started_at_ms,
  subtasks
)
SELECT
  t.id,
  (SELECT id FROM users WHERE email = '${USER_EMAIL}' LIMIT 1),
  t.title,
  t.column_id,
  t.date_key,
  NULLIF(t.recurrence_parent_id, ''),
  t.recurrence,
  t.completed,
  t.created_at_ms,
  t.actual_seconds,
  t.session_seconds,
  t.session_started_at_ms,
  COALESCE(t.subtasks_text::jsonb, '[]'::jsonb)
FROM sync_tasks t;

DELETE FROM daily_earnings
WHERE user_id = (SELECT id FROM users WHERE email = '${USER_EMAIL}' LIMIT 1);

INSERT INTO daily_earnings (
  id,
  user_id,
  date_key,
  project_name,
  amount_cents
)
SELECT
  e.id,
  (SELECT id FROM users WHERE email = '${USER_EMAIL}' LIMIT 1),
  e.date_key,
  e.project_name,
  e.amount_cents
FROM sync_earnings e;

COMMIT;

SELECT count(*) AS tasks_count
FROM tasks
WHERE user_id = (SELECT id FROM users WHERE email = '${USER_EMAIL}' LIMIT 1);

SELECT count(*) AS earnings_count, min(date_key), max(date_key)
FROM daily_earnings
WHERE user_id = (SELECT id FROM users WHERE email = '${USER_EMAIL}' LIMIT 1);
SQL

echo "Reverse sync completed."
