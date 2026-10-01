# Publication selection and acknowledgement — R2

Current source repair: AnnouncementsService.visibleWhere selection LIST vs ENTITY; detail/markRead use ENTITY. Coarse controller PermissionGuard and actual UserContextService are exercised; /ack has no permission decorator, so actual service publication/audience policy is decisive. Neither middleware authentication nor HTTP/DB is simulated as live acceptance.

| State | Current list/unread (unread recipient) | Detail/new ack without archive.read | Detail/new ack with archive.read | Archive-only list with archive.read |
|---|---|---|---|---|
| current | visible | allowed | allowed — fixed MI-PUB-01 | excluded |
| future, not archived | excluded | denied | denied | excluded |
| expired, not archived | excluded | denied | denied | excluded |
| archived | excluded | denied | allowed, existing contract retained | visible |
| archived future publication | excluded | denied | allowed, existing historical selection retained | visible |
| deleted | excluded | denied | denied | excluded |

All rows executed for NORMAL/IMPORTANT × archive capability false/true (24 cases). A personal archive retains existing acknowledged/expired/archived logic in loadVisible (activeOnly:false); this does not automatically authorize new ack/detail. Thus an expired unread entry may be listed in personal archive while entity detail/new ack remain denied; archived-future ack remains permitted only under old archive capability. These product inconsistencies are **decision rows**, not silently widened permissions or grounds to block the unambiguous current-case repair. Acknowledged current entity becomes absent from unread/current, present with timestamp in personal archive; report and notifications agree.

20 audience cases: global/factory-wide/multi-department allowed, wrong/inactive department denied, foreign factory/guest/blocked/deleted/no-read-capability denied, each with/without archive capability. Seven additional actual UserContext cases deny old ack after other currently authorized selected factory, UFA revoke, disabled/deleted factory, blocked/deleted identity or read override revocation. Saved existing ack is not deleted by denial. Attachment adapter is not called on denied detail/ack.

Actual controller→AnnouncementsService→persisted memory AnnouncementRead→NotificationsService→current/unread/list/report/archive is exercised with exact entity IDs. Concurrent first ack sees a real Prisma P2002 instance from the unique-key boundary; only exact persisted winner is accepted; one read and one acknowledgement audit. Not PostgreSQL isolation/locking proof. Storage503 does not acknowledge or mark notice; notice adapter503 after read commit recovers on replay without a second read/audit. Final G2-browser-bridge-02 includes real UI→IPC→controller/guard/service503→retry→report/notice→personal archive→Back→revoke403. New assertion waits for existing450ms acknowledgement transition and local header «Новых нет»; first bridge01 screenshot taken before that settlement is superseded, not hidden. Global notification badge remains an asynchronous WS/poll consumer; immediate badge refresh/live delivery is not proved by service count0.

Evidence: B-publication-red-01=41/47; B-publication-green-01=61/61 combined with prior domain; AB-contracts-01 includes all54 new publication cases and unchanged original MI-PUB-01. Snapshot/build/source records accompany each run.
