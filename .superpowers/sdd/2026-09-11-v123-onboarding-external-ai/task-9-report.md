# Task 9 report — v1.2.3 final-fix verification

Worktree: `E:\PRJ\weki\.worktrees\v123-onboarding-external-ai`  
Source fix commit: `c027395c045fd438dd06c8d15885f52b98fce9d2`

## Final fixes

- Removed `WEKI_GEMINI_API_KEY` consumption from `server.mjs`; credentials enter through the Electron safeStorage → child-process IPC path only. Tests use non-secret fixtures and contain no AIza-shaped literals.
- UI save/clear actions now require safe IPC booleans before clearing input, refreshing state, or showing success.
- Explicit new external-AI reprocess is rejected with `409 external_ai_disabled` while existing processing-policy snapshots remain unchanged.
- DOCX relationship/page-break and HWPX section associations are retained; unmapped ZIP assets use a stable path-order logical-page fallback. Transient image bytes remain available through preprocessing and are removed before persistence.
- `waitForLocalServerReady` now fails with bounded `SERVER_READY_TIMEOUT` instead of waiting indefinitely.
- Added `npm run release:metadata`, which derives tracked metadata from the produced installer and builder release date; a second run produced identical metadata.

## Verification results

| Command | Result |
|---|---|
| `node --test test/ai-credentials.test.mjs` | 11 passed, 0 failed |
| `node --test test/ai-settings-api.test.mjs` | 11 passed, 0 failed |
| `node --test test/ai-processing.test.mjs test/processing-settings.test.mjs test/ui-contract.test.mjs` | 72 passed, 0 failed |
| `node --test test/visual-assets.test.mjs` | 7 total: 6 passed, 1 blocked by missing ignored PDF fixture; new DOCX/HWPX mapping tests passed |
| `npm test` | 264 total: 258 passed, 6 failed; all six are missing ignored `test_data` fixtures listed below |
| `npm run build` | PASS; Vite 7.3.6 production build |
| `node --test test/onboarding-e2e.test.mjs` | 2 passed, 0 failed (fixture-free onboarding, drag/clamp/mobile coverage) |
| `npm run test:e2e` | 3 total: 2 passed, 1 blocked by the missing ignored PDF fixture |
| `npm run dist:win` | PASS from source commit `c027395`; initial sandbox network attempt was retried with approved builder network access |
| `npm run release:metadata -- release/Weki-1.2.3-Setup.exe` | PASS twice with identical output |
| `git diff --check` | PASS |

## Verified v1.2.3 artifact

- Installer: `release/Weki-1.2.3-Setup.exe`
- Size: `232126715` bytes
- SHA-256: `32E759C2FFCAD223C26CA75539EDA2B415169D960089030963C39E7CE8E0952F`
- SHA-512: `C89DBE3225A8A152D8154AA45A317D1B688F69140D77511881829C314F34B92A83BC447B62FC198F46A7F5CA85150937D8C9531D6501280A05701C9DE8A98934`
- `release/BUILD_INFO.txt`, `release/latest.yml`, `release/SHA256.txt`, and the top `release/RELEASE_NOTES.md` record version `1.2.3`, the source commit above, the actual size, and matching checksums.
- Package inspection: `app.asar` contains package version `1.2.3`, the server/provider/visual-asset modules, excludes tests, and has no credential literals in packaged text entries.
- Secret checks: no `WEKI_GEMINI_API_KEY` ingress in `server.mjs`; no AIza-shaped literals in tracked tests.

## Environment-blocked checks

The repository intentionally excludes the following ignored fixtures, so the dependent tests could not run:

- `test_data/01 시내버스 개편 방향 및 효과, 개편사항.pdf`
- `test_data/전남광주통합특별시_대전환의_길_교통.hwpx`

No product or packaging failure remains from the completed checks.
