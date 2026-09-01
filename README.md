# Weki

Windows 로컬 문서 근거 검색 앱입니다. 등록한 문서는 프로젝트 폴더의 `.weki-data` 내부에 보관되며, 검색은 로컬 서버에서 수행됩니다.

## 원클릭 실행

Windows에서 [run-weki.bat](./run-weki.bat)을 더블클릭하면 서버를 시작하고 Weki를 브라우저로 엽니다.

개발 환경에서는 다음 명령도 사용할 수 있습니다.

```powershell
npm run dev
```

데스크톱 창으로 실행하려면 다음 명령을 사용합니다.

```powershell
npm run desktop
```

## 현재 지원

- PDF, DOCX, PPTX, HWPX, HWP 5.x의 로컬 텍스트 추출
- PDF 전체 페이지 로컬 OCR, PPTX 내 PNG/JPEG/WebP 시각 자산 OCR
- Text / Table / Visual Evidence를 페이지·슬라이드·HWP 섹션 위치와 함께 검색
- PPTX Visual Evidence의 원본 이미지 미리보기와 Native/OCR provenance 표시
- SHA-256 중복 방지, 원본 누락 문서의 동일 Hash 원본 재연결
- 서버 기반 등록·재처리 대기열, 재처리 중 기존 색인 유지
- 암호화 검색 시스템·전체 백업, 전체 교체 복원, 감사 기록
- 동의어·약어 검색 확장과 현재 실행 중인 세션의 PDF/PPT 후속 필터
- 문서 단위 삭제와 확인 문구·이중 경고가 필요한 전체 데이터 삭제

## 알려진 제한

- DOCX/HWPX/HWP의 시각 요소는 아직 전체 페이지 렌더링 OCR이 아니라 추출 가능한 원문 텍스트 중심입니다.
- HWP는 파서가 지원하는 HWP 5.x 구조에 한정됩니다.
- 외부 AI Provider 연동과 생성형 요약은 아직 제공하지 않습니다. 현재 처리 모드는 로컬 추출만 사용합니다.
