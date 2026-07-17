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

## Quick Edit Mode

For small safe edits, do not run a long validation cycle unless necessary. If the change only touches interface text, color, spacing, layout, simple visual state, or another minor UI detail and does not touch backend/API/data logic, Prisma schema, auth, desktop updater, deploy scripts, dependencies, or infrastructure, make the edit quickly and limit validation to reviewing the diff or a short targeted command when truly useful.

Visual verification is not required for these low-risk edits; the user will check the result. Do not block small UI/text fixes on a full `build`, full test run, or long validation. In the final response, briefly state that the change is low-risk and which checks were intentionally skipped.

## Parallel Codex Task Template

Use this section when multiple Codex chats or agents work on this repository at the same time. Project-specific guardrails in this file still take priority.

### Operating rules

- One parallel task must run in its own git worktree and branch. Do not run two coding chats in the same checkout unless the task is read-only.
- Recommended branch naming: `feat/<short-task>`, `fix/<short-task>`, or `chore/<short-task>`.
- Before editing, run `git status --short`, `git branch --show-current`, and `git worktree list`; report if the current checkout is not isolated.
- Keep scope narrow and list target files before edits. Avoid shared contracts such as API schemas, auth, payments, migrations, environment variables, and deploy config unless the task explicitly requires them.
- If a task needs a shared contract, update the contract/types/tests first and tell other parallel tasks to rebase or merge before building on it.
- Commit finished work in small commits. Do not merge to `main` from a task chat unless the user explicitly asks.
- Use one integration chat/person to merge branches, resolve conflicts, and run final validation.
- Stop and ask before editing files already modified by another chat/user or before resolving merge conflicts.

### Prompt template

```text
Parallel Codex task
Repo/worktree: <absolute path>
Branch: <branch>
Goal: <one concrete outcome>
Scope: <files/areas allowed>
Do not touch: <files/areas/contracts>
Acceptance checks:
- <check 1>
- <check 2>
Validation:
- <command or "diff review only for low-risk docs/UI text">
Integration notes:
- <contracts changed, migrations, env vars, follow-up risk>
```

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
