# PRD — Weki
**Product Requirements Document — 제품정책 정합성 보완본**

- 문서 상태: v1.0.0
- 대상 버전: 1차 제품
- 대상 OS: Windows
- 제품 유형: Local-first Desktop Document Knowledge Retrieval
- 핵심 UX: Chat-based Evidence Search
- 공식 지원 언어: 한국어 / 영어
- 작성 기준: v1.5의 유효 요구사항과 승인된 제품 의사결정을 유지하되, 추가 정합성 검토에서 확정된 검색 시스템 백업 복원 후 원본 상태, 기존 Document 재처리 상태 분리, 동의어·약어 재처리 수명주기, Table Evidence 판정, 저연관 검색결과 안내, External AI 실행 전 사용자 고지, 앱 업데이트 전 Maintenance 조건을 반영
- 요구사항 해석 원칙: 각 기능의 규범적 Source of Truth는 해당 본문 절이며, 사용자 시나리오·Acceptance Criteria·최종 요약은 설명·검증 목적의 비규범적 파생 표현으로 취급한다. 동일 개념이 반복될 경우 본문 정의를 참조하고 별도 의미를 추가하지 않는다.

---

# 1. 제품 개요

## 1.1 제품 정의

본 제품은 사용자가 보유한 PDF, PPTX, HWP/HWPX, DOCX 문서를 내부 저장소에 등록하고, 문서 내 텍스트·표·이미지·도표·OCR 정보를 검색 가능한 구조로 전처리한 뒤, 사용자가 자연어로 질문하면 관련성이 높은 원문 근거의 위치를 챗봇 형태의 인터페이스로 제공하는 로컬 문서 지식 검색 시스템이다.

제품의 핵심 목적은 생성형 AI가 새로운 답변을 작성하는 것이 아니라 다음을 가능하게 하는 것이다.

> **“내가 보유한 수많은 업무 문서 중 필요한 내용이 정확히 어느 문서의 어느 페이지 또는 슬라이드에 있는지를 빠르게 찾는다.”**

1차 제품에서 검색 시점의 생성형 LLM 답변 작성은 사용하지 않는다.  
문서 등록 이후에는 전처리 결과와 검색 인덱스를 이용해 경량 검색을 수행하며, 전처리 단계에서만 사용자가 허용한 범위 내에서 LLM/VLM을 선택적으로 활용할 수 있다.

제품의 역할은 필요한 근거의 **발견과 위치 확인**까지이다. 검색된 내용을 자동으로 복사·재작성하거나 보고서·기획서 형태로 조합하는 기능은 1차 범위에 포함하지 않는다.

## 1.2 Primary User

주 사용자는 본인 또는 다른 사람이 작성한 제안문서, 보고서, 발표자료 등 조직 내 축적된 다수의 업무 문서를 개인 업무환경에서 활용하는 지식근로자다.

이 사용자는 과거 문서의 내용·근거·분석자료를 현재 업무에 다시 활용하기 위해 반복적으로 문서를 탐색하며, 다음 시간을 줄이고자 한다.

- 어떤 문서에 필요한 내용이 있는지 찾는 시간
- 문서는 알고 있지만 문서 내부의 정확한 위치를 찾는 시간

## 1.3 핵심 문제

1차 제품은 **등록된 전체 Knowledge Base에서 관련 문서와 문서 내부의 정확한 근거 위치를 함께 찾는 문제**를 핵심 해결 대상으로 본다.

주요 사용 상황은 다음 두 유형이다.

1. **어느 문서에 있는지 모르는 경우**
   - 과거 어떤 자료에서 특정 주제를 검토했는지 기억하기 어렵다.
   - 파일명만으로 내용을 판단하기 어렵다.
   - 동일 개념이 문서마다 다른 표현·약어로 작성된다.

2. **문서는 알고 있거나 짐작하지만 내부 위치를 찾기 어려운 경우**
   - 문서가 수십~수백 페이지에 달한다.
   - 필요한 정보가 본문뿐 아니라 표·그래프·지도·이미지 내부에도 존재한다.
   - 기존 파일 검색은 문서 내부 구조와 의미를 충분히 활용하지 못한다.

1차 제품에서는 두 상황 모두 **전체 Knowledge Base 검색**을 통해 관련 문서와 내부 위치를 찾도록 한다. 이미 알고 있는 특정 문서 하나만을 검색범위로 고정하는 기능은 1차 범위에 포함하지 않는다.

## 1.4 제품 핵심 정의

> **“업무 문서를 한 번 검색 가능한 지식 구조로 만들어 두고, 이후에는 생성형 답변에 의존하지 않고 자연어 질문만으로 정확한 원문 근거 위치를 빠르게 찾아주는 로컬 문서 지식 검색 시스템.”**

---

# 2. 제품 목표와 비목표

## 2.1 1차 제품 목표

1차 제품의 목표는 **등록된 전체 Knowledge Base를 대상으로 한 근거 기반 자연어 문서 검색**이다.

사용자는 예를 들어 다음과 같이 질문할 수 있어야 한다.

- “DRT 도입을 검토한 자료 찾아줘.”
- “교통취약지역 선정 기준이 들어간 보고서가 뭐였지?”
- “버스 이용객 감소 원인을 분석한 자료 찾아줘.”
- “그중에서 2024년 이후 자료만 보여줘.”
- “두 번째 결과와 비슷한 자료 찾아줘.”

시스템은 관련성이 높은 Knowledge Unit을 찾아 최소한 다음을 제공해야 한다.

### 필수 제공

- 파일명
- 질의와 직접 관련된 Source Evidence의 정확한 Page 또는 Slide
- 다중 Page/Slide Knowledge Unit인 경우 해당 Knowledge Unit의 관련 범위
- 검색 연관성 지표
- 실제 Source Evidence
  - 직접 근거가 Text인 경우: Native/OCR 원문과 앞뒤 문맥
  - 직접 근거가 Visual인 경우: 실제 원본 Visual Asset 또는 원본에서 검증 가능한 미리보기와 해당 Page/Slide
  - Text와 Visual이 모두 직접 근거인 경우: 두 Evidence를 함께 제공 가능
- 원본 열기 또는 원본 누락 상태

### 생성 가능한 경우 제공

- 주제·요약·특징·키워드 등 검색 보조 메타데이터
- Source Evidence로 선택되지 않은 표·이미지·그래프의 보조 미리보기
- 유사한 문서가 존재하는 경우 그룹 탐색

주제·요약·특징 등 검색 보조 메타데이터가 생성되지 않았더라도 파일명, 질의별 근거 위치, 실제 Source Evidence 등 최소 Evidence가 존재하면 유효한 검색결과로 제공할 수 있어야 한다.

**Source Evidence의 존재와 위치는 검색 결과 생성 시 질의와 실제 원문/Visual Reference의 매칭을 통해 결정한다.** Knowledge Unit 자체에 질의와 무관한 단일 `Evidence Page/Slide` 값을 고정 저장하지 않는다.

## 2.2 성공의 정의

제품은 다음을 성공으로 본다.

- 사용자가 정확한 키워드를 기억하지 못해도 관련 자료를 찾을 수 있다.
- 사용자가 필요한 내용의 파일명과 Page/Slide를 빠르게 확인할 수 있다.
- 일부 전처리 또는 검색 구성요소가 실패해도 가능한 범위에서 검색을 계속 사용할 수 있다.
- GPU가 없는 CPU-only Windows PC에서도 핵심 기능이 동작한다.
- 실제 업무질문 기반 Golden Dataset에서 합의된 검색 품질 기준을 출시 전에 충족한다.

## 2.3 1차 범위에 포함

- Windows Desktop Application
- PDF / PPTX / HWP / HWPX / DOCX
- 한국어 / 영어
- 파일 등록 / 디렉토리 등록
- 반복 등록을 통한 증분 문서 추가
- 내부 원본 저장소
- Hash 기반 동일 파일 중복 방지
- Native Parsing
- OCR
- 텍스트·표·이미지 추출
- 경량 전처리
- 선택적 Local AI 전처리
- 선택적 External AI 전처리
- Knowledge Unit 구성
- AI / Lightweight / Deterministic Fallback Chain
- Page/Slide 최소 Knowledge Unit Fallback
- Embedding
- Vector Search
- BM25/FTS Search
- Hybrid Search
- 검색 랭킹 및 중복 억제
- 유사 문서 검색결과 그룹화
- 챗봇형 검색 UI
- 후속 검색
- 사용자 검색 피드백
- 검색 품질 평가
- 문서 관리 및 재처리
- Processing Job Queue
- 저장소 이전
- MYBOX 백업 / 검색 DB 카탈로그 동기화 / 원본 지연 복원
- 외부 AI Provider 설정
- Custom/OpenAI-compatible Endpoint
- 사용자 동의어·약어 사전
- 처리 로그 / 외부 AI 감사 로그
- 수동 앱 업데이트

## 2.4 1차 범위에서 제외

- 생성형 AI 기반 최종 답변 작성
- 여러 문서 내용을 AI가 종합하여 결론 생성
- 보고서/기획서 자동 작성
- 업무 Agent 기능
- LLM 기반 Query Rewrite
- 서버형 다중 사용자 기능
- 사용자 계정/권한관리
- macOS / Linux
- XLS/XLSX
- TXT/MD 공식 지원
- 디렉토리 실시간 감시
- 등록 이후 외부 파일 위치 추적
- 외부 파일 삭제·이동 감지
- 특정 폴더별 검색
- 특정 문서만 대상으로 한 검색
- 프로젝트/컬렉션 검색
- 자동 프로그램 업데이트 확인·다운로드·설치
- 사용자의 검색 랭킹 가중치 직접 변경
- 비밀번호 문서의 앱 내 비밀번호 입력·해제
- 앱 내부 휴지통
- 과거 검색 대화 복원 및 검색 기록 UI
- PC 전체를 자동 탐색하는 기존 저장소 검색

향후 기능은 실제 필요가 확인된 시점에 별도 요구사항으로 설계하며, 1차 제품에서는 미래 확장을 위한 과도한 사전 추상화를 구현하지 않는다.

---

# 3. 제품 설계 원칙

## 3.1 Local-first

핵심 기능은 GPU가 없는 CPU-only Windows PC에서도 동작해야 한다.

CPU-only 환경에서 공식 지원해야 하는 핵심 기능은 다음과 같다.

- 문서 등록
- Native Parsing
- OCR
- 경량 Fallback
- Embedding
- Vector Search
- BM25/FTS Search
- 검색 결과 제공

**External AI를 허용하거나 네트워크에 연결하지 않아도 위 핵심 기능은 경량 로컬 경로만으로 동작해야 한다.**

로컬 LLM/VLM은 하드웨어가 충분한 경우에만 선택적으로 사용한다. Local AI를 사용할 수 없거나 사용자가 허용하지 않은 경우에도 경량 처리 경로로 핵심 검색 기능이 중단되지 않아야 한다. External AI는 사용자가 명시적으로 허용한 Processing Job에서 전처리 품질을 보강할 수 있는 선택적 수단이며, CPU-only 공식 지원의 필수조건이 아니다.

### 3.1.1 네트워크 의존성 범위

v1의 핵심 로컬 기능은 외부 네트워크 서비스에 대한 필수 의존성 없이 동작해야 한다. 핵심 범위는 다음과 같다.

- PDF/DOCX/PPTX/HWP/HWPX 등록 및 전처리
- 로컬 Embedding
- 로컬 검색
- Evidence 확인
- 앱 재실행 후 기존 데이터 사용

MYBOX, Gemini 등 External AI Provider, Custom/OpenAI-compatible 원격 Endpoint 및 기타 명시적 온라인 연동은 네트워크 의존 기능으로 허용한다. Windows 방화벽 등을 사용한 OS 수준 네트워크 완전 격리 실행 증적은 v1 Release Gate가 아니며, 기존 진단 결과는 참고 증적으로 보존한다.

## 3.2 Preprocessing-heavy, Retrieval-light

> **“전처리는 느릴 수 있지만 검색은 가볍고 빠르게 수행한다.”**

대용량 문서의 전처리에 수십 분 또는 수시간이 걸릴 수 있다.  
검색은 이미 구축된 인덱스를 이용해 수초 이내 결과 제공을 목표로 한다.

## 3.3 Evidence-first

검색 결과는 등록 문서에 실제 존재하는 근거를 중심으로 제공한다.

- 검색 시점에 새로운 사실을 생성하지 않는다.
- 등록 자료에서 확인할 수 없는 내용을 임의로 작성하지 않는다.
- 사용자는 결과에서 실제 Source Evidence와 위치를 직접 확인할 수 있어야 한다.

Source Evidence는 다음 두 유형으로 구분한다.

- **Text Evidence**: Native Text, OCR Text 및 해당 앞뒤 문맥
- **Visual Evidence**: 원본 문서에 실제 존재하는 Image / Table / Chart / Diagram / Map 등의 Visual Asset 또는 원본에서 검증 가능한 미리보기와 해당 Page/Slide

각 검색결과는 질의와 직접 관련된 Source Evidence를 최소 하나 가져야 한다.

- 직접 근거가 Text인 경우 → Text Evidence를 제공한다.
- 직접 근거가 Visual인 경우 → Visual Evidence를 제공한다.
- 두 유형이 모두 직접 근거인 경우 → 둘을 함께 제공할 수 있다.

Table은 근거의 성격에 따라 Evidence Type을 판정한다.

- **표의 실제 문자·Cell 값 자체가 직접 근거인 경우** → Text Evidence로 취급할 수 있다.
- **행·열 관계, 구조, 배치 등 표 자체의 시각적 구조가 직접 근거인 경우** → Visual Evidence로 취급한다.
- 문자값과 표 구조가 함께 직접 근거인 경우 → Text + Visual Evidence를 함께 제공할 수 있다.

AI/VLM 또는 경량 처리로 생성한 Summary, Topic, Visual Description 등은 검색 보조 메타데이터이며 Source Evidence 자체로 취급하지 않는다. **생성정보만 존재하고 실제 Source Evidence로 역추적할 수 없는 항목은 최종 검색결과의 근거로 사용할 수 없다.**

## 3.4 Recall-first Retrieval

검색 품질은 **Precision보다 Recall을 우선**한다.

> 관련 없는 결과가 일부 포함되는 것보다 실제 필요한 자료가 검색 후보에서 빠지는 것을 더 큰 실패로 본다.

따라서 관련성이 낮다고 판단되더라도 절대 Threshold만으로 검색결과를 모두 차단하지 않는다. 시스템은 현재 후보 중 상대적으로 연관성이 높은 결과를 계속 제공한다.

단, **Evidence 정합성은 검색결과 유효성의 Hard Gate**로 적용한다. Recall-first 원칙은 실제 Source Evidence와 정확한 Provenance를 확보하여 유효한 검색결과 후보로 인정된 집합 안에서 적용한다. 생성정보나 검색 신호만 존재하고 실제 Source Evidence로 역추적할 수 없는 항목은 Recall 확보를 이유로 최종 결과에 노출하지 않는다.

## 3.5 Graceful Degradation

전처리나 검색 구성요소 일부가 실패해도 정상 동작 가능한 기능이 남아 있다면 전체 기능을 중단하지 않는다.

- 페이지 일부 OCR 실패 → 성공한 페이지는 검색 가능
- Visual Analysis 실패 → 원문 기반 검색 유지
- Vector Search 또는 BM25/FTS 일부 장애 → 남아 있는 검색 기능으로 계속 검색
- External AI 실패 → 허용 범위 내 하위 Fallback 사용

## 3.6 Source Provenance

사용자에게 반드시 보장하는 Provenance는 다음과 같다.

- 파일명
- 검색결과에서 질의와 직접 관련된 실제 Source Evidence의 정확한 Page 또는 Slide
- Knowledge Unit이 여러 Page/Slide에 걸치는 경우 전체 관련 범위
- 해당 검색결과의 Matched Evidence 유형(Text / Visual)

Page/Slide 기준은 다음과 같이 정의한다.

- PDF → 원본 PDF의 Page 번호
- PPTX → 원본 PPTX의 Slide 번호
- DOCX / HWP / HWPX → 앱 전처리 시 생성한 렌더링 결과의 Page 번호

DOCX/HWP/HWPX는 원본 편집기 및 렌더링 환경에 따라 원본 프로그램에서 보이는 Page와 일부 차이가 발생할 수 있음을 사용자에게 안내한다.

