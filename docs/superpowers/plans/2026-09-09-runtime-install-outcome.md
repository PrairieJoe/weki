# Runtime Component Installation Outcome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or **superpowers:executing-plans** to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distinguish successful runtime installation, unavailable MYBOX deployment, and real installation failure while allowing installable components to finish independently.

**Architecture:** Keep `document-renderer` MYBOX-only and keep `semantic-reranker` as a bundled local runtime pack. Extend the server's `installBatch` contract with per-component outcomes, make the batch continue after `unavailable` or `failed` results, and let the presentation layer decide Korean status text and restart eligibility from that contract. Add focused API/UI tests and verify the reranker pack inside the Windows `app.asar` during release validation.

**Tech Stack:** Node.js ESM, Express, Electron 44, vanilla browser UI, Node test runner, electron-builder/NSIS, `@electron/asar` CLI already available through the build toolchain.

**Spec:** `docs/superpowers/specs/2026-09-09-runtime-install-outcome-design.md`

## Global Constraints

- `document-renderer` remains MYBOX-only and is not added to `DEFAULT_RUNTIME_MANIFEST`.
- `semantic-reranker` remains a bundled local file at `src/runtime/packs/semantic-reranker/1.0.0/reranker.mjs`.
- `unavailable` means no deployable source was found; it is not an installation failure.
- A failed component must not prevent later component IDs in the same batch from being processed.
- A batch with no real failures may restart successfully installed components even when renderer is unavailable.
- A batch containing any real failure must not auto-restart.
- Existing lexical/vector fallback, MYBOX credential isolation, lightweight processing, and atomic runtime staging must remain intact.
- Do not modify unrelated working-tree changes from the other session.

---

### Task 1: Lock the batch outcome contract with API tests

**Files:**
- Modify: `test/search-v2-api.test.mjs` near the runtime component API tests
- Modify: `test/runtime-components.test.mjs` only if a lower-level outcome fixture is needed

**Interfaces:**
- Consumes: existing `POST /api/runtime/components/install-all` and `GET /api/runtime/components` endpoints.
- Produces: test fixtures that require `installBatch.results`, `installed`, `unavailable`, and `failed` fields.

- [ ] **Step 1: Add a test for unavailable renderer with successful bundled reranker**

Create a temporary clean data directory, start the test server, request:

```js
await fetch(`${base}/api/runtime/components/install-all`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ componentIds: ["semantic-reranker", "document-renderer"] }),
});
```

Poll `/api/runtime/components` until `installBatch.status !== "indexing"`, then assert:

```js
assert.equal(batch.status, "partial");
assert.equal(batch.results["semantic-reranker"].status, "installed");
assert.equal(batch.results["document-renderer"].status, "unavailable");
assert.deepEqual(batch.failed, []);
assert.ok(batch.installed.includes("semantic-reranker"));
assert.ok(batch.unavailable.includes("document-renderer"));
```

- [ ] **Step 2: Add a test proving a real reranker failure does not stop the next component**

Seed the temporary runtime root with a local manifest whose `semantic-reranker` entry points to a deterministic missing `file:` URL and has a valid-shaped hash/size. Request `semantic-reranker` followed by `document-renderer`. Assert that the batch ends with:

```js
assert.equal(batch.status, "failed");
assert.equal(batch.results["semantic-reranker"].status, "failed");
assert.equal(batch.results["document-renderer"].status, "unavailable");
assert.equal(batch.failed[0].id, "semantic-reranker");
```

Also assert that `currentComponent` is `null` and the batch has a `finishedAt` timestamp, proving the batch completed its accounting instead of hanging at the failed component.

- [ ] **Step 3: Run the new tests before implementation**

Run: `node --test test/search-v2-api.test.mjs`

Expected: FAIL because the current batch exposes only `skipped`, stops on installation exceptions, and does not expose per-component `results`.

- [ ] **Step 4: Commit only the test changes**

```powershell
git add test/search-v2-api.test.mjs test/runtime-components.test.mjs
git commit -m "test: define runtime install outcomes"
```

### Task 2: Implement independent server-side batch outcomes

**Files:**
- Modify: `server.mjs:741-784` for batch state and runtime status
- Modify: `server.mjs:954-978` for the install loop
- Modify: `test/search-v2-api.test.mjs` if the implementation exposes a more precise error field required by the assertions

**Interfaces:**
- Consumes: existing `runtimeInstallOptions`, `installComponent`, and `runtimeStatus` functions.
- Produces: `installBatch.results`, `installBatch.installed`, `installBatch.unavailable`, and `installBatch.failed`.

- [ ] **Step 1: Define one empty batch-state shape**

Replace the current ad hoc state initializer with a shape containing:

```js
{
  status: "idle",
  componentIds: [],
  currentComponent: null,
  completed: 0,
  total: 0,
  results: {},
  installed: [],
  unavailable: [],
  failed: [],
  error: null,
  startedAt: null,
  finishedAt: null,
}
```

