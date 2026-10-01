# Карта трёх тем ZAVOD V1.0

## Один источник состояния

| Контракт | Owner | Реализация |
| --- | --- | --- |
| Допустимые темы | `frontend/src/theme.ts` | `dark`, `gray`, `light` |
| Локальный ключ | `frontend/src/theme.ts` | `zavod.appearanceTheme`; только `localStorage` текущего origin |
| Первый кадр | `frontend/index.html` | синхронный guarded bootstrap до module script |
| React state | `frontend/src/App.tsx` | один `useState<AppTheme>` в существующем root App |
| UI выбора | `frontend/src/App.tsx` | существующие Settings → один блок «Оформление» |
| Визуальные токены | `frontend/src/styles.css` | Dark — canonical default; Gray/Light — scoped CSS custom properties и owner cascade |
| PWA/browser chrome | `frontend/src/theme.ts`, `frontend/index.html` | `color-scheme`, `theme-color`, `background-color` синхронизируются с выбором |

Второй provider, store, design system, backend preference или DB field не создавались. Смена темы не вызывает remount, product request или новую realtime subscription.

## Палитры

| Название в UI | `data-theme` | Фон | Карточки | Основной текст | Акцент | Семантика |
| --- | --- | --- | --- | --- | --- | --- |
| Тёмная | `dark` | существующий Industrial Premium 10F | существующие graphite surfaces | существующий светлый ink | classic gold | существующие success/warning/danger/info |
| Серая | `gray` | `#cbd2d8`, холодный gray-slate | `#edf0f2`/`#f5f7f8` | `#20282f`/`#11171c` | `#9d6815` | тёмные green/red/blue на светлых tint surfaces |
| Светлая | `light` | `#f3efe7`, тёплый off-white | `#fffdfa`/`#ffffff` | `#24201a`/`#15120e` | `#a66b12` | green/red/blue с отдельными tint surfaces |

## Shared owners и точечные exceptions

- Общие surfaces, cards, controls, inputs, tables, navigation, sheets, modals, attachments chrome, messenger and semantic states получают значения через CSS variables.
- Situation line-state sections сохраняют смысловые danger/success/info различия без тёмных островов.
- Messenger list/dialog/bubbles/composer переведены на theme surfaces; own message остаётся отличимым не только цветом.
- Admin nested setup/row/permission/import/export panels имеют scoped overrides, потому что эти owners исторически содержат literal dark surfaces.
- Auth/onboarding, guest banner и factory picker используют те же light-scheme surfaces; warning/info variants остаются семантическими.
- Ops tabs используют theme control surface и gold-selected state; выбранность остаётся текстово/структурно видимой.

## Намеренные границы

- Print layout остаётся white/black и не зависит от пользовательской темы: это N/A для экранной темы.
- Содержимое пользовательских PNG/JPEG/video не перекрашивается; тематизирован только viewer chrome. Это N/A для медиапикселей, не для UI просмотрщика.
- Physical Android, installed PWA chrome и системные file/camera permission dialogs не эмулируют физическое устройство и остаются PENDING.
- UI Sweep findings `036`, `063`, `047`, `060`, `069` не входят в эту задачу и не исправлялись.