다중 Page Knowledge Unit은 다음 두 위치정보를 구분한다.

- **근거 위치(Matched Evidence Location)**: 검색 시점에 질의와 직접 매칭된 실제 Source Evidence가 존재하는 Page/Slide
- **관련 범위(Source Range)**: 해당 Knowledge Unit이 포함하는 전체 Page/Slide 범위

예:

```text
근거 위치: p.36
관련 범위: p.35~37
```

`근거 위치`는 질의에 따라 달라질 수 있는 **검색결과 속성**이다. Knowledge Unit에는 실제 추출 Text/Visual Asset과 각 원본 Page/Slide의 참조관계를 보존하고, 검색 시점에 이 Reference를 이용하여 Matched Evidence Location을 결정한다.

가능한 경우 다음 상세 위치정보를 보조적으로 제공할 수 있다.

- Section / Heading
- 장·절
- 문단
- 표/이미지 식별정보

Bounding Box 등 내부 정밀 위치정보의 저장 방식과 질의별 Evidence Match 산정 방식은 TRD에서 결정한다.

## 3.7 Maintenance Exclusive Operation

상태 복잡성과 데이터 불일치를 줄이기 위해 다음 관리 작업은 **Processing Queue가 완전히 비어 있을 때만 시작**할 수 있다.

- 저장소 이전
- MYBOX 백업
- 전체 문서 데이터 삭제

`Processing Queue가 완전히 비어 있음`은 다음을 모두 만족하는 상태를 의미한다.

- 실행 중 Job 없음
- 일시중지 Job 없음
- 대기 Job 없음

조건을 만족하지 않으면 해당 관리 작업 시작을 차단하고, 사용자가 기존 Job을 완료하거나 취소/Queue 제거하도록 안내한다.

Maintenance Exclusive Operation이 시작된 뒤에는 해당 작업이 종료될 때까지 다음을 공통으로 적용한다.

- 새로운 문서 등록 Job 생성/Queue 추가 차단
- 새로운 재처리 Job 생성/Queue 추가 차단
- 다른 Maintenance Exclusive Operation의 동시 시작 차단
- 사용자가 등록/재처리를 시도하면 현재 Maintenance 작업으로 인해 시작할 수 없음을 안내

각 관리 작업에서 허용되는 검색·열람·설정 변경 등 읽기/쓰기 범위는 해당 절의 정책을 따른다. Maintenance 상태 진입·해제, Lock, 실패 복구 방식은 TRD에서 정의한다.

# 4. 전체 사용자 흐름과 화면 구조

## 4.1 전체 흐름

```text
파일 / 디렉토리 등록
        ↓
Hash 확인
        ├─ 동일 Hash + 기존 원본 정상 → 이미 등록됨 / 건너뜀
        ├─ 동일 Hash + 기존 Document 원본 누락 → 기존 Document에 원본 자동 재연결
        └─ 신규 Hash → 독립 Document 등록
        ↓
내부 원본 저장소 복사 또는 재연결
        ↓
Native Text Extraction
        ↓
모든 Page / Slide OCR
        ↓
표 / 이미지 / 도표 추출
        ↓
선택된 Processing Mode에 따른 허용 처리
        ↓
AI / Lightweight / Deterministic Fallback Chain
        ↓
Knowledge Unit 생성·확정
        ↓
검색용 Embedding + FTS Index 생성
        ↓
검색 가능 상태
        ↓
사용자 자연어 질의
        ↓
경량 Query Normalization
        ↓
Vector + BM25/FTS Hybrid Search
        ↓
Ranking / 중복 억제 / 유사 문서 그룹화
        ↓
질의별 Matched Source Evidence 및 위치 확정
        ↓
초기 제한 결과 표시 + 더 보기
        ↓
후속 검색 / 원본 확인 / 피드백
```

Lightweight Intelligence에서 인접 Page/Slide 관계 판단에 Embedding이 필요한 경우 **전처리용 경량 Boundary Embedding**을 사용할 수 있다. 이는 Knowledge Unit 확정 후 생성하는 검색용 Embedding과 별개의 전처리 Artifact다.

신규 Document 등록에서는 **검색 가능 조건을 충족한 Knowledge Unit부터 순차적으로 검색에 노출해야 한다.** 검색 가능 조건은 최소 다음을 만족한다.

- 실제 Source Evidence로 역추적 가능한 Text 또는 Visual Reference 존재
- 정확한 Page/Slide Provenance 존재
- Vector 또는 BM25/FTS 중 최소 하나의 정상 검색 경로에 Index 완료

한 검색 경로만 사용 가능한 경우 §3.5 및 §14의 Graceful Degradation 정책에 따라 검색은 계속 제공하되 기능 제한 상태를 표시한다.

기존 Document 재처리에서는 재처리 완료 전까지 기존 검색 데이터를 유지하고, 재처리 완료 및 검증 후 새 결과로 전환한다.

## 4.2 주요 화면

좌측 Navigation 기준으로 다음 화면을 제공한다.

### A. 검색

- 자연어 질문 입력
- 초기 제한 결과 표시
- 더 보기
- 후속 검색
- 검색 연관성 지표
- 관련 원문
- 가능한 경우 표/이미지 미리보기
- 유사한 문서 그룹
- 원본 열기
- 검색 만족도 평가
- 검색 기능 부분 장애 배너

### B. 문서 등록 / Processing Job

파일 등록과 디렉토리 등록을 동일한 중요도로 제공한다.

등록 시 Processing Job 단위로 처리 모드를 선택할 수 있다.

- 경량 처리만
- Local AI 허용
- External AI 허용

현재 처리 Job과 Queue를 함께 확인할 수 있어야 한다.

- 실행 중 Job 확인
- 대기 Job 확인
- Queue 순서 변경
- 대기 Job 실행 전 제거
- 실행/일시중지 Job 일시중지·재개·취소

### C. 문서 관리

- 문서 목록
- 파일 포맷
- 등록일
- 원본 수정일
- 처리 상태
- OCR 상태
- AI 분석 상태
- Knowledge Unit 상태
- 임베딩/색인 상태
- 부분 실패 상태
- 처리 방식 / Confidence
- 실패 항목 재처리
- 특정 처리 단위 재처리
- 주제 / 요약 / 특징 / 키워드 / 별칭 수정
- 자동 생성값으로 되돌리기
- 재처리 후 사용자 수정값 `확인 필요` 상태 확인·처리
- 원본 누락 상태 확인
- 문서 삭제
- 저장공간 사용량 확인

### D. 설정 / 운영

- 내부 저장소 위치
- 저장소 이전
- AI Provider / Model 기본값
- Custom Endpoint
- API Key
- 동의어·약어 사전
- 검색 점수 산정 정보
- MYBOX 백업
- MYBOX 검색 DB 카탈로그 동기화
- MYBOX 원본 지연 복원
- 보안 설정
- 처리 로그
- 외부 AI 감사 로그
- 전체 문서 데이터 삭제

---

# 5. 최초 실행과 빈 Knowledge Base

## 5.1 최초 실행 Setup Flow

최초 실행 시 간단한 Setup Flow를 제공한다.

1. 저장소 위치 확인
2. 기본 Processing Mode가 `경량 처리만`임을 안내
3. 설정 완료

Local/External AI Provider 설정은 최초 실행에서 강제하지 않는다.

기본 저장소는 앱의 내부 데이터 영역을 제안하고 사용자가 다른 위치를 선택할 수 있게 한다. 실제 Windows 물리 경로는 TRD에서 확정한다.

## 5.2 빈 Knowledge Base

등록된 문서가 하나도 없으면 빈 검색창만 표시하지 않는다.

예:

> 아직 등록된 문서가 없습니다.  
> 문서를 등록하면 자연어로 필요한 근거를 검색할 수 있습니다.  
> **[문서 등록 시작]**

---

# 6. 문서 등록, 동일성, 내부 저장소

## 6.1 지원 포맷

P0 공식 지원:

- PDF
- PPTX
- HWP
- HWPX
- DOCX

지원하지 않는 형식은 사용자에게 명확히 안내한다.

## 6.2 내부 저장소가 Source of Truth

외부 파일은 등록을 위한 입력원으로만 사용한다.

등록 완료 후에는 앱 내부 저장소의 원본이 유일한 Source of Truth다.

따라서 등록 이후 외부 파일의 이동·삭제·경로 변경은 시스템 상태에 영향을 주지 않는다.

## 6.3 파일 동일성 정책

1차 제품은 파일 간 버전 관계를 자동 추론하지 않는다.

핵심 규칙은 다음과 같다.

> **동일 Hash = 동일 파일 → 중복 Document를 생성하지 않음**  
> **Hash가 다름 = 별개의 독립 Document → 개별 관리**

단, 동일 Hash에 해당하는 기존 Document가 `원본 누락` 상태인 경우에는 중복 등록이 아니라 **원본 재연결**로 처리한다.

파일명·경로·내용이 비슷하다는 이유만으로 두 파일의 버전 관계를 추론하지 않는다.

## 6.4 동일 Hash 재등록 및 원본 재연결

동일 Hash 파일은 기존 Document의 원본 상태에 따라 다음과 같이 처리한다.

### A. 기존 원본이 정상인 경우

- 경로가 달라도 동일 파일로 판단
- 파일명이 달라도 동일 파일로 판단
- 새 Document를 생성하지 않음
- 재전처리하지 않음
- 사용자 확인 팝업을 표시하지 않음
- Processing Job 결과에 `이미 등록됨 / 건너뜀` 표시

대표 파일명은 최초 등록 시 파일명을 유지한다.

같은 파일을 다시 등록한 행위를 재처리 요청으로 해석하지 않는다. 재처리는 문서 관리 화면에서 사용자가 명시적으로 실행한다.

### B. 기존 Document가 `원본 누락` 상태인 경우

동일 Hash 파일이 등록되면 `이미 등록됨 / 건너뜀`으로 처리하지 않고 기존 Document에 원본을 자동 재연결한다.

- 새 Document를 생성하지 않음
- 기존 Document ID와 전처리·검색 데이터를 유지
- 대표 파일명과 Document의 최초 등록 시 원본 수정일시·등록일시를 유지
- 재연결 파일의 파일시스템 수정일시가 필요한 경우 Source/Relink 메타데이터로 별도 기록하되 Document의 기본 날짜 검색 기준값을 변경하지 않음
- 기존 전처리 결과가 유효하면 OCR, AI 전처리, Embedding, Index를 다시 생성하지 않음
- `source_status = available`로 전환하고 원본 열기 기능을 복구

일반 파일/디렉토리 등록 과정에서도 이 원칙을 동일하게 적용한다.

## 6.5 신규 Hash 등록

Hash가 다르면 새 독립 Document로 등록한다.

기존 Document와 비슷한 파일명, 유사한 내용, 동일 폴더 이력 등이 있더라도 자동으로 연결하거나 병합하지 않는다.

## 6.6 Document 메타데이터

Document는 최소한 다음 정보를 유지한다.

- Document ID
- 최초 등록 파일명
- 파일 포맷
- 파일 Hash
- 원본 수정일시
- 등록일시
- 신뢰 가능한 Native Metadata 작성일시(존재하는 경우)
- 내부 원본 참조
- processing_status
- source_status
- Provenance 연계정보

Native Metadata에서 신뢰 가능한 작성일 정보를 확보할 수 없는 경우 `작성일 정보 없음` 상태로 관리하며, 표지·본문의 날짜를 시스템이 임의로 문서 작성일로 확정하지 않는다.

## 6.7 대용량 문서

파일 크기 또는 페이지 수에 고정 상한을 두지 않는다.

대신 대용량 문서 등록 시 처리시간·저장공간 부담이 클 수 있음을 사전에 안내한다.

예상 저장공간이 부족하면 Processing Job 시작 자체를 차단한다.

처리 도중 예상 밖으로 저장공간이 부족해지면:

> **자동 일시중지 → 완료 결과 유지 → 공간 확보 후 재개**

원칙을 따른다.

## 6.8 등록 부분 실패

여러 파일을 한 Job에서 처리할 때 다음과 같은 파일이 포함되어도 해당 파일만 실패 처리하고 나머지 파일은 계속 진행한다.

- 비밀번호 문서
- 손상 문서
- 잠긴 파일
- Parsing 불가 파일

비밀번호 입력 UI는 1차에서 지원하지 않는다. 사용자가 외부에서 잠금을 해제한 후 다시 등록한다.

---

# 7. Processing Job 운영

## 7.1 Job 단위

문서 등록과 재처리는 Processing Job으로 관리한다.

AI 허용 범위 역시 Document의 영구 속성이 아니라 **Processing Job마다 새롭게 선택하는 실행 정책**이다.

## 7.2 동시 실행과 Queue

1차 제품에서는 한 번에 **하나의 Processing Job만 실행**한다.

나머지 Job은 Queue에 대기한다.

사용자는 다음을 확인할 수 있어야 한다.

- 현재 처리 중 Job
- 대기 Job
- 진행률
- 완료량
- 남은 양
- 실패 항목
- 중단 지점

대기 중인 Job은 사용자가 직접 순서를 변경할 수 있어야 한다.

아직 실행되지 않은 대기 Job은 사용자가 Queue에서 제거할 수 있어야 한다. 대기 Job 제거는 아직 처리 결과가 생성되지 않은 상태이므로 Rollback을 요구하지 않는다.

## 7.3 자원 사용 원칙

CPU 사용 강도를 사용자가 직접 조절하는 기능은 1차에서 제공하지 않는다.

시스템이 자동으로 자원 사용을 조절하며 다음 원칙을 우선한다.

> **전처리 속도보다 검색과 PC 전체 반응성을 우선한다.**

## 7.4 앱 종료 / 재부팅

앱 종료 또는 PC 재부팅 시:

- 완료된 결과를 보존한다.
- 미완료 Job의 진행상태를 보존한다.
- 종료 직전 **실행 중이던 Job**은 앱 재실행 후 자동 재개한다.
- 사용자가 수동으로 일시중지한 Job은 일시중지 상태를 유지하며 자동 재개하지 않는다.
- 저장공간 부족 등 재개를 막는 원인이 남아 있는 Job은 조건이 해소되기 전 자동 재개하지 않는다.
- 저장공간 부족 등 시스템 원인으로 자동 일시중지된 Job은 원인이 해소되더라도 자동 재개하지 않으며, 사용자가 상태를 확인한 뒤 명시적으로 재개한다.

## 7.5 일시중지

사용자가 Job을 일시중지하면:

- 완료 결과와 진행상태를 보존한다.
- 앱 재실행 후에도 자동 재개하지 않는다.
- 사용자가 이후 수동으로 재개한다.

사용자 일시중지와 시스템 원인 자동 일시중지는 원인과 UX를 구분하여 표시할 수 있어야 하며, 두 경우 모두 실제 처리 재개는 사용자의 명시적 동작으로 수행한다.

## 7.6 취소

취소는 처리 중 또는 일시중지 상태의 Job에서 가능하다.

취소 시:

- 해당 Processing Job이 만든 변경사항을 작업 시작 전 상태로 Rollback한다.
- 신규 등록 Job에서 이미 검색에 노출된 처리 완료 단위가 있다면 취소 시 해당 Job이 생성한 검색 데이터도 제거한다.
- 기존 Document 재처리 Job은 완료 전까지 기존 검색 데이터를 유지하므로 취소 시 기존 검색 상태를 그대로 유지한다.
- 완료된 Job에는 취소 기능을 제공하지 않는다.
- 완료된 Document 제거는 문서 삭제 기능을 사용한다.

Checkpoint와 Transaction/Rollback의 구현 방식은 TRD에서 결정한다.

---

# 8. 문서 추출과 전처리

## 8.1 Native Text Extraction

각 포맷에서 가능한 원본 구조정보를 최대한 보존한다.

예:

- Heading
- Paragraph
- Section
- Slide
- Shape
- Table
- Caption
- List
- Page
- Text Box

단순 Plain Text 변환보다 구조적 추출을 우선한다.

## 8.2 OCR

OCR은 **모든 공식 지원 문서의 모든 Page/Slide에 기본 수행**한다.

Native Text가 충분히 존재한다는 이유만으로 Page/Slide OCR을 생략하지 않는다. Native Text만으로는 다음 정보가 빠질 수 있기 때문이다.

