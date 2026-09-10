# Weki

Windows 로컬 문서 근거 검색 앱입니다. 개발 실행에서는 프로젝트 폴더의 `.weki-data`를 사용하고, 설치판에서는 설치 단계에서 선택한 영구 저장소에 원본과 검색 데이터를 보관합니다.

## 원클릭 실행

Windows에서 [run-weki.bat](./run-weki.bat)을 더블클릭하면 서버를 시작하고 Weki를 브라우저로 엽니다.

## 새 개발 PC 설정

Weki 개발 실행과 Windows 패키징은 Windows PC를 기준으로 합니다. Node.js 22.12.0 이상과 npm을 준비한 뒤 저장소 루트에서 lockfile 기준으로 의존성을 설치합니다.

```powershell
npm ci
npm test
npm run build
```

개발 서버는 `npm run dev`, Electron 데스크톱 창은 `npm run desktop`, Windows 설치파일은 `npm run dist:win`으로 실행합니다. 일반 사용자는 Windows 설치 후 Weki 바로가기를 실행하면 되며 PowerShell이나 API 호출이 필요하지 않습니다. `run-weki.bat`도 최초 실행 시 동일하게 `npm ci`를 사용하므로 PC별 의존성 버전 차이를 줄일 수 있습니다.

개발 환경에서는 다음 명령도 사용할 수 있습니다.

```powershell
npm run dev
```

## v1.2.1 현재 정책

- 전체 문서 데이터 삭제 후 새로고침에 실패해도 삭제 확인창이 남아 있지 않도록 수정했습니다.
- 백업은 MYBOX만 지원합니다. v1.2.1은 v1.2.0에서 생성한 로컬 `.weki` 백업을 생성하거나 복원하지 않습니다. 기존 `.weki` 파일은 자동 삭제하지 않지만 복원 대상으로 취급하지 않습니다.
- 사용자 설정 화면의 검색 색인 관리 기능을 제거했습니다. 내부 검색 색인 재생성 API는 마이그레이션·복구용으로만 유지하며, 사용자에게 노출하지 않습니다.
- 전체 문서 재처리(파싱·OCR·AI·Embedding·색인 재실행)는 v1.3.0 검토 항목입니다.
- 일반 화면에는 앱 릴리즈 버전만 표시합니다. runtime/ranking 내부 버전은 진단 용도로만 유지합니다.
- 첫 화면이 준비된 뒤 신규 설치에서 선택형 5단계 온보딩 투어를 한 번 안내합니다. 검색, 문서 등록, 결과·근거, 처리 모드 설정, MYBOX의 역할을 설명하지만 실제 작업은 실행하지 않습니다.
- 기존 `사용 가이드`를 선택하면 언제든 1단계부터 다시 볼 수 있습니다. 건너뛰기·닫기·완료 후에는 투어를 시작한 화면으로 돌아갑니다.
- 온보딩 투어는 문서를 등록하거나 검색·설정 변경·MYBOX 업로드 및 동기화를 수행하지 않습니다. 완료 여부는 제품 데이터와 분리된 이 설치 프로필의 로컬 `localStorage`에만 기록합니다.
- 투어는 상시 hover tooltip이 아니라 단계형 코치 마크이며, 대화상자 내부 포커스·Tab 이동·Esc 종료와 종료 후 포커스 복귀를 지원합니다.

자세한 변경 사항은 [v1.2.1 릴리스 노트](./docs/RELEASE_NOTES_V1.2.1.md)를 참조하세요.

## v1.2.0 개선사항 (역사적)

- SQLite FTS와 vector search를 결합한 RAG 검색, 모델·세대·문서 필터, RRF 결과 결합을 제공합니다.
- Text/Table/Visual Evidence와 bounded Context Pack, 선택형 semantic reranker fallback을 제공합니다.
- 한국어·OCR 문장 경계를 고려한 chunking과 Recall@K·MRR·Evidence Precision 평가 유틸리티를 추가했습니다.
- 설정 · 운영 화면에서 전체 검색 색인을 다시 만들고 진행 상태와 실패 상태를 확인할 수 있습니다.
- 설정 · 운영 화면에서 의미 검색 모델, 검색 결과 재정렬 모델, 문서 화면 처리기의 3개 상태를 항상 확인할 수 있습니다. 배포본이 있는 구성요소만 `전체 설치`로 순서대로 설치하며, 버전·업데이트·앱 재시작 필요 여부와 MYBOX 배포본 여부를 표시합니다.
- 기본 처리 모드는 `설치 상태에 따라 자동`으로 설정할 수 있습니다. 3개 구성요소가 모두 준비되어 적용되기 전에는 경량 처리로 동작하고, 모두 준비되면 새 문서부터 Local AI를 기본으로 사용할 수 있습니다.
- 암호화 백업 및 복원은 다른 PC에서 검색 데이터 또는 전체 문서를 복구할 때 사용하는 `고급 관리` 기능으로 구분했습니다.

