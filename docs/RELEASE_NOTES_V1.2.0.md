# Weki v1.2.0 릴리스 노트

Weki v1.2.0은 v1.1.0의 로컬·경량 검색 흐름을 유지하면서, 검색 정확도와 근거 확인, 선택형 Local AI 구성요소의 설치·운영 경험을 확장한 버전입니다.

## v1.1.0 대비 주요 변경사항

| 영역 | v1.1.0 | v1.2.0 | 사용자에게 달라지는 점 |
|---|---|---|---|
| 검색 | SQLite FTS와 semantic 검색을 RRF로 결합 | Text/Table/Visual Evidence, bounded Context Pack, 선택형 semantic reranker, 검색 품질 평가 도구 추가 | 결과의 근거를 더 쉽게 확인하고 검색 품질을 측정할 수 있습니다. |
| 문서 처리 | native parser와 OCR fallback 중심 | 한국어·OCR 경계를 고려한 chunking과 물리 페이지 기반 시각 근거를 보강 | 긴 문서와 OCR 문서의 검색 단위와 근거 연결이 안정적입니다. |
| runtime 구성요소 | semantic model·document renderer를 개별 선택 설치 | semantic model·semantic reranker·document renderer를 한 화면에서 상태 확인·일괄 설치 | 설치 가능 여부, 진행 상태, 실패 원인, 재시도 가능 여부를 구분해서 확인할 수 있습니다. |
| 설치 안전성 | 파일별 크기·hash·서명 검증과 atomic promotion | 구성요소별 설치 결과, 순서 제어, MYBOX 전용 renderer 출처 검증, 실패 상태 보존 | 한 구성요소의 실패가 전체 설치를 중단하지 않으며, 잘못된 배포본은 설치하지 않습니다. |
| 처리 모드 | 기본 경량 처리와 명시적 Local AI 선택 | `auto` 기본값과 구성요소 적용 상태에 따른 새 작업용 Local AI 전환 | 구성요소가 준비되기 전에는 경량 처리로 동작하고, 준비 후 새 작업부터 Local AI를 기본으로 사용할 수 있습니다. |
| 운영 화면 | 상태값과 백업 기능이 한 화면에 혼재 | 한국어 상태 문구, 검색 색인 재생성 진행 상태, 백업·복원을 `고급 관리`로 분리 | 현재 상태와 작업 목적을 비전공자도 더 쉽게 이해할 수 있습니다. |

## 설치 및 동작 정책

- `semantic-model`은 기본 manifest에 포함된 공개 runtime pack으로 설치할 수 있습니다.
- `semantic-reranker`는 Weki 설치파일에 포함된 bundled pack을 사용하며, 파일 크기와 SHA-256을 검증합니다.
- `document-renderer`는 MYBOX의 `wiki/runtime/v1/` 배포본만 허용합니다. 배포본이 없으면 실패가 아니라 `MYBOX 배포본 없음`으로 표시하고 native parser와 OCR fallback을 유지합니다.
- `전체 설치`는 semantic model → semantic reranker → document renderer 순서로 진행합니다. 사용할 수 없는 항목은 보류하고, 실제 실패한 항목은 오류 원인과 재시도 상태를 보존합니다.
- 설치가 완료되어도 실행 중인 앱에 즉시 강제 적용하지 않고, 작업 Queue를 확인한 뒤 앱 재시작이 필요하다는 안내를 제공합니다.

## 호환성 및 제한

- 기존 로컬 문서와 검색 데이터는 유지됩니다. 기본 처리 모드 변경만으로 기존 문서를 자동 재처리하지 않습니다.
- 외부 AI Provider와 생성형 요약은 이번 릴리스에 포함하지 않습니다.
- DOCX/HWPX/HWP의 시각 요소는 renderer runtime 설치 여부에 따라 범위가 달라지며, renderer가 없거나 실패하면 native parser와 OCR fallback을 사용합니다.
- HWP 지원 범위는 파서가 지원하는 HWP 5.x 구조입니다.

## 배포 검증

- Node 전체 테스트: 184 passed, 0 failed, 0 skipped
- 집중 runtime·검색·UI 테스트: 107 passed, 0 failed, 0 skipped
- Vite production build 및 clean HEAD 기준 Windows x64 NSIS 설치파일 생성 완료
- 설치파일: `Weki-1.2.0-Setup.exe` · SHA-256 `FAD99238A2EFA11E264DF62146ED53FC3CD25C496EA2283A65A043FCBBC95A4F`
- 설치파일과 SHA-256/SHA-512 메타데이터: [`release/BUILD_INFO.txt`](../release/BUILD_INFO.txt), [`release/SHA256.txt`](../release/SHA256.txt), [`release/latest.yml`](../release/latest.yml)