- 이미지 안의 텍스트
- 그래프 축·범례
- 지도 지명
- 이미지 형태 표
- 캡처 화면
- 스캔 페이지
- 그림 안 설명

Native Text와 OCR Text는 중복 제어 후 함께 검색에 활용한다.

텍스트 출처는 구분하여 관리한다.

```text
text_source = native
text_source = ocr
text_source = vlm_generated
```

OCR은 GPU 없이 로컬에서 동작할 수 있어야 한다.

OCR은 AI/Lightweight/Deterministic Fallback Chain의 하위 단계가 아니라 **모든 Processing Mode에 공통으로 선행하는 기본 추출 단계**다. OCR 실패에 대한 재시도·대체 엔진 등의 구현 전략은 TRD에서 정의할 수 있으나, 제품 수준의 Fallback 단계와 혼동하지 않는다.

OCR Engine, 렌더링 DPI, 병렬처리, Cache 등 성능 최적화는 TRD에서 결정하되, 최적화가 `모든 Page/Slide에 OCR을 수행한다`는 제품 요구를 훼손해서는 안 된다.

## 8.3 Visual Asset

문서 내에서 검색 또는 Evidence 후보가 되는 의미 있는 Visual Asset은 **원본 Page/Slide와 역추적 가능한 독립 Reference로 관리해야 한다.**

예:

- Photograph
- Table
- Chart
- Diagram
- Map
- Screenshot

장식성 이미지는 검색 대상에서 제외할 수 있다.

### 8.3.1 1차 제품 보장 수준

이미지·그래프·지도·캡처 등에 포함된 **문자 정보의 검색은 OCR을 통해 핵심 기능으로 지원**한다.

반면 다음과 같은 비텍스트 Visual 의미 이해는 **Best-effort 기능**으로 본다.

- 그래프의 상승·하락 패턴이나 관계 해석
- 도표·Diagram의 구조적 의미
- 사진의 장면·객체 의미
- 지도의 공간적 관계
- 기타 OCR Text만으로 충분히 표현되지 않는 Visual 의미

가능한 경우 다음을 추출한다.

- Asset Type
- Caption
- Description
- 주요 Entity
- 핵심 의미
- OCR Text
- 표/차트의 구조적 데이터

### 8.3.2 Visual Evidence

Visual Asset 자체가 질의와 직접 관련된 실제 근거로 판단되어 검색결과에 사용되는 경우, 시스템은 해당 원본 Visual Asset 또는 원본에서 검증 가능한 미리보기를 **Visual Evidence로 제공해야 한다.**

Visual Evidence는 최소 다음을 가진다.

- 원본 Visual Asset 또는 원본에서 확인 가능한 미리보기
- 실제 Page/Slide
- Visual Asset과 원본 Page/Slide 간 Provenance Reference
- 가능한 경우 Caption / OCR Text

AI/VLM이 생성한 Description, Summary, 주요 의미 등은 검색 보조정보이며 Source Evidence 자체로 표시하지 않는다.

Visual Analysis에 실패하더라도 OCR/Native Text 등으로 검색 가능한 정보가 있으면 해당 경로를 유지한다. 비텍스트 Visual 의미 분석 실패는 핵심 검색 기능의 출시 기준을 실패 처리하지 않는다.

단, Visual Analysis 또는 다른 검색 신호에 의해 **Visual 자체가 직접 근거인 결과를 사용자에게 반환하는 경우에는 실제 Visual Evidence를 표시할 수 있어야 하며, 생성 Description만으로 근거를 대체해서는 안 된다.**

# 9. AI 처리 정책

## 9.1 Processing Mode 3단계

1차 제품의 Processing Mode는 다음 세 단계다.

| 모드 | 의미 |
|---|---|
| **경량 처리만** | LLM/VLM 미사용. Parsing, OCR, 규칙기반 분석, Extractive 처리, Embedding 등만 사용 |
| **Local AI 허용** | 경량 처리 + 사용자 PC에서 동작하는 명확한 Local AI 사용 허용 |
| **External AI 허용** | 경량 처리 + Local AI + 관리영역 외부의 Cloud AI 및 비로컬 Custom Endpoint 사용 허용 |

기본 설정은 **`auto`(`설치 상태에 따라 자동`)**다. 세 runtime 구성요소(semantic model, semantic reranker, document renderer)가 모두 준비되어 앱에 적용되기 전에는 실제 기본 처리 모드를 `경량 처리만`으로 사용한다. 세 구성요소가 모두 준비·적용되면 **새로 시작하는 작업부터** `Local AI 허용`을 실제 기본 처리 모드로 사용할 수 있다. 기존 Document는 이 설정 변경만으로 자동 재처리하지 않는다. 사용자가 특정 Job에서 `경량 처리만`을 명시한 경우에는 Local AI로 자동 승격하지 않는다.

### Local AI 예시

- PC의 Ollama / LM Studio
- Qwen / Gemma 등 로컬 모델
- localhost / loopback 등 명확하게 로컬로 판단 가능한 API Endpoint

### External AI 예시

- OpenAI
- Google Gemini
- 기타 외부 Cloud AI Provider
- 명확하게 로컬로 판단할 수 없는 Custom/OpenAI-compatible Endpoint

1차 제품에서는 별도의 `Trusted Internal Endpoint` 또는 사내망 Endpoint 신뢰 등록 기능을 제공하지 않는다.

## 9.2 자동 승격 금지

선택한 Processing Mode는 해당 Job의 허용 상한이다.

다음 자동 승격은 금지한다.

- 경량 처리만 → Local AI 자동 승격 금지
- 경량 처리만 → External AI 자동 승격 금지
- Local AI 허용 → External AI 자동 승격 금지

External AI 허용 모드에서는 External AI 실패 시 허용 가능한 Local / Lightweight / Deterministic Fallback으로 내려갈 수 있다.

## 9.3 Provider / Model 선택 우선순위

일반 사용자는 매 Processing Job마다 Provider나 Model을 직접 선택하지 않아도 된다.

Provider/Model 선택은 다음 우선순위를 따른다.

1. **Processing Mode 허용 상한**을 먼저 적용한다.
2. 해당 Job에 Provider/Model Override가 있으면, 선택 모드에서 허용되고 필요한 Capability를 만족하는 경우 우선 사용한다.
3. Job Override가 없거나 사용할 수 없으면 설정된 전역 기본 Provider/Model 중 선택 모드에서 허용되는 구성을 사용한다.
4. 선택된 Provider/Model이 실패·미설정·Capability 부족 상태이면, 선택 모드보다 상위 단계로 자동 승격하지 않고 허용 범위 내 Local / Lightweight / Deterministic Fallback으로 내려간다.

Job Override는 전역 기본값을 변경하지 않는다.

`External AI 허용` 모드는 External AI 사용을 강제하는 모드가 아니라 Local AI와 External AI를 모두 **허용**하는 상한이다. 실제 사용 Provider는 위 우선순위에 따라 결정된다.

반대로 `경량 처리만` 또는 `Local AI 허용`에서 해당 상한을 초과하는 Provider/Endpoint를 Override로 선택하려는 경우 실행 전에 차단하고 이유를 안내한다. Provider 선택만으로 Processing Mode의 허용 범위를 우회할 수 없다.

## 9.4 기본 Provider와 Custom Endpoint

1차 제품은 소수 주요 Provider를 기본 지원한다.

예:

- OpenAI
- Google Gemini

추가로 다음 정보를 입력하는 Custom/OpenAI-compatible 연결을 제공한다.

- Endpoint
- API Key
- Model ID

이를 통해 Ollama, LM Studio 등 로컬 API 서버와 기타 호환 서비스를 연결할 수 있어야 한다.

Custom Endpoint의 Processing Mode 적용은 다음과 같다.

- localhost, loopback 등 명확하게 로컬로 판정 가능한 Endpoint → Local AI로 취급 가능
- 그 외 Custom Endpoint → 기본적으로 External AI로 취급
- `Local AI 허용` 모드에서 External로 분류된 Custom Endpoint를 사용하지 않음
- External로 분류된 Custom Endpoint를 사용하려면 `External AI 허용` 모드가 필요

Local/External 판정의 구체적인 주소 규칙과 예외처리는 TRD에서 정의하되, 불확실한 Endpoint를 Local로 간주하여 외부 전송 가능성을 숨겨서는 안 된다.

## 9.5 최소 외부 데이터 전송

External AI 사용이 허용되더라도 전체 원본 파일을 그대로 외부로 전송하는 것을 원칙적으로 사용하지 않는다.

필요한 최소 처리 단위만 전송한다.

- Page
- Slide
- Image
- 필요한 Text Chunk

이를 통해 보안, API 크기 제한, 비용, 오류 재시도, 부분 재처리를 개선한다.

## 9.6 External AI 실행 전 사용자 고지

`External AI 허용` Processing Job에서 실제 External AI가 사용될 수 있는 경우, Job 실행 전에 사용자가 외부 전송 가능성을 명확히 인지할 수 있어야 한다.

최소 다음을 안내한다.

- External AI Provider 또는 비로컬 Custom Endpoint가 사용될 수 있음
- 문서의 Page / Slide / Image / 필요한 Text Chunk 등 문서 내용의 일부가 관리영역 외부로 전송될 수 있음
- 전체 원본 파일을 기본 전송하지 않고 §9.5의 최소 처리 단위 원칙을 적용함

실제 사용할 Provider/Endpoint가 실행 전에 확정 가능한 경우 해당 정보를 표시하고, 설정·Fallback 구조상 복수 후보가 가능한 경우 외부 전송 가능성이 있는 구성임을 명확히 표시한다.

사용자가 `External AI 허용`을 선택한 것은 **해당 Processing Job 범위에서의 외부 AI 사용 허용**으로 취급하며 다른 Job의 Processing Mode를 변경하지 않는다. 실제 처리 과정에서 External AI를 사용하지 않고 Local/Lightweight 경로만 사용된 경우에는 외부 전송이 발생하지 않는다.

구체적인 고지 UI와 Provider 표시 방식은 UX/TRD에서 정의한다.

---

# 10. Fallback과 Knowledge Unit

## 10.1 Fallback 구조

Processing Mode와 별개로 Knowledge Unit을 확정하기 위한 실제 처리 단계에는 다음 Fallback Chain을 적용한다.

선택한 Processing Mode는 사용할 수 있는 처리 방식의 상한이며, 상위 단계가 허용되지 않거나 실패하면 허용 범위 내에서 하위 단계로 내려간다.

### Level 1 — 허용된 AI 처리

해당 Job에서 허용된 경우 AI를 이용해 다음을 수행할 수 있다.

- 주제 경계 판단
- Knowledge Unit 후보 구성
- 주제 / 부주제
- 요약
- 특징
- 키워드 / 별칭
- 주요 Entity
- 이미지·표 설명

### Level 2 — Lightweight Intelligence

AI를 사용할 수 없거나 처리에 실패한 경우 다음 경량 방법을 사용한다.

- Heading 구조
- 글꼴 및 레이아웃
- 장·절 번호
- 페이지 관계
- 인접 단위 전처리용 Boundary Embedding 유사도
- 경량 텍스트 분류
- 키워드 추출
- Extractive Summary
- 주변 Caption
- 규칙 기반 분석

Boundary Embedding은 Knowledge Unit 경계·인접 관계 판단을 위한 전처리 Artifact이며, Knowledge Unit 확정 후 Search Index에 사용하는 검색용 Embedding과 구분한다.

### Level 3 — Deterministic Fallback

Level 2까지 충분하지 않아도 검색 가능성 자체는 보장한다.

- PDF/HWP/HWPX/DOCX → 최소 Page 단위 Knowledge Unit 생성 가능
- PPTX → 최소 Slide 단위 Knowledge Unit 생성 가능

최소 Knowledge Unit은 최소한 다음을 보존한다.

- Original Text 및/또는 OCR Text
- 파일명
- 근거 Page/Slide
- Provenance
- 존재하는 경우 Visual Asset Reference

주제·요약·특징·키워드 등 보조 메타데이터가 생성되지 않아도 위 최소 데이터만으로 유효한 검색결과를 제공할 수 있어야 한다. Semantic Search가 필요한 경우 Original Text/OCR Text 등 실제 추출 텍스트를 직접 검색용 Embedding 대상으로 사용할 수 있어야 하며, 메타데이터 부재만으로 Vector Search 경로가 중단되어서는 안 된다.

## 10.2 Knowledge Unit

**모든 검색 단위는 Knowledge Unit으로 통일한다.** 별도의 `FallbackSearchUnit` Entity는 두지 않는다.

검색의 기본 의미 단위는 Page 자체가 아니라 Knowledge Unit이다.

문서 구조상 여러 페이지가 하나의 주제를 이루면 하나의 Knowledge Unit으로 묶을 수 있고, 한 Slide 안에 여러 독립 주제가 존재하면 여러 Knowledge Unit으로 분리할 수 있다.

AI/Lightweight 처리가 충분하지 않은 경우 Deterministic Fallback에서 Page/Slide 자체를 최소 Knowledge Unit으로 생성한다.

예:

```text
p.35~37
→ 하나의 주제가 연속
→ 하나의 Knowledge Unit

또는

p.35
→ 경계 판단 불충분
→ Page 단위 최소 Knowledge Unit
```

따라서 Topic/Summary/Features/Keywords 등이 비어 있는 Knowledge Unit도 유효할 수 있으며, 최소 Evidence와 Provenance가 존재하면 검색 대상에서 제외하지 않는다.

## 10.3 Knowledge Unit 메타데이터

Knowledge Unit은 질의와 무관하게 안정적으로 유지되는 **정적 Source/Context 정보**를 관리한다.

가능한 범위에서 다음 정보를 가진다.

- ID
- Document ID
- Source Page / Slide Range
- Text Evidence Reference와 각 원본 Page/Slide
- Visual Asset Reference와 각 원본 Page/Slide
- Section / Heading / Paragraph
- Main Topic / Sub Topic
- Document Role
- Summary
- Features
- Keywords / Aliases
- Entities
- Original Text
- OCR Text
- Table / Image References
- Processing Method
- Confidence
- Created At / Updated At

Knowledge Unit에는 질의와 무관한 단일 `Evidence Page / Slide` 또는 단일 `Evidence Type`을 필수 고정값으로 두지 않는다.

검색결과 생성 시에는 질의와 매칭된 Text/Visual Reference를 이용하여 다음 **Search Result 속성**을 결정한다.

- Matched Evidence Page / Slide
- Matched Evidence Type (Text / Visual)
- 필요한 경우 복수 Matched Evidence Reference
- Related Page / Slide Range = Knowledge Unit의 Source Page / Slide Range

따라서 동일 Knowledge Unit이라도 질의가 달라지면 Matched Evidence Page/Slide 또는 Evidence Type이 달라질 수 있다.

정밀 Bounding Box, Evidence Reference의 물리 스키마, 질의별 Match 선정 방식은 TRD에서 결정한다.

## 10.4 사용자 수정값

사용자가 직접 수정 가능한 항목은 다음 5개다.

- 주제
- 요약
- 특징
- 키워드
- 별칭

원문, OCR, 표·이미지 분석결과 등은 직접 편집 대상으로 하지 않는다.

사용자 수정값은 검색에서 시스템 자동 생성값보다 우선 반영하며 `자동 생성값으로 되돌리기`가 가능해야 한다.

같은 Document 재처리 시 사용자 수정값은 삭제하지 않는다.

- 기존 Knowledge Unit과 새 Knowledge Unit이 명확하게 1:1 대응되는 경우 → 사용자 수정값 자동 승계
- Knowledge Unit 분할·병합 등으로 대응관계가 모호한 경우 → 수정값을 `사용자 확인 필요` 상태로 보존
- `사용자 확인 필요` 상태의 수정값은 새 Knowledge Unit에 임의 적용하지 않음
- 사용자는 확인 후 적절한 새 Knowledge Unit에 적용하거나 폐기할 수 있음

시스템 생성값과 사용자 수정값, 그리고 사용자 수정값의 적용 상태를 구분하여 관리한다.

---

# 11. 처리 상태, 부분 성공, 재처리

## 11.1 처리 상태와 검색 가능 상태

최소 처리 단위별 상태를 독립적으로 관리한다.

예:

```text
Page 121

native_text      = success
ocr              = failed
visual_analysis  = pending
knowledge_unit   = partial
index            = partial
retry_count      = 1
```

Document 수준에서는 **처리 상태와 원본 상태를 별도 축으로 관리**한다.

