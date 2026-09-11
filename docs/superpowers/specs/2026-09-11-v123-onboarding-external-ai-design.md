# Weki v1.2.3 온보딩 2차 개선 및 외부 AI 처리 모드 설계 명세

## 목표

v1.2.3에서 신규 사용자가 문서 등록부터 검색 근거 확인, 문서 관리, 설정과 MYBOX까지 실제 데이터를 건드리지 않고 이해할 수 있는 9단계 온보딩을 제공한다. 동시에 기본 처리 모드를 사용자가 이해하기 쉬운 두 가지 선택지로 정리한다.

- 설치된 모델 사용: 로컬 모델이 있으면 사용하고, 없거나 준비되지 않았으면 경량 처리로 동작한다.
- 외부 AI 사용: 사용자가 Gemini API Key와 모델을 등록하고 외부 AI 사용에 동의한 경우에만 새 작업에서 Gemini를 우선 사용한다. Gemini를 사용할 수 없으면 로컬 모델, 그 다음 경량 처리로 순차 fallback한다.

외부 AI는 문서 전처리 보조와 검색 보조 색인만 담당한다. 최종 답변 생성, 검색 결과 요약, 원본 파일 전체 전송은 v1.2.3 범위에 포함하지 않는다.

## 확정된 사용자 정책

### 온보딩

1. 팝업 기본 위치는 기존과 같이 화면 중앙이다.
2. 제목 영역만 드래그 핸들로 사용한다.
3. 드래그 중 팝업이 화면 밖으로 나가지 않도록 좌표를 viewport 안으로 보정한다.
4. 이동 좌표는 현재 투어 세션 동안만 유지한다. 투어 시작과 재생 시 중앙으로 초기화하며 localStorage에는 저장하지 않는다.
5. 모바일 폭에서는 팝업을 이동시키지 않고 기존 중앙 배치를 유지한다.
6. 포커스 트랩, Tab/Shift+Tab, Esc 종료, 건너뛰기, 종료 후 시작 화면과 포커스 복귀는 유지한다.
7. 팝업에 다음 문구를 항상 표시한다.

   이 안내에서는 실제 문서나 설정을 변경하지 않습니다.

8. 기존 완료 키 weki.onboarding.v1.completed를 계속 읽는다. 이미 완료한 사용자는 자동으로 다시 노출하지 않는다.
9. 사용자가 사용 가이드 버튼을 다시 실행하면 현재 9단계를 처음부터 표시한다.
10. 신규 설치 및 완료 기록이 없는 환경에서는 첫 렌더 후 9단계를 한 번 자동 시작한다.

### 온보딩 단계

| 순서 | 단계 ID | 화면/대상 | 설명 |
|---:|---|---|---|
| 1 | registration-screen | 문서 등록 화면 | 문서 등록 메뉴와 전체 흐름 |
| 2 | choose-files | 파일 선택 영역 | 파일 선택과 탐색기 이용 방법 |
| 3 | registration-mode | 처리 모드 선택 영역 | 설치된 모델 사용과 외부 AI 사용의 차이 |
| 4 | processing-queue | 처리 대기열 영역 | 등록 직후 대기열과 처리 상태 |
| 5 | documents-empty | 문서 관리 화면 | 목록, 처리 상태, 원본 상태, 재처리, 삭제 |
| 6 | search-composer | 검색어 입력 영역 | 자연어 검색어 입력 |
| 7 | example-results | 온보딩 내부 예시 결과 | 읽기 전용 가상 결과 목록 |
| 8 | example-evidence | 온보딩 내부 예시 근거 | 페이지, 근거 문장, 결과와 근거의 연결 |
| 9 | mybox | 설정 및 MYBOX 영역 | 설정, 원본 보관, MYBOX 연결 |

단계 7과 8은 팝업 내부의 정적 가상 데이터만 렌더링한다. 실제 검색 API 호출, 실제 문서 등록, 처리 큐 생성, MYBOX 연결은 하지 않는다. 예시 문맥은 기존 화면의 일반 교통·운영 문서 예시와 맞추며 개인정보와 특정 고객 데이터는 사용하지 않는다.

### 기본 처리 모드와 외부 AI 동의

사용자 화면에서는 기본값을 두 가지로만 노출한다.

| 화면 선택 | 저장 호환 값 | 새 작업의 우선순위 |
|---|---|---|
| 설치된 모델 사용 | auto | 설치된 로컬 모델 → 경량 처리 |
| 외부 AI 사용 | external-ai | Gemini → 설치된 로컬 모델 → 경량 처리 |

