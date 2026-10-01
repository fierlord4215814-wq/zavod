# THV-03 start baseline

## Repository owners

| File | Start SHA-256 | Intended role |
| --- | --- | --- |
| `frontend/src/styles.css` | `A11237E29EE59A56356218C13289686C55EDA6CF236A34716BC35D2ECA124EB7` | Shared CSS plus bounded Ops layout override |
| `frontend/src/screens/OpsAuditScreen.tsx` | `4210450BD2C9AA1822E6AE720DBB2332705747C9746993C8C2571541333ABBE6` | Existing real Ops component; presentation hook only if required |
| `frontend/e2e/three-themes.spec.ts` | `62F28FB8286F29F68918F4D5B0F0846D517FD04EF388E03FF6DBD34E914E394D` | Existing isolated browser/evidence harness |

Full byte snapshots are retained in `baseline-source/`.

## Unaffected control owners

`App.tsx`, `theme.ts` and `index.html` retain their recorded TC14-final hashes. Backend, DB/schema, `.env`, uploads, theme persistence, common navigation and Back are outside the change graph.

## Input material

Input ZIP SHA-256: `38F16BE67C2BE767638E9BD071C685CAB8DCDF7FD6884BA63B331DE34E9D0C0B`.

The four supplied 390px Gray/Light screenshots are immutable historical observations. Current before evidence must be generated from the current product CSS and the same new isolated fixture later used for after.
