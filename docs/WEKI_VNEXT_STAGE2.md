# Weki vNext 2단계 구성요소

> 상태: v1.3.0 품질 개선 반영. semantic model, semantic reranker, HWP/HWPX document renderer, Office/PPT presentation renderer는 선택형 runtime 구성요소로 제공됩니다.

2단계는 semantic model, semantic reranker, HWP/HWPX document renderer, Office/PPT presentation renderer를 기본 설치 파일에 강제하지 않고, 검증된 runtime 구성요소로 선택 설치합니다.

## Runtime pack

runtime root는 기본적으로 `<WEKI_DATA_DIR>/runtime/v1`입니다. manifest는 `format: weki-runtime-manifest`, component/version, 파일 크기·SHA-256, 앱 호환성, 선택적 Ed25519 signature를 가져야 합니다.

배포용 runtime pack은 MYBOX 루트의 `wiki/runtime/v1/`에 보관합니다. 이 폴더는 배포 준비 단계에서 한 번만 생성하며, 일반 설치판에는 폴더 생성 기능을 노출하지 않습니다. 사용자는 PowerShell이나 파일 업로드를 수행하지 않습니다. 기존 `weki` 백업 트리와는 분리됩니다.

LibreOffice Portable은 `wiki/runtime/v1/presentation-renderer/26.2.4/`에, rhwp는 `wiki/runtime/v1/document-renderer/0.8.4/`에 보관하고, 루트의 `manifest.json`에서 파일 크기·SHA-256을 선언합니다. renderer 설치는 MYBOX payload를 사용하며, `source: "mybox"` 요청뿐 아니라 자동 설치도 공개 URL로 우회하지 않습니다. MYBOX payload가 없고 설치파일에 검증된 오프라인 번들이 포함된 경우에만 해당 번들을 사용하고, 그 외에는 설치를 실패 상태로 안내합니다. 다운로드는 staging 파일에 먼저 저장하고 SHA-256을 검증한 뒤 atomic promotion합니다.

배포 담당자는 별도의 릴리즈 파이프라인에서 구성요소 항목을 포함한 서명된 `manifest.json`과 component payload를 이 폴더에 게시합니다. `resources/runtime-manifests/mybox-runtime-v1.json`은 rhwp와 LibreOffice 게시 구조를 재현하는 릴리즈 입력 예시입니다. `document-renderer`는 MIT 라이선스 `@rhwp/core@0.8.4`의 HWP/HWPX SVG renderer이고, `presentation-renderer`는 `resources/dependency-manifests/libreoffice-windows-x64.json`에 고정된 LibreOffice Portable 26.2.4입니다. 일반 설치판은 네 구성요소를 앱 화면에 항상 표시합니다. manifest 또는 구성요소 payload가 아직 없으면 해당 항목을 숨기지 않고 `배포 준비 중`으로 안내하며, 실제 설치 동작은 배포본을 확인한 구성요소에만 표시합니다. 설치 시 size·SHA-256·서명·앱 호환성 또는 Portable bundle hash를 검증하고, 사용할 수 없는 renderer는 native parser + OCR fallback으로 처리합니다.

운영 배포에서는 생성된 manifest를 CI Ed25519 키로 서명합니다. 앱에는 검증용 공개키가 내장되어 있고, 특별한 배포 환경에서는 `WEKI_RUNTIME_PUBLIC_KEY`로 교체할 수 있습니다. 구성요소 설치 후 앱을 재시작하면 관련 `/api/status`와 runtime 상태가 적용됩니다. API의 내부 상태값 `healthy`·`degraded` 등은 설정 화면에서 `정상 작동`·`일부 기능 제한`처럼 사용자 친화적인 한국어로 표시합니다.

개발·릴리즈 파이프라인에서만 로컬 runtime pack 생성 스크립트와 `WEKI_RUNTIME_MANIFEST_URL` 설정을 사용합니다. 설치된 Electron 배포판은 v2 검색을 기본 활성화하며, 일반 사용자의 runtime 설치 경로는 설정 화면으로 제한합니다.

상태 조회와 설치 API:

- `GET /api/runtime/components`
- `POST /api/runtime/components/install` (`manifest` 또는 `manifestUrl`, `componentId`, `version`)
- `POST /api/runtime/components/install-all` (설치 가능한 구성요소 목록을 순서대로 설치)
- `POST /api/runtime/components/:id/retry`
- `GET /api/mybox/runtime`

`전체 설치`는 semantic model → semantic reranker → document renderer → presentation renderer 순서로 실행하며, 배포본이 없는 구성요소는 실패 원인과 함께 상태를 남깁니다. 같은 버전이 이미 준비·적용된 구성요소는 다시 설치하지 않고, 더 높은 manifest 버전이 있을 때만 업데이트합니다. 파일은 `<version>.partial-*`에 먼저 내려받고 size/hash를 확인한 뒤 atomic promotion합니다. 이전 버전은 `.previous-*`로 보존하며, 실패한 staging은 정리하고 상태를 `failed`로 기록합니다. manifest에 서명이 있으면 앱에 내장된 공개키(또는 `WEKI_RUNTIME_PUBLIC_KEY` 대체키)로 Ed25519 검증을 통과해야 하며, LibreOffice는 MYBOX payload 또는 검증된 오프라인 번들만 private dependency로 추출합니다. 현재 앱에 복원된 기본 런타임 버전은 `better-sqlite3@13.0.3`, `usearch@2.26.2`, `onnxruntime-node@1.20.1`, `@huggingface/tokenizers@0.1.3`, `@rhwp/core@0.8.4`, `LibreOffice Portable 26.2.4`입니다.

설정의 기본 처리 모드는 `auto`(`설치 상태에 따라 자동`)로 저장할 수 있습니다. 세 구성요소가 모두 `ready`이고 앱에 적용된 경우에만 새 문서의 기본 처리 모드를 Local AI로 전환하며, 그 전에는 경량 처리로 동작합니다. 사용자가 명시적으로 경량 처리를 선택한 작업은 자동으로 Local AI로 승격하지 않습니다. 기존 문서는 이 설정 변경만으로 자동 재처리하지 않습니다.

## 전처리

`src/processing/evidence.mjs`는 native/OCR 병합, 최대 384 token·64 token overlap chunking, Text/Table/Visual Evidence 분리, 실제 페이지 provenance와 asset SHA-256을 제공합니다. v2 dual-write 시 이 계층을 거쳐 FTS fragment를 생성합니다.

## Semantic / ANN

`semantic-engine.mjs`는 384차원 query embedding provider를 주입받는 어댑터입니다. model pack이 없거나 차원이 맞지 않으면 semantic 결과를 비우고 lexical-only로 계속 동작합니다. `ann-index.mjs`는 generation별 staging·검증·active pointer 전환을 제공하며, 설치된 `usearch`가 있으면 실제 USearch 파일을 사용하고 없으면 재시작 가능한 JSON fallback으로 동작합니다. ONNX Runtime과 tokenizer는 semantic model runtime pack이 활성화될 때 연결됩니다.

변경 이력의 사용자 관점 요약은 [README.md](../README.md#v120-개선사항), 전체 변경 목록은 [CHANGELOG.md](./CHANGELOG.md)를 참조하세요.
