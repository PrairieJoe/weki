# Weki v1.2.3 온보딩 2차 개선 및 Gemini 외부 AI 구현 계획

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Weki v1.2.3에 9단계 읽기 전용 온보딩, 이동 가능한 팝업, 설치된 모델/외부 AI의 2가지 기본 처리 모드, Gemini 텍스트·이미지 전처리 보조, 검색 보조 색인, 설치기 문구 수정을 추가한다.

**Architecture:** 기존 Electron main/server/renderer 경계를 유지한다. API Key는 Electron main의 OS safeStorage credential 파일에만 저장하고, Gemini REST 호출과 외부 처리 fallback은 서버 모듈로 격리한다. 생성 메타데이터는 원본 evidence와 분리한 검색 보조 텍스트로만 색인하며, 온보딩은 서버와 상태 store를 호출하지 않는 native controller로 확장한다.

**Tech Stack:** Electron, vanilla JavaScript, Vite, Node.js ESM, SQLite/FTS, Electron safeStorage, Gemini REST API, Node test runner, Electron E2E, electron-builder/NSIS.

**Spec:** docs/superpowers/specs/2026-09-11-v123-onboarding-external-ai-design.md

## Global Constraints

- 사용자 기본 처리 모드는 화면에서 설치된 모델 사용과 외부 AI 사용 두 가지만 노출한다.
- 외부 AI는 기본 OFF이며, OFF에서 ON으로 바꿀 때마다 동의 버전 1 확인을 요구한다.
- API Key는 renderer, SQLite, 일반 설정, 문서 메타데이터, 로그에 평문으로 저장하지 않는다.
- Gemini에는 페이지 또는 슬라이드에서 추출한 텍스트와 선택 이미지만 보낸다. 전체 원본 파일은 보내지 않는다.
- 페이지별 입력 제한은 텍스트 12,000자, 이미지 4개, 이미지 1개 2 MiB, 전체 이미지 8 MiB, 요청 timeout 30초이다.
- 외부 AI는 문서 전처리 보조와 검색 보조 색인만 담당하며 최종 답변 생성에는 사용하지 않는다.
- 생성 메타데이터는 auxiliary text에만 합치고 기존 원본 text, OCR text, 페이지 범위, evidence를 변경하지 않는다.
- 외부 AI OFF는 신규 작업에만 적용하며 이미 등록된 작업의 등록 시점 처리 정책을 바꾸지 않는다.
- 기존 완료 키 weki.onboarding.v1.completed를 읽고, 완료 사용자의 자동 재노출은 하지 않는다.
- 온보딩 예시 단계는 실제 API, 문서 등록, 검색 상태, MYBOX 연결을 호출하지 않는다.
- 프로그램 설치 페이지의 설치 폴더는 유지하고 문서 데이터 페이지의 제목만 문서 데이터 저장 위치로 바꾼다.
- 기능 구현 중 기존 전체 문서 자동 재처리와 Gemini 이외 provider 추가는 하지 않는다.

## 파일 구조와 책임

| 경로 | 변경 | 책임 |
|---|---|---|
| src/server/processing-settings.mjs | 수정 | 처리 모드 정규화, 로컬·외부 준비 상태와 fallback 계산 |
| src/server/ai-credentials.mjs | 생성 | Gemini Key의 암호화 저장, 삭제, 안전한 상태 반환 |
| src/server/gemini-provider.mjs | 생성 | 모델 목록, 연결 확인, 전처리 요청의 Gemini REST adapter |
| src/server/ai-processing.mjs | 생성 | 텍스트·이미지 입력 제한, 응답 검증, 검색 보조 텍스트 |
| src/search/sqlite-store.mjs | 수정 | 생성 메타데이터 색인과 외부 처리 감사 레코드 |
| server.mjs | 수정 | 상태·설정·모델·연결·문서 처리 API와 작업 snapshot 연결 |
| electron-main.cjs | 수정 | AI credential IPC와 server 경계 연결 |
| src/preload.cjs | 수정 | Key 값이 아닌 save/clear/status bridge만 노출 |
| src/onboarding.js | 수정 | 9단계, 정적 예시, 세션 위치, drag/clamp |
| src/main.js | 수정 | 문서 관리 target, 기본 모드 2가지 UI, Gemini 설정과 동의 흐름 |
| styles.css | 수정 | drag handle, 정적 예시, 설정 경고, 반응형 dialog |
| build/installer.nsh | 수정 | 문서 데이터 저장 위치 제목 |
| package.json, package-lock.json | 수정 | v1.2.3 버전 |
| README.md, docs/PRD_Weki.md, docs/USER_TEST_CHECKLIST.md, docs/CHANGELOG.md | 수정 | 사용자 정책과 검증 기준 |
| docs/RELEASE_NOTES_V1.2.3.md | 생성 | v1.2.3 변경 사항과 외부 AI 고지 |
| test/onboarding.test.mjs, test/onboarding-e2e.test.mjs | 수정 | 9단계와 drag/정적 예시/비변경 검증 |
| test/processing-settings.test.mjs | 수정 | 기본 모드와 fallback 계약 |
| test/ai-credentials.test.mjs, test/gemini-provider.test.mjs, test/ai-processing.test.mjs | 생성 | 보안 저장, provider, payload/응답 검증 |
| test/ai-settings-api.test.mjs | 생성 | 설정·동의·모델·연결·문서 작업 계약 |
| test/ui-contract.test.mjs | 수정 | target, installer, v1.2.3 문구 계약 |

