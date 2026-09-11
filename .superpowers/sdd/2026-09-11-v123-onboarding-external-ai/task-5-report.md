# Task 5 report

Implemented the external-AI processing policy connection.

- Added default-mode normalization for `external-ai`, legacy mode compatibility, local/external readiness reporting, and explicit External → Local AI → lightweight fallback with safe reason preservation.
- Added safe `/api/settings`, `/api/status.processing.externalAi`, Gemini model-list, and connection-check behavior. Consent version `1` is required for every OFF → ON transition; incomplete preferences remain saveable and report `ready: false`.
- Snapshot requested/effective processing policy, provider, model, and fallback on registration/reprocess jobs and documents. Queue execution uses the snapshot, so turning External AI off does not alter already-registered jobs.
- Connected page enrichment for effective External AI jobs, persisted only safe per-page audit records, and falls back to Local AI/lightweight on provider failure without changing `semantic_model_unavailable` behavior.
- Added contract coverage for resolver order, consent, incomplete setup, response redaction, and document-body exclusion from connection checks.

Focused tests:

    node --test test/processing-settings.test.mjs test/ai-settings-api.test.mjs
    PASS (14/14)

Prescribed server contract command:

    node --test test/processing-settings.test.mjs test/ai-settings-api.test.mjs test/search-v2-api.test.mjs
    48 passed, 1 pre-existing fixture failure

The failing test is `PDF image pages expose a visual evidence preview`; this checkout does not contain `test_data/01 시내버스 개편 방향 및 효과, 개편사항.pdf`.

## Task 5 fix round 1 — review findings

- Connected encrypted Gemini credentials from the Electron main process to the owned server over a private child-process message. The server keeps the decrypted key in memory only for provider calls; renderer/HTTP/SQLite/audit/log/IPC replies remain key-free. Added coverage proving the configured credential store can drive model listing and connection checks without returning the key or provider response.
- Made queued-job resolution read `processingPolicy` when present and legacy `job.mode` otherwise, preserving legacy local/lightweight/external/automatic behavior and the `semantic_model_unavailable` fallback.
- Required `consentVersion: 1` on explicit `mode: external-ai` document registration before creating any registration job.
- Added accurate `External AI` queue/index/reprocess detail labels and server-level coverage for registration policy snapshots, setting OFF after registration, successful enrichment audit, and lightweight fallback audit.

Fix-round tests:

    node --test test/ai-credentials.test.mjs test/processing-settings.test.mjs test/ai-settings-api.test.mjs
    PASS (26/26)

    node --test test/status-api.test.mjs test/gemini-provider.test.mjs test/ai-processing.test.mjs
    PASS (31/31)

    node --test test/processing-settings.test.mjs test/ai-settings-api.test.mjs test/search-v2-api.test.mjs
    PASS (49/51); 2 unrelated existing failures

The prescribed run's failures are the existing missing `test_data/01 시내버스 개편 방향 및 효과, 개편사항.pdf` fixture and a Windows `EPERM` rename race in `ordered runtime install uses bundled transport after the default manifest is persisted`.
