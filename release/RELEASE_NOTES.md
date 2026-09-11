# Weki v1.2.3

## 사용자에게 달라지는 점

- 신규 설치에서 선택형 9단계 온보딩 투어가 시작됩니다. `문서 등록 화면 → 파일 선택 → 처리 모드 → 처리 대기열 → 문서 관리 → 질문 검색 → 검색 결과 예시 → 근거 예시 → MYBOX와 저장소` 순서로 실제 이용 흐름을 설명합니다.
- 투어는 실제 문서·검색·설정·MYBOX를 변경하지 않습니다. 검색 결과와 근거 단계는 정적 예시이며, `건너뛰기`·닫기·완료로 종료할 수 있습니다. 완료한 설치 프로필에는 투어가 자동으로 다시 재생되지 않고, `사용 가이드`를 선택할 때만 1단계부터 재생됩니다.
- 데스크톱에서는 제목 영역을 드래그해 안내창을 옮길 수 있고 화면 안쪽으로 제한합니다. 모바일에서는 안내창을 중앙에 유지합니다.
- 기본 처리 모드는 `설치된 모델 사용`과 `외부 AI 사용` 두 가지로 표시합니다. 문서별 등록 화면의 선택지는 `경량 처리만`, `Local AI 허용`, `External AI 허용` 세 가지입니다.

## External AI, 보안 및 전송 고지

- Gemini Key는 이 PC에 암호화해 저장하며 화면·상태·로그에 다시 표시하지 않습니다. Key와 모델이 준비되지 않아도 외부 AI 선호 설정은 저장할 수 있지만 실제 처리는 준비 상태에 따라 fallback합니다.
- `External AI 허용`은 문서 전처리 보조와 검색 보조 색인만을 위한 처리 상한입니다. 외부 전송은 페이지·슬라이드에서 추출한 텍스트와 선택한 이미지만으로 제한할 수 있으며 전체 원본 파일, 전체 프롬프트, 로컬 저장 경로, 근거 원문 전체는 전송하지 않습니다.
- Gemini 전송 상한은 텍스트 최대 12,000자, 이미지 최대 4개, 이미지당 최대 2 MiB, 전체 이미지 최대 8 MiB입니다. 요청 제한 시간은 30초입니다.
- External AI를 OFF에서 ON으로 바꾸는 모든 전환과 문서별 `External AI 허용` 선택에는 동의 확인이 필요합니다. 동의하지 않으면 해당 선택은 유지되지 않습니다.
- 외부 AI가 미설정·미선택·연결 실패·응답 오류로 사용할 수 없으면 `External AI → Local AI → 경량 처리` 순으로 허용된 경로를 사용합니다. 외부 AI를 끄면 신규 작업부터 외부 처리가 차단되며, 이미 Queue에 등록된 작업은 등록 당시 snapshot 정책을 유지합니다.
- DOCX 이미지는 문서 관계와 명시적 페이지 나눔을, HWPX 이미지는 참조 섹션을 우선해 시각 근거 페이지를 연결합니다. 원본 형식에서 페이지 연결을 제공하지 않는 이미지는 ZIP 경로 순서 기반의 고정된 논리 페이지 fallback을 사용하며, 후속 이미지를 모두 1페이지로 잘못 묶지 않습니다.
- Gemini가 생성하는 summary·topic·keywords·visual description은 검색 보조 메타데이터입니다. 원문 Evidence를 대체하지 않으며, 최종 답변 생성은 이번 릴리스 범위에 포함하지 않습니다.

## 설치기

- 문서 데이터 저장 위치를 선택하는 페이지의 그룹 제목을 `문서 데이터 저장 위치`로 변경했습니다.
- 프로그램 설치 위치를 지정하는 페이지의 그룹 제목 `설치 폴더`는 유지했습니다. 두 페이지의 역할을 혼동하지 않도록 구분한 변경입니다.

## 검증 범위

- `node --test test/ui-contract.test.mjs`로 v1.2.3 버전, 설치기 두 레이블, 온보딩·External AI 문서 및 동의 문구 계약을 확인합니다.
- 관련 온보딩·처리 설정·Gemini credential/provider·AI processing·API 테스트와 production build를 함께 실행합니다.
- Windows 패키지 생성과 전체 Electron E2E는 릴리스 패키징 단계에서 다시 확인합니다. 생성형 최종 답변 기능은 테스트·릴리스 범위가 아닙니다.

## Verified artifact

- Source commit: `c027395c045fd438dd06c8d15885f52b98fce9d2`
- Installer: `Weki-1.2.3-Setup.exe` (232118616 bytes)
- SHA-256: `FDFD49D419FA4656BCD3830C37E5A721DBB1FBC03C2570E63EEB766FEBB55375`
- SHA-512: `7F5416381A036CC5F25C06A2EACA417515D86116B4B0E2E74C50064A9631F007EF1AF441073CE776818FD8435E342C726E20062048277B9A09617B77F5156EFB`
- Update metadata: `release/latest.yml` records the matching base64 SHA-512, source commit, and release date from the builder output.

---

# Weki v1.2.1

- 전체 문서 데이터 삭제 후 새로고침 실패 시 삭제 확인창이 남는 문제를 수정했습니다.
- 백업은 MYBOX만 지원합니다. v1.2.1은 v1.2.0에서 생성한 로컬 `.weki` 백업의 생성·복원을 지원하지 않으며, 기존 `.weki` 파일을 자동 삭제하지 않습니다.
- 사용자 설정 화면의 검색 색인 관리 UI를 제거했습니다. 내부 검색 색인 재생성 API는 마이그레이션·복구용으로 유지합니다.
- 전체 문서 재처리(파싱·OCR·AI·Embedding·색인 재실행)는 v1.3.0 검토 항목입니다.
- 일반 화면에는 앱 릴리즈 버전만 표시하고 runtime/ranking 내부 버전은 진단 용도로 유지합니다.

## 검증

- `npm test`: 199 passed / 0 failed / 0 skipped
- `npm run test:e2e`: 2 passed / 0 failed / 0 skipped. 기존 PDF 처리 E2E와 fixture-free 온보딩 E2E를 모두 통과했습니다.
- 검증에는 저장소에서 제외된 기존 `test_data` PDF/HWPX fixture를 사용했으며, 개인정보·대용량 원본 보호를 위해 fixture 자체는 릴리즈와 커밋에 포함하지 않았습니다.
- `node --test test/onboarding-e2e.test.mjs`: 1 passed / 0 failed
- `node --test test/status-api.test.mjs`: 12 passed / 0 failed
- `npm run build`: 통과
- `npm run dist:win`: 통과
- 패키지 버전 `1.2.1`, SHA-256 및 SHA-512 검증 완료

## 설치파일

- 파일: `Weki-1.2.1-Setup.exe`
- 크기: 232,100,641 bytes
- SHA-256: `367EFB0F26A4A854497DFF5580D70160C90EF93B603F5F8F816379595557B690`
- SHA-512: `A4470F59B1313A45D3A6B7B6A57819B97D74384F3CDF2F2EA088E4C0A22FC8BAE45B3C7BDC729DE43038C191336031649659441041592E560CE3AF6A316DD065`

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