설정 화면의 기본값 선택만 위 두 가지로 단순화한다. 문서 등록 화면의 작업별 처리 모드는 기존의 경량 처리만, Local AI 허용, External AI 허용 세 가지를 유지한다. 작업별 External AI 허용도 같은 동의와 전송 범위를 적용하며, 동의하지 않은 상태에서는 선택 시 동의 흐름을 먼저 표시하고 작업을 등록하지 않는다. 기본값을 따르는 초기 선택은 설정의 effective mode를 사용한다.

기존 저장값 lightweight와 local-ai는 서버와 마이그레이션 호환성을 위해 계속 허용하지만 새 설정 화면에서는 두 가지 기본 선택지로 통합한다. auto의 기존 규칙인 런타임 구성요소 전체 적용 전 경량 처리, 전체 적용 후 로컬 AI 사용을 유지한다. 외부 AI는 auto에서 자동 승격하지 않는다.

외부 AI 사용은 기본 OFF로 시작한다. 사용자가 OFF에서 ON으로 바꿀 때마다 다음 내용을 포함한 동의를 다시 받아야 한다.

- 전송 대상: 페이지 또는 슬라이드에서 추출한 텍스트와 사용자가 등록한 문서에 포함된 선택 이미지
- 전송하지 않는 항목: 전체 원본 파일, 전체 프롬프트, 로컬 저장 경로, 근거 원문 전체
- 사용 목적: 문서 전처리 보조 및 검색 보조 색인
- 제공자와 모델: Gemini 및 사용자가 선택한 모델
- 처리 중지: 설정에서 외부 AI를 끄면 이후 새 작업부터 외부 처리를 사용하지 않음

동의가 없는 ON 요청은 서버가 거부한다. API Key나 모델을 아직 저장하지 않은 상태에서도 사용자는 외부 AI 선택과 선호 저장을 할 수 있다. 이 경우 설정 화면에 준비 필요 경고를 표시하고 실제 작업은 로컬 모델, 경량 처리 순으로 fallback한다. API Key 저장 자체는 네트워크를 호출하지 않으며, 별도 연결 확인 또는 첫 실제 작업 시 검증한다.

외부 AI를 OFF로 바꾸는 설정은 신규 작업에만 적용한다. 이미 외부 처리 정책으로 큐에 등록된 작업은 등록 시점의 정책을 유지하고 계속 처리할 수 있다. 작업과 문서에 요청 모드, 실제 모드, fallback 사유를 기록한다.

## 구성 및 데이터 흐름

### 보안 경계

- API Key는 Electron main 프로세스가 OS safeStorage로 암호화한 별도 credential 파일에 저장한다.
- renderer, SQLite, 일반 설정 JSON, 설치 로그, 문서 메타데이터에는 평문 API Key를 저장하지 않는다.
- preload는 저장, 삭제, 상태 확인만 노출한다. API Key 값을 renderer에 반환하지 않는다.
- Gemini 요청은 main/server 경계에서 수행한다. renderer가 외부 AI endpoint를 직접 호출하지 않는다.
- 연결 확인과 모델 목록 조회는 문서 데이터를 전송하지 않는다.

### 설정 데이터

일반 설정은 다음 형태로 유지한다. externalAi는 비밀값을 포함하지 않는다.

    {
      "defaultProcessingMode": "auto" | "lightweight" | "local-ai" | "external-ai",
      "externalAi": {
        "provider": "gemini",
        "modelId": "string | null",
        "consentVersion": 1,
        "consentedAt": "ISO-8601 string | null",
        "lastConnection": {
          "status": "unknown" | "ready" | "failed",
          "checkedAt": "ISO-8601 string | null",
          "errorCode": "string | null"
        }
      }
    }

외부 AI 활성화 여부는 defaultProcessingMode === "external-ai"에서 파생한다. API Key 존재 여부와 모델 선택 여부는 각각 externalAiConfigured와 externalAiReady로 계산하며, API 응답에는 boolean과 안전한 상태 코드만 포함한다.

### 모듈 경계

