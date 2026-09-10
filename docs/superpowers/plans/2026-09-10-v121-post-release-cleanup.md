# Weki v1.2.1 Post-Release Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the post-v1.2.0 delete-dialog defect, make MYBOX the only supported backup path, remove user-facing search-index maintenance, expose only the application release version, and explicitly defer whole-document reprocessing to v1.3.0.

**Architecture:** Keep the existing MYBOX folder snapshot/catalog synchronization and lazy original restore as the supported backup flow. Remove the obsolete local `.weki` backup producer/consumer and its renderer controls, but leave the server's internal search reindex API available for migration/recovery; do not reinterpret that API as document reprocessing. Make dialog completion render-safe at the renderer boundary so successful destructive operations cannot leave stale modal DOM behind when a follow-up refresh fails.

**Tech Stack:** Electron renderer with Vite, vanilla JavaScript, Express/Node.js server, SQLite/FTS/ANN search stores, Node test runner, Playwright Electron E2E, Vite build, electron-builder Windows NSIS packaging.

**Spec:** `docs/PRD_Weki.md` plus the approved v1.2.1 scope in the current task.

## Global Constraints

- The application release version must be exactly `1.2.1` in `package.json`, `package-lock.json`, renderer display, release notes, and generated release metadata.
- MYBOX remains the supported backup/synchronization path: catalog synchronization uses `knowledge-base.json`; originals remain in the MYBOX `data/<hash>/` layout and are restored lazily.
- v1.2.1 does not read, restore, or promise compatibility with local `.weki` backups produced by v1.2.0; existing files are left untouched rather than silently deleted.
- The existing `/api/v2/search/reindex` endpoint remains an internal migration/recovery operation and is not renamed to or presented as whole-document reprocessing.
- Whole-document reprocessing, including parser/OCR/AI/embedding/index reruns, is explicitly out of scope for v1.2.1 and is a v1.3.0 candidate.
- Internal format/schema/runtime/ranking identifiers remain available to code, APIs, migration logic, and diagnostics; numeric component/ranking versions are not shown in ordinary user-facing settings UI.
- Do not change MYBOX folder backup behavior, source relinking, document-level reprocessing, or uninstall cleanup semantics except where required to remove the obsolete local backup UI/API.

## File Map

- Modify `src/main.js`: close dialogs before asynchronous work, make destructive-action completion render-safe, remove local backup controls, remove search-index maintenance UI, and display only the application release version in settings while hiding runtime component versions.
- Modify `server.mjs`: remove local encrypted `.weki` backup routes and encryption helpers; retain MYBOX routes, document deletion, document-level reprocessing, and internal search reindex recovery.
- Modify `src/server/backup.mjs`: retain MYBOX folder snapshot/validation and document deletion helpers; remove the obsolete local backup snapshot format and validators.
- Modify `test/electron-e2e.test.mjs`: add a regression scenario proving that the delete modal disappears after a successful delete even when the post-delete status refresh fails once.
- Modify `test/ui-contract.test.mjs`: update v1.2.1 release expectations and assert removal of local-backup/search-index UI plus release-only version exposure.
- Modify `test/backup-model.test.mjs`: remove tests for the retired local `.weki` snapshot while retaining MYBOX folder snapshot and deletion coverage.
- Modify `test/status-api.test.mjs` and `test/search-v2-api.test.mjs`: preserve coverage for MYBOX and internal reindex recovery, and add the retired local-backup route contract where a stable assertion is possible.
- Modify `README.md`, `docs/PRD_Weki.md`, `docs/CHANGELOG.md`, `docs/USER_TEST_CHECKLIST.md`, and create `docs/RELEASE_NOTES_V1.2.1.md`: describe MYBOX-only backup, local `.weki` non-compatibility, removal of user-facing index management, and the v1.3.0 reprocessing deferral.
- Modify `package.json` and `package-lock.json`: bump the application version to `1.2.1`.
- Regenerate/update `release/RELEASE_NOTES.md`, `release/BUILD_INFO.txt`, `release/latest.yml`, and `release/SHA256.txt` from the verified v1.2.1 package; do not rely on stale v1.2.0 checksums.

### Task 1: Establish the v1.2.1 failing contracts

**Files:**

- Modify: `test/ui-contract.test.mjs:101-132,393-399,244-246`
- Modify: `test/backup-model.test.mjs:8-70`
- Modify: `test/status-api.test.mjs` near the existing route tests
- Test: the focused Node test files listed above

