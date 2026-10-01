# MES4-FACTORY9-DIRECT-01 — bounded verification receipt

28.09.2026, Windows local `mes` only; no Docker, VPS, T1, C0/C1 or old FACTORY09 DB tests.

| Check | Result | Boundary |
|---|---|---|
| Native pre-migration `pg_dump -Fc` | exit0, 13 618 407 bytes, readable TOC 783 entries | Not an independent restore drill |
| Existing migration deploy | 53→57, status current, strict Prisma diff exit0 | No migration58, reset, seed or bootstrap |
| Backend build after TECHNOLOG+ОКК source change | exit0 | Initial compile attempt TS18048 on optional reason, fixed before runtime |
| Frontend Vite build | exit0, 89 modules | Chunk-size advisory, no build failure |
| `node --test` `checklist-verify-01`, `factory09-authority`, `factory09-checklist-consumer`, `factory09-staffing` | 13/13 PASS, exit0 | Isolated source/consumer tests; not live role/UI acceptance |
| Permission catalogue read-only SQL | Four expected `okk`/`wash.okk-review` codes present in `mes` | No override records written by test |
| Runtime after backend restart | `/ready=true`, `/version=MES4-FACTORY9-DIRECT-20260928`, frontend HTTP200, loopback listeners | Live UFA grant/TECHNOLOG consumer still NOT_RUN |
| №4 read-only post-restart counts | Factory1, User2473, Line185, Attachment2230 | Counts do not prove full byte preservation |
| №9 read-only post-restart counts | Factory1, Line9, UFA1 | No new test User yet |
| Existing uploads SHA readback | 2260/2260 original files unchanged, no original missing | Existing 106 absent active Attachment targets remain |
| Checklist browser + SQL | 3 separate completed occurrences A/B/C with own answers/photo; next due 300s after latest completion | General UI archive of ACTIVE parent run remains unverified |

Old ADMIN normal sign-in, №4↔№9 switch, factory9 object persistence and one accessible old №4 photo were observed in the ordinary browser. New personal TECHNOLOG+ОКК UI grant, MANAGEMENT own session, contractor/company/cross-factory journeys, 24-hour natural boundary, independent second user, phone and HTTPS/WSS were **not** observed. Do not promote isolated results to those gates.