기존 구조가 큰 server.mjs와 src/main.js는 이번 패치에서 전면 분리하지 않는다. 외부 provider와 순수 변환 규칙만 새 모듈로 분리하고, route/화면 연결은 기존 파일의 해당 흐름에 국소적으로 추가한다. root main.js는 현재 index.html에서 사용하지 않는 legacy 파일이므로 수정하지 않는다.

---

### Task 1: RED 계약 테스트와 호환 규칙 고정

**Files:**
- Modify: test/processing-settings.test.mjs
- Modify: test/onboarding.test.mjs
- Modify: test/onboarding-e2e.test.mjs
- Modify: test/ui-contract.test.mjs
- Create: test/ai-credentials.test.mjs
- Create: test/gemini-provider.test.mjs
- Create: test/ai-processing.test.mjs
- Create: test/ai-settings-api.test.mjs

**Interfaces:**
- Produces the executable contracts consumed by Tasks 2–8:
  - normalizeDefaultProcessingMode(value)
  - resolveProcessingDefault(settings, components, externalStatus)
  - resolveRequestedProcessingMode(requestedMode, context)
  - createGeminiProvider(options)
  - buildGeminiPageInput(page)
  - validateGeneratedMetadata(value)
  - buildSearchAuxiliaryText(metadata)

- [ ] **Step 1: Add processing-mode failure cases**

    test/processing-settings.test.mjs에 다음 케이스를 추가한다.

    - external-ai가 허용되고, auto가 기존 legacy 값으로 유지된다.
    - auto는 외부 provider가 준비되어도 외부로 자동 승격되지 않는다.
    - 외부 모드가 준비되면 effective mode가 external-ai이다.
    - 외부 모드가 준비되지 않고 local runtime이 준비되면 local-ai로 fallback한다.
    - 둘 다 준비되지 않으면 lightweight로 fallback하고 external_ai_not_configured 또는 external_ai_connection_failed를 보존한다.

    기대 형태는 다음과 같다.

        assert.deepEqual(
          resolveRequestedProcessingMode("external-ai", {
            localAiAvailable: true,
            externalAiAvailable: false,
            externalFailureReason: "external_ai_not_configured"
          }),
          {
            requestedMode: "external-ai",
            effectiveMode: "local-ai",
            fallbackReason: "external_ai_not_configured",
            provider: null,
            modelId: null
          }
        );

- [ ] **Step 2: Add onboarding and UI contract failures**

    온보딩 테스트를 9개 단계 ID와 순서에 맞춰 갱신한다. 기존 완료값은 자동 재노출하지 않고, replay는 1단계로 초기화하며, dialog 위치는 replay마다 중앙으로 초기화하는 기대값을 추가한다. E2E 계약에는 제목 pointer drag, 좌표 clamp, 모바일 중앙 유지, 단계 7·8의 fetch 0회와 mutation 0회를 추가한다.

    UI 계약에는 registration-screen, choose-files, registration-mode, processing-queue, documents-empty, search-composer, example-results, example-evidence, mybox target과 변경 없음 문구를 고정한다. installer 계약은 프로그램 페이지에 설치 폴더가 남고 문서 데이터 페이지에 문서 데이터 저장 위치가 존재하는지 각각 확인한다.

- [ ] **Step 3: Add failing provider, credential, and API tests**

    새 테스트는 아직 존재하지 않는 모듈을 import하거나 아직 구현되지 않은 route를 호출하므로 RED가 되어야 한다. mock fetch는 다음을 검증한다.

    - model 목록 요청은 문서 payload 없이 전송된다.
    - 연결 확인은 선택 모델만 사용하고 문서 텍스트를 전송하지 않는다.
    - enrich 요청은 text와 허용된 image만 포함한다.
    - 응답 JSON 오류와 HTTP 오류가 안전한 error code로 변환된다.
    - credential 테스트의 API Key는 파일 내용, 반환 status, 오류 객체 어디에도 평문으로 나타나지 않는다.

- [ ] **Step 4: Run the RED suite**

    Run: node --test test/processing-settings.test.mjs test/onboarding.test.mjs test/ai-credentials.test.mjs test/gemini-provider.test.mjs test/ai-processing.test.mjs test/ai-settings-api.test.mjs

    Expected: 새 계약이 구현되지 않았다는 실패가 발생한다. 기존 테스트가 실패하면 새 기대값과 기존 회귀를 별도로 기록하고, 다음 task 구현 후에도 원인을 분리해서 확인한다.

- [ ] **Step 5: Commit the contract tests**

    Run:

        git add test/processing-settings.test.mjs test/onboarding.test.mjs test/onboarding-e2e.test.mjs test/ui-contract.test.mjs test/ai-credentials.test.mjs test/gemini-provider.test.mjs test/ai-processing.test.mjs test/ai-settings-api.test.mjs
        git commit -m "test: define v1.2.3 onboarding and external ai contracts"

---

### Task 2: Gemini API Key의 암호화 credential 경계

**Files:**
- Create: src/server/ai-credentials.mjs
- Modify: electron-main.cjs
- Modify: src/preload.cjs
- Test: test/ai-credentials.test.mjs