- src/server/processing-settings.mjs: 처리 모드 값 검증, 기본 모드 해석, 로컬·외부 준비 상태에 따른 fallback.
- src/server/ai-credentials.mjs: Gemini credential 암호화 파일의 읽기·쓰기·삭제.
- src/server/gemini-provider.mjs: Gemini REST API 호출, 모델 목록, 연결 확인, 구조화된 전처리 응답.
- src/server/ai-processing.mjs: 페이지 입력 제한, 텍스트·이미지 payload 구성, 응답 검증, 검색 보조 텍스트 생성.
- electron-main.cjs와 src/preload.cjs: credential IPC와 server 재시작/상태 갱신 연결.
- src/main.js: 설정 화면, 2가지 기본 모드, 외부 AI 동의, 키와 모델 관리 UI.
- src/onboarding.js: 9단계 정의, 세션 좌표, 드래그와 viewport 보정.

### Gemini 요청 계약

각 페이지 또는 슬라이드 작업은 다음 입력만 보낸다.

    {
      "page": 3,
      "text": "추출된 페이지 텍스트",
      "images": [
        {
          "name": "page-3-figure-1.png",
          "mimeType": "image/png",
          "base64": "..."
        }
      ]
    }

안전 제한은 페이지별 텍스트 최대 12,000자, 이미지 최대 4개, 이미지 1개 최대 2 MiB, 페이지 전체 이미지 최대 8 MiB, 요청 timeout 30초로 고정한다. 이미지가 제한을 넘으면 우선순위가 낮은 이미지부터 제외하고, 제외 사실을 작업 메타데이터에 기록한다. 원본 파일 바이트, ZIP 전체, PDF 전체를 payload에 넣지 않는다.

Gemini 응답은 다음 구조만 허용한다.

    {
      "summary": "짧은 페이지 요약",
      "topic": "주제",
      "keywords": ["키워드1", "키워드2"],
      "visualDescriptions": [
        {
          "assetName": "page-3-figure-1.png",
          "description": "이미지에 대한 짧은 설명"
        }
      ]
    }

알 수 없는 필드는 버리고 문자열·배열 길이와 항목 수를 제한한다. JSON 파싱 실패, 필수 필드 누락, provider error는 외부 처리 실패로 기록하고 같은 페이지의 로컬 처리 또는 경량 처리로 진행한다.

### 색인과 근거

생성 메타데이터는 검색 보조 색인용 auxiliary text로만 추가한다. summary, topic, keywords, visualDescriptions.description을 공백으로 합쳐 FTS와 검색 보조 매칭에 사용한다. 기존 unit.text, nativeText, ocrText, 페이지 범위, 근거 문장은 변경하지 않는다. 검색 결과의 근거 표시는 항상 원본 추출·OCR 텍스트 또는 원본 시각 자산에서 만든 기존 evidence를 사용한다.

외부 요청마다 다음 최소 감사 정보를 기록한다.

- 문서 ID
- 페이지 또는 슬라이드 번호
- 제공자와 모델
- 요청 시각
- 성공/실패와 안전한 오류 코드
- 데이터 종류 text, image, text+image
- 이미지가 제한으로 제외되었는지 여부

프롬프트 전문, API Key, 원본 파일 전체, 전송한 근거 문장 전문은 감사 로그에 저장하지 않는다.

## API 및 상태 계약

### 설정 및 외부 상태

- GET /api/status: 기존 상태에 processing.externalAi를 추가한다. provider, configured, modelSelected, enabled, ready, lastConnection만 반환한다.
- PATCH /api/settings: 기존 설정 변경을 유지하고 defaultProcessingMode, externalAi.modelId, externalAi.consentVersion을 처리한다. external-ai 활성화 시 현재 동의 버전이 없으면 409 external_ai_consent_required를 반환한다.
- GET /api/ai/gemini/models: 저장된 Key로 Gemini 모델 목록을 조회한다. 문서 데이터는 전송하지 않으며 generateContent 사용 가능 모델만 반환한다.
- POST /api/ai/gemini/check: 저장된 Key와 선택 모델로 연결만 확인한다. 문서 데이터는 전송하지 않는다.
- POST /api/documents: 명시적인 mode가 있으면 기존 작업별 선택을 사용하고, 없으면 저장된 기본 모드의 정책을 사용한다. 외부 모드 작업은 요청 시점에 provider 준비 상태를 계산한다.

### 작업 상태

작업과 문서의 기존 필드에 다음 값을 보완한다.

    {
      "requestedProcessingMode": "auto" | "lightweight" | "local-ai" | "external-ai",
      "processingMode": "lightweight" | "local-ai" | "external-ai",
      "processingModeFallback": "external_ai_not_configured"
        | "external_ai_connection_failed"
        | "external_ai_invalid_response"
        | "semantic_model_unavailable"
        | null,
      "externalProvider": "gemini" | null,
      "externalModel": "string | null"
    }

