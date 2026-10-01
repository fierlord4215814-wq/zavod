# Stage55.2 — Tiny Mobile Polish / Overlay, Readability, Demo Data Hygiene

## Discovery result

Stage55.1 phone screenshots confirmed several small but visible human UX issues:

- Bottom mobile action “Ещё” could stay open over fullscreen announcements and long mobile surfaces.
- Profile cards on mobile looked visually translucent because the card itself did not force a solid panel.
- Checklists used one long metadata line, so mobile cards looked like raw developer output.
- Admin permissions had a Russian map for known permissions, but unknown codes still fell back to mixed technical words.
- Orders/stock runtime filtering hid Stage markers but did not hide dirty manual demo records such as `апра` with malformed unit `22`.

Migration was not needed. The fixes are UI/CSS, frontend label mapping, and a tiny runtime DTO filter.

## What changed

### Bottom overlay

The mobile “Ещё” sheet now locks body scroll while open, closes on screen change, and is suppressed on fullscreen announcements. Modal z-index and backdrop contrast were raised so profile/dialog surfaces are above mobile navigation.

### Profile modal

Profile cards now use a solid background, border, and shadow on mobile. This prevents background text from visually leaking through the profile.

### Checklists

Checklist available/library cards now render metadata as readable tags:

- assignment/scope;
- periodicity;
- shift;
- item count.

On 360px buttons stack vertically and long names wrap instead of merging into a single line.

### Admin permissions

Permission labels keep Russian text as primary UI. Unknown permission codes are translated word-by-word where possible instead of being shown as raw English dot-codes. Technical codes remain available as tooltips/advanced context, not as the visible main label.

### Stock runtime hygiene

Runtime orders/stock lists hide marked Stage/test records and dirty demo records with invalid units or known manual noise names. No physical delete is performed. Archive/diagnostic history is not cleaned.

## Regression coverage

Added `stage55_2:tiny-mobile-polish-regression`:

- dirty stock record is not returned in runtime orders list;
- orders summary stays clean;
- admin permissions endpoint still loads;
- fullscreen announcements and checklist endpoints return data without secrets;
- blocked user is denied runtime stock data;
- responses do not expose `storagePath`, secrets, tokens, or password hashes.

## Browser coverage

Added `stage55_2:browser-e2e`:

- mobile fullscreen announcements have no overlapping “Ещё” control;
- profile card is solid;
- checklist cards show tag-style metadata;
- stock list does not show `апра` / malformed `50 22`;
- admin permissions show Russian labels, not raw technical codes;
- lines screen keeps bottom safe space;
- 360px viewport has no horizontal overflow;
- no browser dialogs, mojibake, visible English placeholders, or `storagePath`.

Screenshots are written to:

`docs/stage55-2-tiny-mobile-polish-screenshots/`

## What remains future

- Deeper mobile redesign of line cards is still future; Stage55.2 only fixed overlap/readability blockers.
- Admin permissions can later get a full explanatory permission catalog.
- Dirty manual data is hidden from pilot runtime lists, not physically deleted.
