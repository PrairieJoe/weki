# RAG Search Operations UI and v1.2.0 Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose full search-index regeneration to Electron users, release the current RAG/vector-search work as Weki v1.2.0, and produce a verified Windows installer.

**Architecture:** The settings screen will read `/api/v2/status`, start `/api/v2/search/reindex`, and poll the existing reindex state while preserving the current search UI. The Electron package remains the user-facing entry point; `npm run desktop` is the source checkout launcher and `npm run dist:win` creates the NSIS installer from the versioned package metadata.

**Tech Stack:** Electron 44, Express, vanilla browser UI, Node test runner, Vite, electron-builder/NSIS.

**Spec:** Current approved RAG/vector-search plan and the v1.2.0 release request in the active task.

## Global Constraints

- The user-facing flow must be available from the Electron settings screen without PowerShell or direct API calls.
- The full reindex action must show progress, prevent duplicate requests, and retain the current searchable generation on failure.
- The release version must be exactly `1.2.0` in package metadata, lockfile metadata, changelog, and installer artifact name.
- Existing test coverage must remain green; the Windows installer must be generated with `electron-builder --win nsis`.

---

### Task 1: Add failing UI contract coverage for user-facing reindex controls

**Files:**
- Modify: `test/ui-contract.test.mjs`

- [x] Add assertions that the settings UI contains the search-index maintenance section, the `reindex-search` action, visible progress/status wording, and the `/api/v2/search/reindex` request.
- [x] Run `node --test test/ui-contract.test.mjs` and confirm it fails because the controls do not yet exist.

### Task 2: Implement settings-screen reindex status and action

**Files:**
- Modify: `src/main.js`
- Modify: `styles.css` only if the new status/progress presentation needs a missing rule

- [x] Add v2 status to the existing refresh cycle and preserve it in UI state.
- [x] Add a settings card with current generation, state, completed/total counters, and a “검색 색인 다시 만들기” button.
- [x] Confirm before starting, call the existing reindex endpoint, poll status while indexing, disable duplicate actions, and show failure/success messages.
- [x] Run the focused UI contract test and confirm it passes.

### Task 3: Bump release metadata and documentation to v1.2.0

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `docs/CHANGELOG.md`
- Modify: `release/BUILD_INFO.txt` if it is the tracked release metadata for the current artifact

- [x] Set package and lockfile root versions to `1.2.0`.
- [x] Add a v1.2.0 changelog entry covering RAG/vector search, Context Pack, reranker fallback, evaluation, and the reindex UI.
- [x] Update user-facing launch/build documentation to distinguish Electron (`npm run desktop`) from developer-only server/API commands.

### Task 4: Build and verify the Electron Windows installer

**Files:**
- Generated: `release/Weki-1.2.0-Setup.exe` and electron-builder output metadata

- [x] Run `npm test` and `npm run build`.
- [x] Run `npm run dist:win` to produce the NSIS installer.
- [x] Verify the installer exists, has a non-zero size, is named `Weki-1.2.0-Setup.exe`, and package metadata reports version `1.2.0`.
- [x] Run `git diff --check` and inspect the final working-tree diff before reporting completion.
