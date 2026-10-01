# Только live / physical / внешние решения

Службы сейчас **не запускать**. Ни один пункт ниже не является текущим разрешением на стенд, БД, реальные mutations, cleanup или deployment. Реальные fixture/data cleanup UNKNOWN: подключения к БД не было. Исходный dirty worktree, uploads и screenshots сохранены.

## До будущего live стенда

1. Отдельное решение MI-SEC-01: видимость результата повторной команды после factory/permission/entity transition; проверить Task create/take/done и родственные Wash replay branches. Текущий actual negative test должен перестать возвращать чужую factory без изменения idempotency schema/keys и lost-response compatibility. Нужен bounded Astra High/Max security review; product patch не выполнялся.
2. Отдельное решение MI-PUB-01: какие current/expired/archived объявления разрешено acknowledge. Не смешивать archive-only list и current ack; сохранить audience/department/factory/guest/blocked guards. Нужен bounded Astra High/Max current-contract review, не широкое открытие прав.
3.014: авторизованно проверить **существующую изолированную fixture**: exact generator user+operationId+resultKey→WashSession. Затем решить projection-only exclusion vs active occupancy. Без доказанного relation нельзя фильтровать обычные имена. No new schema/business data выбран автоматически.
4.050/MI-CLS-01: policy для настоящего human-name с legacy PILOT prefix. Точная новая classifier поправка не отменяет старое broad legacy правило самостоятельно.

## Live endpoint checklist после отдельного разрешения

| Контур | Минимальная изолированная fixture / роли | Что нельзя доказать текущей заменой инфраструктуры |
|---|---|---|
|036 | ordinary-only, archive-only, both, no-access, guest; свои/чужие factory/department; archived/softdeleted log/comment/file | GET /shift-log/archive, /archive/:id, обычный query bypass; POSTread/comment/importantclose и upload/delete denial. Настоящий Nest middleware→UserContext→Prisma, archive receipt0, file headers/accessrevocation;19bindings настоящегоUI |
|063/044 | Тот же разрешённый technician/MASTER с задачей вне board300 и своим уведомлением | Real GET/tasks/:id/readreceipt, POST/notifications/:id/read/feed/count/source, auth refresh во время factory/logout/revoke; idempotency/delivery неfrontendPromise |
|042/046/050/053 | Уже существующие documented fixtures + обычные human negatives; diagnosticADMIN отдельно | Persistence totals/list/detail/export parity;selectedfactory/UFA сохраняется; история/данные не удаляются |
|Task/Line/Assignment/Shift | Изолированные текущий факт/будущий план/worker/line +два разрешённых участника | Настоящие rowversion/advisory locks/rollback/skill-credit uniqueness, contested PAUSE/STOP/assign; planned→factual/history boundary. Scheduler не включать без отдельного scope |
|Wash/Defrost/Checklists | Своя isolated line/session/request/run/occurrence | Реальные cross-command conflicts, OKK/openissue/complete constraints,occurrence generation and archive stats; repeated notifications после commit failure; не запускать hooks ради proof |
|Quantity/Stock/Orders | Изолированные decimalquantity/movements/release/history;STORE отдельно | Concurrent partial release/take/negativebalance/atomic history;полныйOrderRequest lifecycle иpublication scope |
|Chat/Announcements/Admin | Изолированные audience/memberroles/configentities,foreign andrevoked | HTTPmembership/room joins,attachmentownership/delete,ack/reportdelivery, config derived readers. No mutations onbusinessrows |
|Archive/Ops/Audit | Одни и те же persistedsourceentities,knownrange/fromto | Всеcategories scopedaggregate/export equivalence,realfinancial/time totals, sensitivefields and audit completeness |
|Realtime/polling | Только loopbackauthorizedWS с двумя фабриками/user sessions | Server socket auth/protocol/room scope,revocation delivery,reconnect/order and push. Current fake transport proves frontend lifetime only |

## Physical phone

Android Chrome/PWA: настоящий beforeinstallprompt/cancel/accepted/appinstalled/standalone/reload и оба входа; обновление SW со Stay/discard; native AndroidBack/keyboard/focus/nested sheets;360–390px short viewport/rotation/safe-area. iOS/Safari: честная инструкция вместо обещания install. Web-camera и native capture отдельно; camera/mic granted/denied/site-revoke/unsupported/busy, отмена chooser сохраняетdraft; настоящий codec/audio/video/trackstop. Notification permission и browserpush realdelivery/vibration/sound — с явным пользовательским жестом и разрешением. Не превращать synthetic WAV/canvas или navigator flag в physicalPASS.

## Что не спрятано под live blocker

Непроверенные **offline варианты** (все nested parent-scroll, same-name field type replacement/removed option semantics, дополнительные Wash OKK branches, полный start→occurrence chain, all Admin mutations) помечены PARTIAL/static в Jmatrix/sharedmatrix. Они не названы технически невозможными без БД. Это самостоятельные узкие verification follow-ups, а не разрешение продолжать основной UI Sweep. Toolchain: полноценный React type gate требует согласованного tsconfig/отсутствующих declarations; зависимости не установлены. Library write недоступен: PERSISTENCE_PENDING, подготовлен source delta.
