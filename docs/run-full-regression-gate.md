# Full Regression Gate

## Назначение

Этот gate нужен перед пилотным ручным browser/device проходом и перед любым крупным следующим этапом. Он проверяет DB, Prisma, сборки, все stage regressions и UI hygiene.

## Порядок

1. `npm.cmd run db:doctor --workspace backend`
2. `npm.cmd run prisma:validate --workspace backend`
3. `npm.cmd run prisma:generate --workspace backend`
4. `npm.cmd run prisma:migrate:status --workspace backend`
5. `npm.cmd run build --workspace backend`
6. `npm.cmd run build --workspace frontend`
7. Запустить stage regressions с Stage 6 по Stage 30.
8. `node --check backend/prisma/seed.js`
9. `rg "window\.(prompt|alert|confirm)|\balert\(" frontend/src`
10. Запустить scan на типовые признаки битой кодировки в `frontend/src`, `frontend/public` и `docs`.

## Wrapper

Команды можно вывести списком:

```powershell
node backend/scripts/stage30-full-regression-gate.js
```

Полный запуск через wrapper:

```powershell
$env:RUN_STAGE30_FULL_GATE='1'; node backend/scripts/stage30-full-regression-gate.js
```

Если `prisma:generate` падает на Windows из-за locked DLL, остановите backend node-процесс и повторите generate.
