# SB resolution matrix

| GAP | ROOT CAUSE | FIX | PROOF | STATUS |
|---|---|---|---|---|
| SB-009 | Guest entered the operational WS connect/reconnect path although effective permissions were empty | `App.tsx` skips operational WS for Guest; client cancels stale reconnect after auth-context change | Mobile Guest: 0 WS attempts; no 403/reconnect noise | RESOLVED |
| SB-012 | `sendToFactory` scoped by factory only and payload summaries exposed entity metadata | Existing effective permission result now filters every factory event; payload is opaque `changedAt` | Backend audience regression, cross-factory deny, no forbidden metadata | RESOLVED |
| SB-013 | OKK event was not consumed and mutations did not consistently invalidate after commit | Typed OKK event, post-commit emit, debounced canonical refetch | Two-client OKK refresh without reload; unauthorized actor gets none | RESOLVED |
| SB-015 | Some Wash events lacked usable transport context and open WashScreen did not converge | Post-commit Wash invalidations and debounced list/detail canonical refetch | Two-client message/issue/control refresh; no lifecycle side effect | RESOLVED |
| SB-016 | Defrost depended on unrelated line event and had no profile consumer | Explicit Defrost invalidation and calendar/list canonical refetch | Two-client Defrost refresh; cross-factory and capability deny | RESOLVED |

## Preserved contours

- Shift, assignment, task, chat, notification, announcement and checklist representative realtime smokes passed.
- Chat remains membership-scoped. A missing post-commit `chat_updated` after message creation was restored in the existing chat service; no second event system was introduced.
- Notification remains exact-recipient scoped.
- Auth downgrade/block/access removal closes the old socket; the client does not keep reconnecting with stale authority.

## Out of scope

- SB-017 offline outbox ownership remains open as non-runtime P3.
- SB-018 old App/store/theme fragments remain open as non-runtime P3.

