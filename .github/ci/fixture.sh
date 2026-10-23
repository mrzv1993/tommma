#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" = migrate ]]
npm run prisma:generate
npm --prefix backend run prisma:deploy
(
  cd backend
  export JWT_SECRET="$FOCUS_TEST_JWT_SECRET" PORT=8787 HOST=127.0.0.1
  exec node --import tsx src/server.ts
) >.ci-work/api.log 2>&1 &
echo $! >.ci-work/api.pid
for attempt in {1..60}; do if curl -fsS http://127.0.0.1:8787/health >/dev/null; then exit 0; fi; sleep 1; done
exit 1
