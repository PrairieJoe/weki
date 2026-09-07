# Weki 1.0.0

- 제품명: Weki
- 버전: 1.0.0
- 목적: 사내 최종 배포
- 지원 포맷: PDF / PPTX / DOCX / HWP / HWPX
- 로컬 검색 및 Evidence 확인 지원
- CPU-only 환경 공식 지원
- 설치/업데이트/재설치 및 데이터 보존 검증 완료
- Golden Dataset / 검색 품질 Gate 통과

## Release 범위

이번 릴리스부터 v1 신규 기능 추가는 중단합니다. 실사용 중 발견되는 실행 실패,
데이터 손실, 문서 처리 오류, 검색 불능만 blocker로 수정하며 비필수 UX 개선과
신규 기능은 backlog로 유지합니다.

## Release Gate 및 Preflight

OS 수준 네트워크 완전 격리 실행 증적은 v1 Release Gate에서 제외합니다. 기존
diagnostic 결과는 참고 증적으로 보존하며 삭제하지 않습니다. 핵심 로컬 경로는
External API 필수 의존성 없이 동작해야 하고, MYBOX·Gemini·Custom/OpenAI-compatible
원격 Endpoint 등 명시적 온라인 연동은 네트워크 의존 기능으로 허용합니다.

REQ-SCALE-001의 CPU-only 50,000~100,000페이지 대표 성능시험은 이번 배포 요구사항에서
제외하고 후속 성능 검증 과제로 이관합니다. 기존 RC 및 진단 증적은 외부 보관소에
보존합니다.

## Release 상태

최종 1.0.0 Release입니다.

OS 네트워크 완전 격리 증적 미확보는 더 이상 미통과 사유가 아닙니다.
