#!/usr/bin/env bash
set -euo pipefail
corepack enable
npm ci --no-audit --no-fund
pnpm -C frontend install --frozen-lockfile
npm --prefix backend ci --no-audit --no-fund
