# Task 7 report — nine-step safe onboarding

## Result

Implemented Task 7 in the requested worktree. The onboarding tour now has the exact nine-step order and targets from the Task 7 brief:

1. `registration-screen` / `add`
2. `choose-files` / `add` / `choose-files`
3. `registration-mode` / `add` / `registration-mode`
4. `processing-queue` / `add` / `processing-queue`
5. `documents-empty` / `documents` / `documents-empty`
6. `search-composer` / `search` / `search-composer`
7. `example-results` / static onboarding example
8. `example-evidence` / static onboarding example
9. `mybox` / `settings` / `mybox`

The static result and evidence cards are built entirely in the onboarding controller. They do not attach handlers, include document IDs, call fetch/search APIs, register files, change settings, trigger MYBOX/consent flows, or mutate application state.

Desktop title-only pointer dragging stores position only for the active tour, clamps it to an 8px viewport gutter, and cleans pointer listeners/capture on pointerup, pointercancel, step/route changes, skip, Escape, and completion. Mobile widths (640px and below) clear inline coordinates and remain centered. Starting/replaying resets to step 1 and the centered position. Existing completed users remain suppressed from automatic replay; manual guide replay remains available. Dialog role, modal semantics, focus trap, Escape, skip/complete, focus restoration, and cleanup remain in place.

While touching `src/main.js`, removed the second `syncGeminiCredentialEditor()` invocation from the render wrapper. Gemini settings continue to bind through the existing single `syncGeminiSettings()` path.

## Verification

- `node --test test/onboarding.test.mjs` — PASS, 14/14
- `node --test test/ui-contract.test.mjs` — PASS, 49/49
- `node --test test/onboarding-e2e.test.mjs` — PASS, 2/2
- `node --test test/ai-processing.test.mjs test/processing-settings.test.mjs test/evidence-display.test.mjs` — PASS, 27/27
- `npm run build` — PASS (`vite build`)
- Broader `test/evidence-processing.test.mjs` check — 3 fixture-dependent failures because `test_data/전남광주통합특별시_대전환의_길_교통.hwpx` is absent from this worktree; unrelated tests pass.
