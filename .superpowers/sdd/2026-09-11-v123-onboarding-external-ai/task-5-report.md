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

## Task 5 fix round 2 — scoped P2 findings

- Queue extraction checkpoints now receive the snapshotted `modeResolution` for both registration and reprocess flows. Progress and completion details therefore describe the effective Local AI/lightweight mode when an External AI request has fallen back, rather than using the requested `job.mode`.
- Credential delivery now clears persisted `externalAi.lastConnection` before acknowledging the private main→server update. A newly saved/replaced key must be checked again before the provider is reported ready; no plaintext key is included in the acknowledgment or public responses.
- Added focused server coverage for credential reload invalidation, executed legacy queued registration jobs without `processingPolicy`, effective-mode formatting for registration/reprocess snapshots, and server-side Local AI→lightweight fallback. The test environment has no valid semantic runtime pack, so it verifies the safe `semantic_model_unavailable`/lightweight fallback; an actual External→Local AI run requires installing a real model pack and is intentionally not faked.

Fix-round focused tests:

    node --test test/ai-credentials.test.mjs test/processing-settings.test.mjs test/ai-settings-api.test.mjs
    PASS (29/29)

Fix-round prescribed server contract command:

    node --test test/processing-settings.test.mjs test/ai-settings-api.test.mjs test/search-v2-api.test.mjs
    PASS (52/54); 2 unrelated existing environment failures

The prescribed run's failures are a concurrent search-server readiness timeout and the missing `test_data/01 시내버스 개편 방향 및 효과, 개편사항.pdf` fixture.

## Cross-task policy fix — global External AI OFF

- External readiness now includes the global `externalAi.enabled` state. OFF therefore reports `ready: false`, `externalAiReady: false`, and the safe `external_ai_disabled` reason even when a key, model, and previously successful connection remain persisted.
- New explicit `mode: external-ai` document registrations require both consent version `1` and External AI enabled. When OFF, the API returns `409 external_ai_disabled` before creating a job or invoking the provider; no existing snapshot is changed.
- Registered external jobs continue to execute from their snapshotted policy after settings are switched OFF. The registration snapshot regression now also asserts the safe OFF status while the completed document retains its external provider/model policy and enrichment audit.
- Kept the per-document lightweight / Local AI / External AI choices intact and mapped the safe server rejection to a clear UI message while preserving the selected files for correction.

Cross-task focused tests:

    node --test test/processing-settings.test.mjs test/ai-settings-api.test.mjs
    PASS (20/20)

    node --test test/ui-contract.test.mjs
    PASS (50/50)

Prescribed server contract command:

    node --test test/processing-settings.test.mjs test/ai-settings-api.test.mjs test/search-v2-api.test.mjs
    PASS (54/55); 1 pre-existing fixture failure

The remaining failure is `PDF image pages expose a visual evidence preview`; this checkout does not contain `test_data/01 시내버스 개편 방향 및 효과, 개편사항.pdf`. The OFF-policy test verified `providerCalls === 0` and an unchanged empty job list.
