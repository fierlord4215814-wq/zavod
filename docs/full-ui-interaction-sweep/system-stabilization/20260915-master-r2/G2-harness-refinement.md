# Late test-only refinement at frozen G2 product

Product remained f5fae924de3e208c68fa6c2878b2ecf016576b3fa36312a23e23cd2543562098. G2 expected manifests were saved before execution. All expected titles/IDs remained; no skipped/xfail/removed negatives and no new product edit.

Native J19 review of bridge01 showed that the saved service read existed while the local UI was still in its existing450ms acknowledgement transition. Source AnnouncementsScreen.acknowledge explicitly awaits450ms, removes local unread row, updates announcement count, then loadUnread. Added an assertion waiting for `.announcement-mobile-bar` «Новых нет» before final archive capture. This strengthens UI proof; no business contract or expected result changed.

Before bytes/hash: snapshots/G2-bridge-ui-settle-before; before test SHA784700544a84975960c92ee06a7f5b16c8397f7b4cd02ce42e033be85da7455b. Final exact test bytes/hash/diff: handoff/source-delta-manifest.json + handoff/source-after/frontend/e2e/master-r2-bridge.spec.ts. Both helper modes J19 and J14 rechecked as G2-browser-bridge-02 **2/2**. Bridge01 **2/2** remains historical, not two extra unique cases. Final report is handoff/final-test-manifest.json; earlier root-level provisional manifest retained.

The82 final unique browser outcomes combine53 base +15 profile +12 return +2 bridge02, on one product identity. They are not one82-case process, and not84 cases. Current expected line numbers differ only because three test lines were inserted; stable title-derived IDs match. Native78 final targets use bridge02; four bridge01 captures remain indexed/viewed but superseded. Actual NotificationsService read/count is0; real WS delivery/immediate global notification badge remains outside isolated proof.

G2 People exact12/12 does NOT resolve G-browser-return-01 intermittent1286→1213. The only return harness change adds observation records/listeners; exact assertion unchanged. Two scoped probes could not reproduce it. No rollback, tolerance broadening or hidden retry.
