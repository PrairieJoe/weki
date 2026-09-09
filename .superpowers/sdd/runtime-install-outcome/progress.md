# SDD ledger — plan: docs/superpowers/plans/2026-09-09-runtime-install-outcome.md

## Setup

- Plan and spec read: `docs/superpowers/plans/2026-09-09-runtime-install-outcome.md`, `docs/superpowers/specs/2026-09-09-runtime-install-outcome-design.md`.
- Working tree is `main` with unrelated uncommitted changes from the prior session; implementation must touch only plan-scoped files.
- No linked worktree exists. The plan is being executed in the current workspace because the approved changes depend on the current dirty working tree and the app's current 1.2.0 source state.

## Pre-flight conflict scan

| Pair/task | Shared file or interface | Finding | Ruling |
|---|---|---|---|
| Task 1 ↔ Task 2 | `test/search-v2-api.test.mjs`, `installBatch` | Task 1 defines the new response contract before Task 2 implements it. | Proceed in order; the expected initial failure is intentional. |
| Task 2 ↔ Task 3 | `installBatch` fields | Task 2 produces `results`, `installed`, `unavailable`, and `failed`; Task 3 consumes them. | Consistent with the spec. |
| Task 3 ↔ Task 4 | `runtimeAction`, `runtimeBatchMessage`, `shouldAutoRestart` | Task 3 changes pure presentation behavior; Task 4 wires those helpers into DOM behavior. | Consistent; Task 4 must not duplicate outcome rules. |
| Task 1 ↔ Task 5 | Runtime API tests | Task 5 runs the focused tests after all implementation tasks. | No conflict; Task 5 is verification only for this interface. |
| Task 4 ↔ Task 5 | UI contract and user checklist | Task 4 establishes UI strings; Task 5 documents the final user-facing meanings. | Consistent; update docs only after UI strings settle. |
| Task 1 self-consistency | API test fixture | The plan used `${base}` in the illustrative request without defining `base`. | Ruling: implement with the existing test convention `server.port`/`baseUrl`; no production API change. |
| Task 2 self-consistency | `skipped` compatibility | Existing tests may reference `skipped` while the new contract uses `unavailable`. | Ruling: keep `skipped` as an alias of `unavailable` if existing consumers require it, but make new UI/tests use `unavailable`. |
| Task 3 self-consistency | Restart tests | Existing tests assert unconditional restart for `ready`; the new rule requires an installed component. | Ruling: update the existing ready fixture to include `installed`, preserving the new acceptance criterion. |
| Task 5 self-consistency | Package verification | A generic “extract or read” instruction would be ambiguous on Windows. | Ruling: use the exact `@electron/asar` `extractFile` command added to the plan. |

## Rulings

- Ruling: execute in the current workspace rather than create a new git worktree — the user selected Subagent-Driven execution after another session left the current 1.2.0 changes uncommitted, and a clean worktree from `HEAD` would omit the source state this plan is meant to refine. Cost if wrong: implementation commits and review artifacts will be on the current branch and require selective integration or rollback.

## Task progress

- Task 1: minor (deferred): strengthen the failure test with `completed === total` and exact failed-list assertions; cleanup uses a fixed 200 ms child-process delay.
- Task 1: complete (commit `79cb5659b1fc2f8aa33a19304a3b49d5b8de88d7`, review clean).
- Task 2: minor (deferred): commit `b45f837` includes the pre-existing broad `server.mjs` diff because the file was already dirty; functional review found no issue.
- Task 2: complete (commit `b45f837e44370104b3dbc5b737403e1f6fccfe3e`, review clean).
- Task 3: complete (commit `9cb1b49`, review clean).
- Task 4: review failed — Important findings: preserve MYBOX source metadata for failed-component retries; enforce `document-renderer` MYBOX-only in row and batch paths. Minor finding: avoid duplicated MYBOX wording. Commit-scope concern is deferred as history-only.
- Task 4: Ruling: extend fix scope to `server.mjs` and `src/runtime/presentation.mjs` if needed, in addition to the Task 4 UI files — the spec's MYBOX-only constraint must be enforced at the API/presentation boundary, and a UI-only guard could leave `install-all` able to install a public renderer. Cost if wrong: the fix round touches two additional files, but it prevents a policy bypass.
- Task 4: fix round 1/5 (3 addressed, 0 open; commits `2e4e1b3`; scoped re-review clean).
- Task 4: complete (commits `38cbffd`, `2e4e1b3`; review clean after fix round 1).
- Task 5: review found one Important documentation mismatch: `docs/CHANGELOG.md` reported 169 tests and implied E2E ran inside `npm test`, while the final report/build metadata recorded 174 tests and a separately skipped `npm run test:e2e`.
- Task 5: fix round 1/5 (all findings addressed; commit `7fa0e9e`; re-review clean).
- Task 5: complete (commits `97a0a2d`, `7fa0e9e`; focused tests 76 passed, full tests 174 passed, build/package and ASAR hash verification passed).
- Final review: failed on committed-branch integrity and three user-visible/runtime edge cases; findings were Critical/Important and required a bounded fix loop.
- Final fix round 1/5: commit `c9d27c2` made runtime dependencies self-contained, exposed concrete failure details, marked no-MYBOX renderer unavailable, and aligned MYBOX retry transport; scoped review found three additional provenance/validation gaps.
- Final fix round 2/5: commit `b8e3fef` added manifest-less MYBOX retry and persisted renderer fallback protections; scoped review found provenance persistence and bundled-renderer classification gaps.
- Final fix round 3/5: commit `e619ae0` persisted runtime source metadata, preserved bundled/native renderer provenance, restricted MYBOX restoration to explicit source metadata, and corrected source-specific retry validation; scoped re-review clean with no Critical/Important/Minor findings.
- Final fix round 4/5: commit `7f060e8` committed the v1.2.0 package version fields required for reproducible release packaging.
- Final fix round 5/5: commit `11374f6` added `.gitattributes` byte preservation for the bundled reranker and a source-byte/hash regression test; clean checkout runtime verification passed.
- Final package verification: current-tree focused runtime/UI/API suite 79 passed; Vite build passed; Windows NSIS package regenerated with ASAR reranker path present and 982-byte expected hash; release metadata committed in `11c49e2`. Full current-tree suite reached 176 passed and one environment-flaky `status-api` startup failure on two runs, so release metadata records that caveat instead of claiming an all-green full suite.
- Final review fix: commit `ba36851` committed the intended README v1.2.0 installation/release contract so clean-checkout UI tests are reproducible.
- Final review fix: commit `f355c31` rebuilt merged synonym-search context from merged results, explicitly closed unsupported composite pagination, rejected contradictory public/MYBOX source declarations, and added API coverage; focused API/UI suite passed 74/74.
- Final package refresh: commit `2e86853` records the newly rebuilt installer size and SHA-256/SHA-512 metadata after `f355c31`; ASAR reranker remains 982 bytes with the expected SHA-256 and one archive entry.
- Final review fix: commit `ee1f17c` corrected the default semantic-model provenance to public Hugging Face, kept only the file-backed reranker bundled, and expanded synonym searches to pageSize 200 so merged pagination is complete; the full focused suite passed 107/107.
- Final review fix: commit `5b22e06` aligned the UI contract assertion with semantic-reranker restart requirements.
- Reproducibility fix: rebuilt the installer from a clean archive of `5b22e06`, copied that artifact into `release/`, updated `BUILD_INFO.txt`, `SHA256.txt`, and `latest.yml`, and verified the clean package ASAR contains the 982-byte reranker with the expected hash once.
