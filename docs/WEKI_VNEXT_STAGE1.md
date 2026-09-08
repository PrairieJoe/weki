# Weki vNext 1단계 검색 기반

> 상태: v1.0.0 이후 구현됨. 현재 `main`의 개발 서버에서는 기능 플래그로, packaged Electron 앱에서는 기본 활성화됩니다.

1단계는 기존 v1 JSON 저장소를 유지한 채, 기능 플래그로 별도 SQLite 검색 저장소를 활성화합니다.

## 실행

```powershell
$env:WEKI_SEARCH_V2 = "1"
npm start
```

기본 저장소가 `WEKI_DATA_DIR`라면 vNext 원장은 `<WEKI_DATA_DIR>/v2/knowledge-base.sqlite`에 생성됩니다. 플래그가 꺼져 있으면 v2 원장을 열지 않으므로 기존 v1 동작과 저장소 이전을 그대로 보존합니다. 기존 v1 문서는 자동 이행하지 않습니다. 플래그가 켜진 뒤 새로 등록·재처리된 문서만 v2 FTS에 dual-write됩니다.

## API

- `POST /api/v2/search`: `query`, `sessionId`, `cursor`, `filters`를 받고 FTS5 lexical 결과, 안정적인 cursor, evidence provenance, 단계별 timings와 engine health를 반환합니다.
- `POST /api/v2/feedback`: 검색 세션과 결과·순위·ranking version을 SQLite에 기록합니다.
- `GET /api/v2/status`: v2 feature flag, SQLite/FTS/ANN/model 상태와 데이터 위치를 반환합니다.
- `GET /api/status`: 기존 응답을 유지하면서 `search`, `searchVersion`, `rankingVersion`을 추가합니다.

검색은 FTS5 상위 200개를 먼저 가져오고, RRF(`k=60`)로 합친 뒤 상위 100개만 hydrate합니다. 첫 페이지는 문서당 최대 2개로 제한하고 낮은 연관성 결과는 `lowRelevance`로 표시합니다. 동일한 결과 순서를 위해 cursor는 offset을 base64url로 인코딩합니다.

## 측정

```powershell
npm run benchmark:search:v2 -- 1000 100
```

출력에는 페이지 수, 질의 수, P50/P95/max 검색 시간과 RSS가 포함됩니다. 릴리스 Gate 판정은 GPU가 비활성화된 Windows x64 패키지에서 1k/10k/50k/100k 단계로 별도 수행해야 합니다.

## 의도적인 제한

1단계에서는 semantic model/ANN과 고품질 포맷 renderer를 설치하지 않습니다. 이 경우 engine 상태는 degraded/unavailable로 남고 lexical 검색은 계속 동작합니다. SQLite는 설치된 `better-sqlite3@13.0.3`를 우선 사용하고, 로드할 수 없는 개발 환경에서는 Node 22+의 `node:sqlite`로 대체합니다. semantic/runtime pack은 2단계에서 선택 설치합니다.

변경 이력의 사용자 관점 요약은 [README.md](../README.md#v100-이후-개선사항), 전체 변경 목록은 [CHANGELOG.md](./CHANGELOG.md)를 참조하세요.
