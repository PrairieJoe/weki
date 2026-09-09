# Runtime Component Installation Outcome Design

## Goal

런타임 구성요소 일괄 설치에서 실제 설치 실패와 배포본 부재를 구분한다. 검색 결과 재정렬 모델 설치가 실패했는지 사용자가 확인할 수 있게 하고, 문서 화면 처리기는 MYBOX 전용 정책을 유지하면서 배포본이 없다는 이유로 전체 설치가 중단된 것처럼 보이지 않게 한다.

## Context and confirmed facts

- `semantic-reranker`는 Weki 설치 파일에 포함된 로컬 번들이다.
- 현재 1.2.0 `app.asar`에는 `src/runtime/packs/semantic-reranker/1.0.0/reranker.mjs`가 포함되어 있다.
- 번들 파일은 manifest의 크기 982바이트 및 SHA-256과 일치한다.
- `document-renderer`는 기본 manifest에 포함하지 않으며, MYBOX runtime manifest가 제공될 때만 설치 대상이 된다.
- 현재 일괄 설치는 구성요소를 순서대로 처리하지만, 배치 결과가 `skipped`와 `failed`를 충분히 구분하지 않아 사용자 화면에서 “설치 중단”으로 해석될 수 있다.
- 설치 직후 서버 프로세스는 새 runtime provider를 자동으로 로드하지 않으므로, 성공한 구성요소도 앱 재시작 전에는 `앱 재시작 필요` 상태가 될 수 있다.

## Scope

### In scope

1. 배치 설치 결과를 설치 완료, 이미 준비됨, 배포본 없음, 실제 실패로 구분한다.
2. 한 구성요소의 배포본 부재나 설치 오류가 다음 구성요소 처리 자체를 중단시키지 않도록 한다.
3. `semantic-reranker`의 실제 실패 원인과 재시도 경로를 표시한다.
4. `document-renderer`가 MYBOX 배포본을 찾지 못한 경우 실패가 아닌 보류 상태로 표시한다.
5. 설치 가능한 구성요소가 성공하고 실제 실패가 없으면, 배포본 없는 선택 구성요소가 있어도 성공한 구성요소 적용을 위해 재시작할 수 있게 한다.
6. 배포 산출물에 재정렬 모델 번들이 포함되는지 빌드 검증 절차에 명시한다.

### Out of scope

- `document-renderer`를 Weki 설치 파일에 포함하는 것
- MYBOX runtime manifest를 새로 배포하거나 자동 생성하는 것
- 재정렬 모델 알고리즘 자체의 품질 변경
- 설치 실패 시 네트워크 재시도 정책의 전면 재설계
- 기존 문서의 자동 재처리

## Design

### 1. Runtime source policy

구성요소별 배포 정책은 그대로 유지한다.

| 구성요소 | 기본 설치 출처 | 출처가 없을 때 | 사용자 의미 |
|---|---|---|---|
| `semantic-model` | Weki 기본 runtime manifest의 외부 모델 파일 | 실제 다운로드/검증 실패로 기록 | 설치 대상 |
| `semantic-reranker` | Weki 설치 파일에 포함된 로컬 번들 | 번들 파일 누락·무결성 오류면 실제 실패 | 설치 대상 |
| `document-renderer` | MYBOX runtime manifest | `unavailable`/보류 | MYBOX 배포본 준비 후 설치 |

`document-renderer`를 기본 manifest에 추가하지 않는다. 따라서 기본 설치 흐름에서 이 구성요소가 없다는 사실은 오류가 아니라 배포 상태다.

### 2. Batch outcome contract

`GET /api/runtime/components`와 `POST /api/runtime/components/install-all`의 `installBatch`에 다음 필드를 사용한다.

```js
{
  status: "idle" | "indexing" | "ready" | "partial" | "failed",
  componentIds: ["semantic-model", "semantic-reranker", "document-renderer"],
  currentComponent: "semantic-reranker" | null,
  completed: 2,
  total: 3,
  results: {
    "semantic-model": { status: "already-ready", version: "1.0.0" },
    "semantic-reranker": { status: "installed", version: "1.0.0" },
    "document-renderer": { status: "unavailable", reason: "runtime_pack_not_configured" }
  },
  installed: ["semantic-reranker"],
  unavailable: ["document-renderer"],
  failed: [],
  error: null,
  startedAt: "2026-09-09T00:00:00.000Z",
  finishedAt: "2026-09-09T00:00:10.000Z"
}
```

Outcome rules:

- `ready`: 모든 요청 항목이 `installed` 또는 `already-ready`이고 `failed`와 `unavailable`이 없다.
- `partial`: 실제 실패는 없고 하나 이상의 항목이 `unavailable`이다.
- `failed`: 하나 이상의 항목이 `failed`이다. 다른 항목이 성공했는지는 `results`와 `installed`에 남긴다.
- `unavailable`은 오류 문자열이 아니라 배포본 부재의 원인을 담는다.
- `failed` 항목은 `{ id, error }` 형태로 오류를 보존해 UI가 재시도 안내를 만들 수 있게 한다.

