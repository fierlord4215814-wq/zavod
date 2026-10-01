# Owner → affected variants/consumers → required proof

| Owner / variant | Current affected consumers | Planned minimal correction | Required proof |
| --- | --- | --- | --- |
| `.mobile-sheet-header h2` | mobile Settings sheet | Gray/Light foreground token only | Settings Gray/Light 1440/360/390/430; computed fg/bg; scoped Dark compare |
| `.section-subhead h3` | Shift, Okk, Checklists and shared section headings | Gray/Light `--text-strong` | explicit Shift/Okk/Checklists screens on 1440/360/390/430; static consumer inventory |
| `.admin-task-nav-group strong` | four Admin navigation groups on all Admin subsections | Gray/Light `--text-strong` | Admin overview Gray/Light 1440/360/390/430; all four group labels asserted |
| `.shift-log-scope-note` | ShiftLog scope information | Gray/Light theme surface/text/border | ShiftLog Gray/Light 1440/360/390/430 |
| `.tasks-screen > .tab-row .primary-button` | Tasks create action | restore existing primary foreground/background only in Gray/Light | Tasks enabled/focus state Gray/Light 1440/360/390/430; Dark compare; shared disabled primary is proved separately on Login |
| `.announcement-mobile-bar`, `.announcement-tabs` | Announcements mobile header and tabs | Gray/Light control/surface tokens | Announcements normal empty state Gray/Light 1440/360/390/430; selected/inactive/focus styles; Dark compare |
| `.live-refresh-pill` | visible in Tasks, Announcements and ShiftPeople; Chats consumer is deliberately `sr-only` | Gray/Light subtle surface + readable text, preserving `.updated` success semantics | Tasks/Announcements direct computed/screenshot proof at all four widths; ShiftPeople is present in full Shift captures; Chats hidden live-region consumer verified statically |
| `.people-shift-tabs`, `.people-category-tabs`, `.orders-stock-tabs` | People and Orders top-level selectors | scoped Gray/Light segmented surface/text/selected tokens | People/Orders Gray/Light 1440/360/390/430; inactive/selected/focus |
| `.admin-screen .wizard-choice-grid .factory-chip` | Admin factory setup EMPTY/COPY choices | Gray/Light control/selected surfaces and descendant text | both selected/unselected choices Gray/Light 1440/360/390/430; no clicks/writes required |
| `.form-grid .checkbox-row` | synthetic gallery; real Chats and Checklists form consumers | Gray/Light shared foreground only | gallery + one real Chats + one real Checklists consumer; checked state preserved; 1440/360/390/430 |
| `.primary-button:disabled` light-scheme variant | login/initial-loading and any disabled gold primary | raise readable disabled foreground/opacity without enabling | Gray/Light initial loading 1440/360/390/430; `disabled=true`; enabled comparison |
| Checklists fixture contract | `three-themes.spec.ts` intercepted archive/library/workspace GETs | return current DTO shapes and a filled normal workspace; separate empty/error scenarios | normal filled + empty + handled error Gray/Light at 1440/360/390/430; no product write/backend; no raw JS error in normal proof |

## Explicitly unaffected

- Dark palette/geometry; `theme.ts`, `index.html`, `App.tsx`; theme selection/persistence/fallback owner.
- Ops formulas/data, KPI geometry, bottom-nav/fixed navigation, Back lifecycle, RBAC/factory scope, backend/API contracts.
- Main UI Sweep findings/coverage and physical Android/PWA/media gates.