작업이 외부 모드로 등록되었으면 설정을 나중에 OFF로 바꿔도 위 정책을 변경하지 않는다. 아직 실행되지 않은 작업도 등록 시점의 requestedProcessingMode와 선택 provider/model을 사용한다.

## 온보딩 UI 설계

### 이동 가능한 대화상자

기존 중앙 fallback 레이아웃을 유지하고, 대상 요소가 있는 경우에도 동일한 dialog 좌표 상태를 사용한다. 제목 영역에 data-onboarding-drag-handle과 적절한 버튼이 아닌 non-interactive drag handle semantics를 추가한다. pointerdown에서 시작 좌표와 dialog rect를 저장하고 pointermove에서 다음 공식을 적용한다.

    left = clamp(startLeft + deltaX, 8, viewportWidth - dialogWidth - 8)
    top = clamp(startTop + deltaY, 8, viewportHeight - dialogHeight - 8)

모바일 breakpoint에서는 pointer drag를 시작하지 않고 left/top을 지우며 중앙 CSS를 적용한다. pointerup, pointercancel, Esc, skip, complete에서 listener를 정리한다.

### 정적 예시

7단계에는 다음과 같은 읽기 전용 카드 2개를 표시한다.

- 결과 예시: 운영 시간 변경 안내, 통행 제한 구간, 페이지 번호와 간단한 일치 설명
- 근거 예시: p.3, 2026년 4월부터 ..., 결과 카드에서 근거로 이어지는 시각적 연결

예시 카드는 실제 검색 상태 store, fetch, document id, database id를 참조하지 않는다.

## 설치기와 문서

- build/installer.nsh의 문서 데이터 페이지 그룹 제목은 설치 폴더에서 문서 데이터 저장 위치로 변경한다.
- 프로그램 설치 위치 페이지의 설치 폴더 표기는 유지한다.
- README, PRD, 사용자 테스트 체크리스트, v1.2.3 릴리즈 노트에는 9단계 온보딩, 2가지 기본 모드, Gemini Key 보안 저장, 동의와 fallback, 설치기 문구를 반영한다.
- v1.2.3에서는 기존 문서의 전체 재처리를 자동 수행하지 않는다.

## 범위 제외

- 외부 AI를 이용한 최종 답변 또는 검색 결과 요약 생성
- OpenAI 등 Gemini 이외 provider의 실제 연동
- 전체 원본 파일의 외부 전송
- 사용자 동의 없는 외부 AI 자동 활성화
- 기존 완료 사용자의 온보딩 자동 재노출
- 온보딩에서 실제 파일 탐색기, 검색 API, 문서 등록을 실행하는 동작
- 외부 처리 결과를 기존 원본 근거로 덮어쓰기

## 수용 기준

1. 완료 기록이 없는 신규 설치에서 9단계가 순서대로 표시되고, 실제 문서·설정·검색 상태가 변하지 않는다.
2. 기존 완료 사용자는 자동 재노출되지 않으며, 사용 가이드 재생으로만 9단계를 볼 수 있다.
3. 데스크톱에서 제목 드래그로 dialog를 이동할 수 있고, viewport 밖으로 나가지 않으며, 모바일에서는 중앙 배치가 유지된다.
4. 설정 화면의 기본 모드는 설치된 모델 사용과 외부 AI 사용 두 가지로 보인다.
5. 외부 AI를 다시 켤 때마다 동의가 필요하고, 동의 없는 활성화는 저장되지 않는다.
6. API Key 저장은 로컬 암호화 저장만 수행하며, Key가 renderer·SQLite·로그에 노출되지 않는다.
7. Gemini 모델 목록은 동적으로 조회되고, 연결 확인과 실제 문서 처리는 별도 요청이다.
8. 외부 작업은 텍스트와 선택 이미지로만 처리되며, Gemini 실패 시 로컬 모델, 경량 처리 순으로 fallback한다.
9. 생성 메타데이터는 검색 보조 색인에 포함되지만 검색 근거는 기존 원본 evidence를 유지한다.
10. 외부 AI OFF는 신규 작업만 차단하고 이미 등록된 외부 정책 작업의 등록 시점 정책을 바꾸지 않는다.
11. 설치기 문서 데이터 페이지 제목은 문서 데이터 저장 위치, 프로그램 설치 페이지 제목은 설치 폴더로 구분된다.
12. v1.2.3 단위 테스트, 계약 테스트, Electron E2E, 패키지 빌드 검증이 모두 계획된 명령으로 재현된다.