배치 루프는 각 구성요소를 독립적인 `try/catch`로 처리한다. `runtimeInstallOptions`가 배포본을 찾지 못하면 `unavailable`로 기록하고 다음 항목으로 진행한다. `installComponent`가 해시, 크기, 서명, 다운로드 또는 파일시스템 오류를 반환하면 `failed`로 기록하고 다음 항목으로 진행한다. 전체 Promise는 배치 상태를 갱신한 뒤 정상 종료한다.

### 3. Component status presentation

구성요소 행의 표시 규칙은 다음과 같다.

- `missing` + `runtime_pack_not_configured` + `requiresMybox`: `MYBOX 배포본 없음`
- `missing` + `runtime_pack_not_configured` + non-MYBOX: `배포 준비 중`
- `installing`: `설치 중`
- `failed`: `설치 실패`와 함께 배치 결과의 오류 원인을 표시
- `ready` + `applied === false`: `앱 재시작 필요`
- `ready` + `applied === true`: `최신 상태` 또는 `업데이트 가능`

일괄 설치 결과 메시지는 구성요소별 결과를 요약한다.

- 성공만 있는 경우: `설치 가능한 구성요소 설치가 완료되었습니다.`
- 성공 + renderer 보류: `설치 가능한 구성요소 설치가 완료되었습니다. 문서 화면 처리기는 MYBOX 배포본이 없어 보류되었습니다.`
- 실제 실패가 있는 경우: `일부 구성요소 설치에 실패했습니다: 검색 결과 재정렬 모델. 오류 원인을 확인하고 재시도하세요.`

행별 동작 버튼은 `failed` 상태에서 `재시도`를 사용한다. MYBOX 출처 구성요소의 행별 설치 요청에는 `source: "mybox"`를 전달해 출처를 추측하지 않게 한다.

### 4. Restart behavior

재시작은 “모든 선택 구성요소가 설치되었는가”가 아니라 “실제 실패 없이 적용 가능한 설치가 끝났는가”를 기준으로 한다.

- `status === "ready"`이고 설치된 구성요소가 있으면 자동 재시작 대상이다.
- `status === "partial"`이어도 `failed`가 비어 있고 `installed`가 있으면 자동 재시작 대상이다. renderer 보류가 reranker 적용을 막지 않아야 한다.
- `status === "failed"`이면 자동 재시작하지 않는다. 성공한 구성요소는 화면에 `앱 재시작 필요`로 남기고, 사용자가 실패 원인을 확인한 뒤 재시도하도록 한다.
- 활성 문서 처리 작업이 있으면 기존 정책대로 자동 재시작하지 않는다.

### 5. Packaging verification

소스 테스트 외에 Windows 패키징 검증에서 다음을 확인한다.

1. `release/win-unpacked/resources/app.asar` 목록에 `src/runtime/packs/semantic-reranker/1.0.0/reranker.mjs`가 존재한다.
2. 패키지 안의 파일 크기와 SHA-256이 기본 manifest와 일치한다.
3. 새 설치 환경에서 runtime API가 `semantic-reranker`를 설치 대상으로 보고한다.
4. 설치 후 재시작 전에는 `ready/applied=false`, 재시작 후에는 provider가 로드되어 `applied=true`가 된다.

## Error handling

- 실제 설치 오류는 서버가 오류 문자열을 배치 결과와 component-state에 남긴다.
- renderer 배포본 부재는 서버 오류 응답으로 반환하지 않고 `unavailable` 결과로 반환한다.
- 배치 요청 자체가 잘못된 component ID만 포함하면 기존대로 400을 반환한다.
- 설치 가능한 항목이 하나도 없으면 기존의 `설치 가능한 새 구성요소가 없습니다.` 안내를 유지한다.
- 재시도는 실패한 구성요소의 현재 manifest/source metadata를 사용하며, 실패한 구성요소만 다시 처리한다.

## Acceptance criteria

1. 신규 설치에서 semantic model과 semantic reranker는 설치 대상이며, document renderer는 MYBOX 배포본이 없으면 `MYBOX 배포본 없음` 또는 동등한 보류 상태로 표시된다.
2. semantic reranker의 로컬 번들이 누락되거나 해시가 틀리면 실제 `failed` 결과와 재시도 안내가 보인다.
3. document renderer 배포본이 없더라도 semantic reranker 설치가 완료되고 배치가 다음 항목까지 진행된다.
4. document renderer 보류만 있는 배치는 자동 재시작을 막지 않는다.
5. 실제 실패가 있는 배치는 자동 재시작하지 않는다.
6. 패키지 산출물에 재정렬 모델 파일이 포함되고 무결성 검증이 통과한다.
7. 기존 검색 fallback, MYBOX 인증 실패 격리, 경량 처리 흐름은 변경되지 않는다.

## Test matrix

| 시나리오 | 기대 결과 |
|---|---|
| clean install, bundled reranker present | model/reranker 설치 성공 |
| bundled reranker file missing | reranker failed, 원인 표시, renderer 처리 계속 |
| bundled reranker hash mismatch | reranker failed, atomic staging 원복 |
| renderer manifest absent | renderer unavailable, reranker 성공 유지 |
| renderer manifest available only in MYBOX | renderer installable, source 표시 MYBOX |
| reranker success + renderer unavailable | partial, 자동 재시작 가능 |
| reranker failure + renderer unavailable | failed, 자동 재시작 금지 |
| active document job during partial success | 자동 재시작 금지 |
| packaged app inspection | reranker bundle path/size/hash 확인 |