**Interfaces:**
- Consumes: existing MYBOX safeStorage pattern in electron-main.cjs and src/server/mybox-credentials.mjs.
- Produces:

        createAiCredentialsStore({
          filePath,
          safeStorage,
          fsImpl,
          provider = "gemini"
        })

        store.saveApiKey(apiKey) -> Promise<{ provider: "gemini", configured: true }>
        store.clearApiKey() -> Promise<{ provider: "gemini", configured: false }>
        store.getStatus() -> Promise<{
          provider: "gemini",
          configured: boolean,
          encryptionAvailable: boolean
        }>

        window.wekiAiCredentials.saveGeminiKey(apiKey)
        window.wekiAiCredentials.clearGeminiKey()
        window.wekiAiCredentials.getGeminiStatus()

- [ ] **Step 1: Implement failing file-format assertions**

    credential 테스트에 빈 Key 거부, safeStorage encryption 호출, atomic temp write 후 rename, 기존 파일이 있을 때 덮어쓰기, clear 후 configured false, safeStorage 미사용 상태의 명시적 오류를 추가한다. 파일 JSON에는 weki-credential, provider, version, ciphertext만 허용하고 API Key 원문이 없어야 한다.

- [ ] **Step 2: Implement the credential store**

    mybox-credentials.mjs의 atomic write와 safeStorage 흐름을 재사용하되 provider를 Gemini로 고정한다. saveApiKey는 trim 후 빈 문자열을 거부하고 safeStorage.encryptString 결과만 JSON에 쓴다. getStatus는 파일 존재와 복호화 가능 여부만 확인하며 평문을 반환하지 않는다. 파일 쓰기 중 실패하면 temp 파일을 남기지 않고 기존 credential을 보존한다.

- [ ] **Step 3: Add main-process IPC**

    electron-main.cjs에 save/clear/status IPC를 추가한다. save 또는 clear 후 기존 server restart 소유권 규칙을 사용해 서버가 새 credential을 읽도록 한다. IPC 응답은 configured, encryptionAvailable과 안전한 오류 코드만 반환한다. API Key를 console, renderer event, restart command argument에 넣지 않는다.

- [ ] **Step 4: Expose the preload bridge**

    src/preload.cjs에 window.wekiAiCredentials를 추가한다. 함수는 API Key를 저장하거나 삭제할 때만 main으로 전달하며 get status는 boolean만 받는다. 기존 MYBOX bridge의 이름과 동작은 변경하지 않는다.

- [ ] **Step 5: Run the focused tests**

    Run: node --test test/ai-credentials.test.mjs

    Expected: safeStorage mock과 temp fixture에서 PASS; grep 가능한 파일·응답·오류 객체에서 테스트 Key가 0회여야 한다.

- [ ] **Step 6: Commit the credential boundary**

    Run:

        git add src/server/ai-credentials.mjs electron-main.cjs src/preload.cjs test/ai-credentials.test.mjs
        git commit -m "feat: store gemini credentials in encrypted storage"

---

### Task 3: Gemini provider adapter와 안전한 요청 계약

**Files:**
- Create: src/server/gemini-provider.mjs
- Modify: test/gemini-provider.test.mjs

**Interfaces:**
- Consumes: encrypted Key from Task 2 and the design spec's text/image limits.
- Produces:

        createGeminiProvider({
          apiKey,
          modelId,
          fetchImpl = globalThis.fetch,
          baseUrl = "https://generativelanguage.googleapis.com/v1beta",
          timeoutMs = 30000
        }) -> {
          listModels() -> Promise<Array<{
            id: string,
            displayName: string,
            supportsGenerateContent: true
          }>>,
          checkConnection() -> Promise<{
            status: "ready",
            provider: "gemini",
            modelId: string
          }>,
          enrichPage(input) -> Promise<GeneratedMetadata>
        }

    enrichPage의 input은 { page, text, images }, image는 { name, mimeType, base64 }이다. GeneratedMetadata는 { summary, topic, keywords, visualDescriptions }이다.

- [ ] **Step 1: Add mock-fetch assertions for URL, headers, and payload**

    listModels는 provider model 목록 endpoint를 호출하고 generateContent capability가 있는 항목만 반환한다. checkConnection은 문서 데이터 없이 선택 model에 최소 연결 요청을 보낸다. enrichPage는 text와 image inline data만 request body에 넣고 Key는 URL query 또는 SDK 내부 인증 영역 외의 body/header에 넣지 않는다.

- [ ] **Step 2: Add timeout and error mapping tests**

    mock fetch가 HTTP 401, 403, 429, 5xx, invalid JSON, abort를 각각 반환하게 하고 다음 error code로 정규화한다.

    - external_ai_invalid_key
    - external_ai_permission_denied
    - external_ai_rate_limited
    - external_ai_provider_error
    - external_ai_invalid_response
    - external_ai_timeout

    오류 객체에는 URL 전체, API Key, request body, 원본 응답 전문을 넣지 않는다.

