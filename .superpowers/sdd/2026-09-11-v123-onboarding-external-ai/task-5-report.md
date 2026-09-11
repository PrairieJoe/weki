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