Keep `skipped` only as a backward-compatible alias if existing callers require it; new UI and tests must use `unavailable`.

- [ ] **Step 2: Record already-ready components explicitly**

When a requested component is already `ready` and has no update, increment `completed` and write:

```js
runtimeInstallBatchState.results[componentId] = {
  status: "already-ready",
  version: current.version,
};
```

- [ ] **Step 3: Record unavailable sources and continue**

In the `runtimeInstallOptions` catch block, write an `unavailable` result with `reason: "runtime_pack_not_configured"`, push the component ID to `unavailable`, increment `completed`, and continue the loop. Do not set the batch error.

- [ ] **Step 4: Record install failures and continue**

Wrap the `installComponent` call in its own `try/catch`. On failure, write `{ status: "failed", error: error.message }`, push `{ id: componentId, error: error.message }` to `failed`, increment `completed`, and continue to the next component. Do not let this exception reach the outer batch catch.

- [ ] **Step 5: Set the final status from outcome arrays**

After every requested ID has a result:

```js
runtimeInstallBatchState.status = runtimeInstallBatchState.failed.length
  ? "failed"
  : runtimeInstallBatchState.unavailable.length
    ? "partial"
    : "ready";
```

Set `currentComponent = null` and `finishedAt` for both normal and unexpected outer failures. Preserve unexpected outer failures in `error`.

- [ ] **Step 6: Run the focused API tests**

Run: `node --test test/search-v2-api.test.mjs`

Expected: PASS for the new unavailable/failed-continuation cases and all pre-existing API cases.

- [ ] **Step 7: Commit the server contract**

```powershell
git add server.mjs test/search-v2-api.test.mjs
git commit -m "fix: separate runtime unavailable and failed outcomes"
```

### Task 3: Define presentation and restart rules in pure functions

**Files:**
- Modify: `src/runtime/presentation.mjs`
- Modify: `test/runtime-presentation.test.mjs`

**Interfaces:**
- Consumes: component entries and the new `installBatch` shape.
- Produces: `runtimeAction`, `runtimeBatchMessage`, and `shouldAutoRestart` behavior used by `src/main.js`.

- [ ] **Step 1: Add failing presentation tests**

Add assertions for:

```js
assert.deepEqual(runtimeAction({ status: "failed" }, { version: "1.0.0" }), { label: "재시도", disabled: false });
assert.equal(
  runtimeBatchMessage({ status: "partial", installed: ["semantic-reranker"], unavailable: ["document-renderer"], failed: [] }),
  "설치 가능한 구성요소 설치가 완료되었습니다. 문서 화면 처리기는 MYBOX 배포본이 없어 보류되었습니다.",
);
assert.equal(
  runtimeBatchMessage({ status: "failed", failed: [{ id: "semantic-reranker", error: "runtime hash mismatch" }] }),
  "일부 구성요소 설치에 실패했습니다: 검색 결과 재정렬 모델. 오류 원인을 확인하고 재시도하세요.",
);
assert.equal(shouldAutoRestart({ status: "partial", installed: ["semantic-reranker"], failed: [] }, []), true);
assert.equal(shouldAutoRestart({ status: "failed", installed: ["semantic-reranker"], failed: [{ id: "semantic-reranker" }] }, []), false);
```

- [ ] **Step 2: Run the presentation tests to verify failure**

Run: `node --test test/runtime-presentation.test.mjs`

Expected: FAIL on the new `failed`, `partial`, and restart assertions.

- [ ] **Step 3: Implement the minimal presentation rules**

Update `runtimeAction` so `failed` maps to `재시도`. Update `runtimeBatchMessage` to use component labels and the new outcome arrays. Update `shouldAutoRestart` so it returns true for `ready` or `partial` only when `failed` is empty, at least one component was installed, and no active job exists.

- [ ] **Step 4: Run the presentation tests**

