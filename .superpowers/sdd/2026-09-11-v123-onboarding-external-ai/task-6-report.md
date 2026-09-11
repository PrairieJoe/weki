# Task 6 report

Implemented the local/external processing settings UI in `src/main.js` and `styles.css`.

- Replaced the legacy default-mode selector with exactly two choices: `설치된 모델 사용` and `외부 AI 사용`; legacy `auto`, `lightweight`, and `local-ai` values remain readable through the existing server contract.
- Preserved the three per-document modes (`경량 처리만`, `Local AI 허용`, `External AI 허용`) and made External AI selection use the shared consent flow.
- Added renderer-local, masked Gemini Key entry with save/delete through `window.wekiAiCredentials`; the Key is cleared before status refresh and is never interpolated into HTML or application state.
- Added dynamic Gemini model refresh with `supportsGenerateContent` filtering, model persistence, and a document-free connection check.
- Added OFF→ON consent confirmation with version `1`, provider/model and transfer-scope copy, cancel rollback, explicit OFF behavior for new work, and safe fallback/configuration warnings.
- Added UI contract assertions for labels, controls, warning copy, model filtering, document-free checks, save-route separation, and Key non-disclosure.

Verification:

    node --test --test-name-pattern="Task 6|separates installed|never interpolates" test/ui-contract.test.mjs
    PASS (3/3)

    node --test test/processing-settings.test.mjs
    PASS (10/10)

    npm run build
    PASS

    node --test test/ui-contract.test.mjs test/processing-settings.test.mjs
    55 passed, 2 pre-existing failures

The two failures are the existing Task 7 onboarding assertions for the missing `registration-screen` target/copy. They are outside Task 6 and were not changed.

## Task 6 fix round 1 (base `78fd497`)

- Unified consent cancellation through `dismissDialog()`. Cancel-button, backdrop, and Escape dismissal now invoke the dialog's `onCancel` rollback before rendering, including per-document mode rollback.
- Added consent-PATCH failure reconciliation: processing mode and External AI drafts are forced OFF, `/api` settings are re-read, and the UI cannot leave a rejected ON state visible.
- Added the rendered `#gemini-key-message` status region with `role="status"` and `aria-live="polite"`. Credential success/error text is retained across refresh renders without retaining the Key.
- Added focused UI contract coverage for backdrop cancellation, rejected consent PATCH rollback, and accessible credential feedback.

Fix-round verification:

    node --test --test-name-pattern="(Task 6|Gemini Key|consent UI)" test/ui-contract.test.mjs
    PASS (3/3 matching tests)

    node --test test/processing-settings.test.mjs
    PASS (10/10)

    npm run build
    PASS

    git diff --check
    PASS