## v1.1.0 이후 개선사항

`v1.0.0` 태그 이후 현재 `main`에 반영된 개선은 검색 정확도와 원문 근거 추적을 강화하면서도, 선택형 고품질 구성요소가 없는 환경에서는 기존 경량 처리를 유지하는 방향으로 구성되었습니다.

- SQLite FTS5 기반 v2 검색 저장소와 안정적인 cursor 페이지네이션, 검색 세션·결과·사용자 피드백 기록을 추가했습니다.
- RRF 기반 lexical/semantic 결과 결합, 문서별 중복 근거 제한, 낮은 연관성 결과 표시와 검색 엔진 상태·단계별 timing을 제공합니다.
- Text/Table/Visual Evidence를 분리하고 페이지·슬라이드 위치, native/OCR 출처, 시각 자산 SHA-256을 보존합니다.
- Local AI 문서 처리 모드와 semantic model을 선택형 runtime pack으로 연결했습니다. 모델이 설치되지 않은 경우 요청을 자동으로 경량 처리로 전환하고 이유를 작업 상태에 남깁니다.
- document-renderer를 선택형 runtime pack으로 설치할 수 있으며, 파일 크기·SHA-256·Ed25519 서명·앱 호환성을 검증하고 실패 시 atomic promotion을 하지 않습니다.
- MYBOX token을 Windows 보안 저장소 기반 암호화 파일로 관리하고, 검색 카탈로그 동기화와 원본 지연 복원 및 runtime 배포 경로를 분리했습니다.
- runtime 설치 진행률, 재시작 안내, 처리 모드·semantic 색인 상태를 설정 화면과 API에서 확인할 수 있습니다.
- 관련 설계·운영 문서는 [vNext 1단계 검색 문서](./docs/WEKI_VNEXT_STAGE1.md), [vNext 2단계 구성요소 문서](./docs/WEKI_VNEXT_STAGE2.md), [v1.2.0 릴리스 노트](./docs/RELEASE_NOTES_V1.2.0.md), [이용자 테스트 체크리스트](./docs/USER_TEST_CHECKLIST.md), [변경 이력](./docs/CHANGELOG.md)에서 확인할 수 있습니다.

데스크톱 창으로 실행하려면 다음 명령을 사용합니다.

```powershell
npm run desktop
```

Windows 설치파일을 만들려면 다음 명령을 사용합니다.

```powershell
npm run dist:win
```

생성물은 `release/Weki-1.2.0-Setup.exe`입니다.

## 현재 지원

- PDF, DOCX, PPTX, HWPX, HWP 5.x의 로컬 텍스트 추출
- PDF 전체 페이지 로컬 OCR, PPTX 내 PNG/JPEG/WebP 시각 자산 OCR
- Text / Table / Visual Evidence를 페이지·슬라이드·HWP 섹션 위치와 함께 검색
- PPTX Visual Evidence의 원본 이미지 미리보기와 Native/OCR provenance 표시
- SHA-256 중복 방지, 원본 누락 문서의 동일 Hash 원본 재연결
- 서버 기반 등록·재처리 대기열, 재처리 중 기존 색인 유지
- MYBOX를 통한 검색 데이터·원본 업로드, 검색 DB 동기화와 원본 지연 복원
- MYBOX `weki/knowledge-base.json` 검색 데이터와 `weki/data/` 실제 원본 파일의 분리 저장
- MYBOX 검색 DB 동기화와 원본 지연 복원, Hash 기준 문서·원본 중복 방지, 감사 기록
- 동의어·약어 검색 확장과 현재 실행 중인 세션의 PDF/PPT 후속 필터
- `/api/v2/search`의 `includeContext: true` 요청을 통한 bounded Evidence Context Pack
- 선택형 `semantic-reranker` runtime pack adapter와 reranker 미설치 시 RRF fallback
- 검색 품질 평가용 Recall@K·MRR·Evidence precision 유틸리티
- 문서 단위 삭제와 확인 문구·이중 경고가 필요한 전체 데이터 삭제