- [ ] **Step 3: Implement the REST adapter**

    외부 SDK dependency는 추가하지 않는다. baseUrl과 fetchImpl을 주입해 unit test가 네트워크 없이 실행되게 한다. 모델 목록에서는 text generation이 아닌 embedding 모델과 capability 없는 항목을 제외한다. checkConnection은 선택된 modelId가 없으면 external_ai_model_not_selected를 반환한다. enrichPage는 structured JSON 응답을 요청하고 response text에서 JSON을 안전하게 추출한 뒤 Task 4의 validator에 넘긴다.

- [ ] **Step 4: Implement response normalization**

    provider 응답은 summary, topic, keywords, visualDescriptions만 추출한다. 응답이 markdown fence 안에 있거나 알 수 없는 필드를 포함해도 허용된 객체로 정규화한다. JSON parse 실패는 provider exception이 아니라 external_ai_invalid_response로 반환한다.

- [ ] **Step 5: Run the provider tests**

    Run: node --test test/gemini-provider.test.mjs

    Expected: 모든 network call이 mock fetch로만 발생하고, 요청 body와 결과에 API Key가 포함되지 않은 PASS.

- [ ] **Step 6: Commit the provider adapter**

    Run:

        git add src/server/gemini-provider.mjs test/gemini-provider.test.mjs
        git commit -m "feat: add gemini preprocessing provider adapter"

---

### Task 4: 텍스트·이미지 전처리, 검색 보조 색인, 감사 레코드

**Files:**
- Create: src/server/ai-processing.mjs
- Modify: src/processing/visual-assets.mjs
- Modify: src/processing/document-renderer.mjs
- Modify: src/processing/pdf-visual.mjs
- Modify: src/search/sqlite-store.mjs
- Modify: server.mjs
- Test: test/ai-processing.test.mjs

**Interfaces:**
- Consumes: page/slide objects and ephemeral visual bytes from current renderers; provider.enrichPage from Task 3.
- Produces:

        buildGeminiPageInput(page) -> {
          page: number,
          text: string,
          images: Array<{ name, mimeType, base64 }>
        }

        validateGeneratedMetadata(value) -> GeneratedMetadata
        buildSearchAuxiliaryText(metadata) -> string
        enrichPagesForSearch(pages, {
          provider,
          now = () => new Date().toISOString(),
          onAudit
        }) -> Promise<{ pages, audits }>

        GeneratedMetadata = {
          summary: string,
          topic: string,
          keywords: string[],
          visualDescriptions: Array<{ assetName: string, description: string }>
        }

- [ ] **Step 1: Write payload-limit and evidence-preservation tests**

    테스트 fixture 페이지에 긴 text, 5개 이미지, 2 MiB 초과 이미지, 여러 이미지 합계 8 MiB 초과를 넣는다. 기대값은 text truncation, 이미지 최대 4개, 이미지 byte cap, 전체 cap과 excluded image count이다. page의 original text/nativeText/ocrText와 evidence range는 enrich 전후가 같아야 한다.

- [ ] **Step 2: Implement input capping**

    텍스트는 UTF-16 문자열 기준 12,000자로 자르고, 이미지 우선순위는 page render 순서와 asset importance를 사용한다. 한도를 넘는 asset은 payload에서 제외하되 원본 처리 단계의 시각 asset 자체는 삭제하지 않는다. 이미지 bytes는 base64로 변환한 뒤 요청 직전에만 보유하고, provider 호출 후 page object에 base64를 남기지 않는다.

- [ ] **Step 3: Preserve ephemeral bytes for PDF, PPTX, and HWPX**

    현재 PDF와 renderer가 추출 후 버리는 bytes를 provider input이 생성되는 시점까지 유지한다. PPTX/HWPX ZIP asset에도 { name, mimeType, bytes }를 임시로 둔다. makeUnits와 document persistence 직전에 bytes와 base64를 제거해 SQLite나 document JSON에 저장하지 않는다. 기존 visual evidence와 local OCR 흐름은 동일하게 유지한다.

- [ ] **Step 4: Implement response validation and auxiliary text**

    validateGeneratedMetadata는 summary/topic을 문자열로, keywords를 최대 12개 문자열 배열로, visualDescriptions를 최대 asset 수만큼 정규화한다. 각 문자열의 최대 길이를 제한하고 unknown key를 제거한다. buildSearchAuxiliaryText는 summary, topic, keywords, visualDescriptions.description을 공백으로 합치며 페이지 원문은 포함하지 않는다.

- [ ] **Step 5: Add generated metadata to search without changing evidence**

    unit persistence에 generatedMetadata와 searchAuxiliaryText를 선택 필드로 추가한다. FTS/보조 매칭 입력은 기존 unit text와 auxiliary text를 함께 사용하고, 결과 evidence field는 기존 text/nativeText/ocrText와 시각 asset reference만 사용한다. source database generation hash에 auxiliary text와 metadata의 안정적인 JSON을 포함해 재색인 상태를 식별한다.

- [ ] **Step 6: Persist minimal provider audit**

    기존 audit 저장 패턴에 documentId, page, provider, model, timestamp, status, safe error code, dataType, excludedImageCount를 기록한다. prompt, API Key, 원본 파일, 전송 text 전문은 저장하지 않는다. 성공과 실패 모두 한 페이지당 한 audit record를 남기고, fallback이 실행되면 processingModeFallback과 연결한다.

- [ ] **Step 7: Run focused processing tests**

    Run: node --test test/ai-processing.test.mjs test/search-v2-api.test.mjs

    Expected: payload 제한, bytes 비영속성, 검색 보조 매칭, 원본 evidence 보존, audit 필드 비밀값 차단이 PASS.

