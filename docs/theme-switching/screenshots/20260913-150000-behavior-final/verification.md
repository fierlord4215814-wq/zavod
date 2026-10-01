# Theme behavior verification

- Status: PASS, one targeted Playwright test.
- Immediate Gray/Light application and exact selected status proved.
- Root `.app-shell` marker remains, proving no remount.
- API read count and product `/ws` socket count remain unchanged on theme clicks.
- LocalStorage, meta colors and `color-scheme` are synchronized.
- First animation frame after reload is the stored Light theme.
- Theme survives Settings → factory picker → factory selection and logout/login-style reload.
- Unavailable storage still applies Gray and shows a Russian notice.
- Unknown and missing stored values both fall back to Dark.
- `apiWrites=[]`, `isolatedFixtureWrites=[]`, `pageErrors=[]`, `consoleErrors=[]`, `requestFailures=[]`.
