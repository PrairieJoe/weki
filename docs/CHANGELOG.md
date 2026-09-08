# Weki 변경 이력

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

검증 결과는 Node 테스트 140건 통과, 0건 실패, 1건 환경 조건 skip이며, Vite production build와 Windows x64 NSIS 패키징이 통과했습니다. Electron 시각 문서 E2E 1건은 현재 실행 환경에서 조건부 skip되었습니다. 현재 변경분의 상세 실행 방법과 의도적인 제한은 [WEKI_VNEXT_STAGE1.md](./WEKI_VNEXT_STAGE1.md)와 [WEKI_VNEXT_STAGE2.md](./WEKI_VNEXT_STAGE2.md)에 정리되어 있습니다.
