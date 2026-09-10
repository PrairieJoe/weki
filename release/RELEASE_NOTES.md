# Weki v1.2.1

- 전체 문서 데이터 삭제 후 새로고침 실패 시 삭제 확인창이 남는 문제를 수정했습니다.
- 백업은 MYBOX만 지원합니다. v1.2.1은 v1.2.0에서 생성한 로컬 `.weki` 백업의 생성·복원을 지원하지 않으며, 기존 `.weki` 파일을 자동 삭제하지 않습니다.
- 사용자 설정 화면의 검색 색인 관리 UI를 제거했습니다. 내부 검색 색인 재생성 API는 마이그레이션·복구용으로 유지합니다.
- 전체 문서 재처리(파싱·OCR·AI·Embedding·색인 재실행)는 v1.3.0 검토 항목입니다.
- 일반 화면에는 앱 릴리즈 버전만 표시하고 runtime/ranking 내부 버전은 진단 용도로 유지합니다.

---

# Weki v1.2.0

## RAG/vector search release

- SQLite FTS와 vector search를 결합한 RAG 검색
- Text/Table/Visual Evidence 기반 bounded Context Pack
- 선택형 semantic reranker 및 미설치 시 RRF fallback
- 한국어·OCR 청킹 개선과 검색 품질 평가 CLI
- Electron 설정 화면의 전체 검색 색인 재생성 및 진행 상태
- semantic model·semantic reranker·document renderer 3개 runtime 구성요소의 상태 표시와 설치 가능한 항목 일괄 설치
- semantic-reranker bundled pack(982 bytes, SHA-256 `31db99da8c2d7c8a1df461ffe652fe2e29d14505a455edbbe6cd5364686e842e`)의 설치 검증과 실제 오류·재시도 안내
- document-renderer는 MYBOX 전용이며 `MYBOX 배포본 없음`은 비실패 상태입니다. 성공한 구성요소는 renderer unavailable 상태에서도 재시작 적용할 수 있고, 실제 실패 시 자동 재시작하지 않습니다.
- 설치 상태에 따라 자동으로 동작하는 기본 처리 모드와, 구성요소 적용 후 새 문서부터 Local AI를 기본으로 사용하는 흐름
- 암호화 백업 및 복원을 고급 관리 영역으로 정리하고, 구성요소·검색 엔진 상태를 쉬운 한국어로 표시

Windows installer: `Weki-1.2.0-Setup.exe`

---

# Weki v1.1.0

- 제품명: Weki
- 버전: 1.1.0
- 배포 방식: GitHub Release
- 지원 포맷: PDF / PPTX / DOCX / HWP / HWPX
- SQLite FTS5 기반 v2 검색, cursor 페이지네이션, RRF ranking과 Evidence provenance
- PDF·PPTX·DOCX·HWPX의 visual evidence/OCR 보강 및 검색 결과 snippet·highlight
- 선택형 semantic model / document renderer runtime pack과 unavailable/degraded fallback
- MYBOX token 암호화 저장, 검색 카탈로그 동기화, hash 기반 원본 지연 복원
- 동의어 승인·확장 검색, route 경계 검색, 문서별 중복 근거 제한
- semantic runtime이 없는 CPU-only 환경에서도 lexical 검색 및 경량 처리 지원

## 알려진 제한

- Electron visual document E2E 1건은 실행 환경 조건 때문에 자동 skip됩니다.
- DOCX/HWPX/HWP 시각 요소는 renderer runtime 설치 여부에 따라 visual evidence 범위가 달라집니다.
- 외부 AI Provider 연동과 생성형 요약은 포함하지 않습니다.

## 검증

- `npm ci` 성공
- Node 테스트 140 passed / 0 failed / 1 skipped
- `npm run test:e2e`: 0 passed / 0 failed / 1 skipped (환경 조건)
- Vite production build 통과
- Windows x64 NSIS 설치파일 생성 통과
- 설치파일 SHA-256 및 SHA-512 검증 완료

## 설치파일

- 파일: `Weki-1.1.0-Setup.exe`
- 크기: 232,086,352 bytes
- SHA-256: `25DD37A62609CAD9525EA129F65A3A9C63681DB41D78C6E58E91C64D3F887216`
- GitHub Release 자산: 설치파일, blockmap, `latest.yml`, `SHA256.txt`
