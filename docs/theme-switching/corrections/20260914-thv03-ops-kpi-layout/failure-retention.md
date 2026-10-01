# THV-03 retained interrupted evidence

No retained attempt below is marked PASS or included in the 42-before / 42-after accepted PNG counts.

| Directory | Classification | Reason / result |
| --- | --- | --- |
| `failures/before-query-path-harness/` | INTERRUPTED / HARNESS | Query assertion needed recorded search parameters; no accepted screenshot |
| `failures/before-lower-target-visibility-harness/` | INTERRUPTED / HARNESS / THV-06 boundary | Centering a tall section placed hit-test points beneath unchanged fixed navigation; one partial frame excluded |
| `failures/after-scroll-metric-harness/` | INTERRUPTED / HARNESS | ScrollHeight/clientHeight font rounding falsely classified normal line boxes as clipped; no accepted screenshot |
| `failures/after-word-range-harness-attempt-1/` | INTERRUPTED / HARNESS | `Range.getClientRects().length` treated same-line hyphen glyph fragments as a broken word |
| `failures/after-word-range-harness-attempt-2/` | INTERRUPTED / HARNESS | Reconfirmed the same range-fragment false positive; temporary CSS experiment was removed and is not in the final product diff |
| `failures/after-hyphen-wrap-product/` | INTERRUPTED / PRODUCT EDGE | Corrected line-position detector proved a real 360px break opportunity inside `чек-листы`; final Ops-only `text-wrap: balance` resolved it without changing the label text or font size |

Traces, automatic failure screenshots, runtime data and error contexts remain in place. They are intentionally excluded from the small review ZIP; this file gives their retained repository locations.