**Interfaces:**

- Consumes: the approved v1.2.1 behavior and current route/UI contracts.
- Produces: failing assertions that define the removal and version boundaries before implementation.

- [ ] **Step 1: Replace v1.2.0 UI assertions with v1.2.1 assertions.**

  Update `test/ui-contract.test.mjs` so the release metadata expectation is `1.2.1`; replace assertions requiring `암호화 백업 및 복원`, `data-backup`, and `검색 색인 다시 만들기` with assertions that the active renderer does not contain those user-facing controls. Keep the MYBOX catalog sync/original lazy-restore assertions intact.

  Add assertions with the following intent:

  ```js
  assert.doesNotMatch(main, /암호화 백업 및 복원/);
  assert.doesNotMatch(main, /검색 색인 다시 만들기/);
  assert.match(main, /APP_VERSION/);
  assert.match(main, /앱 버전/);
  assert.doesNotMatch(main, /entry\.version\?` ·/);
  ```

- [ ] **Step 2: Remove local snapshot tests from the model contract.**

  Update the import list in `test/backup-model.test.mjs` so it no longer imports `createBackupSnapshot` or `validateBackupSnapshot`, and remove only the tests that exercise the retired `weki-cloud-backup` local snapshot. Keep `createFolderSnapshot`, `validateFolderSnapshot`, `mergeDatabases`, `reconcileFolderSnapshotOriginals`, and `removeDocumentData` coverage unchanged.

- [ ] **Step 3: Add a stable route-removal assertion.**

  In `test/status-api.test.mjs`, start a clean test server and request the retired JSON route:

  ```js
  const response = await fetch(`http://127.0.0.1:${server.port}/api/backups`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "full", passphrase: "not-used" }),
  });
  assert.equal(response.status, 404);
  ```

  Keep the assertion limited to the route being absent; do not couple the test to Express/Vite's exact 404 body.

- [ ] **Step 4: Run the focused tests and confirm they fail for the intended reasons.**

  Run:

  ```powershell
  node --test test/ui-contract.test.mjs test/backup-model.test.mjs test/status-api.test.mjs
  ```

  Expected: failures for the still-present local-backup/search-index UI, the `1.2.0` version expectation, and the still-present `/api/backups` route. Existing unrelated failures must be investigated before proceeding.

- [ ] **Step 5: Commit the contract changes.**

  ```powershell
  git add test/ui-contract.test.mjs test/backup-model.test.mjs test/status-api.test.mjs
  git commit -m "test: define v1.2.1 post-release cleanup contracts"
  ```

### Task 2: Fix the delete confirmation modal lifecycle

**Files:**

- Modify: `src/main.js:40,59,62`
- Modify: `test/electron-e2e.test.mjs` in the existing Electron flow after document indexing

**Interfaces:**

- Consumes: the existing `state.dialog`, `openDialog`, `refresh`, and `DELETE /api/data` contract.
- Produces: a renderer action boundary that clears and renders the modal before awaiting network/refresh work, then renders again on both success and failure.

- [ ] **Step 1: Add a deterministic E2E regression setup.**

  In the existing Electron test, register a Playwright route handler for `**/api/v2/status` with a boolean `failNextV2StatusRefresh`. When the flag is set, abort exactly one matching request and then continue all later requests. Navigate to settings after the fixture is indexed, enter `DELETE ALL DOCUMENTS`, set the flag immediately before clicking the confirmation button, and assert both the modal disappearance and server-side deletion:

  ```js
  let failNextV2StatusRefresh = false;
  await page.route("**/api/v2/status", async (route) => {
    if (failNextV2StatusRefresh) {
      failNextV2StatusRefresh = false;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.locator('button.nav-item[data-nav="settings"]').click();
  await page.locator("#delete-confirmation").fill("DELETE ALL DOCUMENTS");
  await page.locator("#delete-all-data").click();
  failNextV2StatusRefresh = true;
  await page.locator("[data-dialog-confirm]").click();
  await page.waitForSelector(".dialog-backdrop", { state: "detached" });
  await expect.poll(async () => page.evaluate(async () => (await (await fetch("/api/documents")).json()).documents.length)).toBe(0);
  ```

  Use the test file's existing `waitFor` helper if the Playwright version in this project does not expose `expect.poll`.

- [ ] **Step 2: Refactor the generic dialog-confirm handler to render immediately and finally.**

  Extract the current inline handler into a small local function or equivalent control flow. It must capture the callback before clearing state, clear the dialog, render immediately, catch callback errors into `state.toast`, and always render in `finally`:

  ```js
  async function confirmDialogAction() {
    const action = state.dialog?.onConfirm;
    state.dialog = null;
    render();
    try {
      await action?.();
    } catch (error) {
      state.toast = error.message || "작업에 실패했습니다.";
    } finally {
      render();
    }
  }
  ```

  Wire `[data-dialog-confirm]` to this function. Do not wait for `refresh()` before the first render.

- [ ] **Step 3: Make the whole-delete callback report HTTP failure correctly.**

  In the `#delete-all-data` callback, check `response.ok` before showing the success toast. Keep the server's confirmation header unchanged, retain the successful-delete toast even if the follow-up refresh fails, and let the generic handler's `finally` render protect the UI:

  ```js
  const response = await fetch("/api/data", {
    method: "DELETE",
    headers: { "x-weki-confirmation": confirmation },
  });
  if (!response.ok) throw new Error("전체 데이터 삭제에 실패했습니다.");
  state.toast = "전체 문서 데이터가 삭제되었습니다.";
  await refresh().catch(() => {});
  ```

- [ ] **Step 4: Run the focused E2E test.**

  Run:

  ```powershell
  npm run test:e2e -- --test-name-pattern="delete modal|visual document"
  ```

  Expected: the test completes with the document count at zero and `.dialog-backdrop` detached even though one refresh request was aborted. If the environment gates the Electron suite, run the test with the normal project command and record the environment skip rather than claiming the regression was exercised.

- [ ] **Step 5: Commit the bug fix.**

  ```powershell
  git add src/main.js test/electron-e2e.test.mjs
  git commit -m "fix: close delete confirmation after successful deletion"
  ```

### Task 3: Remove local encrypted backup production and restore support

**Files:**

- Modify: `src/main.js:37,62`
- Modify: `server.mjs:17,57,69,396-405,1200-1226`
- Modify: `src/server/backup.mjs:7-10,60-95,159-169`
- Modify: `test/backup-model.test.mjs`
- Modify: `test/status-api.test.mjs`

**Interfaces:**

- Consumes: MYBOX folder backup helpers and the existing settings renderer.
- Produces: MYBOX-only backup behavior; no `/api/backups` producer or restore endpoint; existing `.weki` files are not read, migrated, or deleted by update.

- [ ] **Step 1: Remove the local backup settings card and event wiring.**

  Delete the `LOCAL MAINTENANCE` card from the active `settingsPageV2` markup in `src/main.js`, including `#backup-passphrase`, `#restore-file`, `data-backup`, `#choose-restore`, and the restore change handler. Leave the MYBOX upload/sync controls and their warning/maintenance lock intact. Remove the unused `backups` state lookup from the active settings renderer after confirming no remaining active UI code uses it.

- [ ] **Step 2: Remove local backup server routes and crypto helpers.**

  Remove `encryptBackup`, `decryptBackup`, the `backupsDir` creation dependency used only by local backups, and the two routes below:

  ```js
  app.post("/api/backups", ...);
  app.post("/api/backups/restore", ...);
  ```

  Keep `backups` in uninstall/managed-store cleanup lists so an old v1.2.0 managed backup file is cleaned only when the user uninstalls the managed store, not during application update. Do not add an upgrade-time deletion or migration.

- [ ] **Step 3: Remove only the obsolete local snapshot model.**

  In `src/server/backup.mjs`, remove `BACKUP_FORMAT`, `BACKUP_VERSION`, `createBackupSnapshot`, and `validateBackupSnapshot`. Preserve `FOLDER_BACKUP_FORMAT`, `FOLDER_BACKUP_VERSION`, folder snapshot creation/validation, merge/reconcile logic, and `removeDocumentData`, because MYBOX and document deletion still depend on them. Adjust the `server.mjs` import to retain only `buildPageMetrics`, `createFolderSnapshot`, `reconcileFolderSnapshotOriginals`, and `removeDocumentData`.

- [ ] **Step 4: Remove local-only tests and verify route absence.**

  Delete the local encrypted snapshot tests from `test/backup-model.test.mjs`, retain all MYBOX folder snapshot tests, and keep the route-removal test from Task 1. Confirm that `test/status-api.test.mjs` still covers MYBOX catalog sync and lazy original restore.

- [ ] **Step 5: Run the backup/status tests.**

  Run:

  ```powershell
  node --test test/backup-model.test.mjs test/status-api.test.mjs
  ```

  Expected: MYBOX folder validation, merge, source relink, lazy original download, document deletion, and absence of `/api/backups` all pass.

- [ ] **Step 6: Commit the local-backup removal.**

  ```powershell
  git add src/main.js server.mjs src/server/backup.mjs test/backup-model.test.mjs test/status-api.test.mjs
  git commit -m "refactor: make MYBOX the only supported backup path"
  ```

### Task 4: Remove user-facing search-index management without adding whole-document reprocessing

**Files:**

- Modify: `src/main.js:7,54-56,408-427`
- Modify: `test/ui-contract.test.mjs:393-399`
- Modify: `test/search-v2-api.test.mjs` only if the retained internal endpoint contract needs a clearer comment/assertion

**Interfaces:**

- Consumes: automatic document registration/reprocessing indexing and the existing internal `POST /api/v2/search/reindex` API.
- Produces: no ordinary settings-screen search-index card; internal reindex recovery remains callable and tested; no batch document reprocessing endpoint.

- [ ] **Step 1: Remove the renderer's reindex state and polling.**

  Remove `searchV2` and `searchReindexPollTimer` from renderer state, stop fetching `/api/v2/status` in the ordinary `refresh()` request set, remove the `syncSearchReindexControls` call from `render()`, and delete `startSearchReindexPolling` plus `syncSearchReindexControls`. Do not remove `/api/status` search health data used by the search page.

- [ ] **Step 2: Preserve the internal server recovery endpoint.**

  Keep `GET /api/v2/status` and `POST /api/v2/search/reindex` in `server.mjs`, and add a nearby comment stating that the endpoint is for migration/recovery and is not whole-document reprocessing. Keep the shadow-store swap test in `test/search-v2-api.test.mjs` so this safety path remains verified.

  The intended distinction is:

  ```text
  internal search reindex: existing parsed units -> FTS/Embedding/ANN projection
  v1.3.0 whole-document reprocess: original -> parse/OCR/AI/Embedding/index
  ```

- [ ] **Step 3: Update the UI contract tests.**

  Replace the old positive assertions for `검색 색인 다시 만들기`, `id="reindex-search"`, and renderer `searchV2` state with negative assertions for the active settings UI. Keep API-level reindex tests positive.

- [ ] **Step 4: Run the focused search/UI tests.**

  Run:

  ```powershell
  node --test test/ui-contract.test.mjs test/search-v2-api.test.mjs
  ```

  Expected: settings UI contains no search-index maintenance card while the API still completes a verified shadow-store reindex.

- [ ] **Step 5: Commit the UI removal.**

  ```powershell
  git add src/main.js test/ui-contract.test.mjs test/search-v2-api.test.mjs
  git commit -m "refactor: remove user-facing search index management"
  ```

### Task 5: Keep internal versions while exposing only the application release version

**Files:**

- Modify: `src/main.js:1-16,220,390-400`
- Modify: `test/ui-contract.test.mjs:244-246`
- Modify: `package.json:3`
- Modify: `package-lock.json:3,9`

**Interfaces:**

- Consumes: package metadata, runtime component state, ranking/version identifiers, and existing settings markup.
- Produces: `Weki v1.2.1` user-facing release information; runtime component numbers remain in internal state/API but are not rendered as ordinary settings copy.

- [ ] **Step 1: Bump package metadata to `1.2.1`.**

  Change only the root application version fields in `package.json` and `package-lock.json`:

  ```json
  "version": "1.2.1"
  ```

  Leave dependency versions unchanged.

- [ ] **Step 2: Read the release version from package metadata in the renderer.**

  Import the package JSON through Vite and use one constant for the user-facing copy:

  ```js
  import packageJson from "../package.json";
  const APP_VERSION = packageJson.version;
  ```

  Add `앱 버전 ${APP_VERSION}` to the settings page's non-operational app information copy. Do not duplicate `1.2.1` in renderer strings.

- [ ] **Step 3: Hide component version numbers from ordinary settings copy.**

  In the dynamic runtime component card, render the component label and localized status without appending `entry.version`. In the MYBOX renderer note, replace text such as `문서 화면 처리기 ${renderer.version} 배포본` with `문서 화면 처리기 배포본을 확인했습니다.` Keep `version` in `data-runtime-version`, server responses, manifests, install state, and diagnostic APIs because installation compatibility depends on it.

- [ ] **Step 4: Confirm internal identifiers remain.**

  Do not remove `RANKING_VERSION`, SQLite/schema version, MYBOX folder backup version, runtime manifest/component versions, or ANN generation identifiers. Add/retain a UI contract assertion that `RANKING_VERSION` remains in `src/search/service.mjs` while numeric runtime versions are absent from user-facing renderer templates.

- [ ] **Step 5: Run version/UI tests.**

  Run:

  ```powershell
  node --test test/ui-contract.test.mjs
  ```

  Expected: package and lockfile report `1.2.1`; settings exposes the application version; MYBOX/runtime operation behavior remains covered; no component version is shown in the ordinary runtime card.

- [ ] **Step 6: Commit the version exposure change.**

  ```powershell
  git add src/main.js test/ui-contract.test.mjs package.json package-lock.json
  git commit -m "chore: align v1.2.1 release version display"
  ```

### Task 6: Align product documentation and explicitly defer v1.3.0 reprocessing

**Files:**

- Create: `docs/RELEASE_NOTES_V1.2.1.md`
- Modify: `README.md`
- Modify: `docs/PRD_Weki.md`
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/USER_TEST_CHECKLIST.md`
- Modify: `release/RELEASE_NOTES.md`

**Interfaces:**

- Consumes: the implemented v1.2.1 behavior from Tasks 2–5.
- Produces: consistent user/developer documentation with an explicit non-compatibility statement and a clear v1.3.0 boundary.

- [ ] **Step 1: Add the v1.2.1 release note.**

  Create `docs/RELEASE_NOTES_V1.2.1.md` with these mandatory statements:

  ```markdown
  # Weki v1.2.1 릴리스 노트

  - 전체 문서 데이터 삭제 후 새로고침 실패 시 확인창이 남는 문제를 수정했습니다.
  - 백업은 MYBOX를 사용합니다. v1.2.1은 v1.2.0에서 생성한 로컬 `.weki` 백업의 생성·복원을 지원하지 않습니다.
  - 기존 `.weki` 파일은 업데이트 과정에서 자동 삭제하지 않지만, 복원 대상으로 취급하지 않습니다.
  - 사용자 설정 화면에서 검색 색인 관리 UI를 제거했습니다. 내부 검색 색인 재생성 API는 마이그레이션·복구용으로 유지됩니다.
  - 전체 문서 재처리(파싱·OCR·AI·Embedding·색인 재실행)는 v1.3.0 검토 항목입니다.
  - 일반 화면에는 앱 릴리즈 버전만 표시하고 runtime/ranking 내부 버전은 진단 용도로 유지합니다.
  ```

- [ ] **Step 2: Correct the PRD's backup policy.**

  Revise `docs/PRD_Weki.md` §16 so the supported first-product backup is MYBOX, remove the requirement that local encrypted `.weki` backup/restore is supported, retain the existing MYBOX catalog/lazy-original rules, and preserve the already documented statement that old single `.weki` files are not restored by the new version. Update the requirements table entries that currently mandate local backup compatibility.

- [ ] **Step 3: Correct README, changelog, and user-test guidance.**

  Remove claims that Weki provides local encrypted backup and user-facing full search-index regeneration. Add MYBOX-only backup wording, the explicit `.weki` non-compatibility note, the internal-recovery distinction, and the v1.3.0 whole-document reprocessing boundary. Replace the backup user-test step with MYBOX upload/catalog sync and lazy original restore verification.

- [ ] **Step 4: Add a top-level v1.2.1 changelog entry.**

  Put the v1.2.1 entry before v1.2.0 in `docs/CHANGELOG.md`, link to `RELEASE_NOTES_V1.2.1.md`, and categorize the changes as delete-dialog fix, MYBOX-only backup policy, settings simplification, and version-display cleanup. State that no v1.2.0 local `.weki` restore compatibility is provided.

- [ ] **Step 5: Run documentation consistency searches.**

  Run:

  ```powershell
  rg -n -i "암호화 백업 및 복원|검색 색인 다시 만들기|검색 색인 관리|기존 단일.*weki|전체 문서 재처리|1\.2\.1" README.md docs release
  ```

  Expected: obsolete feature claims appear only in historical v1.2.0 notes where they describe what v1.2.0 contained; current README/PRD/checklist/release note describe the v1.2.1 policy. The v1.3.0 boundary is present and no document promises local `.weki` restore.

- [ ] **Step 6: Commit documentation changes.**

  ```powershell
  git add README.md docs/PRD_Weki.md docs/CHANGELOG.md docs/USER_TEST_CHECKLIST.md docs/RELEASE_NOTES_V1.2.1.md release/RELEASE_NOTES.md
  git commit -m "docs: document v1.2.1 MYBOX-only backup policy"
  ```

### Task 7: Run the complete verification and regenerate release metadata

**Files:**

- Modify: `release/BUILD_INFO.txt`
- Modify: `release/latest.yml`
- Modify: `release/SHA256.txt`
- Modify: `release/RELEASE_NOTES.md`
- Generate/verify: ignored v1.2.1 installer and blockmap under `release/`

**Interfaces:**

- Consumes: the clean v1.2.1 source tree and documentation from Tasks 1–6.
- Produces: verified tests, build, Windows installer metadata, and a release record that is internally consistent at `1.2.1`.

- [ ] **Step 1: Run the full Node test suite.**

  ```powershell
  npm test
  ```

  Expected: zero failed tests. Record any environment-gated E2E skip separately from pass/fail counts.

- [ ] **Step 2: Build the renderer.**

  ```powershell
  npm run build
  ```

  Expected: Vite production build succeeds and the generated bundle contains the active `src/main.js` behavior without local backup/search-index settings controls.

- [ ] **Step 3: Run Electron E2E verification.**

  ```powershell
  npm run test:e2e
  ```

  Expected: the visual document flow and delete-dialog regression pass, or the existing environment-gated skip is reported with its reason.

- [ ] **Step 4: Build the Windows installer.**

  ```powershell
  npm run dist:win
  ```

  Expected: electron-builder produces `release/Weki-1.2.1-Setup.exe` and its blockmap; packaged metadata reports version `1.2.1`.

- [ ] **Step 5: Regenerate and verify release metadata from the actual artifact.**

  Update `release/BUILD_INFO.txt`, `release/latest.yml`, `release/SHA256.txt`, and the top release-notes section using the actual package output. Verify the installer with:

  ```powershell
  Get-FileHash release/Weki-1.2.1-Setup.exe -Algorithm SHA256
  Get-FileHash release/Weki-1.2.1-Setup.exe -Algorithm SHA512
  rg -n "1\.2\.1|Weki-1\.2\.1-Setup\.exe" package.json package-lock.json docs/RELEASE_NOTES_V1.2.1.md docs/CHANGELOG.md release
  ```

  Expected: every application/release reference uses `1.2.1`; checksum files name the v1.2.1 installer; no v1.2.0 checksum is reused.

- [ ] **Step 6: Inspect the final diff and working tree.**

  ```powershell
  git status --short
  git diff --check HEAD~6..HEAD
  git diff --stat HEAD~6..HEAD
  ```

  Confirm that no user data, `.env`, ignored installer binary, or unrelated source changes are included in the release commits. If the number of implementation commits differs from six, run `git diff --check` against the actual pre-work base commit instead of assuming `HEAD~6`.

- [ ] **Step 7: Commit only tracked release metadata if the packaging workflow does not commit it automatically.**

  ```powershell
  git add release/BUILD_INFO.txt release/latest.yml release/SHA256.txt release/RELEASE_NOTES.md
  git commit -m "chore: record verified v1.2.1 release metadata"
  ```

## Self-Review Checklist

- [ ] The delete E2E test fails when the modal is only cleared in state but not rendered, and passes after the immediate/final render change.
- [ ] No active renderer markup or event handler creates/restores local `.weki` backups.
- [ ] MYBOX folder snapshot, catalog synchronization, lazy original restore, and uninstall cleanup remain intact.
- [ ] The internal search reindex API remains tested and is not mislabeled as whole-document reprocessing.
- [ ] No v1.3.0 whole-document reprocessing endpoint or queue policy is introduced in this plan.
- [ ] Runtime, ranking, storage, and backup-format identifiers remain internally available while only `Weki v1.2.1` is user-facing.
- [ ] Current documentation no longer promises local `.weki` compatibility or user-facing search-index management; historical v1.2.0 notes remain historically accurate.
- [ ] No step requires deleting or overwriting a broad directory, and old local backup files are not removed during update.
