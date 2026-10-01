# Role / route / API parity

Legend: VA = UI_VISIBLE + API_ALLOWED; VD = UI_VISIBLE + API_DENIED; HA = UI_HIDDEN + API_ALLOWED; HD = UI_HIDDEN + API_DENIED; VN/HN = no primary read endpoint for presentation/form screen.

| ACTOR | home | shift | shift-history | people | admin | situation | tasks | wash | okk | stock | orders | checklists | defrost | returns | log | chats | announcements | archive | notifications | ops | report | FOREIGN_FACTORY |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GUEST | VN | HD | HD | HD | HD | HD | HD | HD | HD | HD | HD | HD | HD | HD | HD | HD | HD | HD | HD | HD | VN | 403 |
| WORKER | HN | VA | VA | VA | HD | HD | HD | HD | HD | HD | HD | HD | VA | HA | HD | VA | VA | HA | VA | HD | VN | 403 |
| CONTRACTOR | HN | VA | HA | VA | HD | HD | HD | HD | HD | HD | HD | HD | HA | HA | HD | HD | HD | HA | HD | HD | VN | 403 |
| MASTER | HN | VA | HA | VA | VD | VA | VA | VA | VA | HD | VA | VA | VA | VA | VA | VA | VA | VA | VA | HD | VN | 403 |
| TECH_KIPIA | HN | VA | HD | VA | HD | VA | VA | HD | HD | HD | HD | HD | HA | HA | VA | VA | VA | VA | VA | HD | VN | 403 |
| CONTRACTOR_LEAD | HN | VA | HA | VA | HD | HD | HD | HD | HD | HD | HD | HD | HA | HA | HD | HD | VA | HA | HD | HD | VN | 403 |
| TECHNOLOG | HN | HD | HD | VA | HD | VA | VA | HA | HD | HD | VA | VA | VA | VA | VA | VA | VA | VA | VA | HD | VN | 403 |
| OTHER | HN | HD | HD | VA | HD | HD | HD | HD | HD | HD | HD | HD | HA | HA | HD | HD | VA | HA | HD | HD | VN | 403 |
| TECH_MECHANIC | HN | VA | HD | VA | HD | VA | VA | HD | HD | HD | HD | HD | HA | HA | VA | VA | VA | VA | VA | HD | VN | 403 |
| TECH_ELECTRIC | HN | VA | HD | VA | HD | VA | VA | HD | HD | HD | HD | HD | HA | HA | VA | VA | VA | VA | VA | HD | VN | 403 |
| TECH_HOLOD | HN | VA | HD | VA | HD | VA | VA | HD | HD | HD | HD | HD | VA | HA | VA | VA | VA | VA | VA | HD | VN | 403 |
| TECH_SANTECHNIK | HN | VA | HD | VA | HD | VA | VA | HD | HD | HD | HD | HD | HA | HA | VA | VA | VA | VA | VA | HD | VN | 403 |
| OKK | HN | HD | HD | VA | HD | VA | VA | VA | VA | HD | VA | VA | HA | VA | VA | VA | VA | VA | VA | HD | VN | 403 |
| STORE | HN | HD | HD | VA | HD | HD | HD | HD | HD | HD | HD | HD | HA | VA | VA | VA | VA | VA | VA | HD | VN | 403 |
| MANAGEMENT | HN | VA | HA | VA | HD | VA | VA | VA | VA | VA | VA | VA | VA | VA | VA | VA | VA | VA | VA | VA | VN | 403 |
| ADMIN | HN | VA | HA | VA | VA | VA | VA | VA | VA | VA | VA | VA | VA | VA | VA | VA | VA | VA | VA | VA | VN | 403 |

## Totals

- VA: 142; HD: 133; HA: 28; VD: 1; presentation without primary GET: 32.
- Foreign factory denial: 16/16.
- The single VD is MASTER/Admin overview probe (SB-006); the limited admin workflow still renders via fallback.
- HA classified as: worker-only dedicated ShiftHistory vs shared history API (expected); permission-filtered Archive sections (expected); Defrost SB-003; Returns SB-004; TECHNOLOG Wash SB-005.
- Direct navigation uses app state/session recovery by design, not URL routing. Unauthorized screen state is normalized to a visible screen by App; backend remains final authority.

ROLE_MENU_MATRIX_GATE: PASS  
ROLE_ROUTE_MATRIX_GATE: PASS  
ROLE_API_MATRIX_GATE: PASS  
MENU_ROUTE_API_PARITY_GATE: PASS (all mismatches classified)  
FACTORY_SCOPE_MATRIX_GATE: PASS (16/16 foreign deny)  
FACTORY_SWITCH_CACHE_GATE: PASS WITH PROOF_PENDING SB-011
