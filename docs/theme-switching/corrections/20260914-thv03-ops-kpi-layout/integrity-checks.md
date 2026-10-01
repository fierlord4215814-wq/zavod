# THV-03 integrity checks

- Rich before/after filenames: `36` vs `36`, missing/extra `0`.
- Zero before/after filenames: `6` vs `6`, missing/extra `0`.
- Before/after PNG pixel dimensions: mismatches `0` across all `42` pairs.
- Baseline/final owner snapshots:

| Owner | Baseline SHA-256 | Final SHA-256 |
| --- | --- | --- |
| `frontend/src/styles.css` | `A11237E29EE59A56356218C13289686C55EDA6CF236A34716BC35D2ECA124EB7` | `DEB4D9B688EF639913E2E2B499833EB5AD7E0EDF43C14A29169C218BE461F200` |
| `frontend/src/screens/OpsAuditScreen.tsx` | `4210450BD2C9AA1822E6AE720DBB2332705747C9746993C8C2571541333ABBE6` | `88A3535FA17D3B1344641A922302C677E3D3DF5E2E01A3DB5F30117074C081A0` |
| `frontend/e2e/three-themes.spec.ts` | `62F28FB8286F29F68918F4D5B0F0846D517FD04EF388E03FF6DBD34E914E394D` | `FCB6E1463C5B8D652FAE6FBD89441B370D88F67A1281A06AE18DE4B28B3C0966` |

- Unaffected owner hashes are unchanged from task start: `theme.ts=9F57F204E4840A1D7C97DFCB7A00FD4338D05D60E3AF7D7756FD390438B8EC34`, `App.tsx=4FFD326E93059DDF45E3E0EABC872628EE9180BEA228731DE9EDF59D4E2DDAAC`, `index.html=5F71C93252EF1BCDD851814BC6C9070DAC18259C28888D5C1D21D4B2485CC841`.
- Input ZIP remains external/unchanged: `38F16BE67C2BE767638E9BD071C685CAB8DCDF7FD6884BA63B331DE34E9D0C0B`.
- Product diff changes only Ops presentation hooks and an appended Ops-scoped CSS block. The locally scoped `!important` declarations are required to override existing mobile KPI rules that already use `!important`; no global selector was strengthened.
- No `.env`, cookies, storage state, database, uploads, credentials or secrets are present in this batch.
