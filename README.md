# Tommma v2

Новый стек проекта:
- Frontend: Vue 3 + Vite + shadcn-vue
- UI Theme: токены из preset `b3QvsAOMS` (без legacy CSS)
- Backend: Node.js (Fastify)
- DB: PostgreSQL + Prisma

## Структура
- `/frontend` — Vue-приложение
- `/backend` — API + Prisma

## Требования
- Node.js 20+
- pnpm 10+
- PostgreSQL 16+

## Быстрый старт
1. Создайте БД PostgreSQL:
```sql
CREATE DATABASE tommma;
```

2. Укажите переменные в `backend/.env`:
```env
PORT=8787
HOST=0.0.0.0
FRONTEND_ORIGIN=http://localhost:5173
JWT_SECRET=change-me
DATABASE_URL=postgresql://YOUR_LOCAL_PG_USER@127.0.0.1:5432/tommma?schema=public
```

3. Выполните первичную установку и применение миграций одной командой:
```bash
npm run setup
```

4. Запустите frontend + backend одной командой:
```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8787`

Проверка сборки:
```bash
npm run check
```

`check` выполняет:
- сборку frontend и backend;
- автоматический запуск локального backend;
- smoke-сценарий API;
- остановку backend после проверки.

Smoke-проверка API (auth/tasks/earnings):
```bash
# backend должен быть запущен вручную (по умолчанию http://localhost:8787)
npm run smoke

# при другом адресе API
BASE_URL=http://localhost:8787 npm run smoke
```

## API (минимум)
- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/session`
- `POST /auth/logout`
- `GET /tasks`
- `POST /tasks`
- `PATCH /tasks/:id`
- `DELETE /tasks/:id`
- `GET /earnings`
- `POST /earnings`
- `PATCH /earnings/:id`
- `DELETE /earnings/:id`

## Что уже перенесено в Vue v2
- UI разбит на компоненты: `AuthPanel`, `SessionToolbar`, `TaskColumnCard`.
- Авторизация: регистрация, вход, проверка сессии, выход.
- Задачи вынесены в отдельную таблицу `tasks` и синхронизируются через `/tasks`.
- Для задач добавлены granular-эндпоинты (`POST/PATCH/DELETE`) для пооперационного обновления.
- Раздел «Заработок за день по проектам» вынесен в отдельную таблицу и API `/earnings`.
- Task Board (To Do / Not Do / Anti-To Do):
  - создание задачи;
  - переключение выполнения;
  - редактирование заголовка;
  - удаление;
  - перенос между колонками через select и drag&drop.
  - навигация по дням (пред./след./сегодня);
  - повторение задач (без повтора / ежедневно / еженедельно);
  - автосоздание инстансов recurring-задач при переходе на дату;
  - удаление recurring: только событие или событие + все следующие;
  - подзадачи (добавление, отметка выполнения, удаление).
  - таймер задачи (play/pause/stop), одновременно активен только один таймер;
  - накопление факта времени (секунды) с сохранением в PostgreSQL.
  - таймер запускается только для задач выбранного дня;
  - авто-стоп running-таймеров при смене локальной даты.
  - undo удаления задачи (5 секунд);
  - прогресс по каждой колонке за выбранный день.

## Примечание по миграции
Старый статический frontend (vanilla JS/PHP) выведен из целевого стека и удалён из рабочей ветки (`api/*.php`, `app.js`, `index.html`, `database.sql`, `styles.css`). UI строится через shadcn-vue + дизайн-токены preset.
