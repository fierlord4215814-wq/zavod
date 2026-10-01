# Пласт 9: статус требований

| Блок | Статус | Evidence |
| --- | --- | --- |
| Focused checklist runner | PASS | Compact header, current-item focus, collapsed optional comment, secondary pause, sticky navigation |
| Checklist lifecycle | PASS | Workflow `80/80`, periodic lifecycle без failures |
| Default staffing Завода 4 | PASS | 13/13 `DEFAULT_OK`, mutation plan 0, `Люди X/N` из canonical template |
| Canonical department options | PASS | 13 options, normalized duplicates 0, factory scope и LOCAL override |
| Department reconciliation | PASS | 2 P9 fixtures soft-deactivated; references remapped 0; physical delete 0 |
| Assignment cards | PASS | Позиция, сотрудник и статус разделены; mobile 360 PASS |
| Announcement audience modes | PASS | Весь завод / Мой отдел / Выбранные отделы; bulk select/clear и recipient semantics PASS |
| RBAC/factory/privacy | PASS | P9 `21/21`, security/privacy `17/17`, foreign factory denied |
| Browser/mobile | PASS | 3/3 E2E, desktop + 360/390/430, overflow/safe footer/Back PASS |
| Cleanup | PASS | Active P9 templates/runs/departments 0; physical delete 0 |
| Migration | NOT_NEEDED | Схема достаточна |
| Fresh physical runtime | PASS | Новый HTTPS tunnel; frontend/API/manifest/SW/WSS smoke PASS; свежий QR создан |
| Physical phone gate | PENDING | Только пользователь может подтвердить |
