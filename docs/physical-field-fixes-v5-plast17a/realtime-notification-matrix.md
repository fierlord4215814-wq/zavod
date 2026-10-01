# Realtime and notification matrix

| EVENT | EMITTER | AUDIENCE | FRONTEND CONSUMER | HISTORY | STATUS | GAP |
|---|---|---|---|---|---|---|
| assignment_updated | Employee/Shift/Line/Wash | factory broadcast | operational invalidation → Shift/Situation | Assignment history | PROVEN_CANONICAL |  |
| shift_updated | Shift/Line | factory broadcast | operational invalidation | ShiftSession/ShiftLog | PROVEN_CANONICAL |  |
| line_updated | Line/Defrost | factory broadcast | appStore line + operational invalidation | LineStatusEvent | PROVEN_CANONICAL | SB-016 Defrost has no profile consumer |
| task_updated | TaskService | factory broadcast | TasksScreen refresh | TaskHistory | PROVEN_CANONICAL |  |
| orders_updated | OrdersService | factory broadcast | OrdersStockScreen refresh | movements/order history | PROVEN_CANONICAL |  |
| wash_updated | Wash/Employee | factory broadcast | partial store + operational invalidation | WashEvent | GAP_FRONTEND_ONLY | SB-015 |
| okk_updated | OkkService | factory broadcast | no frontend event branch | OKK archive | GAP_FRONTEND_ONLY | SB-013 |
| quantity_release_updated | QuantityReleaseService | factory broadcast | OKK/Returns refresh | QuantityRelease | PROVEN_CANONICAL |  |
| checklist_updated | ChecklistsService | factory broadcast | checklist invalidation | Run/Entry history | PROVEN_CANONICAL |  |
| notification_created/count_changed | NotificationsService | recipient users | notification store/count/browser signal | Notification/Read | PROVEN_CANONICAL |  |
| chat_updated | ChatsService | chat participants | ChatsScreen refresh | ChatRead/messages | PROVEN_CANONICAL |  |
| auth_context_changed | Admin/Auth | target user/role | auth refresh/reconnect | AuditLog | PROVEN_CANONICAL |  |

## Notification sources

| SOURCE | TRIGGERS | RECIPIENT OWNER | SCOPE |
|---|---|---|---|
| Заявки | created/done/redirect/LONG escalation | task recipients/actors | entity visibility + factory |
| Заказы/остатки | request created/closed, low stock | department/creator/management | factory + department |
| Мойка | issue/control/OKK review/task done | allowed wash recipients | factory + role/department |
| Чек-листы | overdue and auto-close | assignee/department/management | run visibility |
| Оттайка | start/complete | factory operational recipients | factory |
| Смена | will-be removed/return requested | target/masters | factory/user |
| Пересменка | important log | department/management | factory + department |
| Объявления | important publication/reminder | canonical audience | factory + department/user audience |

## Scope and PWA

- WS authentication checks token epoch, active UserFactoryAccess, blocked/deactivated/password-reset and guest denial.
- SB-012: generic factory broadcast exposes only id/status/type/timestamp, but audience is wider than module permissions; no content DTO is sent.
- Manifest: standalone `Завод`; service worker cache: `zavod-shell-v6`; `skipWaiting`, `clients.claim`, navigation fallback present.
- Stale cache risk: **LOW**. New cache name must still be bumped per deployment, but current activate lifecycle removes older shell caches and does not indefinitely pin the old app.
- Sound/vibration/recent emoji/quick navigation: device-local by design. Notification/Push/camera: browser permission. Business data remains server canonical.

NOTIFICATION_SOURCE_MATRIX_GATE: PASS  
REALTIME_CONSUMER_MATRIX_GATE: PASS (all missing consumers classified)  
SETTINGS_PERSISTENCE_CLASSIFICATION_GATE: PASS
