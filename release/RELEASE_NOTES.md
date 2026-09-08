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
