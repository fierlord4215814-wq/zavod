# Evidence harness change summary

The existing `frontend/e2e/three-themes.spec.ts` remains the only theme evidence harness. No second state engine was created.

Changes in this batch:

1. Added correction batch/phase/part paths so small runs cannot overwrite the old theme corpus or each other.
2. Added SHA-256 `index.csv` rows with file, bytes, theme, width, state, role, phase and part.
3. Added exact computed style capture for foreground, background, background image, border, opacity, disabled and selected state.
4. Replaced the invalid Checklists fallback fixture with current library/archive/by-template/workspace response shapes.
5. Added isolated filled, empty and controlled error Checklists states; all mutation requests still abort/report and no write was allowed.
6. Added six bounded correction tests split into small sequential families.
7. Added correction-only console/request-failure capture. No console entry is suppressed.
8. Fixed two harness locators and aligned the controlled 503 expectation with the current API client’s Russian public error mapping.

The final harness hash and the pre-task hash are recorded in `changed-files.txt`. Product API and Checklists consumer code were not changed.