### processing_status

`Document.processing_status`는 **현재 사용자에게 Commit되어 제공되는 Document 처리 결과의 상태**를 나타낸다. 신규 Document가 최초 처리 중인 동안에는 아직 Commit된 검색 데이터가 없으므로 실행 진행상태를 함께 표현할 수 있다.

- 대기 (`pending`)
- 처리 중 (`processing`)
- 일시중지 (`paused`)
- 완료 (`completed`)
- 부분 완료 (`partial`)
- 실패 (`failed`)

신규 Document의 최초 처리 결과 또는 기존 Document에 성공적으로 Commit된 처리 결과의 완료 상태는 다음 제품 의미를 따른다.

- `completed` → 해당 Commit 결과에서 요구된 필수 처리 단계가 전체 대상 단위에서 성공하여 별도 실패 단위가 없음
- `partial` → 하나 이상의 필수 처리 단위가 실패했지만 최소 하나 이상의 검색 가능한 Knowledge Unit이 존재함
- `failed` → 최초 처리 등에서 검색 가능한 Knowledge Unit을 하나도 확보하지 못해 사용자에게 제공할 Commit 결과가 없음

**기존 Document의 재처리 실행상태와 성공·실패는 `ProcessingJob`에서 별도로 관리한다.** 기존 Document 재처리 중에는 현재 Commit된 `Document.processing_status`를 재처리 Job의 `processing/paused/failed` 상태로 덮어쓰지 않는다. 재처리 결과가 완료·검증되어 새 데이터로 전환된 경우에만 새 Commit 결과에 따라 Document의 `processing_status`를 갱신한다.

따라서 기존 Document 재처리가 취소되거나 실패하면 기존 검색 데이터와 기존 `Document.processing_status`를 유지하고, 재처리 실패 사실은 Processing Job 상태와 관련 UI에서 별도로 표시한다.

비텍스트 Visual Analysis처럼 본 PRD에서 Best-effort로 정의한 단계의 실패만으로 `partial` 또는 `failed`를 판정하지 않는다. 세부 필수 단계 목록과 Document/ProcessingJob 상태 전이는 본문의 처리 요구를 기준으로 TRD/시험계획에서 구체화한다.

### source_status

- 원본 정상 (`available`)
- 원본 누락 (`missing`)

따라서 다음과 같은 조합이 정상적으로 존재할 수 있다.

```text
processing_status = completed
source_status     = missing
```

이 경우 전처리·검색 데이터가 정상이라면 검색과 Evidence 열람은 계속 가능하고, 원본 열기만 제한된다.

`processing_status`와 별개로 각 Knowledge Unit의 **검색 가능 여부(searchable)**를 판단할 수 있어야 한다. 최소 검색 가능 조건은 §4.1을 따른다.

- Source Evidence Reference 존재
- 정확한 Page/Slide Provenance 존재
- Vector 또는 BM25/FTS 중 최소 하나의 정상 검색 Index 존재

따라서 Document가 `processing` 또는 `partial` 상태여도 일부 Knowledge Unit은 검색 가능할 수 있으며, 반대로 `completed` 상태라도 Index 손상 등으로 특정 검색 경로가 사용할 수 없으면 §14의 부분 장애 정책을 적용한다.

## 11.2 부분 성공

일부 단위가 실패해도 전체 Document를 실패 처리하지 않는다.

예:

```text
200페이지 문서
198페이지 성공
2페이지 실패
```

신규 등록 Document에서는 성공한 198페이지를 검색 가능하게 하고 실패한 단위만 이후 재처리할 수 있어야 한다.

## 11.3 재처리

재처리는 등록과 별개의 명시적 사용자 동작이다.

지원 대상:

- 실패 항목만 재처리
- 특정 Page 재처리
- 특정 Slide 재처리
- 특정 Image 재처리
- OCR만 재처리
- Visual 분석만 재처리
- AI 전처리만 재처리
- 문서 전체 재처리

가능한 경우 이미 성공한 단계를 불필요하게 다시 수행하지 않는다.

기존 Document 재처리 중 검색 가시성은 다음 원칙을 따른다.

- 재처리 시작 전의 기존 검색 데이터를 계속 제공
- 새 재처리 결과는 완료 전까지 기존 검색결과와 혼합하여 노출하지 않음
- 재처리 완료 및 결과 검증 후 새 검색 데이터로 전환
- 새 결과로 전환된 경우에만 새 Commit 결과에 따라 `Document.processing_status`를 갱신
- 재처리 취소 또는 실패 시 기존 검색 데이터와 기존 `Document.processing_status`를 유지
- 재처리 실행·실패 상태는 `ProcessingJob`에서 별도 관리하고 사용자에게 해당 Job의 실패 사실과 필요한 조치를 표시
- 부분 재처리의 전환 단위와 Atomic Switch 구현은 TRD에서 정의하되, 사용자에게 불완전한 신·구 데이터 혼합 상태를 노출하지 않는 것을 원칙으로 함

---

# 12. 검색 설계

## 12.1 Query Processor

질의 시 생성형 LLM 기반 Query Rewrite는 사용하지 않는다.

경량 Query Normalization을 수행한다.

지원 기능:

- 원본 질의 보존
- 조사·불용어 처리
- 승인된 약어·동의어 사전 활용
- 날짜 조건 추출
- 파일형식 조건 추출
- 제한적 Fuzzy Matching
- 현재 검색 세션 상태 해석

날짜 조건은 다음 원칙으로 해석한다.

- “2024년 이후 자료”처럼 기준이 명시되지 않은 날짜 조건 → 기본적으로 `원본 수정일` 기준
- 사용자가 명시하면 `등록일 기준` 또는 `문서 작성일 기준`으로 변경 가능
- `문서 작성일`은 신뢰 가능한 Native Metadata의 작성일이 존재하는 경우에만 사용
- 신뢰 가능한 작성일이 없으면 `작성일 정보 없음`으로 처리
- 표지·본문의 날짜를 시스템이 임의로 문서 작성일로 추정하지 않음
- 현재 적용 중인 날짜 기준을 검색 결과/필터 상태에서 사용자가 확인할 수 있어야 함

## 12.2 동의어 및 약어

전처리 과정에서 동의어·약어 후보를 생성할 수 있다.

예:

```text
DRT
수요응답형교통
수요응답형버스
```

후보는 Source, Confidence, 발견 문서 수 등을 관리할 수 있다.

사용자는 동의어·약어를:

- 추가
- 수정
- 삭제
- 승인

할 수 있어야 한다.

자동 생성된 후보는 사용자가 승인하기 전까지 실제 Query Normalization/Search Expansion에 사용하지 않는다.

- 미승인 후보 → 검색에 영향 없음
- 승인된 항목 → 실제 검색에 사용
- 수정 후 승인 → 수정된 값을 기준으로 활성화
- 삭제된 항목 → 검색에 사용하지 않음

후보 상태와 실제 활성 상태를 구분하여 관리한다.

Document 재처리 시 자동 생성 동의어·약어 후보의 Source 연계정보와 집계는 새 전처리 결과에 맞게 갱신한다.

- 재처리 후 해당 Document에서 더 이상 발견되지 않는 **미승인 자동 생성 후보 Source** → 해당 Source 연결 제거
- Source 연결 제거 후 다른 Source가 남지 않은 미승인 자동 생성 후보 → 삭제 가능
- 여러 Document가 Source인 미승인 자동 생성 후보 → 해당 Document의 Source 연결과 Confidence/발견 문서 수 등 관련 집계정보 갱신
- 재처리에서 새로 발견된 후보 → 미승인 자동 생성 후보로 추가 가능
- 사용자가 승인·수정한 항목 또는 직접 추가한 항목 → 재처리 결과만을 이유로 자동 삭제·비활성화하지 않음

즉 자동 후보의 Source/집계 수명주기와 사용자가 확정한 활성 사전의 수명주기를 분리한다.

## 12.3 Embedding

Embedding은 용도에 따라 다음 두 종류를 구분한다.

### A. 전처리용 Boundary Embedding

Lightweight Intelligence에서 인접 Page/Slide의 의미적 연속성이나 Knowledge Unit 경계 판단을 보조하기 위해 사용할 수 있다.

- 선택적 전처리 Artifact
- 검색 Index에 직접 사용되는 최종 Embedding과 구분
- GPU 없이 동작 가능한 경량 경로를 가져야 함

### B. 검색용 Embedding

검색용 Embedding은 한국어와 영어의 교차 언어 검색을 지원해야 한다.

- Korean Query → English Document
- English Query → Korean Document

질의 시 검색용 Embedding 모델 실행은 허용하며, 이는 생성형 LLM 답변 작성과 구분한다.

Boundary Embedding과 검색용 Embedding의 모델을 동일하게 사용할지 분리할지는 TRD에서 결정한다.

## 12.4 Hybrid Search

검색은 Hybrid Search를 기본으로 한다.

### Semantic Search

Knowledge Unit의 다음 정보를 중심으로 활용한다.

- Summary
- Topic
- Keyword
- Alias
- Original Text / OCR Text Fallback Embedding

Summary/Topic/Keyword/Alias가 생성되지 않은 Deterministic Fallback 단위에서도 Original Text/OCR Text를 기반으로 Semantic Search가 가능해야 한다.

### Lexical Search

FTS/BM25는 다음 정보를 활용한다.

- Original Text
- OCR Text
- Title / Filename
- Heading
- Table Text
- Entity / Identifier
- Keyword

## 12.5 Ranking

복수의 검색 신호를 조합하여 최종 Ranking을 구성한다.

초기 고려 요소 예:

- Semantic Similarity
- BM25
- Title / Topic Match
- Keyword Match
- User Override
- Preprocessing Quality
- Provenance Quality

구체적인 Weight, Fusion, Normalization 방식은 Golden Dataset 평가를 통해 조정하며 TRD에서 정의한다.

## 12.6 검색 연관성 지표

사용자에게는 합산 검색결과를 **`검색 연관성 지표`**로 표시한다.

예:

```text
검색 연관성 지표 94
검색 연관성 지표 88
검색 연관성 지표 83
```

정보 아이콘 또는 Tooltip에는 다음 의미를 명시한다.

> **검색 알고리즘이 여러 요소를 종합해 산정한 상대적 지표이며, 일치율이나 정확도를 의미하지 않습니다.**

실제 0~100 환산 방식은 TRD에서 정의한다.

Recall-first 원칙에 따라 연관성이 낮다는 이유만으로 절대 Threshold를 적용하여 모든 결과를 숨기지 않는다. 다만 현재 후보 전체의 연관성이 매우 낮다고 판단되는 경우에는 결과를 계속 제공하면서 다음과 같은 상태 안내를 표시할 수 있어야 한다.

> **관련성이 높은 자료를 찾지 못했을 수 있습니다. 검색어를 바꾸거나 추가 결과를 확인해 보세요.**

이 안내는 검색결과를 제거하는 Hard Threshold가 아니며, 실제 Source Evidence/Provenance가 확보된 후보를 사용자가 계속 탐색할 수 있어야 한다. 낮은 연관성 상태 판정에 사용하는 내부 신호와 기준은 Golden Dataset/UX 평가를 바탕으로 TRD에서 정의한다.

## 12.7 초기 결과 수

화면 가독성을 위해 초기에는 약 5개 결과를 우선 표시하고 **`더 보기`**를 제공한다.

초기 표시 개수 자체는 UX 평가 결과에 따라 변경할 수 있다.

제품 요구는 고정된 숫자가 아니라 다음이다.

> **제한된 초기 결과를 보기 쉽게 제공하고, 사용자가 추가 결과를 계속 탐색할 수 있어야 한다.**

## 12.8 검색 결과 중복 억제

Top 결과가 동일·유사한 Knowledge Unit이나 거의 동일한 문서 내용으로만 채워지지 않도록 결과 다양성을 확보한다.

## 12.9 유사 문서 그룹화

독립 Document 중 내용·구조상 매우 유사한 문서가 여러 개 검색되면 다음 형태로 묶을 수 있다.

```text
대표 결과 1개
└─ 유사한 문서 N개
```

대표 결과는 해당 질의에 대해 검색 연관성이 가장 높은 결과를 우선한다.

다음 두 개념은 구분한다.

- Query ↔ Document 검색 연관성
- Document ↔ Document 문서 유사성

> **검색 연관성 지표가 같다는 이유만으로 문서를 유사 문서로 판단하지 않는다.**

그룹을 펼치면 각 파일의 최소 다음 정보를 제공한다.

- 파일명
- 근거 Page/Slide
- 관련 범위가 존재하는 경우 Page/Slide Range
- 검색 연관성 지표

유사도 계산과 Grouping Threshold는 TRD에서 정의한다.

---

# 13. 검색 결과 UX와 검색 세션

## 13.1 검색 결과 카드

각 결과 카드는 최소 다음 정보를 제공한다.

```text
[파일명]
[근거 위치: Matched Evidence Page / Slide]
[관련 범위: Knowledge Unit Source Page / Slide Range — 해당하는 경우]

검색 연관성 지표 94

[검색 보조정보 — 생성된 경우]
주제: ...       [자동 생성 | 사용자 수정]
특징: ...       [자동 생성 | 사용자 수정]
요약: ...       [자동 생성 | 사용자 수정]

[Source Evidence]
- Matched Evidence Type = Text인 경우
  관련 원문
  앞뒤 문맥
  출처: Native / OCR

- Matched Evidence Type = Visual인 경우
  실제 Visual Asset 또는 원본 검증 가능한 미리보기
  해당 Page / Slide
  가능한 경우 Caption / OCR

[원본 열기 또는 원본 누락]
[관련 있음] [관련 없음]
```

주제·요약·특징·키워드·이미지/표 설명 등 시스템 생성정보와 사용자 수정정보는 검색 보조 메타데이터로 표시한다. 해당 정보가 생성되지 않았더라도 실제 Source Evidence와 Provenance가 존재하면 결과 카드는 유효할 수 있다.

사용자 수정값이 적용된 경우 값의 Source를 `사용자 수정`으로 명확히 표시하며, 시스템 자동 생성값과 혼동하지 않는다.

## 13.2 Source Evidence와 생성정보 구분

### Text Evidence

질의와 직접 매칭된 근거가 Text인 경우 관련 문장 하나만 떼어 보여주지 않고 앞뒤 문맥을 함께 제공한다.

기본적으로:

- 핵심 관련 문장
- 앞뒤 1~2문단 수준의 문맥

을 제공하고 필요 시 `더 보기`로 확대한다.

Text Evidence 영역은 Native Text/OCR Text 등 실제 문서에서 추출된 내용을 중심으로 구성한다.

### Visual Evidence

질의와 직접 매칭된 근거가 Visual Asset인 경우 실제 원본 Visual Asset 또는 원본에서 검증 가능한 미리보기를 Source Evidence로 **반드시 제공한다.**

Visual Evidence에는 실제 Page/Slide를 함께 표시하고, 가능한 경우 Caption/OCR Text를 보조적으로 제공한다.

### 생성정보

AI/경량 처리로 생성한 주제·요약·특징·이미지 설명 등은 검색 보조정보이며 원문 인용이나 Source Evidence로 표시하지 않는다. 사용자가 실제 문서 내용과 시스템 생성정보, 사용자 수정정보를 명확히 구분할 수 있도록 시각적으로 분리한다.

생성정보가 검색 신호로 사용되었더라도 최종 결과는 실제 Text/Visual Reference로 역추적되어야 하며, 역추적할 수 없는 생성정보만으로 Evidence 카드를 구성하지 않는다.

## 13.3 원본 열기

검색결과에서 내부 저장소의 원본 문서를 열 수 있어야 한다.

1차 제품에서 외부 원본 프로그램을 특정 Page/Slide로 자동 이동시키는 기능은 필수로 요구하지 않는다.

다만 검색결과 자체에는 정확한 근거 Page/Slide를 반드시 제공하고, 다중 Page/Slide Knowledge Unit에서는 관련 범위를 함께 제공한다.

원본 누락 상태에서는 검색결과와 Evidence 열람은 가능하되 `원본 열기`가 제한됨을 명확히 표시한다.

## 13.4 검색 범위

1차 검색 대상은 등록된 **전체 Knowledge Base**다.

사용자가 검색 대상 폴더·프로젝트·개별 문서를 선택하거나 특정 문서 하나로 검색범위를 고정하는 기능은 1차에 포함하지 않는다.

