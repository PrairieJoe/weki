# Weki v1.3.0

## 핵심 방향

v1.3.0의 문서 처리 품질 개선은 HWP 호환성 보완과 Office 문서 렌더링을 서로 대체하지 않고 병렬로 운영합니다.

- `@rhwp/core@0.8.4`: HWP/HWPX 전용 renderer
- LibreOffice Portable `26.2.4`: DOCX/PPTX 실제 페이지·슬라이드 렌더러
- native parser·OCR fallback: 선택형 runtime이 없거나 실패한 경우에도 등록·검색 지속

## 검색 정확도 개선

- 통짜 이미지 PDF는 기존 전체 페이지 OCR과 visual evidence를 유지합니다.
- PPTX는 슬라이드 XML, native 표, 차트 XML/embedded workbook을 구조적으로 추출합니다.
- LibreOffice가 준비된 PPTX/DOCX는 실제 렌더링 결과를 PNG로 변환해 OCR하고, 이미지에만 존재하는 텍스트를 페이지·슬라이드 근거로 색인합니다.
- HWP/HWPX는 rhwp 렌더링 provenance를 사용하고, 지원하지 않는 구조는 기존 parser/OCR fallback으로 보존합니다.
- 렌더링 결과와 native/OCR 출처를 evidence provenance 및 미리보기 자산으로 유지합니다.

## 설치·배포

- 설정의 선택형 runtime 목록에 `presentation-renderer`를 추가했습니다.
- HWP/HWPX용 `document-renderer`도 MyBox `wiki/runtime/v1/document-renderer/0.8.4/`에서 내려받아 설치할 수 있도록 게시했습니다. 설치파일에는 rhwp 본체를 포함하지 않습니다.
- LibreOffice 번들은 MYBOX `wiki/runtime/v1/presentation-renderer/26.2.4/` payload 또는 설치파일에 포함된 오프라인 번들의 SHA-256을 검증한 뒤 사용자 데이터의 `dependencies/libreoffice/26.2.4`에 atomic 설치합니다.
- Online 환경은 MYBOX에서 번들을 내려받고, Full Offline 환경은 `resources/dependency-bundles/`에 같은 검증 번들을 포함할 수 있습니다. 공개 LibreOffice URL fallback은 제공하지 않습니다.
- 앱 패키지에는 Portable 압축 해제를 위한 7-Zip helper를 포함하고, LibreOffice 자체는 MSI 등록이나 시스템 전역 설치 없이 private runtime으로 실행합니다.
- 서비스 배포에서는 LibreOffice와 rhwp 자체를 설치 파일에 포함하지 않고, `wiki/runtime/v1/manifest.json`과 MYBOX payload를 통해 필요 시 내려받습니다. LibreOffice renderer의 자동·명시 설치 모두 공개 URL fallback을 사용하지 않으며, MYBOX payload가 없을 때는 검증된 오프라인 번들이 있는 경우에만 설치합니다.
- Windows x64 설치파일은 대상 아키텍처의 네이티브 런타임만 포함하고 Electron 언어 리소스를 한국어·영어로 제한해 NSIS 임시 압축 해제 용량을 줄였습니다. ONNX 실행에 필요한 `DirectML.dll`은 유지합니다.
- 설치 후 앱 재시작 전에는 `component_not_applied`, 재시작 후에는 `applied=true`로 상태를 명확히 구분합니다.
- MYBOX 목록·매니페스트 요청은 제한시간 내 실패를 명확히 표시하고, 대용량 runtime payload 다운로드에는 별도 제한시간을 적용합니다. renderer 설치 실패 시 전체 설치가 무기한 대기하거나 자동 종료되지 않습니다.
- LibreOffice payload 전송 스트림이 중단되면 자동 재시도하고, 요청 실패·payload 전송 중단·압축 해제 실패를 구분해 표시합니다.
- MYBOX 저장공간 연결 상태와 renderer manifest·payload 배포 상태를 분리해 표시하며, 배포본 부재는 전체 설치 실패가 아닌 보류 상태로 안내합니다.
- `presentation-renderer` 설치 실패·보류 메시지는 `Office 문서·PPT 렌더러`라는 사용자용 이름과 구체적인 원인을 사용합니다.
- runtime 적용 재시작은 Electron의 graceful relaunch/quit 흐름을 사용해 Windows에서 앱이 닫힌 뒤 다시 열리지 않는 문제를 방지합니다.
- 기존 설치 위에 업데이트할 때는 Weki 데이터 폴더·암호화 MYBOX 토큰·저장소 포인터를 보존하고, 명시적인 제거에서만 사용자 데이터를 삭제합니다.

## 검증 기준

- managed dependency의 URL·SHA-256·entrypoint 검증, staging/atomic promotion, 재시작 적용 상태
- LibreOffice 실제 1-slide PPTX OCR-only E2E
- LibreOffice 실제 1-page DOCX OCR-only E2E
- 기존 PDF visual evidence, PPTX 구조 추출, HWP/HWPX renderer, Electron onboarding 및 전체 회귀 테스트

패키지 버전과 사용자 테스트 설치파일은 현재 `1.3.0`으로 고정되어 있습니다.

## Verified artifact

- Source commit: `70e9dc48fbd6c8ebc9bb3d6178153c72a6b322af`
- Installer: `Weki-1.3.0-Setup.exe` (178490073 bytes)
- SHA-256: `34E5906D12C09F559F62916DD8DE05AE2B70B190F43CACC20043634B997305EF`
- SHA-512: `FE13F3A2A55E9B55E82F0199BE5DB2408AD9C298B64773FFA281D982987EC4F0273F5E491DAAEC60A723529741297B5CAE9E877E779F1FE9941A6FC2AAAEAFE5`
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
