# D — minimal genuine React type infrastructure

Installed baseline: React18.3.1/react-dom18.3.1, TypeScript5.9.3; npm11.12.1, workspaces + lockfile v3. No React declarations, frontend tsconfig or typecheck. Runtime/framework/package-manager versions must remain unchanged. Previous incomplete90→80 diagnostics are historical only.

Official registry metadata retained in D-*-metadata runs: @types/react18.3.31 (TS minimum5.3), @types/react-dom18.3.7 (TS minimum5.1; React18 types peer), dependencies csstype3.2.3 and @types/prop-types15.7.15. Declaration packages have no lifecycle scripts; csstype has a developer prepublish script, explicitly suppressed with ignore-scripts. Root/backend/frontend manifests have no install hooks. Registry pinned to public npm; no user config/secrets printed or altered. The npm major-upgrade notice is ignored.

`D-install-dry-run` exit0 reports exactly4 additions,0 changes,0 removals,0 audited. No React/Vite/Playwright/TS upgrade or existing dependency pruning. Package/lock bytes verified equal the initial bytes after dry-run.

The generic snapshot wrapper intentionally rejects node_modules. `D-before` therefore saved only its first three package/lock files before failing (no complete manifest). This is not a finished receipt. `D-owner-before` is the complete immutable package/lock/config/test-owner before/ABSENT receipt. Installed dependency metadata/absence is separately inspected; node_modules is not placed in the source export.

Authorized install: workspace frontend dev-only, exact @types/react18.3.31/@types/react-dom18.3.7, same npm/lockfile, ignore-scripts/no-audit/no-fund. After installation compare package-lock entries and runtime versions; only those4 additions should remain. Create browser-source tsconfig with real React+DOM+Vite declarations and noEmit, full src graph. Browser E2E/config is a separately identified scope, not quietly represented as the app type gate.

Full baseline is the unchanged frontend source **after correct type infrastructure is available**, before type repairs. Record full diagnostic identities/files/graph; compare current/resolved/introduced with the same compiler/config. No stub declarations, blanket assertions, disabled checks, or unreachable source exclusions to obtain PASS.