사용자가 특정 문서를 알고 있거나 짐작하는 경우에도 1차 제품에서는 전체 Knowledge Base 검색을 통해 해당 문서와 내부 근거 위치를 찾는다.

## 13.5 후속 검색

현재 앱 실행 중의 검색 세션에서는 후속 검색 횟수를 별도로 제한하지 않는다.

지원 대상은 검색 맥락을 활용한 검색 정제다.

예:

- 그중에서
- PPT만 / PDF만
- 특정 연도 이후 / 이전
- 첫 번째 / 두 번째 결과
- 해당 결과와 비슷한 자료
- 새 검색

생성형 자유대화나 다문서 추론 답변은 지원하지 않는다.

## 13.6 앱 종료 후 검색 세션

앱을 종료하면:

- 과거 검색 대화를 복원하지 않는다.
- 검색 기록 UI를 제공하지 않는다.
- 다음 실행 시 새 검색 세션으로 시작한다.

다만 검색 품질 분석을 위한 내부 로그는 별도로 보존할 수 있다.

## 13.7 사용자 피드백

검색결과별:

- 관련 있음
- 관련 없음

검색 세션별:

> 원하는 자료를 찾으셨나요?

- 예
- 아니오

를 제공한다.

암묵적 Signal로 다음을 로컬 기록할 수 있다.

- 결과 펼쳐보기
- 표/이미지 보기
- 원본 열기
- 특정 결과 기반 후속 검색

단순 클릭을 정답으로 간주하지 않으며 명시적 피드백보다 낮은 신뢰도로 활용한다.

---

# 14. 검색 부분 장애와 오류 UX

## 14.1 검색 구성요소 부분 장애

Vector Search 또는 BM25/FTS 중 일부가 고장나더라도 정상 기능이 남아 있으면 검색을 계속 제공한다.

이 경우 검색 화면에 지속적인 경고를 표시한다.

예:

> ⚠ **검색 기능 일부가 제한되어 있습니다.**

단순 1회 Toast가 아니라 다음을 제공한다.

- 검색 화면 배너
- 현재 상태
- 영향 범위 설명
- `[문제 확인]`

## 14.2 일반 오류 표시

일반 사용자에게는 사람이 이해할 수 있는 오류·처리 요약을 제공한다.

- 실패 단계
- 실패 처리 단위
- 사용자에게 필요한 조치
- 재처리 가능 여부

Stack Trace, 내부 오류 코드 등은 고급 로그에서 별도 확인한다.

---

# 15. 저장소 이전

## 15.1 기본 원칙

저장소 이전 시작 조건은 **§3.7 Maintenance Exclusive Operation**을 따른다.

저장소 이전 중 기존 저장소가 끝까지 Source of Truth다.

이전 절차는 다음 원칙을 따른다.

1. 기존 저장소 유지
2. 새 위치로 데이터 복사
3. 중간 실패·재부팅·공간 부족 시 이어서 재개 가능
4. 새 저장소 전체 이전 및 검증
5. 검증 완료 후에만 공식 저장소 전환
6. 새 저장소의 복사·검증과 공식 경로 전환이 완료된 뒤 기존 Weki 관리 데이터는 자동 정리
7. 기존 저장소에 Weki가 관리하지 않는 사용자 파일이 남아 있으면 해당 파일을 보존하고 폴더 자체도 보존

## 15.2 이전 중 사용 가능 기능

이전 중 다음 읽기 기능은 허용한다.

- 검색
- 검색결과 열람
- 원본 열기

다음 쓰기 기능은 제한한다.

- 문서 등록
- 삭제
- 재처리
- 메타데이터 수정
- 동의어·약어 변경
- 설정 변경 등 저장소 상태를 변경하는 기능

검색 자체는 허용하되 다음 검색 관련 Write는 이전이 완료되거나 중단될 때까지 **일시적으로 기록하지 않는다.**

- 결과별 `관련 있음 / 관련 없음`
- 검색 세션 성공/실패 피드백
- 결과 펼쳐보기
- 표/이미지 보기
- 원본 열기
- 특정 결과 기반 후속 검색 등 암묵적 Signal

즉 저장소 이전 중 검색은 읽기 전용 동작으로 제공한다.

세부 Lock, Checkpoint, Integrity Check, Atomic Switch는 TRD에서 정의한다.

---

# 16. 백업과 복원

## 16.1 백업 유형

1차 제품에서 지원하는 백업 경로는 MYBOX뿐이다. 로컬 암호화 검색 시스템 백업, 로컬 전체 백업 및 로컬 `.weki` 복원은 지원하지 않는다. v1.2.1은 v1.2.0에서 생성한 로컬 `.weki` 백업을 생성하거나 복원하지 않으며, 기존 파일을 자동 변경·삭제하지 않는다.

백업과 카탈로그 동기화는 검색 DB와 원본 Archive를 MYBOX에 보존하고, 필요할 때 원본을 지연 복원하는 흐름으로 제공한다. API Key는 MYBOX 백업에 포함하지 않는다.

## 16.2 v1 MYBOX 클라우드 백업 구현 기준

v1의 MYBOX는 검색 DB 카탈로그와 원본 Archive를 분리해서 동기화한다. `knowledge-base.json`에는 문서·본문·임베딩과 원본 참조를 저장하고, 실제 원본은 사용자가 필요할 때만 지연 다운로드한다. 업로드는 검색 DB와 로컬 원본을 함께 백업하는 단일 동작이며 업로드 전에 평문·원본 포함 경고를 표시한다.

```text
MYBOX/
└─ weki/
   ├─ knowledge-base.json
   └─ data/
      ├─ <파일 Hash>/
      │  └─ 원본문서.pdf
      └─ <다른 파일 Hash>/
         └─ 원본문서.hwp
```

- 최초로 생성된 빈 로컬 DB에 토큰이 있으면 앱 시작 후 `knowledge-base.json`만 1회 자동 동기화한다. 로컬 문서가 하나라도 있으면 앱 시작 시 자동 동기화하지 않는다.
- 이후 카탈로그 동기화는 설정 화면의 `MYBOX 검색 DB 동기화` 버튼으로 실행한다. 동기화 시 원본 파일은 다운로드하지 않는다.
- 검색은 항상 로컬 DB·임베딩을 사용한다. 검색 결과의 원본이 로컬에 없으면 `원본 열기` 시 해당 MYBOX 원본만 다운로드하고 Hash 검증 후 현재 로컬 저장소에 캐시한다.
- 로컬 문서 삭제는 MYBOX에 전파하지 않으며, 이후 동기화에서 MYBOX에 남아 있는 문서가 다시 나타날 수 있다.
- 초기 버전은 평문 패키지를 사용하며, 업로드 전에 원본 포함 및 평문 전송 경고를 표시한다.
- MYBOX 카탈로그 동기화와 업로드는 Hash 기준으로 기존 로컬 DB와 병합한다. 동기화 실패 시 기존 로컬 DB를 유지한다.
- 문서 동일성은 파일 Hash를 기준으로 판단한다.
- 동일 Hash는 하나로 병합하고, 서로 다른 Hash는 모두 보존한다.
- `knowledge-base.json`에는 임베딩·검색 데이터와 `data/<파일 Hash>/<원본 파일명>` 참조만 저장한다.
- 원본 파일은 JSON에 포함하지 않고 `weki/data/<파일 Hash>/`에 실제 파일로 업로드한다. MYBOX의 실제 파일명은 원본 파일명을 유지하고, Hash가 다른 동일 파일명은 Hash 폴더로 분리한다.
- 업로드 시 원본 파일명이 달라도 동일 Hash가 manifest에 있으면 해당 Hash 폴더의 기존 MYBOX 원본을 재사용하고, JSON의 참조만 기존 경로로 연결한다. 내용이 변경되어 Hash가 달라진 경우에는 다른 Hash 폴더에 별도 원본으로 저장한다.
- 신규 버전은 `weki/knowledge-base.json`, `weki/data/`, `weki/data/<파일 Hash>/`, 그 하위의 manifest 파일만 조회한다. 루트 `data`, `weki/data/<파일명>`, Hash 파일명만 있는 flat 구조와 기존 `.weki` 파일은 백업 대상으로 취급하지 않으며 기존 파일을 자동 변경·삭제하지 않는다.
- 클라우드 백업의 절대 `originalPath`는 저장하지 않는다. 로컬 원본은 현재 저장소의 `originals/<hash>/<원본 파일명>`으로 재구성하고, MYBOX 참조는 `cloudOriginalFile: data/<hash>/<원본 파일명>`으로 저장한다. 문서에는 `originalName`을 보존하며, 동일 Hash의 실제 원본은 하나만 저장한다.
- 최신 `knowledge-base.json` 하나를 유지하고, 기존 원본 파일은 자동 삭제하지 않는다.
- 기존 단일 `.weki` 백업은 v1.2.1에서 복원하지 않으며 기존 파일은 삭제하지 않는다.

MYBOX 연동은 MYBOX Open API의 파일 목록 조회, 업로드 URL 발급·전송, 다운로드 URL 발급·전송의 2단계 API를 사용한다. 설치 프로그램은 `NAVER_MBOX_TOKEN`을 선택적으로 입력받고, 입력값을 선택한 Weki 데이터 저장소의 `credentials/mybox-token.json`에 Windows DPAPI 기반으로 암호화한다. 설치 파일과 레지스트리에는 토큰을 저장하지 않으며, 패키지 실행 시 Electron이 복호화한 값을 서버 프로세스의 환경변수로만 전달한다. 설치 단계에서는 네트워크 검증을 하지 않고 최초 실행 시 `/api/mybox/status`로 검증한다. 토큰이 없거나 검증에 실패해도 로컬 기능은 유지하고 관리자 문의를 안내한다. 기존 `.env` 방식 설치판의 토큰은 자동 이관하지 않으며 업데이트 시 다시 입력한다. 공개·외부 배포 단계에서는 이 방식을 폐기하고 별도 인증·Secret 관리 구조로 전환한다.

## 16.3 검색 색인과 재처리 경계

사용자 설정 화면에서는 검색 색인 관리 UI를 제공하지 않는다. 내부 검색 색인 재생성 API는 기존 파싱 단위에서 FTS·Embedding·ANN 투영을 다시 만드는 마이그레이션·복구용 API로만 유지한다.

전체 문서 재처리(원본 → 파싱·OCR·AI·Embedding·색인 재실행)는 v1.2.1 범위가 아니며 v1.3.0 검토 항목으로 명시적으로 연기한다.

# 17. 삭제 정책

## 17.1 개별 Document 삭제

Document 삭제 시 해당 Document의 데이터를 즉시 영구 삭제한다.

단, 해당 Document와 관련된 Processing Job이 다음 상태 중 하나라면 삭제를 차단한다.

- 실행 중
- 일시중지
- 대기

사용자는 관련 Job을 먼저 완료하거나 취소/Queue 제거한 뒤 Document를 삭제해야 한다.

삭제 대상 예:

- 원본
- 추출 Text
- OCR
- Visual Asset
- AI 전처리 결과
- Knowledge Unit
- Embedding
- Search Index
- 사용자 수정값
- Document에 종속된 처리 상태/메타데이터

앱 내부 휴지통은 제공하지 않는다.

삭제된 Document는 검색결과에 남아서는 안 된다.

문서 삭제 시 임베딩 DB·Knowledge Unit·Search Index와 해당 문서의 Processing Job 기록은 제거한다. 삭제 사실만 감사 기록으로 유지하며, 삭제된 문서는 검색 결과에 남지 않는다.

일반 처리 로그와 외부 AI 감사 로그는 Document 삭제와 별개로 유지한다. 로그 삭제는 별도의 명시적 기능으로 수행한다.

로그에는 기존 원칙대로 원문/OCR 전문이나 Prompt 전문을 중복 저장하지 않는다.

이미 생성된 과거 백업 파일의 내용까지 역으로 삭제하지 않는다.

전처리 과정에서 생성된 동의어·약어 후보는 Document 삭제 시 Source 연계정보를 함께 정리한다.

- 삭제되는 Document만 Source로 연결된 **미승인 자동 생성 후보** → 삭제
- 여러 Document가 Source인 미승인 자동 생성 후보 → 삭제 Document의 Source 연결과 발견 문서 수 등 관련 집계정보 갱신
- 사용자가 승인·수정한 항목 또는 사용자가 직접 추가한 항목 → Document와 독립적인 사용자 사전으로 간주하여 유지

사용자 승인 이후의 사전 항목은 원본 Document 삭제를 이유로 자동 비활성화하거나 삭제하지 않는다.

## 17.2 전체 문서 데이터 삭제

`전체 문서 데이터 삭제`는 별도의 강한 관리 기능으로 제공하며 **2단계 확인**을 요구한다.

실행 시작 조건은 **§3.7 Maintenance Exclusive Operation**을 따른다.

전체 문서 데이터 삭제가 시작되면 작업이 완료되거나 실패·중단으로 Maintenance 상태가 해제될 때까지 다음 읽기 기능도 차단한다.

- 검색
- 검색결과 열람
- 원본 열기

삭제 진행 중 남아 있는 일부 데이터만을 기준으로 검색 또는 열람 결과를 제공하지 않는다.

삭제 대상:

- 전체 원본 Archive
- 문서 메타데이터
- OCR / 전처리 결과
- Knowledge Unit
- Search Index
- 사용자 수정값
- 검색 피드백
- Document에 종속된 처리 상태/파생 메타데이터

유지 대상:

- AI Provider 설정
- API Key
- 일반 앱 설정
- 일반 처리 로그
- 외부 AI 감사 로그

즉 `문서 데이터 삭제`, `로그 삭제`, `설정 초기화`는 서로 별개의 기능이다.

---

# 18. 보안과 로그

## 18.1 인증

1차 버전은 별도 앱 로그인 기능을 제공하지 않는다.

Windows 사용자 계정의 접근통제를 기본 전제로 한다.

## 18.2 로컬 민감정보 보호

민감 데이터는 로컬에서 보호되어야 한다.

보호 대상에는 최소 다음을 포함한다.

- 원본 Archive
- OCR / Extracted Text
- Visual Asset 및 Evidence용 파생 미리보기
- 사용자 수정값 등 문서 내용에서 파생된 민감 데이터
- API Key
- 민감 설정값

검색 Index와 Metadata DB 역시 원문·키워드·Embedding 등 민감정보를 포함할 수 있으므로 보호 대상에서 제외하지 않는다.

1차 제품의 최소 보안 수준은 다음과 같다.

- 원본 Archive와 주요 문서 내용 저장 DB 등 **주요 민감 데이터는 앱 수준의 저장 데이터 보호를 적용**해야 한다.
- API Key 등 Credential은 일반 설정 파일이나 평문 DB에 그대로 저장하지 않고 별도의 안전한 Credential 저장 방식을 사용해야 한다.
- Search Index, Cache, 임시 파생파일 등은 검색 성능·복구·재설치 요구를 고려하여 일부 보호 방식의 예외가 가능하나, 예외 범위와 잔여 위험은 TRD Threat Model에서 명시해야 한다.
- Windows 사용자 계정 접근통제만을 유일한 민감 데이터 보호수단으로 간주하지 않는다.

Archive/DB/Index/Cache별 구체 암호화 범위·알고리즘·키 관리 방식은 TRD의 Threat Model과 보안 설계에서 결정한다.

보안 구현은 MYBOX 백업·카탈로그 동기화·원본 지연 복원 흐름을 방해해서는 안 된다. 1차 사내 배포판의 제거 후 재설치는 새 저장소 선택을 전제로 한다.

## 18.3 외부 AI 감사 로그

External AI 사용 시 최소 다음 정보를 기록한다.

- Document ID
- Page / Slide / Image 등 처리대상
- Provider
- Model
- 처리 시각
- 성공 / 실패
- 외부 전송 데이터 유형
- 가능한 경우 Token 사용량
- 가능한 경우 API 비용

실제 원문 전체와 Prompt 전체를 감사 로그에 중복 저장하는 것을 기본 요구로 하지 않는다.

## 18.4 로그 보존

일반 처리 로그와 외부 AI 감사 로그는 기간 기준 자동 삭제를 하지 않는다.

사용자가 직접 삭제할 수 있어야 한다.

개별 Document 삭제 또는 전체 문서 데이터 삭제를 수행해도 일반 처리 로그와 외부 AI 감사 로그는 자동 삭제하지 않는다.

