# Admin Install Checklist

## Перед Запуском

- PostgreSQL установлен и доступен.
- `DATABASE_URL` задан в backend `.env`.
- `JWT_SECRET` задан и не равен placeholder.
- `uploads/` расположен вне git-tracked файлов.
- Backup plan для DB + uploads подготовлен.

## Установка

1. Установить зависимости.
2. Проверить `db:doctor`.
3. Применить migrations безопасным deploy-подходом.
4. Запустить seed.
5. Собрать backend и frontend.
6. Запустить backend.
7. Проверить `/health` и `/version`.
8. Запустить frontend dev или preview.

## Проверка После Установки

- Вход ADMIN.
- Выбор завода.
- Главное меню.
- Администрирование.
- Уведомления.
- Статистика / Аудит.
- Вложения: metadata без `storagePath`.
- Full regression gate для test/dev окружения.

## Нельзя Делать

- Не запускать destructive reset на production-like базе.
- Не удалять историю физически.
- Не хранить реальные секреты в docs или git.
- Не считать local uploads полноценным production object storage.

## Перед Пилотом

Нужен Stage 22 manual browser/device pass:

- desktop browser;
- mobile 360px;
- реальный телефон при возможности;
- PWA/offline sanity;
- роли ADMIN, MANAGEMENT, MASTER, WORKER, OKK, STORE, TECH_HOLOD, CONTRACTOR_LEAD.
