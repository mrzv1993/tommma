# AGENTS.md

## Project Contract

- Stack: Vue 3 + Vite + shadcn-vue frontend, Fastify + Prisma backend, PostgreSQL, Tauri desktop shell.
- Frontend: `frontend/`
- Backend: `backend/`
- Shared release/version scripts: `scripts/`

## Default Workflow

1. Check scope before editing and avoid unrelated rewrites.
2. For UI-only changes, prefer `npm run check:fast`.
3. For backend/API/data changes, run `npm run check` before finalizing.
4. For release/updater work, also run `npm run check:desktop-updater`.

## Commands

- Install/setup: `npm run setup`
- Dev: `npm run dev`
- Fast validation: `npm run check:fast`
- Full validation with smoke: `npm run check`
- API smoke against running backend: `npm run smoke`

## Guardrails

- Do not change Prisma schema, migrations, auth, JWT/cookie behavior, desktop updater config, or deploy scripts unless the task explicitly requires it.
- Do not edit `backend/.env`; update `backend/.env.example` or docs instead.
- Do not change public API routes without updating smoke coverage or documenting the contract change.
- Keep frontend and backend version values in sync through existing `sync:version` scripts.

## Done Criteria

- Acceptance checks from the task are satisfied.
- Relevant validation command was run and reported.
- No unrelated files were modified.