삭제된 Document와 연계된 로그는 운영/감사 이력으로 유지할 수 있으나 실제 원문 전체, OCR 전문, Prompt 전문 등을 중복 보관하는 것을 기본 요구로 하지 않는다.

일반 화면에는 사용자 친화적 요약 로그를 제공하고, 기술적 상세내용은 고급 로그로 분리한다.

---

# 19. 성능과 지원 규모

## 19.1 CPU-only 공식 지원

PRD 수준에서 특정 CPU/RAM 숫자를 고정하지 않는다.

제품 요구는 다음과 같다.

> **GPU가 없는 CPU-only Windows PC에서도 핵심 기능이 동작해야 한다.**

최소·권장 Hardware, CPU/RAM/Storage 기준은 TRD와 시험계획에서 확정한다.

## 19.2 목표 지원 규모

1차 목표 규모:

- 문서 수: 수천 건 수준
- 페이지: 약 50,000~100,000페이지

50,000~100,000페이지는 절대 최대치가 아니라:

> **1차 목표 지원 규모이자 대표 성능시험 규모**

로 정의한다.

## 19.3 검색 응답

일반 검색 요청은 **수초 이내** 결과 제공을 사용자 체감 목표로 한다.

P50/P95/P99 등 정량 성능 목표는 Reference Hardware를 정한 후 TRD/시험계획에서 확정한다.

## 19.4 전처리 시간

전처리는 품질 우선이다.

100페이지 문서가 수십 분 이상 걸릴 수 있으며, 복잡한 OCR·Visual·AI 처리가 포함되면 수시간도 허용할 수 있다.

단 진행상태는 사용자에게 명확히 제공해야 한다.

---

# 20. 품질 평가와 Release Gate

## 20.1 Golden Dataset

Golden Dataset은 권장사항이 아니라 **1차 출시 필수 절차**다.

실제 업무질문 약 50~100개를 준비하고 각 질문에 다음 정답을 지정한다.

- 정답 Document
- 정답 Matched Evidence Page/Slide 또는 허용 가능한 Evidence 위치 집합
- 필요한 경우 정답 Evidence Type(Text / Visual)
- Visual Evidence가 핵심인 경우 정답 Visual Asset Reference 또는 동등한 원본 근거

Golden Dataset은 목적에 따라 최소 다음 두 Set으로 **튜닝 전에 먼저 분리**한다.

### A. Tuning Set

다음 개선과 조정에 사용한다.

- Ranking Weight / Fusion
- Embedding 선택 및 설정
- Query Normalization
- 중복 억제 / Grouping
- 기타 검색 품질 튜닝

Baseline 및 Threshold 수립에 필요한 관찰은 Tuning Set을 중심으로 수행한다.

### B. Release Evaluation Set

최종 출시 품질 판단에 사용하는 Hold-out 평가용 Set이다.

- 반복적인 검색 파라미터 튜닝에 직접 사용하지 않는다.
- Release Threshold를 정하기 위해 결과를 반복 열람하지 않는다.
- 릴리스 후보 검증 시 제한적으로 사용하고, 실패 원인을 보고 다시 튜닝한 경우 다음 평가에서 Hold-out 성격이 훼손되지 않도록 시험계획에서 Set 갱신/교체 원칙을 정의한다.

주요 지표:

- Evidence Top-1 Hit Rate
- Evidence Top-3 Hit Rate
- Evidence Top-5 Hit Rate
- 보조 진단용 Document Top-K Hit Rate

핵심 KPI는 **Evidence Top-5 Hit Rate**로 한다.

`Evidence Hit`는 Top-K 결과 중 최소 하나가 다음을 모두 만족하는 경우로 정의한다.

1. 정답 Document와 일치
2. 정답으로 지정된 Page/Slide 또는 허용 위치 집합과 Matched Evidence Location이 일치
3. Evidence Type이 정답에 지정된 경우 해당 Type과 일치

Table이 정답 Evidence인 경우 §3.3의 판정 원칙을 적용하여 문자·Cell 값 자체가 핵심이면 Text, 행·열 관계·구조·배치가 핵심이면 Visual, 둘 다 필요한 경우 허용 가능한 복수 Evidence Type으로 정답을 정의할 수 있다.

따라서 정답 Document만 찾고 실제 근거 Page/Slide를 찾지 못한 경우는 핵심 Evidence Hit로 계산하지 않는다.

구체적인 출시 기준값을 PRD에서 임의로 정하지 않는다.

Release Gate 확정 절차는 다음과 같다.

1. Golden Dataset을 Tuning Set / Release Evaluation Set으로 선분리
2. Tuning Set에서 최초 Baseline 평가 수행
3. 제품 책임자가 Baseline 및 제품 목표를 바탕으로 Release Threshold 확정
4. 확정된 Release Threshold 동결
5. 이후 Tuning Set을 중심으로 Ranking/Embedding/Fusion 등을 개선
6. Release Candidate에서 Release Evaluation Set으로 동결된 Threshold 충족 여부 확인
7. 출시 전 반드시 기준 충족

Release Threshold를 Release Evaluation 결과에 맞춰 반복적으로 낮추어 출시를 맞추는 방식은 사용하지 않는다.

Tuning Set / Release Evaluation Set의 구체적인 문항 수, 포맷별·언어별·Text/Visual 유형별 구성, 분할 및 갱신 방식은 시험계획에서 확정한다.

## 20.2 Online 품질지표

실사용에서 다음을 측정할 수 있다.

- Search Success Rate
- Relevant Feedback Ratio
- Not Relevant Ratio
- 원본 열기 비율

## 20.3 피드백 기반 Ranking 개선

사용자 피드백이 충분히 축적되면 Ranking 개선에 활용할 수 있다.

예:

- Weight Optimization
- Lightweight Learning-to-Rank

새 Ranking을 자동 적용하지 않는다.

```text
User Feedback
      ↓
Candidate Ranking
      ↓
Tuning Set 검증 + Release Candidate 단계의 제한적 Release Gate 평가
      ↓
기존 기준 이상?
   ├─ Yes → 적용 가능
   └─ No  → 기존 유지
```

Ranking 변경 시 Ranking Version을 기록하여 전후 품질을 비교할 수 있어야 한다.

## 20.4 전처리 Release Gate

검색뿐 아니라 전처리 안정성에도 정량 Release Gate를 둔다.

평가 대상:

- 등록
- Native Parsing
- 모든 공식 지원 Page/Slide OCR 수행 성공률
- OCR을 통한 Visual 내 문자 검색 가능성
- Knowledge Unit 생성
- Source Evidence / Page-Slide Provenance 연결 무결성
- Embedding
- Indexing
- Processing Failure Rate

구체적인 기준값은 대표 Test Corpus와 Tuning/Baseline 평가 후 확정한다.

그래프 해석·사진 의미 이해 등 **비텍스트 Visual Analysis는 Best-effort 기능**이므로 핵심 전처리 Release Gate와 분리하여 별도 품질기준으로 관리한다.

다만 Visual 자체를 직접 근거로 반환하는 검색결과에 대해 실제 Visual Evidence와 Page/Slide를 제공해야 한다는 §8.3·§13 요구사항은 Best-effort가 아니라 필수 정합성 기준이다.

## 20.5 v1 네트워크 Release Gate 범위

v1 Release Gate는 핵심 로컬 기능이 External API 없이 동작하는지 확인한다. OS 수준 네트워크 완전 격리 자체는 Gate 조건으로 평가하지 않는다.

- 필수: PDF/DOCX/PPTX/HWP/HWPX 등록·전처리, 로컬 Embedding, 로컬 검색, Evidence 확인, 앱 재실행 후 기존 데이터 사용
- 필수: 위 핵심 경로에 External API 또는 원격 서비스가 필수 의존성으로 포함되지 않음
- 허용: 사용자가 명시적으로 선택한 MYBOX, Gemini 등 External AI Provider, Custom/OpenAI-compatible 원격 Endpoint 및 기타 온라인 연동
- 참고 증적: 기존 OS 네트워크 격리 diagnostic 결과는 삭제하지 않고 보존하되 Release Gate 판정에서 제외
- 별도 유지 Gate: CPU-only 50,000~100,000페이지 대표 성능시험(`REQ-SCALE-001`)

# 21. 업데이트, 재설치, 앱 삭제

## 21.1 앱 업데이트

1차 제품은 **수동 업데이트만 지원**한다.

사용자가 새 설치파일을 직접 적용한다.

자동 업데이트 확인·다운로드 기능은 1차에서 제외한다.

새 버전 설치파일을 적용하기 전에는 다음을 모두 만족해야 한다.

- **Processing Queue가 완전히 비어 있어야 한다.** 여기서 Queue가 완전히 비어 있음은 §3.7과 동일하게 실행 중·일시중지·대기 Job이 모두 없는 상태를 의미한다.
- **실행 중인 Maintenance Exclusive Operation이 없어야 한다.**

미완료 Job이 존재하면 사용자는 해당 Job을 완료하거나 취소/Queue 제거한 뒤 업데이트를 진행해야 한다. 저장소 이전·MYBOX 업로드·전체 문서 데이터 삭제 등 Maintenance Exclusive Operation이 실행 중이면 해당 작업이 정상 종료되어 Maintenance 상태가 해제된 뒤 업데이트를 진행해야 한다.

앱은 종료 또는 업데이트 준비 과정에서 미완료 Job 또는 활성 Maintenance 작업이 있음을 명확히 안내해야 하며, 1차 제품은 버전 간 미완료 Processing Job의 Checkpoint/Queue 상태 호환을 보장하지 않는다.

새 버전에서 저장소 또는 DB Migration을 시작하기 전에도 활성 Maintenance 상태가 없어야 한다. 구체적인 설치파일/앱 간 상태 확인·Lock 검증 방식은 TRD에서 정의한다.

업데이트 후 기본적으로 다음을 유지해야 한다.

- 기존 Document
- 원본
- 사용자 수정값
- 전처리 결과
- 설정

내부 검색 색인 재생성 API는 마이그레이션·복구용으로만 유지하며 사용자 설정 화면에서 제공하지 않는다. 전체 문서 재처리(파싱·OCR·AI·Embedding·색인 재실행)는 v1.3.0 검토 항목으로 명시적으로 연기한다.

새 버전에서 저장소 또는 DB 구조 Migration이 필요한 경우 다음 원칙을 따른다.

1. 기존 저장소 상태를 보존한다.
2. 기존 저장소를 직접 훼손하는 방식으로 Migration하지 않는다.
3. 새 구조 Migration 및 무결성 검증이 모두 성공한 경우에만 새 구조로 전환한다.
4. Migration 또는 검증이 실패하면 기존 저장소를 그대로 유지한다.
5. 업데이트 실패만으로 기존 Document, 원본, 사용자 수정값, 전처리 결과, 설정이 손상되어서는 안 된다.
6. 사용자에게 Migration 실패 상태와 필요한 조치를 명확히 안내한다.

Schema Migration, Copy-on-Migrate, Atomic Switch, Rollback 등 구체 구현은 TRD에서 정의한다.

## 21.2 앱 삭제와 데이터 삭제

1차 사내 배포판에서는 **프로그램 제거 시 Weki가 관리하는 로컬 데이터도 함께 삭제**한다.

삭제 대상은 선택 저장소 안의 Weki 관리 파일, 설치 폴더의 `data`, 기존 AppData 레거시 저장소, 저장소 위치 포인터다. 사용자 지정 폴더의 다른 파일은 삭제하지 않으며, Weki 전용 표식과 관리 파일을 확인한 경우에만 정리한다.

프로그램을 제거하지 않고 새 버전을 설치하는 업데이트에서는 기존 저장소를 유지한다. 제거 후 재설치하면 설치 단계에서 새 데이터 저장 위치를 다시 선택하고 문서 0개인 신규 저장소로 시작한다.

과거 Temp 레거시 저장소는 제품 기능으로 이관하거나 재사용하지 않는다. 현재 설치 환경의 잔여 Temp 데이터와 이를 참조하는 stale 문서는 일회성 정리 대상으로만 취급한다.

---

# 22. Logical Data Model

PRD 수준의 핵심 논리 Entity는 다음과 같다.

## Document
사용자가 등록한 독립 문서. 파일 Hash, 최초 등록 시 원본 수정일, 등록일, 신뢰 가능한 경우 Native Metadata 작성일 등을 관리한다. 현재 사용자에게 Commit되어 제공되는 처리 결과의 상태(`processing_status`)와 원본 상태(`source_status`)를 별도 축으로 관리한다.

## SourceBlob
내부 저장소에 보관하는 실제 원본 데이터. 원본 재연결 이력이나 재연결 파일의 파일시스템 메타데이터가 필요한 경우 Document의 최초 등록 기준 메타데이터와 구분하여 관리한다.

## ProcessingJob
등록·재처리 실행 단위와 Queue 상태를 관리한다. Processing Mode와 Job별 Provider/Model Override를 실행정책으로 가지며, 기존 Document 재처리의 실행·일시중지·성공·실패 상태는 Document의 현재 Commit 상태와 분리하여 관리한다.

## ProcessingUnit
Page / Slide / Image / Table 등 최소 처리 단위.

## KnowledgeUnit
검색의 유일한 검색 단위. AI/Lightweight 처리로 구성한 의미 단위와 Deterministic Fallback으로 생성한 Page/Slide 최소 단위를 모두 포함한다. 질의와 무관한 Source Page/Slide Range, Text/Visual Source Evidence Reference, 최소 Provenance를 관리한다. **질의별 Matched Evidence Location/Type은 KnowledgeUnit의 고정 속성이 아니다.**

## VisualAsset
Image / Table / Chart / Diagram / Map 등. 검색 또는 Evidence에 사용되는 경우 원본 Page/Slide와 역추적 가능한 Reference를 유지한다.

## ProcessingArtifact
OCR, Summary, Keyword, Boundary Embedding, AI 분석 결과 등 전처리 파생 결과.

## UserOverride
사용자가 수정한 주제·요약·특징·키워드·별칭과 적용 상태를 관리. 재처리 후 명확한 1:1 대응은 승계하고, 분할·병합 등 모호한 경우 `사용자 확인 필요` 상태를 가질 수 있음.

## SearchIndex
Vector / Lexical 검색 인덱스.

## SearchResult
검색 시점에 생성되는 논리적 결과 Projection. KnowledgeUnit과 질의의 매칭 결과를 바탕으로 Matched Evidence Page/Slide, Matched Evidence Type, Matched Evidence Reference, Related Range, 검색 연관성 지표 등을 구성한다. 영구 저장 Entity 여부는 TRD에서 결정한다.

## SynonymEntry
약어·동의어 항목. 자동 생성 후보와 사용자가 승인하여 검색에 활성화된 항목을 구분한다. 미승인 자동 후보는 Source Document와 Confidence/발견 문서 수 등 집계정보를 관리하고 재처리·삭제 시 Source 연계를 갱신하며, 사용자 승인·수정·직접 추가 항목은 독립적인 활성 사전 수명주기로 관리한다.

## SearchSession
현재 앱 실행 중의 검색 세션 상태.

## SearchFeedback
검색결과 및 세션 피드백.

## ProviderAudit
외부 AI 처리 감사 이력.

## BackupManifest
MYBOX 백업 구성, 카탈로그 동기화 상태와 원본 Hash 검증에 필요한 메타정보.

물리 DB Schema와 Entity 간 상세 관계는 TRD에서 정의한다.

# 23. 주요 사용자 시나리오

본 장의 시나리오는 앞선 규범적 요구사항을 설명하기 위한 예시이며, 독립적인 요구사항 Source of Truth가 아니다. 표현이 충돌하는 경우 해당 기능의 본문 정책을 우선한다.


## Scenario A — 최초 실행 및 신규 등록

1. 사용자가 앱 실행
2. 저장소 위치 확인
3. 기본 Processing Mode `설치 상태에 따라 자동` 안내. runtime 구성요소가 준비되기 전에는 실제로 경량 처리로 동작함을 함께 표시
4. 빈 Knowledge Base에서 `[문서 등록 시작]`
5. 파일 또는 디렉토리 선택
6. 해당 Job의 Processing Mode 확인
7. `External AI 허용`이며 실제 External AI 사용 가능성이 있으면 Provider/Endpoint와 외부 전송 가능 데이터 범위를 실행 전에 안내
8. Hash 확인
9. 신규 Document 내부 저장소 복사
10. Native Parsing 및 모든 Page/Slide OCR 포함 전처리 수행
11. Source Evidence/Provenance와 최소 하나의 Search Index가 준비된 Knowledge Unit부터 검색 가능
12. 처리상태 확인

