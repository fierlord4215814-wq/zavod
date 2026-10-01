# FACTORY9-FUNCTIONAL-CLOSURE-04 — состав review

Один ZIP содержит текущий report, actor/factory matrix, test/runtime evidence, source diff, исходные before-снимки восьми owners, текущие after-исходники адресно затронутых owners, один новый isolated test и 12 ключевых UI screenshots. Manifest внутри ZIP содержит SHA-256 и размер каждого payload entry; внешний readback рядом с ZIP сверяет каждый entry с текущим файлом-источником.

`source-before-after.patch` получен механическим `git diff --no-index` между защищёнными предснимками и текущими файлами для восьми owners. Для `employee.service.ts`, `staffing-control-policy.service.ts`, `frontend/src/App.tsx`, `frontend/src/store/app.store.ts` предснимок до этого блока не сохранялся в защищённом наборе; их after включены, но patch не выдаётся за полную before/after дельту именно этих файлов. Их отдельные security tests и live evidence приведены в отчёте.

ZIP не включает DB dump, `.env`, конфигурацию, uploads, их содержимое, cookie/storageState, пароль, токен или JWT. Локальный protected backup указан в отчёте, но остаётся вне пакета. Приложенный пользователем source snapshot не накладывался поверх репозитория.
