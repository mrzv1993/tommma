# Команды проекта

- «Запусти моки»: основная папка на свежем main, изолированная локальная БД/файлы и тестовые данные. Настройки `.env` и production-ключи не загружаются. Известные внешние провайдеры симулируются; для остальных запросов нужен отдельный тестовый адаптер.
- «Запусти прод»: тот же локальный интерфейс и реальный HTTPS API с действующими правами аккаунта. Сохранение меняет production сразу. Локальный backend с production-БД не запускается.
- «Сделай пуш»: проверки по риску, commit только готовых изменений задачи, учёт свежего origin/main и обычный push в main. Чат и просмотр продолжают работать.
- «Заверши задачу»: оставшийся готовый push при необходимости, ожидание нужного деплоя, проверка версии/работоспособности и сценария по риску; очистка только временных файлов задачи.

Git-подготовку выполняет скилл project-workflow. При запуске в уже рабочем чате код не сбрасывается к main. Worktree является запасным вариантом при занятой или небезопасной основной папке. Незавершённые ветки и файлы сохраняются восстанавливаемо.

Конкретные команды, зависимости БД, источники данных и выпуск заданы в `.codex/project.json`. Локально запусти команду из `launch.mock` или `launch.prod`; `launch.status` сообщает папку, текущий commit, адрес и режим. База находится под игнорируемым `.codex-local`, переносить её в production запрещено. MySQL/PostgreSQL запускаются как отдельные принадлежащие этой папке процессы и не меняют системные службы. Приложение показывает «Моки» или «Прод: реальные данные».

Для локальных Node-процессов настройки окружения из файлов отключены; Python backend запускается из отдельной папки с явными тестовыми параметрами. Системные зависимости устанавливаются по lockfile проекта. Внешние платные сервисы в мок-режиме не используют production-ключи. Переключение режима сохраняет код и тестовые данные.

Автовыпуск должен идти: push main → проверки/сборка → разрешённые проектом миграции → деплой → версия/health. Изменение миграций и опасные операции с данными требуют отдельной задачи и проверенного backup. Очистка серверных релизов не входит в эти четыре команды. Если GitHub SSH secrets или подтверждённый hosting отсутствуют, это конкретный блокер автоматического выпуска; наличие YAML не означает выполненный деплой.

Требуется для автодеплоя: DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS. Приватные ключи не копируются в GitHub без отдельного решения.

Тестовый вход в мок-режиме: mock@example.test / mock-password. Эти учётные данные работают только в принадлежащей локальной папке тестовой БД.

Установка зависимостей описана в `setup` настроек проекта; выполняется при отсутствии зависимостей. Для MySQL/PostgreSQL нужен локальный серверный binary, системные службы менять не требуется. `launch.stop` останавливает только процессы этого просмотра; `.codex-local` сохраняет тестовые данные.

Этот проект сохраняет существующий выпуск в общую серверную папку. Откат кода выполняется отдельным revert-коммитом в main с обычным выпуском; автоматического переключения на предыдущую серверную папку здесь нет. Публикация кода по умолчанию не применяет миграции.

## Shared production host

Tommma, Toodo, Hotel and PWRCPL share a host with 2 CPUs and 4 GiB RAM. Server dependency installation, builds and backend activation use the same `flock` at `/var/lock/moths-production-deploy.lock` to prevent concurrent workflows from exhausting production memory. The remote stage fails after waiting 30 minutes. The lock is released automatically when its server process exits; never delete or replace the lock file during a release. Tommma retains its existing in-place source/frontend upload; the lock covers its dependency setup, revision marker and backend restart.

SSH credentials are GitHub environment secrets in `production`: `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS`. Values stay outside Git and strict host-key verification remains required.