## Scenario B — 같은 폴더 다시 등록 / 원본 재연결

1. 사용자가 기존 업무 폴더를 다시 등록
2. 각 파일 Hash 확인
3. 동일 Hash + 기존 원본 정상 → `이미 등록됨 / 건너뜀`
4. 동일 Hash + 기존 Document `원본 누락` → 기존 Document에 원본 자동 재연결
5. 신규 Hash → 새 독립 Document 등록
6. 기존 내부 Document는 자동 삭제하지 않음
7. 신규 항목만 전처리
8. 원본 재연결 항목은 기존 전처리·Index가 유효하면 재사용

## Scenario C — 자연어 검색

1. 사용자가 자연어 질문
2. 경량 Query Normalization
3. 승인된 동의어/약어 및 날짜 조건 적용
4. Hybrid Search
5. Ranking 및 중복 억제
6. 유사 문서 그룹화
7. 초기 제한 결과 표시
8. 사용자가 질의별 Matched Evidence 위치와 Knowledge Unit 관련 범위, 실제 Source Evidence 확인
9. 필요 시 `더 보기`
10. 원본 열기
11. 피드백

## Scenario D — 후속 검색

1. 사용자가 첫 검색 수행
2. 현재 검색 세션 유지
3. “그중에서 2024년 이후 것만” → 기준 미지정이므로 원본 수정일 기준
4. 필요 시 “등록일 기준으로” 또는 “문서 작성일 기준으로” 변경
5. “두 번째 결과와 비슷한 자료”
6. 현재 검색 맥락 기반으로 재검색
7. 필요 시 `새 검색`

## Scenario E — Processing Job 중단과 재개

1. Job 실행
2. 앱 종료 또는 PC 재부팅
3. 완료 결과·진행상태 보존
4. 앱 재실행
5. 종료 직전 실행 중이던 Job은 자동 재개
6. 사용자가 수동 일시중지했던 Job은 일시중지 상태 유지

## Scenario F — Job 일시중지 / 대기 제거 / 취소

### 일시중지
1. 사용자가 일시중지
2. 현재 결과 보존
3. 앱 재실행 후에도 일시중지 유지
4. 수동 재개

### 대기 Job 제거
1. 아직 실행되지 않은 Job 선택
2. Queue에서 제거
3. Rollback 없이 종료

### 실행/일시중지 Job 취소
1. 처리 중 또는 일시중지 Job에서 취소
2. 해당 Job 변경사항 Rollback
3. 신규 등록 Job의 노출 데이터는 제거
4. 기존 Document 재처리 Job은 기존 검색 상태 유지

## Scenario G — 기존 Document 재처리

1. 사용자가 기존 Document 재처리 실행
2. 기존 검색 데이터는 계속 사용
3. 새 재처리 결과는 완료 전까지 검색에 혼합 노출하지 않음
4. 재처리 완료 및 검증
5. 새 검색 데이터로 전환
6. Knowledge Unit이 명확히 1:1 대응하면 사용자 수정값 자동 승계
7. 분할·병합 등 대응이 모호하면 수정값은 `사용자 확인 필요`로 보존
8. 미승인 자동 동의어·약어 후보의 Source/집계는 새 재처리 결과에 맞게 갱신
9. 재처리 취소/실패 시 기존 검색 데이터와 기존 `Document.processing_status` 유지
10. 재처리 실패 사실은 Processing Job 상태에서 별도 표시

## Scenario H — 저장소 이전

1. §3.7 조건에 따라 Processing Queue가 완전히 비어 있는지 확인
2. Maintenance 상태 진입 후 신규 등록/재처리 Job 생성 차단
3. 새 저장소 위치 선택
4. 기존 저장소는 계속 Source of Truth
5. 복사·검증
6. 이전 중 검색/열람은 가능하되 검색 피드백·암묵적 Signal 등 Write는 기록하지 않음
7. 중단 시 이어서 재개
8. 완료·검증 후 새 저장소로 전환
9. 새 저장소 전환과 시스템 경로 포인터 갱신 후 기존 Weki 관리 데이터 정리
10. 기존 저장소에 사용자 파일이 남아 있으면 해당 파일과 폴더를 보존하고 결과를 사용자에게 안내

## Scenario I — MYBOX 백업·카탈로그 동기화와 원본 지연 복원

1. §3.7 조건에 따라 Processing Queue가 완전히 비어 있는지 확인
2. MYBOX 업로드를 실행해 검색 DB와 원본 Archive를 함께 보존
3. 새 저장소의 빈 로컬 DB에서 `knowledge-base.json`을 동기화
4. 검색은 동기화된 로컬 DB·임베딩으로 수행
5. 원본이 없는 검색결과에서 `원본 열기`를 선택
6. 필요한 MYBOX 원본만 다운로드하고 Hash 검증 후 현재 저장소에 캐시
7. v1.2.0 로컬 `.weki` 파일은 자동 삭제되지 않으며 복원 대상으로 제공되지 않음

## Scenario J — 전체 문서 데이터 삭제

1. §3.7 조건에 따라 Processing Queue가 완전히 비어 있는지 확인
2. `전체 문서 데이터 삭제` 선택
3. 2단계 확인
4. 전체 문서·검색 데이터 삭제
5. 일반 처리 로그·외부 AI 감사 로그·일반 설정은 유지

---

# 24. 1차 Acceptance Criteria / Traceability

본 장은 앞선 본문 요구사항을 다시 정의하지 않는다. **제품 요구사항의 Source of Truth는 각 본문 절**이며, 본 장은 주요 요구사항에 Requirement ID를 부여하고 출시 시 검증할 Acceptance Condition을 연결한다.

본문과 본 장의 설명이 충돌하는 경우 본문 정책을 우선하며, Acceptance Condition은 해당 본문 요구를 검증하는 방향으로 수정한다.

## 24.1 등록 / 저장소

| Requirement ID | Source | Acceptance Condition |
|---|---|---|
| REQ-DOC-FMT-001 | §2.3, §4.2, §6.1 | PDF/PPTX/HWP/HWPX/DOCX 파일 및 디렉토리 등록이 가능하다. |
| REQ-DOC-STORE-001 | §6.2 | 등록 완료 후 내부 저장소 원본이 Source of Truth이며 외부 파일 이동·삭제가 검색 상태에 영향을 주지 않는다. |
| REQ-DOC-IDENT-001 | §6.3~6.5 | 동일 Hash는 중복 Document를 만들지 않고, 다른 Hash는 독립 Document로 등록한다. |
| REQ-DOC-RELINK-001 | §6.4 | 동일 Hash + `source_status=missing`이면 기존 Document에 원본을 자동 재연결하고 유효한 전처리·Index를 재사용한다. |
| REQ-DOC-DATE-001 | §6.4~6.6 | 원본 재연결 후에도 최초 등록 당시 Document 원본 수정일·등록일·대표 파일명을 유지한다. |
| REQ-DOC-LARGE-001 | §6.7 | 대용량 문서에 고정 상한을 두지 않고, 저장공간 부족 예상 시 Job 시작 차단 및 처리 중 부족 시 일시중지·재개가 가능하다. |

## 24.2 Processing Job / 전처리

| Requirement ID | Source | Acceptance Condition |
|---|---|---|
| REQ-JOB-QUEUE-001 | §7.2 | 한 번에 하나의 Job만 실행되고 Queue 순서 변경 및 실행 전 제거가 가능하다. |
| REQ-JOB-MAINT-001 | §3.7 | Maintenance Exclusive Operation 중에는 신규 등록/재처리 Job 생성·Queue 추가와 다른 Maintenance 작업의 동시 시작이 차단된다. |
| REQ-JOB-RESUME-001 | §7.4~7.5 | 앱 종료 또는 PC 재부팅 후 종료 직전 실행 중이던 Job은 자동 재개하고, 사용자 일시중지 또는 시스템 원인 자동 일시중지 Job은 사용자가 명시적으로 재개하기 전까지 처리되지 않는다. |
| REQ-JOB-CANCEL-001 | §7.6 | 처리 중/일시중지 Job 취소 시 해당 Job 변경사항이 시작 전 상태로 Rollback된다. |
| REQ-OCR-ALL-001 | §8.2 | 모든 공식 지원 문서의 모든 Page/Slide에 OCR이 수행되고 Native Text 존재만으로 생략되지 않는다. |
| REQ-VIS-TEXT-001 | §8.3 | 이미지·그래프·지도 등의 문자 정보가 OCR 검색 경로에 포함된다. |
| REQ-VIS-BEST-001 | §8.3 | 비텍스트 Visual 의미 분석 실패가 핵심 검색 사용 가능성을 차단하지 않는다. |
| REQ-FB-CHAIN-001 | §10.1 | 허용 AI → Lightweight → Deterministic 순의 Fallback Chain으로 Knowledge Unit을 확정하며 상위 모드로 자동 승격하지 않는다. |
| REQ-FB-EMB-001 | §4.1, §10.1, §12.3 | 전처리용 Boundary Embedding과 검색용 Embedding이 목적상 구분된다. |
| REQ-KU-ONE-001 | §10.2 | 모든 검색 단위는 Knowledge Unit이며 Deterministic Fallback도 Page/Slide 최소 Knowledge Unit으로 생성된다. |
| REQ-PARTIAL-001 | §4.1, §11.1~11.3 | 신규/부분 처리 Document는 Source Evidence·Provenance와 최소 하나의 Search Index가 준비된 Knowledge Unit부터 검색할 수 있고 실패 단위만 재처리할 수 있다. |
| REQ-REPROC-STATE-001 | §11.1, §11.3 | 기존 Document 재처리의 실행·실패 상태는 ProcessingJob에서 관리하고, 실패·취소 시 기존 검색 데이터와 기존 `Document.processing_status`를 유지하며 성공적으로 새 결과를 Commit한 경우에만 Document 상태를 갱신한다. |

## 24.3 상태 / 검색 / Evidence

| Requirement ID | Source | Acceptance Condition |
|---|---|---|
| REQ-STATE-001 | §11.1 | `processing_status`와 `source_status`가 독립적으로 표현되며 `completed + missing` 조합을 지원한다. `completed/partial/failed`는 필수 처리 성공 여부와 검색 가능한 Knowledge Unit 존재 여부에 따라 본문 기준대로 판정된다. |
| REQ-SEARCH-XLM-001 | §12.3 | 한국어↔영어 교차 언어 검색이 가능하다. |
| REQ-SEARCH-HYB-001 | §3.3~3.4, §12.4~12.5 | Vector + BM25/FTS Hybrid Search와 Recall 우선 Ranking이 동작하되, 실제 Source Evidence와 Provenance를 확보하지 못한 후보는 Recall 확보를 이유로 최종 결과에 노출하지 않는다. |
| REQ-SEARCH-RANGE-001 | §13.4 | 1차 검색은 전체 Knowledge Base를 대상으로 하며 특정 폴더/프로젝트/개별 문서 고정 검색은 제공하지 않는다. |
| REQ-SEARCH-FOLLOW-001 | §13.5~13.6 | 현재 앱 실행 중 후속 검색이 가능하고 앱 종료 후 과거 검색 대화는 복원하지 않는다. |
| REQ-EVD-TEXT-001 | §3.3, §13.1~13.2 | Text Evidence는 실제 Native/OCR Text와 문맥을 제공한다. |
| REQ-EVD-VIS-001 | §3.3, §8.3, §13.1~13.2 | Visual 자체가 직접 근거인 결과는 실제 Visual Asset 또는 원본 검증 가능한 미리보기와 정확한 Page/Slide를 Visual Evidence로 반드시 제공한다. |
| REQ-EVD-TABLE-001 | §3.3 | Table의 문자·Cell 값 자체가 근거이면 Text Evidence, 행·열 관계·구조·배치가 근거이면 Visual Evidence로 판정하고 둘이 모두 필요하면 Text+Visual Evidence를 함께 제공할 수 있다. |
| REQ-EVD-MATCH-001 | §3.6, §10.3, §13.1 | Matched Evidence Page/Slide와 Type은 질의별 Search Result 속성으로 결정되며 Knowledge Unit의 고정 질의독립 속성으로 저장하지 않는다. |
| REQ-EVD-GEN-001 | §3.3, §13.2 | 생성 Summary/Topic/Visual Description은 Source Evidence와 시각적으로 구분되고 실제 Evidence로 역추적되지 않는 생성정보만으로 결과 근거를 구성하지 않는다. |
| REQ-OVERRIDE-001 | §10.4, §13.1 | 사용자 수정값이 자동 생성값보다 우선하며 결과 카드에 `사용자 수정`/`자동 생성` Source가 구분된다. |
| REQ-SYN-001 | §12.2 | 승인된 동의어·약어만 실제 Query Normalization/Search Expansion에 사용된다. |
| REQ-SYN-LIFE-001 | §12.2 | Document 재처리 시 미승인 자동 후보의 Source/Confidence/발견 문서 수 등 집계는 새 결과에 맞게 갱신되며, 사용자 승인·수정·직접 추가 항목은 재처리만을 이유로 자동 삭제·비활성화하지 않는다. |
| REQ-SEARCH-LOWREL-001 | §3.4, §12.6 | 후보 전체의 연관성이 매우 낮은 경우 결과를 숨기지 않고 낮은 연관성 안내를 표시하며, Source Evidence/Provenance가 유효한 후보를 계속 탐색할 수 있다. |
| REQ-DATE-SEARCH-001 | §12.1 | 기준 미지정 날짜 조건은 원본 수정일 기준이며 등록일/신뢰 가능한 작성일 기준으로 변경 가능하다. |

## 24.4 AI / 보안 / 운영 로그

| Requirement ID | Source | Acceptance Condition |
|---|---|---|
| REQ-AI-MODE-001 | §9.1~9.3 | 기본 설정은 `auto`이며 세 runtime 구성요소가 모두 준비·적용되기 전에는 경량 처리, 이후 새 작업부터 Local AI를 사용한다. 사용자가 경량 처리를 명시한 Job은 Local AI로 자동 승격하지 않는다. |
| REQ-AI-SELECT-001 | §9.3~9.4 | Provider/Model은 Processing Mode 상한 → Job Override → 허용 가능한 전역 기본값 순으로 선택하며 Override로 모드 상한을 우회할 수 없다. |
| REQ-AI-ENDPOINT-001 | §9.4 | 명확한 Local Endpoint만 Local AI로 취급하고 불확실한 Endpoint는 External AI로 분류한다. |
| REQ-AI-DATA-001 | §9.5 | External AI에는 필요한 최소 처리 단위만 전송한다. |
| REQ-AI-NOTICE-001 | §9.6 | External AI가 사용될 수 있는 Processing Job 실행 전에 외부 Provider/Endpoint 사용 가능성과 Page/Slide/Image/Text Chunk 등 문서 내용 일부의 외부 전송 가능성을 사용자에게 명확히 안내한다. |
| REQ-SEC-LOCAL-001 | §18.2 | 원본 Archive와 주요 문서 내용 저장 DB에는 앱 수준 저장 데이터 보호가 적용되고, API Key 등 Credential은 별도 안전한 저장 방식을 사용한다. Index/Cache 예외는 Threat Model에서 명시된다. |
| REQ-LOG-AUDIT-001 | §18.3~18.4 | External AI 감사 로그를 기록하고 로그는 자동 기간 삭제하지 않으며 사용자 직접 삭제가 가능하다. |

## 24.5 Maintenance / MYBOX 백업과 지연 복원

