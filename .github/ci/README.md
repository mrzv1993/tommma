# Выборочные проверки критичных операций

Карта `checks.json` принадлежит этому репозиторию. Она определяет paths, команды, критичных потребителей, runtime, фикстуры и значимые входы. Общий протокол адаптирован из проверенного Campus: бизнес-карта, package manager, Python/Bun/PostgreSQL/MySQL и порядок выпуска настроены отдельно. Источник и версия указаны в `engine-provenance.json`.

## Локальная работа

Из корня: `python3 .github/ci/local_check.py --plan-only` показывает затронутые профили; без флага выполняет только их. Обычный UI/документация — diff. `--full` — отдельный явный запуск разрешённых критичных профилей. Исторические scripts сохранены в `legacy-scripts.json` для чтения; они не являются автоматическим fallback. Существующие frontend-команды и файлы тестов сохранены для отдельного явного запроса.

Работа с данными никогда не подбирает production URL. DB-профиль требует отдельную явно созданную фикстуру. CI создаёт только loopback-контейнер из подтверждённого digest; `fixture.sh` мигрирует только заданную синтетическую БД, запускает нужный локальный API и завершает его после проверки. `CI_FIXTURE_READY` не следует выставлять вручную для существующей или туннелированной БД.

## CI и выпуск

`critical-checks.yml` связывает план с base/target, генерирует правила `dorny/paths-filter`, сверяет изменённые области с полной инвентаризацией и выбирает критичных потребителей. Для production база — подтверждённый действующий frontend/backend SHA. Delivery и CI-only исключения заданы отдельно; неизвестный эффект, неверная карта или отсутствующая история блокируют gate.

AST-проекция сохраняет обработчики, суммы, payload, значения полей и директивы; исключает известные presentation-атрибуты, текст шаблона и CSS. Общие монолитные файлы могут выбирать несколько критичных профилей. Новые импорты проверяются по source closure; pure UI primitives и class-name helpers явно исключены из critical dependency edges. Новую критичную операцию нужно добавить в карту вместе с профильным контрактом.

Старый результат пригоден только при совпадении значимых code/test/schema/config/dependency/runtime входов и подтверждении GitHub producer run/attempt/job, source SHA, repository и digest артефакта. Missing/expired evidence запускает выбранный профиль; повреждённое evidence блокирует gate. Production не принимает fork/PR/feature/local receipts. Данные и секреты приложения не входят в receipts.

`Critical required` отклоняет failed/cancelled/unexpected_skip, отсутствующий/пустой результат и неверную привязку к исходникам. Валидный пустой UI-план допустим. Ручной запуск по умолчанию affected; full выбирается явно и не включает frontend unit/component/hooks/client-only suites. Сборка артефакта выполняется для выпуска; exact-SHA/stale/lock, backup/schema/checksum, health/readiness/version сохраняются отдельно от test reuse.

## Профили

| Профиль | Проверяемое последствие |
|---|---|
| `data.plan-save` | Serialized nested plan data is retained |
| `data.focus-history` | Retries, concurrency, retained history and user isolation |
| `release.desktop` | Updater version/signature manifest integrity |
| `ci.mechanism` | Selector/gate trust, configuration and local credential-isolation guards |
| `release.safety` | Shared-host lock, exact release and no local fixtures in source transfer |

## Поддержка механизма

`test_select_checks.py` проверяет trust/gate/ошибки, `test_fingerprint.mjs` — ограниченные проекции и dependency closure, `test_map.py` — десять сценариев реальной карты (неприменимые UI/DB случаи для delivery не добавляют продуктовую реализацию). Для изменения протокола сохранять эти контракты и все проектные адаптеры; не переносить чужую карту или замороженный workflow целиком.

Локальные результаты, реальный Actions execution/reuse, публикация и production identity — отдельные уровни доказательств. До публикации и проверки в Actions новый gate остаётся локально подготовленным; действующий опубликованный workflow не обходить.