- [ ] **Step 8: Commit enrichment and indexing**

    Run:

        git add src/server/ai-processing.mjs src/processing/visual-assets.mjs src/processing/document-renderer.mjs src/processing/pdf-visual.mjs src/search/sqlite-store.mjs server.mjs test/ai-processing.test.mjs
        git commit -m "feat: index external ai metadata without changing evidence"

---

### Task 5: 처리 모드 resolver와 서버 API/작업 정책 연결

**Files:**
- Modify: src/server/processing-settings.mjs
- Modify: server.mjs
- Modify: test/processing-settings.test.mjs
- Modify: test/ai-settings-api.test.mjs

**Interfaces:**
- Consumes: credential status from Task 2, provider from Task 3, enrichment from Task 4.
- Produces:

        normalizeDefaultProcessingMode(value) -> "auto" | "lightweight" | "local-ai" | "external-ai"

        resolveProcessingDefault(settings, components, externalStatus) -> {
          defaultMode,
          effectiveDefaultMode,
          localAiAvailable,
          externalAiEnabled,
          externalAiReady,
          fallbackReason
        }

        resolveRequestedProcessingMode(requestedMode, {
          localAiAvailable,
          externalAiAvailable,
          externalProvider,
          externalModelId,
          externalFailureReason
        }) -> {
          requestedMode,
          effectiveMode,
          fallbackReason,
          provider,
          modelId
        }

- [ ] **Step 1: Add resolver table tests**

    auto, lightweight, local-ai, external-ai와 local ready/not-ready, key/model ready/not-ready, connection failure 조합을 table test로 고정한다. auto에는 external ready를 넣어도 effective mode가 local/lightweight인 것을 확인한다. external-ai는 Gemini → local → lightweight 순서만 허용한다.

- [ ] **Step 2: Implement normalization and fallback**

    기존 settings JSON과 API response의 legacy mode를 깨지 않도록 허용한다. defaultProcessingMode가 누락되거나 알 수 없으면 auto로 normalize한다. 외부 enabled는 external-ai에서 파생하고, configured/ready는 credential과 modelId/connection 상태를 결합한다. fallback reason은 가장 구체적인 외부 오류를 유지한다.

- [ ] **Step 3: Extend status and settings routes**

    GET /api/status에 다음 안전한 shape을 추가한다.

        processing: {
          externalAi: {
            provider: "gemini",
            configured: boolean,
            modelSelected: boolean,
            enabled: boolean,
            ready: boolean,
            lastConnection: {
              status: "unknown" | "ready" | "failed",
              checkedAt: string | null,
              errorCode: string | null
            }
          }
        }

    PATCH /api/settings는 defaultProcessingMode, externalAi.modelId, externalAi.consentVersion을 처리한다. external-ai로 전환하면서 consentVersion 1이 없으면 HTTP 409와 external_ai_consent_required를 반환한다. Key가 없거나 modelId가 없어도 선호 저장은 허용하되 ready false를 반환한다. OFF 전환은 다음 작업 정책에만 영향을 준다.

- [ ] **Step 4: Add model-list and connection-check routes**

    GET /api/ai/gemini/models는 저장된 Key가 없으면 안전한 409 external_ai_not_configured, 있으면 provider.listModels 결과를 반환한다. POST /api/ai/gemini/check는 문서 body를 받지 않고 설정 modelId로 provider.checkConnection을 실행한다. 두 route 모두 raw provider response와 Key를 반환하지 않는다. 연결 결과는 lastConnection에 timestamp와 safe error code만 저장한다.

- [ ] **Step 5: Snapshot external policy at job registration**

    POST /api/documents에서 명시적인 mode가 없으면 저장된 default mode를, 있으면 작업별 mode를 requestedProcessingMode로 snapshot한다. 등록 시점에 provider/model과 fallback reason을 계산해 job/document metadata에 기록한다. runQueue는 이 snapshot을 사용하므로 이후 설정을 OFF로 바꿔도 이미 external-ai로 등록된 작업의 순서를 바꾸지 않는다.

- [ ] **Step 6: Connect enrichment and fallback**

    external effective mode인 page 처리에서 enrichPagesForSearch를 호출한다. provider unavailable, timeout, invalid response이면 해당 페이지의 external audit를 실패로 남기고 local-ai가 준비된 경우 local 흐름으로, 아니면 lightweight로 진행한다. local 처리 오류가 기존 정책으로 반환되던 semantic_model_unavailable 동작은 유지한다.

- [ ] **Step 7: Run server contract tests**

    Run: node --test test/processing-settings.test.mjs test/ai-settings-api.test.mjs test/search-v2-api.test.mjs

    Expected: 동의 없는 활성화 거부, Key 없는 선호 저장, 모델/연결 문서 비전송, 등록 시점 snapshot, 외부 OFF 신규 작업 차단, fallback 순서가 PASS.

- [ ] **Step 8: Commit server policy**

    Run:

        git add src/server/processing-settings.mjs server.mjs test/processing-settings.test.mjs test/ai-settings-api.test.mjs
        git commit -m "feat: connect external ai mode to document processing"

---

### Task 6: 기본 모드와 Gemini 설정 화면