| Requirement ID | Source | Acceptance Condition |
|---|---|---|
| REQ-MAINT-EMPTY-001 | §3.7 | 저장소 이전/MYBOX 업로드/전체 문서 데이터 삭제는 실행·일시중지·대기 Job이 하나도 없을 때만 시작된다. |
| REQ-MIG-READ-001 | §15.2 | 저장소 이전 중 검색/열람/원본 열기는 가능하고 검색 피드백·암묵적 Signal Write는 기록되지 않는다. |
| REQ-BACKUP-TYPE-001 | §16.1~16.2 | MYBOX가 유일한 지원 백업 경로다. MYBOX 업로드는 검색 데이터와 원본 Archive를 함께 보존하고, 검색 DB 동기화는 `knowledge-base.json`만 받으며 원본은 지연 복원한다. |
| REQ-BACKUP-KEY-001 | §16.1~16.2 | API Key는 MYBOX 백업에 포함하지 않는다. |
| REQ-BACKUP-MANUAL-001 | §16.2 | MYBOX 업로드와 검색 DB 동기화는 사용자가 버튼으로 명시적으로 실행한다. 단, 신규 빈 로컬 DB의 최초 MYBOX 검색 DB 동기화만 1회 자동 실행한다. |
| REQ-BACKUP-WEKI-001 | §16.1~16.2 | v1.2.1은 v1.2.0의 로컬 `.weki` 백업을 생성·복원하지 않으며, 기존 `.weki` 파일을 자동 삭제하지 않는다. |
| REQ-REPROCESS-BOUNDARY-001 | §16.3 | 사용자 설정 화면에 검색 색인 관리 UI를 제공하지 않으며, 전체 문서 재처리는 v1.3.0 검토 항목으로 연기한다. |
| REQ-DEL-DOC-001 | §17.1 | 개별 Document 삭제 시 해당 Document의 검색·전처리 데이터가 제거되고, 미승인 자동 동의어·약어 후보는 Source 연계정책에 따라 삭제 또는 집계 갱신되며 사용자 승인·수정·직접 추가 사전은 유지된다. |
| REQ-DEL-ALL-001 | §17.2 | 전체 문서 데이터 삭제는 Queue가 비어 있을 때만 시작되며 작업 중 검색·검색결과 열람·원본 열기가 차단된다. |

## 24.6 품질 / 설치 / 업데이트

| Requirement ID | Source | Acceptance Condition |
|---|---|---|
| REQ-CPU-001 | §3.1, §19.1 | GPU 없는 CPU-only Windows PC에서 External AI나 네트워크 연결 없이 문서 등록/OCR/Fallback/Embedding/검색 핵심 기능이 동작한다. |
| REQ-LOCAL-CORE-001 | §3.1.1, §20.5 | PDF/DOCX/PPTX/HWP/HWPX 등록·전처리, 로컬 Embedding·검색·Evidence 확인, 앱 재실행 후 기존 데이터 사용이 외부 API 필수 의존성 없이 동작한다. |
| REQ-SCALE-001 | §19.2 | 50,000~100,000페이지 규모를 대표 성능시험 규모로 검증한다. |
| REQ-QUAL-SET-001 | §20.1 | Golden Dataset을 튜닝 전에 Tuning Set과 Hold-out Release Evaluation Set으로 분리하고 Release Evaluation Set을 반복 튜닝에 사용하지 않는다. |
| REQ-QUAL-GATE-001 | §20.1 | Tuning Set Baseline 후 제품 책임자가 Evidence Top-5 중심 Release Threshold를 확정·동결하고 Release Evaluation Set에서 충족해야 출시할 수 있다. |
| REQ-QUAL-HIT-001 | §20.1 | 핵심 Evidence Hit는 정답 Document와 Matched Evidence Page/Slide가 함께 맞아야 하며, 지정된 경우 Evidence Type도 일치해야 한다. |
| REQ-PROC-GATE-001 | §20.4 | 등록/Parsing/OCR/Knowledge Unit/Embedding/Indexing의 전처리 안정성 Release Gate를 수립하고 충족한다. |
| REQ-UPD-001 | §21.1 | 1차 제품은 수동 업데이트만 지원하고, Processing Queue가 완전히 비어 있으며 활성 Maintenance Exclusive Operation이 없을 때만 새 설치파일을 적용한다. 업데이트 후 기존 원본/Document/사용자 수정값/전처리 결과/설정을 보존한다. |
| REQ-REINSTALL-001 | §21.2 | 1차 사내 배포판은 Uninstall 시 Weki 관리 데이터를 정리하고, 재설치 시 설치 단계에서 새 저장소를 선택한다. 사용자 파일이 있는 지정 폴더는 Weki 관리 대상만 정리한다. |

각 Requirement ID의 상세 시험 절차, Test Corpus, Reference Hardware, 정량 Threshold 및 자동화 여부는 시험계획/TRD에서 정의한다.

---

# 25. TRD로 이관할 항목

다음은 제품 요구가 아니라 구현 설계의 영역이므로 TRD에서 확정한다.

## 25.1 시스템 아키텍처

- Desktop Framework
- Worker Process 구조
- Process / Thread 모델
- Queue 구현
- Crash Recovery
- Job Checkpoint
- Transaction / Rollback

## 25.2 데이터 모델

- Physical DB Schema
- Document / SourceBlob / ProcessingUnit / KnowledgeUnit 관계
- `processing_status` / `source_status` 물리 모델과 상태 전이
- 기존 Document 재처리 시 Document Commit 상태와 ProcessingJob 실행/실패 상태 분리 방식
- ProcessingArtifact
- UserOverride
- ProcessingJob
- Audit Log
- Backup Manifest

## 25.3 파일 동일성 / 저장

- Hash 알고리즘
- 파일크기 병행검증
- Hash 계산 최적화
- Blob Dedup
- 물리 폴더 구조

## 25.4 OCR / Lightweight Pipeline

- OCR Engine
- 페이지 렌더링 DPI
- Native/OCR Dedup
- Bounding Box
- Language Detection
- Rotation
- Heading Detection
- 구조 분석
- Extractive Summary
- Keyword Extraction
- Lightweight Classifier
- 전처리용 Boundary Embedding 모델·Cache·비용
- Boundary Embedding과 검색용 Embedding의 실행·저장 분리 방식

## 25.5 AI

- Provider Adapter
- Local Endpoint
- Local/External Custom Endpoint 판정 규칙
- Model Capability Detection
- Prompt / JSON Schema
- Timeout
- Retry
- Provider Error Mapping
- Fallback State Machine
- External AI 실행 전 고지 UI와 실제/후보 Provider·Endpoint 표시 방식

## 25.6 Knowledge Unit

- 생성 알고리즘
- 최대 길이
- Page Span
- Source Evidence Reference / Source Page-Slide Range
- 질의별 Matched Evidence Location / Type 산정 방식
- Boundary
- Overlap
- Deterministic Fallback Page/Slide 최소 Knowledge Unit 생성 규칙
- AI Output Schema
- Stable ID
- 재처리 전후 Knowledge Unit 1:1 매칭 및 UserOverride 승계 판정

## 25.7 Embedding

- 검색용 Embedding 모델 선택
- Boundary Embedding과 검색용 Embedding 모델 공유 여부
- Cross-lingual 성능
- CPU 성능
- Batch Size
- 재임베딩 정책

## 25.8 Search

- Vector Engine
- BM25/FTS Engine
- Candidate Pool
- Fusion / RRF
- Normalization
- Ranking Weight
- 검색 연관성 지표 0~100 환산
- 낮은 연관성 후보 상태 판정 신호·기준 및 안내 UX 연계
- User Override 반영
- 유사 문서 계산
- Grouping Threshold
- Dedup

## 25.9 보안

- Archive Encryption 구현
- DB Encryption 구현
- Index/Cache 예외 범위 및 보호 방식
- API Key 저장
- Windows DPAPI / Credential Manager 등
- Key Management
- Uninstall/Reinstall 후 기존 저장소 복호화·키 복구 방식
- Cross-PC Backup Recovery Key/Passphrase 방식
- Threat Model

## 25.10 저장소 이전

- Migration Checkpoint
- Integrity Check
- Atomic Switch
- Read/Write Lock
- 이전 중 검색 피드백·암묵적 Signal Write 억제 방식

## 25.11 백업

- MYBOX 카탈로그와 원본 Archive 업로드 범위
- Hash 기반 카탈로그 병합과 원본 지연 복원
- MYBOX 업로드 시 원본 포함·평문 경고
- 기존 `.weki` 파일 비호환·비삭제 정책

## 25.12 앱 업데이트 Migration

- 업데이트 전 Queue Empty + 활성 Maintenance 없음 확인/안내 방식
- 설치/앱 Migration 진입 시 Maintenance Lock 상태 검증 방식
- Storage / DB Versioning
- Copy-on-Migrate 또는 동등한 보존 방식
- Integrity Verification
- Atomic Switch
- Migration Failure Recovery
- 이전 버전 데이터 보존 정책

## 25.13 성능

- Reference Hardware
- 최소 / 권장 CPU·RAM·Storage
- P50 / P95 / P99
- 50k / 100k Page Benchmark
- 메모리 목표
- Index Size
- Resource Throttling

## 25.14 시험

- Golden Dataset 포맷
- Tuning Set / Release Evaluation Set 분할 방식
- Test Corpus
- Baseline 평가 절차
- Release Threshold 확정·동결 절차
- Top-K 자동평가
- Processing Success Rate
- Evidence Hit 자동평가 정의
- Table Text/Visual Evidence Type 판정 시험
- 낮은 연관성 검색결과 안내 UX 시험
- Release Evaluation Hold-out 갱신/교체 정책
- Release Gate 정량값

---

# 26. 최종 제품 방향 요약

본 장은 앞선 규범적 요구사항의 요약이며 독립적인 요구사항 Source of Truth가 아니다.

```text
                  File / Directory
                         │
                         ▼
                    Hash Check
         ┌───────────────┼────────────────────┐
         │               │                    │
 Same Hash +        Same Hash +           New Hash
 Original OK        Source Missing             │
         │               │                    │
       Skip         Auto Source Relink    New Document
                         │                    │
                         └──────────┬─────────┘
                                    ▼
                            Internal Archive
                                    │
                          Native Extraction
                                    │
                         OCR on Every Page/Slide
                                    │
                        Table / Image Parsing
                                    │
                                    ▼
                         Processing Mode Ceiling
       ┌────────────────────┬─────────────────────┐
       │                    │                     │
  Lightweight Only      Local AI Allowed    External AI Allowed
       │                    │                     │
       └────────────── Fallback Chain ───────────┘
                                    │
                                    ▼
                         Knowledge Unit 확정
                         + Source References
                                    │
                         Search Embedding + FTS
                                    │
                                    ▼
                             Search Database
                                    │
                    Natural-language Query
                                    │
                    Vector + BM25/FTS Search
                                    │
                    Ranking / Dedup / Grouping
                                    │
                  Query-time Evidence Matching
                                    │
                                    ▼
        Evidence Cards: Matched Text and/or Visual
                                    │
                 Original Open / Follow-up / Feedback
```

1차 제품의 최종 방향은 다음 원칙으로 요약한다.

1. **Document의 핵심은 파일 간 버전 추론이 아니라 Hash 기반 동일성 관리와 독립 문서 관리다.** 동일 Hash는 중복 등록하지 않되, 기존 Document의 `source_status`가 `missing`이면 자동 재연결한다. 재연결은 최초 등록 기준 메타데이터를 임의 변경하지 않는다.
2. **OCR은 모든 공식 지원 Page/Slide에 수행하는 공통 선행 단계다.** AI/Lightweight/Deterministic Fallback은 그 이후 Knowledge Unit을 확정하는 처리 Chain이며 OCR 자체를 Fallback 단계로 취급하지 않는다.
3. **모든 검색 단위는 Knowledge Unit이다.** Knowledge Unit은 질의독립적인 Source Range와 Text/Visual Reference를 보존하고, 실제 Matched Evidence Page/Slide와 Type은 검색 시점에 결정한다.
4. **AI는 검색의 필수조건이 아니라 전처리 품질을 높이는 선택적 수단이다.** GPU·External AI·네트워크 없이도 CPU-only 경량 경로로 핵심 기능이 동작해야 한다.
5. **Processing Mode가 Provider/Model 선택의 상한이다.** Job Override가 전역 기본값보다 우선하지만 모드 상한을 우회할 수 없으며, 실패 시 허용 범위 내 하위 Fallback만 사용한다. External AI가 사용될 수 있는 Job은 실행 전에 외부 Provider/Endpoint와 문서 내용 일부의 외부 전송 가능성을 사용자에게 안내한다.
6. **Evidence는 Text와 Visual을 구분한다.** 직접 근거가 Visual인 결과는 실제 Visual Asset 또는 원본 검증 가능한 미리보기와 Page/Slide를 반드시 제공하고, AI/VLM 생성 설명으로 대체하지 않는다. Table은 문자·Cell 값이 근거이면 Text, 구조·배치가 근거이면 Visual로 판정하며 필요하면 둘을 함께 제공한다.
7. **신규 Document는 검색 가능 조건을 만족한 Knowledge Unit부터 순차 노출한다.** 기존 Document 재처리는 기존 검색결과와 기존 `Document.processing_status`를 유지한 상태에서 수행하고, 완료·검증 후 새 결과를 Commit한 경우에만 새 상태로 전환한다. 재처리 실행·실패 상태는 ProcessingJob에서 별도 관리한다.
8. **1차 검색 범위는 전체 Knowledge Base다.** 특정 폴더·프로젝트·개별 문서로 검색범위를 고정하는 기능은 1차에 포함하지 않는다.
9. **Document의 처리상태와 원본상태는 분리한다.** 전처리가 완료되었지만 원본이 누락된 상태에서도 파생데이터가 정상이라면 검색과 Evidence 열람을 유지한다.
10. **저장소 이전·MYBOX 업로드·전체 문서 데이터 삭제는 공통 Maintenance Exclusive Operation 정책을 따른다.** 시작 전 Queue가 비어 있어야 하며 작업 중 신규 등록/재처리 Job 및 다른 Maintenance 작업 시작을 차단한다.
11. **백업은 MYBOX만 지원한다.** MYBOX 업로드는 검색 데이터와 원본 Archive를 함께 보존하고, 검색 DB 동기화 때는 JSON만 받으며 원본은 필요 시 지연 복원한다. API Key는 MYBOX 백업에 포함하지 않는다. v1.2.0 로컬 `.weki` 파일은 생성·복원하지 않고 자동 삭제하지도 않는다.
12. **검색 색인과 전체 문서 재처리의 경계를 명확히 한다.** 사용자 설정 화면에는 검색 색인 관리 UI를 제공하지 않는다. 내부 색인 재생성 API는 마이그레이션·복구용으로 유지하며, 전체 문서 재처리는 v1.3.0 검토 항목이다.
13. **검색 품질의 핵심 Hit는 Document만이 아니라 Evidence 위치까지 맞아야 한다.** Golden Dataset은 Tuning Set과 Hold-out Release Evaluation Set으로 선분리하고 Evidence Top-5 중심의 동결된 Threshold를 출시 전에 충족한다.
14. **비텍스트 Visual 의미 이해는 Best-effort지만 Evidence 정합성은 필수다.** Visual Analysis 실패 자체는 핵심 출시 실패가 아니지만, Visual을 직접 근거로 반환한 결과는 실제 Visual Evidence로 역추적되어야 한다.
16. **부분 실패와 일시중지는 사용자에게 숨기지 않는다.** 필수 처리 일부 실패는 검색 가능한 단위가 있어도 `partial`로 표시하고, 사용자 또는 시스템 원인으로 일시중지된 Job은 사용자가 명시적으로 재개한다.
17. **주요 민감 데이터에는 앱 수준 저장 데이터 보호를 적용한다.** API Key는 별도의 안전한 Credential 저장 방식을 사용하고 Index/Cache 등의 세부 예외는 Threat Model에서 관리한다.
18. **수동 업데이트 전에는 Processing Queue가 완전히 비어 있고 실행 중인 Maintenance Exclusive Operation도 없어야 한다.** 1차 제품은 버전 간 미완료 Processing Job 상태 호환을 보장하지 않는다.
19. **자동 생성 동의어·약어 후보와 사용자 확정 사전은 수명주기를 분리한다.** 재처리·삭제 시 미승인 후보의 Source/집계를 갱신하되 사용자 승인·수정·직접 추가 항목은 자동 삭제·비활성화하지 않는다.
20. **Recall-first는 낮은 연관성 후보를 숨기지 않는 원칙이다.** 후보 전체의 연관성이 매우 낮으면 결과를 계속 제공하면서 관련성이 높지 않을 수 있음을 안내한다.
21. **본문 요구사항이 Source of Truth다.** 사용자 시나리오·Acceptance Criteria·최종 요약은 본문을 설명하거나 검증하는 역할만 하며 독립적으로 요구사항을 재정의하지 않는다.