Run: `node --test test/runtime-presentation.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the pure presentation behavior**

```powershell
git add src/runtime/presentation.mjs test/runtime-presentation.test.mjs
git commit -m "fix: present runtime install outcomes clearly"
```

### Task 4: Wire the UI to source-aware component outcomes

**Files:**
- Modify: `src/main.js` around `runtimeStatusText`, `enhanceRuntimeCard`, `syncRuntimeCardPresentation`, and `installRuntimeComponent`
- Modify: `test/ui-contract.test.mjs`

**Interfaces:**
- Consumes: server `components` entries and the new `installBatch` fields; presentation helpers from `src/runtime/presentation.mjs`.
- Produces: stable component rows, source-aware install/retry actions, and Korean batch messages.

- [ ] **Step 1: Add UI contract assertions**

Require the source and state vocabulary in `test/ui-contract.test.mjs`:

```js
assert.match(main, /MYBOX 배포본 없음/);
assert.match(main, /재시도/);
assert.match(main, /설치 가능한 구성요소 설치가 완료되었습니다/);
assert.match(main, /runtimeBatchMessage/);
assert.match(main, /sourceType/);
```

- [ ] **Step 2: Add stable component selectors to rendered rows**

Render each runtime row with `data-runtime-component="<id>"`. Change `syncRuntimeCardPresentation` to locate rows by that attribute instead of comparing the visible label text with the internal component ID. This prevents Korean label replacement from breaking later status updates.

- [ ] **Step 3: Present MYBOX unavailability distinctly**

Update `runtimeStatusText(entry)` so a missing entry with `reason === "runtime_pack_not_configured"` and `requiresMybox === true` returns `MYBOX 배포본 없음`; retain `배포 준비 중` for non-MYBOX entries without a source.

- [ ] **Step 4: Pass source metadata into install and retry actions**

When creating a row action, pass `source: metadata.sourceType === "mybox" ? "mybox" : null` into `installRuntimeComponent`. A failed row must use the same endpoint with the current component/version metadata and display `재시도`.

- [ ] **Step 5: Render the batch summary from the new contract**

Use `runtimeBatchMessage(data.installBatch)` after every refresh. Show the summary as an ARIA live status and include the failed component label when `failed` is non-empty. Do not use the old `skipped`-only message as the primary user-facing result.

- [ ] **Step 6: Update the UI tests**

Run: `node --test test/ui-contract.test.mjs`

Expected: PASS, with existing runtime, MYBOX, restart, and Korean-status assertions intact.

- [ ] **Step 7: Commit the UI wiring**

```powershell
git add src/main.js test/ui-contract.test.mjs
git commit -m "fix: distinguish runtime unavailable and failed states in UI"
```

### Task 5: Verify source, package, and release behavior

**Files:**
- Modify: `docs/USER_TEST_CHECKLIST.md` to align RUNTIME-03/RUNTIME-04/RUNTIME-05 with the final outcome wording
- Modify: `docs/CHANGELOG.md` with the runtime installation outcome clarification
- Generated during verification: `release/Weki-1.2.0-Setup.exe`, `release/Weki-1.2.0-Setup.exe.blockmap`, `release/latest.yml`, `release/BUILD_INFO.txt`, `release/SHA256.txt` only if the release workflow updates them

**Interfaces:**
- Consumes: the completed server/UI implementation and `src/runtime/semantic-manifest.mjs`.
- Produces: evidence that the bundled reranker is present and installable in the Windows package.

- [ ] **Step 1: Run all focused runtime tests**

Run:

```powershell
node --test test/runtime-components.test.mjs test/runtime-reranker.test.mjs test/runtime-presentation.test.mjs test/search-v2-api.test.mjs test/ui-contract.test.mjs
```

Expected: PASS with zero failures.

- [ ] **Step 2: Build the renderer and Windows package**

Run:

```powershell
npm run build
npm run dist:win
```

Expected: `release/Weki-1.2.0-Setup.exe` exists and `release/win-unpacked/resources/app.asar` is regenerated.

- [ ] **Step 3: Inspect the packaged runtime pack**

Run:

```powershell
& node_modules/.bin/asar.cmd list release/win-unpacked/resources/app.asar |
  Select-String 'src\\runtime\\packs\\semantic-reranker\\1.0.0\\reranker.mjs'
```

Expected: exactly one matching packaged path.

- [ ] **Step 4: Verify packaged bytes against the manifest**

Run this exact Windows-compatible check using the existing `@electron/asar` toolchain:

```powershell
node --input-type=module -e "import {extractFile} from '@electron/asar'; import crypto from 'node:crypto'; const bytes=extractFile('release/win-unpacked/resources/app.asar','src\\runtime\\packs\\semantic-reranker\\1.0.0\\reranker.mjs'); const hash=crypto.createHash('sha256').update(bytes).digest('hex'); if(bytes.length!==982 || hash!=='31db99da8c2d7c8a1df461ffe652fe2e29d14505a455edbbe6cd5364686e842e') throw new Error(JSON.stringify({length:bytes.length,hash})); console.log(JSON.stringify({length:bytes.length,hash}));"
```

Expected output: `{"length":982,"hash":"31db99da8c2d7c8a1df461ffe652fe2e29d14505a455edbbe6cd5364686e842e"}`.

- [ ] **Step 5: Update the user checklist and changelog**

Document that:

- `semantic-reranker` is bundled and its actual hash/installation error is shown if it fails.
- `document-renderer` remains MYBOX-only and `MYBOX 배포본 없음` is a non-failure state.
- successful installable components can restart even when renderer is unavailable.
- actual failures do not auto-restart and expose `재시도`.

- [ ] **Step 6: Run the complete verification suite**

Run: `npm test`

Expected: all tests pass.

Run: `git diff --check`

Expected: no whitespace errors and no unrelated files staged.

- [ ] **Step 7: Commit documentation and verified release metadata**

```powershell
git add docs/USER_TEST_CHECKLIST.md docs/CHANGELOG.md release/BUILD_INFO.txt release/RELEASE_NOTES.md release/SHA256.txt release/latest.yml
git commit -m "docs: clarify runtime installation outcomes"
```
