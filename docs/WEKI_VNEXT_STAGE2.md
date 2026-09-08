# Weki vNext 2단계 구성요소

> 상태: v1.0.0 이후 구현됨. semantic model과 document renderer는 선택형 runtime pack으로 제공됩니다.

2단계는 semantic model과 document renderer를 기본 설치 파일에 강제하지 않고, 검증된 runtime pack으로 선택 설치합니다.

## Runtime pack

runtime root는 기본적으로 `<WEKI_DATA_DIR>/runtime/v1`입니다. manifest는 `format: weki-runtime-manifest`, component/version, 파일 크기·SHA-256, 앱 호환성, 선택적 Ed25519 signature를 가져야 합니다.

배포용 runtime pack은 MYBOX 루트의 `wiki/runtime/v1/`에 보관합니다. 이 폴더는 배포 준비 단계에서 한 번만 생성하며, 일반 설치판에는 폴더 생성 기능을 노출하지 않습니다. 사용자는 PowerShell이나 파일 업로드를 수행하지 않습니다. 기존 `weki` 백업 트리와는 분리됩니다.

배포 담당자는 별도의 릴리즈 파이프라인에서 `document-renderer` 항목을 포함한 서명된 `manifest.json`과 component payload를 이 폴더에 게시합니다. 현재 배포에는 MIT 라이선스 `@rhwp/core@0.8.4`의 `document-renderer@1.0.0`(HWP/HWPX SVG renderer)이 `wiki/runtime/v1/`에 게시되어 있습니다. 일반 설치판은 폴더·manifest·`document-renderer` 항목이 모두 확인될 때만 앱 화면에 renderer 설치 동작을 표시하고, size·SHA-256·서명을 검증합니다. manifest가 없거나 renderer 항목이 빠진 경우에는 설치 동작을 숨기고 native parser + OCR fallback을 유지합니다.

운영 배포에서는 생성된 manifest를 CI Ed25519 키로 서명합니다. 앱에는 검증용 공개키가 내장되어 있고, 특별한 배포 환경에서는 `WEKI_RUNTIME_PUBLIC_KEY`로 교체할 수 있습니다. 모델 pack 설치 후 앱을 재시작하면 `/api/status`의 `search.model`과 `search.semantic`이 `ready`/`healthy`가 됩니다.

개발·릴리즈 파이프라인에서만 로컬 runtime pack 생성 스크립트와 `WEKI_RUNTIME_MANIFEST_URL` 설정을 사용합니다. 설치된 Electron 배포판은 v2 검색을 기본 활성화하며, 일반 사용자의 runtime 설치 경로는 설정 화면으로 제한합니다.

상태 조회와 설치 API:

- `GET /api/runtime/components`
- `POST /api/runtime/components/install` (`manifest` 또는 `manifestUrl`, `componentId`, `version`)
- `POST /api/runtime/components/:id/retry`
- `GET /api/mybox/runtime`

파일은 `<version>.partial-*`에 먼저 내려받고 size/hash를 확인한 뒤 atomic promotion합니다. 이전 버전은 `.previous-*`로 보존하며, 실패한 staging은 정리하고 상태를 `failed`로 기록합니다. manifest에 서명이 있으면 앱에 내장된 공개키(또는 `WEKI_RUNTIME_PUBLIC_KEY` 대체키)로 Ed25519 검증을 통과해야 합니다. 현재 앱에 복원된 기본 런타임 버전은 `better-sqlite3@13.0.3`, `usearch@2.26.2`, `onnxruntime-node@1.20.1`, `@huggingface/tokenizers@0.1.3`, `@rhwp/core@0.8.4`입니다.

## 전처리

`src/processing/evidence.mjs`는 native/OCR 병합, 최대 384 token·64 token overlap chunking, Text/Table/Visual Evidence 분리, 실제 페이지 provenance와 asset SHA-256을 제공합니다. v2 dual-write 시 이 계층을 거쳐 FTS fragment를 생성합니다.

## Semantic / ANN

`semantic-engine.mjs`는 384차원 query embedding provider를 주입받는 어댑터입니다. model pack이 없거나 차원이 맞지 않으면 semantic 결과를 비우고 lexical-only로 계속 동작합니다. `ann-index.mjs`는 generation별 staging·검증·active pointer 전환을 제공하며, 설치된 `usearch`가 있으면 실제 USearch 파일을 사용하고 없으면 재시작 가능한 JSON fallback으로 동작합니다. ONNX Runtime과 tokenizer는 semantic model runtime pack이 활성화될 때 연결됩니다.

변경 이력의 사용자 관점 요약은 [README.md](../README.md#v100-이후-개선사항), 전체 변경 목록은 [CHANGELOG.md](./CHANGELOG.md)를 참조하세요.