**Files:**
- Modify: src/main.js
- Modify: styles.css
- Modify: test/ui-contract.test.mjs

**Interfaces:**
- Consumes: /api/status, /api/settings, /api/ai/gemini/models, /api/ai/gemini/check, and window.wekiAiCredentials from Tasks 2 and 5.
- Produces: settingsPageV2의 기본값 두 가지와 addPage의 기존 작업별 세 가지 모드:

        기본 처리 모드:
        ( ) 설치된 모델 사용
        ( ) 외부 AI 사용

        문서 등록 작업별 모드:
        경량 처리만
        Local AI 허용
        External AI 허용

        외부 AI:
        제공자 Gemini
        API Key 저장/삭제
        모델 목록 새로고침 및 모델 선택
        연결 확인
        외부 AI 사용 ON/OFF

- [ ] **Step 1: Add UI contract assertions**

    settingsPageV2와 addPage가 두 가지 기본 선택 label, Gemini Key masked input, 저장/삭제, model refresh, 연결 확인, external toggle, persistent warning을 렌더링하는지 고정한다. 정적 HTML/렌더 테스트에서 Key value가 value attribute나 innerHTML에 들어가지 않는 조건을 추가한다.

- [ ] **Step 2: Render the two basic default choices**

    기존 defaultProcessingMode select를 settingsPageV2에서 두 radio/segmented option으로 바꾼다. auto와 legacy lightweight/local-ai를 읽을 때는 설치된 모델 사용으로 표시한다. external-ai일 때만 외부 AI 사용을 선택한다. addPage의 작업별 경량 처리만, Local AI 허용, External AI 허용 radio는 유지하고, 초기 선택만 settings의 effective mode로 맞춘다. 저장 전에는 dirty state를 유지하고 PATCH 성공 후에만 화면 상태를 확정한다.

- [ ] **Step 3: Add Gemini credential controls without network on save**

    Key 입력은 renderer local variable로만 잠시 유지한다. 저장 버튼은 window.wekiAiCredentials.saveGeminiKey만 호출하고, 성공 후 status를 새로 읽는다. 저장 자체에서는 models route나 check route를 호출하지 않는다. 삭제는 clear bridge 후 external ready false와 경고를 갱신한다. Key input은 status refresh나 page re-render 때 빈 값으로 초기화한다.

- [ ] **Step 4: Add dynamic model selection and connection check**

    모델 새로고침은 GET models route를 호출해 generateContent 가능 모델만 select에 넣는다. 선택 modelId를 PATCH settings로 저장한다. 연결 확인은 POST check route만 호출하며 document payload가 없음을 network mock으로 검증한다. 결과는 연결됨, Key 필요, 모델 선택 필요, 연결 실패로 안전하게 표시한다.

- [ ] **Step 5: Implement consent and toggle rules**

    OFF에서 ON으로 변경할 때마다 전송 범위, 목적, provider/model, 신규 작업 적용 범위를 설명하는 confirmation UI를 연다. 동의 확인 시에만 consentVersion 1과 현재 시각을 포함해 PATCH한다. 취소하면 OFF를 유지한다. 외부 AI를 OFF로 바꾸면 신규 작업 차단 안내를 즉시 표시하고 기존 큐 작업은 영향 없음으로 설명한다.

- [ ] **Step 6: Add inline fallback and configuration warnings**

    외부 AI 선택 상태지만 Key나 modelId가 없으면 선호는 저장되지만 실제 작업은 설치된 모델, 경량 처리 순으로 진행됩니다를 표시한다. 마지막 연결 실패가 있으면 오류 code를 사용자 문장으로 매핑한다. 등록 화면의 작업별 External AI 허용은 동의 상태를 확인하고, 동의가 없으면 선택 즉시 같은 동의 UI를 연다. 취소하면 기존 radio 선택을 유지하며, 동의했지만 준비되지 않은 경우에는 등록 후 fallback 메시지를 표시한다.

- [ ] **Step 7: Run UI tests**

    Run: node --test test/ui-contract.test.mjs test/processing-settings.test.mjs

    Expected: 두 가지 기본 모드, Key 비노출, 동의 재확인, 연결 확인 분리, fallback warning이 PASS.

- [ ] **Step 8: Commit the settings UI**

    Run:

        git add src/main.js styles.css test/ui-contract.test.mjs
        git commit -m "feat: add local and gemini processing mode settings"

---

### Task 7: 9단계 온보딩과 이동 가능한 dialog

**Files:**
- Modify: src/onboarding.js
- Modify: src/main.js
- Modify: styles.css
- Modify: test/onboarding.test.mjs
- Modify: test/onboarding-e2e.test.mjs

**Interfaces:**
- Consumes: existing onboarding controller, settings/add/documents/search pages from Tasks 5 and 6.
- Produces:

        ONBOARDING_STEPS = [
          { id: "registration-screen", page: "add", target: null },
          { id: "choose-files", page: "add", target: "choose-files" },
          { id: "registration-mode", page: "add", target: "registration-mode" },
          { id: "processing-queue", page: "add", target: "processing-queue" },
          { id: "documents-empty", page: "documents", target: "documents-empty" },
          { id: "search-composer", page: "search", target: "search-composer" },
          { id: "example-results", page: "onboarding-example", target: null },
          { id: "example-evidence", page: "onboarding-example", target: null },
          { id: "mybox", page: "settings", target: "mybox" }
        ]

        clampDialogPosition({ left, top, width, height, viewportWidth, viewportHeight, gutter = 8 })
          -> { left: number, top: number }