## 알려진 제한

- DOCX/HWPX/HWP의 시각 요소는 아직 전체 페이지 렌더링 OCR이 아니라 추출 가능한 원문 텍스트 중심입니다.
- HWP는 파서가 지원하는 HWP 5.x 구조에 한정됩니다.
- 문서 등록의 `Local AI 허용`은 semantic model runtime pack이 적용된 환경에서 사용할 수 있습니다. 기본 처리 모드를 자동으로 두면 3개 runtime 구성요소가 모두 준비·적용되기 전까지 경량 처리로 동작하고, 모델이 없거나 적용되지 않은 명시적 Local AI 요청도 경량 처리로 전환합니다. `External AI 허용`, 외부 AI Provider 연동과 생성형 요약은 아직 제공하지 않습니다.
- MYBOX는 `weki/knowledge-base.json`을 검색 DB로 동기화하고, 원본은 `원본 열기` 시 필요한 파일만 지연 다운로드하는 평문 구조입니다. 원본 포함 업로드 전 경고를 확인해야 합니다. MYBOX 토큰은 설치 시 또는 앱 설정에서 입력하고 선택한 데이터 저장소의 `credentials/mybox-token.json`에 Windows 보안 저장소로 암호화합니다.
- MYBOX 원본은 `weki/data/<파일 Hash>/<원본 파일명>`에 저장합니다. `knowledge-base.json`은 `data/<파일 Hash>/<원본 파일명>`만 참조합니다. v1.2.1은 기존 flat/root `data` 구조와 v1.2.0의 단일 `.weki` 파일을 자동 호환·이동·삭제하지 않으며, `.weki` 복원을 지원하지 않습니다.
- 로컬 문서가 새로 생성된 빈 상태에서 토큰이 있으면 최초 1회만 `knowledge-base.json`을 자동 동기화합니다. 이후 동기화는 설정 화면의 `MYBOX 검색 DB 동기화` 버튼으로만 실행하며, 로컬 삭제는 MYBOX에 전파하지 않습니다.
- 로컬 원본은 선택한 저장소의 `originals/<hash>/<원본 파일명>`에 보관합니다. 기존 `originals/<hash>.<ext>` 원본은 최초 실행 시 Hash 검증 후 자동 이전합니다. 검색 결과의 원본이 로컬에 없고 MYBOX 참조가 있으면 `MYBOX에서 원본 가져와 열기`로 해당 파일만 다운로드하고 Hash 검증 후 같은 구조에 캐시합니다.
- 설치판은 설치 단계에서 데이터 저장 위치를 선택합니다. 설정운영에서 이후 저장소를 변경할 수 있으며, 설치 폴더에 쓰기 권한이 없으면 관리자 권한으로 데이터 폴더 쓰기 권한을 설정할지 먼저 묻고 거부 시 다른 위치를 선택합니다.
- 저장소 이전은 비어 있는 새 폴더를 대상으로 복사·검증·경로 전환 후 기존 Weki 관리 데이터를 정리합니다. 기존 위치에 Weki가 관리하지 않는 사용자 파일이 있으면 해당 파일과 폴더는 보존합니다.
- 문서 데이터는 선택한 저장소 내부에만 보관합니다. 저장소 위치 포인터는 Windows 사용자 레지스트리에 기록하며 AppData에 문서 DB를 저장하지 않습니다.
- 프로그램 제거 시 Weki 전용 저장소의 DB·원본·백업·설정과 저장소 위치 포인터를 삭제합니다. 프로그램 업데이트는 기존 저장소를 유지합니다.
- 문서 등록이 실패하면 처리 현황에 오류 원인을 남기고 재시도·제거할 수 있습니다. 실패한 문서는 문서 관리와 검색에 노출되지 않습니다.
- 1차 설치 파일은 사내 전용으로 배포합니다. 설치 파일에는 MYBOX 토큰을 포함하지 않으며, 토큰이 없거나 검증에 실패하면 로컬 기능만 활성화하고 관리자 문의를 안내합니다. 토큰 유출이 의심되면 즉시 폐기·재발급해야 합니다.
