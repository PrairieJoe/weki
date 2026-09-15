# Weki v1.3.0 릴리스 반영 범위

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