- [ ] **Step 1: Add pure step and position tests**

    9개 step의 순서, page, target, example flag, 변경 없음 문구를 고정한다. clampDialogPosition은 음수, 오른쪽 초과, 아래쪽 초과, dialog가 viewport보다 큰 경우를 각각 검사한다. start/replay마다 위치가 중앙에서 시작하고 step 전환 중에는 위치가 유지되는 것을 검사한다.

- [ ] **Step 2: Add target hooks and static targets**

    src/main.js의 addPage에 choose-files, registration-mode, processing-queue target을 추가한다. documentsPageV2의 문서 목록/빈 상태에 documents-empty target을 추가한다. registration-screen은 add page fallback, search-composer와 mybox는 기존 target을 재사용한다. 정적 example-results/example-evidence는 onboarding controller가 만드는 dialog content 안에서만 생성한다.

- [ ] **Step 3: Implement session-only drag state**

    dialog의 제목 영역에 data-onboarding-drag-handle을 붙이고 pointerdown/move/up/cancel listener를 등록한다. 시작 시 { pointerId, startX, startY, startLeft, startTop }를 저장하고 clampDialogPosition 결과로 style left/top을 갱신한다. 새 투어를 시작하거나 replay할 때 style 좌표를 제거하고 중앙으로 reset한다. localStorage에는 완료 값 외 dialog 좌표를 기록하지 않는다.

- [ ] **Step 4: Preserve accessibility and close behavior**

    drag handle을 Tab 순서와 focus trap 밖의 별도 actionable control로 만들지 않는다. pointer event의 preventDefault는 제목 영역에서만 호출한다. input/button을 드래그 시작점으로 취급하지 않고, Esc/skip/complete/route change 시 pointer listener와 pointer capture를 해제한다. 기존 role dialog, aria-modal, focus restore, focus trap, Escape 종료를 유지한다.

- [ ] **Step 5: Implement static search result and evidence examples**

    step 7에는 실제 상태와 무관한 읽기 전용 result card를, step 8에는 p.3 근거 문장과 연결 표시를 렌더링한다. button에는 click handler를 연결하지 않고, data document id, fetch, search API, mutation event를 만들지 않는다. step 9의 settings 이동 시에도 동의 dialog나 설정 PATCH가 자동으로 열리지 않게 한다.

- [ ] **Step 6: Implement mobile center rule**

    mobile media query 또는 viewport width 640px 이하에서는 drag start를 무시하고 dialog inline left/top을 제거한다. resize 시 mobile이면 중앙, desktop이면 현재 세션 위치를 새 viewport에 맞춰 재-clamp한다. fallback target이 없을 때의 기존 중앙 배치를 회귀시키지 않는다.

- [ ] **Step 7: Run onboarding tests**

    Run: node --test test/onboarding.test.mjs test/onboarding-e2e.test.mjs test/ui-contract.test.mjs

    Expected: 9단계 전환, 신규 자동 시작, 기존 완료 사용자 미노출, replay 중앙 reset, drag/clamp, mobile center, 정적 예시, mutation 0회가 PASS.

- [ ] **Step 8: Commit onboarding**

    Run:

        git add src/onboarding.js src/main.js styles.css test/onboarding.test.mjs test/onboarding-e2e.test.mjs test/ui-contract.test.mjs
        git commit -m "feat: expand onboarding to nine safe guided steps"

---

### Task 8: 설치기, 버전, 사용자 문서와 릴리즈 노트

**Files:**
- Modify: build/installer.nsh
- Modify: package.json
- Modify: package-lock.json
- Modify: README.md
- Modify: docs/PRD_Weki.md
- Modify: docs/USER_TEST_CHECKLIST.md
- Modify: docs/CHANGELOG.md
- Create: docs/RELEASE_NOTES_V1.2.3.md
- Modify: test/ui-contract.test.mjs

**Interfaces:**
- Consumes: completed UI/API behavior from Tasks 2–7.
- Produces: versioned release metadata and user-facing policy that match the implementation exactly.

- [ ] **Step 1: Change only the data-page installer label**

    build/installer.nsh에서 문서 데이터 페이지의 group title만 문서 데이터 저장 위치로 변경한다. 프로그램 설치 페이지의 설치 폴더는 그대로 둔다. NSIS page description이 docs/index를 설명하는지 함께 확인한다.

- [ ] **Step 2: Bump application version**

    package.json과 package-lock.json의 application version을 1.2.3으로 맞춘다. dependency version은 변경하지 않는다. 기존 release metadata의 v1.2.2 값을 소스 문서에 복사해 두지 않는다.

- [ ] **Step 3: Update product documentation**

    README에는 9단계 온보딩 실행/replay/skip, 변경 없음 문구, 두 가지 기본 모드, Gemini Key의 로컬 암호화 저장, 동의 재확인, 텍스트·이미지 범위, fallback을 추가한다. PRD의 온보딩 5단계를 9단계로 갱신하고, default auto의 local 규칙과 external-ai explicit consent 정책을 맞춘다. USER_TEST_CHECKLIST에는 desktop drag, mobile center, static example, Key non-disclosure, OFF 신규 작업 정책을 추가한다.

