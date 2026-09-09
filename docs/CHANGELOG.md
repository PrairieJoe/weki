# Weki 변경 이력

## v1.2.0 - 2026-09-09

### RAG 및 검색 운영

- SQLite FTS와 vector search를 결합하고 모델·세대·문서 필터와 RRF 결과 결합을 적용했습니다.
- Text/Table/Visual Evidence를 기반으로 bounded Evidence Context Pack을 제공합니다.
- 선택형 semantic reranker runtime adapter와 미설치 시 RRF fallback을 추가했습니다.
- 한국어·OCR 문장 경계를 고려한 chunking과 Recall@K·MRR·Evidence Precision 평가 CLI를 추가했습니다.
- 설정 · 운영 화면에서 전체 검색 색인을 다시 만들고 진행 상태를 확인할 수 있습니다.

### 설정 및 사용자 흐름

- 의미 검색 모델, 검색 결과 재정렬 모델, 문서 화면 처리기의 3개 runtime 구성요소를 설정 화면에 항상 표시합니다. 배포본이 없는 항목도 숨기지 않고 `배포 준비 중`으로 안내하며, 설치 가능한 항목만 `전체 설치` 대상에 포함합니다.
- `semantic-reranker`는 설치파일에 bundled runtime pack으로 포함되며, 982 bytes와 SHA-256 `31db99da8c2d7c8a1df461ffe652fe2e29d14505a455edbbe6cd5364686e842e`를 검증합니다. 검증·설치에 실패하면 실제 오류 원인과 `재시도` 경로를 표시합니다.
- `document-renderer`는 MYBOX 전용으로 유지하며, `MYBOX 배포본 없음`은 실패가 아닌 보류 상태로 표시합니다. renderer를 사용할 수 없어도 성공한 설치 가능 구성요소는 적용을 위해 재시작할 수 있고, 실제 설치 실패가 있을 때는 자동 재시작하지 않습니다.
- `전체 설치`는 semantic model → semantic reranker → document renderer 순서로 진행하고, 동일 버전 재설치를 막으며 새 버전이 있을 때만 업데이트 대상으로 표시합니다. 설치 후 앱 재시작이 필요한 상태도 구분합니다.
- 기본 처리 모드에 `설치 상태에 따라 자동`과 `Local AI 사용`을 제공했습니다. 3개 구성요소가 모두 준비·적용되기 전에는 경량 처리로 유지하고, 기존 문서를 자동 재처리하지 않은 채 새 작업부터 Local AI를 기본으로 사용할 수 있습니다.
- 암호화 백업 및 복원은 `고급 관리` 영역으로 접어 기본 화면의 복잡도를 줄이고, 다른 PC에서 검색 데이터 또는 전체 문서를 복구하는 기능이라는 목적을 표시합니다.
- 설정 화면의 내부 상태값 `healthy`·`degraded` 등을 비전공자도 이해하기 쉬운 한국어 상태 문구로 표시합니다.

### 릴리스

- Electron Windows NSIS 설치파일을 `Weki-1.2.0-Setup.exe`로 승격합니다.

## v1.1.0 - 2026-09-08

기준점은 Git 태그 `v1.0.0`입니다. 아래 내용은 해당 태그 이후 구현되어 `v1.1.0`에 포함된 변경사항입니다.

### 검색 및 데이터 모델

- 기존 JSON 저장소와 별도로 `<WEKI_DATA_DIR>/v2/knowledge-base.sqlite`를 사용하는 v2 검색 원장을 추가했습니다.
- SQLite FTS5 lexical 검색, cursor 기반 페이지네이션, 검색 세션·결과·피드백 저장을 추가했습니다.
- lexical/semantic 결과를 RRF(`k=60`)로 결합하고, 문서당 중복 근거를 제한하며, 낮은 연관성 결과도 숨기지 않고 표시합니다.
- 검색 결과에 엔진 상태, ranking version, 단계별 timing, evidence provenance를 포함합니다.
- v2 원장은 신규 등록·재처리 문서에 dual-write하며, 기존 v1 문서는 자동 이행하지 않습니다.

### 근거 기반 문서 처리

- native 텍스트와 OCR 결과를 병합하고 최대 384 token, 64 token overlap 기준으로 chunking합니다.
- Text/Table/Visual Evidence를 분리하고 페이지·슬라이드 위치, 출처(native/OCR), 시각 자산 hash를 보존합니다.
- HWP/HWPX renderer를 사용할 수 있으면 물리 페이지 단위 결과와 렌더링 provenance를 기록하고, 사용할 수 없거나 실패하면 기존 parser와 OCR fallback을 유지합니다.
- 문서 등록·재처리 작업에 요청 모드, 실제 적용 모드, fallback 사유, semantic 색인 단계를 기록합니다.

### 선택형 runtime 구성요소

- semantic model과 document renderer를 설치파일에 강제하지 않고 runtime pack으로 선택 설치하도록 분리했습니다.
- runtime manifest는 component/version, 파일 크기, SHA-256, 앱 호환성 및 선택적 Ed25519 서명을 검증합니다.
- 설치는 partial staging 후 검증·atomic promotion하며, 기존 버전은 보존하고 실패한 staging은 정리합니다.
- semantic model이 없으면 Local AI 요청을 경량 처리로 자동 전환하며, semantic/ANN 엔진은 unavailable 또는 degraded 상태에서도 lexical 검색을 계속 제공합니다.
- USearch가 있으면 ANN 파일 인덱스를 사용하고, 없으면 재시작 가능한 JSON fallback을 사용합니다.
- 상태 조회, 설치, 재시도, 진행률 및 앱 재시작 안내를 API와 설정 화면에 추가했습니다.

### MYBOX 및 운영 안정성

- MYBOX token을 평문으로 저장하지 않고 Windows 보안 저장소로 암호화한 credential 파일로 관리합니다.
- 검색 카탈로그(`weki/knowledge-base.json`) 동기화와 원본의 hash 경로 지연 복원을 분리했습니다.
- runtime 배포는 기존 백업 트리와 별도의 `wiki/runtime/v1/` 경로를 사용합니다.
- 로컬 저장소 통계에 짧은 캐시를 적용하고, 저장소 이전·전체 삭제·문서 삭제 시 v2 원장과 ANN 상태도 함께 정리합니다.
- Electron 재시작 IPC와 runtime 설치 후 재시작 안내를 추가했습니다.

### 검증

```powershell
npm ci
npm test
npm run build
npm run test:e2e
npm run dist:win
```

현재 재검증 결과는 Node 테스트 176건 통과, status-api startup 환경 변동 1건을 포함해 총 177건 중 1건이 환경 요인으로 실패했습니다. Electron 시각 문서 E2E는 `npm test`와 별도로 `npm run test:e2e`에서 실행되며, 실행 환경 조건으로 1건 skip되었습니다. Vite production build와 Windows x64 NSIS 패키징 검증도 유지됩니다. 현재 변경분의 상세 실행 방법과 의도적인 제한은 [WEKI_VNEXT_STAGE1.md](./WEKI_VNEXT_STAGE1.md)와 [WEKI_VNEXT_STAGE2.md](./WEKI_VNEXT_STAGE2.md)에 정리되어 있습니다.