- [ ] **Step 4: Write v1.2.3 release notes**

    docs/RELEASE_NOTES_V1.2.3.md에 사용자 영향, 보안/전송 고지, fallback, 기존 완료 사용자의 자동 재노출 없음, installer label 변경, 테스트 범위를 기록한다. 최종 답변 생성이 범위에 없다는 문장을 포함한다.

- [ ] **Step 5: Update contract checks**

    ui-contract.test.mjs가 v1.2.3 version string, installer two-label distinction, docs copy, external consent copy를 확인하도록 갱신한다.

- [ ] **Step 6: Run documentation and packaging contracts**

    Run: node --test test/ui-contract.test.mjs

    Expected: v1.2.3 metadata, installer labels, user-facing policy strings가 PASS.

- [ ] **Step 7: Commit release documentation**

    Run:

        git add build/installer.nsh package.json package-lock.json README.md docs/PRD_Weki.md docs/USER_TEST_CHECKLIST.md docs/CHANGELOG.md docs/RELEASE_NOTES_V1.2.3.md test/ui-contract.test.mjs
        git commit -m "docs: prepare weki v1.2.3 release materials"

---

### Task 9: 종합 검증과 Windows 패키지 확인

**Files:**
- Modify: release/ metadata generated by the build process only
- Test: all test/*.test.mjs and test/onboarding-e2e.test.mjs

**Interfaces:**
- Consumes: all committed implementation from Tasks 1–8.
- Produces: verified v1.2.3 source build, fixture-free E2E result, and package inspection evidence.

- [ ] **Step 1: Run the full Node test suite**

    Run: npm test

    Expected: processing, onboarding, search, UI contract, credential, provider, and API tests PASS. Existing fixture-dependent failures, if present, are listed separately with their missing fixture path and are not converted into code changes outside this scope.

- [ ] **Step 2: Run the production build**

    Run: npm run build

    Expected: Vite/Electron renderer build succeeds, src/server/ai-processing.mjs and src/server/gemini-provider.mjs are included, and no Key or test fixture is copied into the output.

- [ ] **Step 3: Run fixture-free Electron E2E**

    Run: node --test --test-name-pattern="onboarding|external ai|processing mode" test/electron-e2e.test.mjs test/onboarding-e2e.test.mjs

    Expected: clean profile starts with 9-step onboarding, replay works, static example makes zero document/search mutations, desktop drag clamps, mobile remains centered, external setting requires consent.

- [ ] **Step 4: Run the complete Electron E2E suite**

    Run: npm run test:e2e

    Expected: existing document registration, search, settings, MYBOX, runtime, and onboarding flows pass. A pre-existing missing PDF/HWPX fixture is reported with the existing fixture-dependent classification.

- [ ] **Step 5: Build and inspect the Windows installer**

    Run: npm run dist:win

    Inspect:

        release/win-unpacked/resources/app.asar
        release/BUILD_INFO.txt
        release/latest.yml
        release/SHA256.txt

    Verify package version 1.2.3, installer data-page label, program-page label, no API Key in asar/release logs, and the new provider modules are packaged. If the Windows packaging command requires an unavailable host capability, retain the successful source/build evidence and report the exact command and environment error.

- [ ] **Step 6: Run final diff and secret checks**

    Run:

        git diff --check
        rg -n "AIza|apiKey|api_key|base64|gemini" src server.mjs electron-main.cjs src/preload.cjs build test
        git status --short

    Expected: only intentional code paths contain credential variable names; no test Key, plaintext credential, or generated document content is committed. Generated release metadata is included only when produced by the package workflow.

- [ ] **Step 7: Commit or report the final verification state**

    If all required checks pass, commit only generated release metadata that is tracked by the repository:

        git add release
        git commit -m "chore: record v1.2.3 build metadata"

    If a packaging or fixture-dependent check is unavailable, do not alter unrelated code to hide it. Report the exact pass/fail/unavailable matrix, current branch, and uncommitted paths.

## Acceptance matrix

| Area | Verification |
|---|---|
| New install onboarding | 9 steps in order; no network, document, search, settings, or MYBOX mutation |
| Existing completed user | no automatic replay; manual guide starts current 9 steps |
| Dialog movement | title drag only; desktop clamp; session-only position; mobile center |
| Default mode | installed model vs external AI only in basic UI |
| Consent | every OFF→ON transition requires version 1 consent |
| Credential security | OS-encrypted file; no Key in renderer, DB, logs, or package |
| Gemini payload | extracted text plus selected images; caps and 30-second timeout |
| Fallback | Gemini → local AI → lightweight for explicit external mode |
| Search | generated auxiliary metadata searchable; original evidence unchanged |
| Queue semantics | OFF blocks new external jobs; registered external jobs retain snapshot policy |
| Installer | data page 문서 데이터 저장 위치; program page 설치 폴더 |
| Release | package, docs, tests, and version all report 1.2.3 |

## Implementation handoff

Execute the tasks in order with a fresh test run and commit at each task boundary. Use superpowers:subagent-driven-development for independent task review, or superpowers:executing-plans for inline execution with the same checkpoints. Do not start feature implementation from this planning turn until one of those execution modes is selected.
