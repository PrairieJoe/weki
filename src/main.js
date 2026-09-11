import "./styles.js";
import { formatDisplayScore, highlightEvidence } from "./search/evidence-display.mjs";
import { runtimeAction, runtimeBatchMessage, shouldAutoRestart } from "./runtime/presentation.mjs";
import { createOnboardingController } from "./onboarding.js";
import packageJson from "../package.json";

const APP_VERSION = packageJson.version;
let docs = [];
let onboardingController;
const MYBOX_RUNTIME_CACHE_TTL = 30_000;
const state = { page: "search", query: "", apiResults: [], searchCursor: null, searchHasMore: false, jobs: [], selectedFiles: [], status: null, settings: null, documentModeDraft: null, processingDefaultDraft: null, externalAiToggleDraft: null, geminiModels: [], geminiModelsLoaded: false, geminiConnectionStatus: null, mybox: { connected: false, backups: [] }, myboxLoaded: false, myboxRuntime: null, myboxRuntimeFetchedAt: 0, myboxRuntimePromise: null, myboxRendererInstalling: false, searchSessionId: null, rankingVersion: null, searchAbortController: null, runtimeLoading: false, runtime: null, runtimePollTimer: null, runtimeBatchRequested: false, runtimeRestartTimer: null, toast: "", dialog: null, loading: false, expandedEvidence: new Set() };
const icons = { search:"⌕", add:"＋", docs:"▤", settings:"⚙", spark:"✦", arrow:"→", close:"×", pause:"Ⅱ", play:"▶", more:"⋯", file:"▧", check:"✓", alert:"!" };
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const activeJobs = () => state.jobs.filter((job) => ["queued", "processing", "paused"].includes(job.status));
const statusLabel = { processing:"처리 중", queued:"대기", paused:"일시중지", completed:"완료", skipped:"건너뜀", failed:"실패", cancelled:"취소됨" };
const runtimeComponentLabels = { "semantic-model":"의미 검색 모델", "semantic-reranker":"검색 결과 재정렬 모델", "document-renderer":"문서 화면 처리기" };
const runtimeStatusLabels = { healthy:"정상 작동", ready:"사용 가능", degraded:"일부 기능 제한", missing:"설치 필요", installing:"설치 중", failed:"설치 실패", unavailable:"사용할 수 없음" };
const processingDefaultLabels = { auto:"설치 상태에 따라 자동", lightweight:"경량 처리", "local-ai":"Local AI 사용" };
const processingDefaultUiLabels = { "installed-model":"설치된 모델 사용", "external-ai":"외부 AI 사용" };
const healthStatusLabels = { healthy:"정상 작동", degraded:"일부 기능 제한", unavailable:"사용할 수 없음", reindexing:"색인 다시 만드는 중", disabled:"사용하지 않음" };
function healthStatusLabel(value){ const status=typeof value==="object"?value?.status:value; return healthStatusLabels[status]||status||"확인 중"; }
const externalFailureLabels = { external_ai_not_configured:"Gemini API Key가 필요합니다.", external_ai_model_not_selected:"Gemini 모델을 선택해 주세요.", external_ai_connection_failed:"Gemini 연결에 실패했습니다. 연결을 다시 확인해 주세요.", external_ai_timeout:"Gemini 연결 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.", external_ai_provider_error:"Gemini 제공자 오류가 발생했습니다. 설치된 모델로 처리합니다.", external_ai_invalid_response:"Gemini 응답을 확인할 수 없습니다. 설치된 모델로 처리합니다." };
function externalStatus(){ return state.status?.processing?.externalAi||state.settings?.externalAi||{}; }
function externalModelId(){ return state.settings?.externalAi?.modelId||state.status?.processing?.externalAi?.modelId||""; }
function externalConsentVersion(){ return state.settings?.externalAi?.consentVersion===1?1:null; }
function currentDefaultMode(){ return state.processingDefaultDraft||((state.status?.processing?.defaultMode==="external-ai"||state.settings?.defaultProcessingMode==="external-ai")?"external-ai":"installed-model"); }
function currentDocumentMode(){ return state.documentModeDraft||state.status?.processing?.effectiveDefaultMode||"lightweight"; }
function externalWarningText(){ const external=externalStatus(); const selected=state.externalAiToggleDraft??Boolean(external.enabled||currentDefaultMode()==="external-ai"); if(!selected)return ""; const failure=external.lastConnection?.status==="failed"?external.lastConnection.errorCode:null; const code=failure||(!external.configured?"external_ai_not_configured":!external.modelSelected&&!externalModelId()?"external_ai_model_not_selected":null); return code?externalFailureLabels[code]||"Gemini를 사용할 수 없어 설치된 모델, 경량 처리 순으로 진행됩니다.":!external.ready?"외부 AI를 사용할 수 없어 설치된 모델, 경량 처리 순으로 진행됩니다.":""; }
function consentMessage(){ const model=externalModelId()||"사용자가 선택한 Gemini 모델"; return `전송 범위: 페이지 또는 슬라이드에서 추출한 텍스트와 선택한 이미지입니다. 전체 원본 파일, 전체 프롬프트, 로컬 저장 경로, 근거 원문 전체는 전송하지 않습니다. 목적: 문서 전처리 보조 및 검색 보조 색인입니다. 제공자와 모델: Gemini · ${model}. 외부 AI를 끄면 이후 신규 작업부터 외부 처리를 사용하지 않으며, 이미 등록된 큐 작업에는 영향이 없습니다.`; }

function nav(){
  const items = [["search","검색",icons.search],["add","문서 등록",icons.add],["documents","문서 관리",icons.docs],["settings","설정 · 운영",icons.settings]];
  const storage = state.status?.storage || { usage: 0, available: 0, total: 0 };
  const used = storage.total ? Math.round(storage.usage / storage.total * 100) : 0;
  return `<aside class="sidebar"><a class="brand" data-nav="search" aria-label="Weki 검색으로 이동"><span class="brand-mark">w</span><span>Weki</span></a><div class="kb-chip"><span class="pulse"></span><span>LOCAL KNOWLEDGE</span><b>${docs.length} docs</b></div><nav aria-label="주요 메뉴">${items.map(([key,label,icon]) => `<button class="nav-item ${state.page===key?"active":""}" data-nav="${key}" aria-label="${label}" title="${label}" aria-current="${state.page===key?"page":"false"}"><i aria-hidden="true">${icon}</i><span>${label}</span></button>`).join("")}</nav><div class="sidebar-bottom"><div class="storage"><span>저장소 사용량</span><strong>${formatBytes(storage.usage)}</strong><div><b style="width:${used}%"></b></div><em>${formatBytes(storage.available)} 사용 가능</em></div><button class="help" data-onboarding-replay type="button">?&nbsp; 사용 가이드</button></div></aside>`;
}
function formatBytes(bytes){ if (!bytes) return "확인 중"; const units=["B","KB","MB","GB","TB"]; let n=bytes, i=0; while(n>=1024&&i<units.length-1){n/=1024;i++;} return `${n.toFixed(i?1:0)} ${units[i]}`; }
function shellHeader(){ return `<header class="shell-header" aria-label="시스템 상태"><button aria-label="메모리 상태">◫</button><button aria-label="로컬 저장소 상태">☁</button></header>`; }
function topbar(eyebrow,title,subtitle,action=""){ const restart=title==="설정 · 운영"?`<button class="secondary" id="restart-app" title="구성요소 설치 후 다시 시작">↻ 앱 다시 시작</button>`:""; return `<header class="topbar"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1>${subtitle?`<p class="subtitle">${subtitle}</p>`:""}</div><div class="topbar-actions">${action}${restart}</div></header>`; }
function banner(message, kind="warning"){ return `<div class="banner ${kind}" role="status"><span aria-hidden="true">${kind==="error"?icons.alert:"i"}</span><p>${message}</p></div>`; }
function sourceStatusLabel(status){ return status==="local_available"||status==="available"?"사용 가능":status==="cloud_available"?"MYBOX 원본 있음":"원본 없음"; }
const myboxLayoutHelp = "MYBOX 원본은 weki/data/<hash>/<원본 파일명> 아래에 보관하고, 로컬에는 현재 저장소의 originals/<hash>.<ext>로 캐시합니다.";
function formatResults(){ return state.apiResults.map((result) => { const knownDoc=docs.find((doc)=>doc.id===result.documentId); const evidence=result.matchedEvidence||{}; const evidenceType=result.evidenceType||evidence.type||"text"; const evidenceOrigin=result.evidenceOrigin||evidence.origin; const evidenceId=result.resultId||result.unitId||`${result.documentId}:${result.matchedPage||evidence.pageStart||0}`; return ({ doc:{id:result.documentId,name:result.fileName||result.documentName||knownDoc?.name,type:result.format||knownDoc?.type,sourceStatus:result.sourceStatus||knownDoc?.sourceStatus,cloudOriginalFile:result.cloudOriginalFile||knownDoc?.cloudOriginalFile}, unit:{ resultId:result.resultId, unitId:result.unitId, evidenceId, rank:result.rank, range:`${result.locationPrefix||"p."} ${result.sourceRange||evidence.pageStart||""}`, match:`${result.locationPrefix||"p."} ${result.matchedPage||evidence.pageStart||""}`, score:formatDisplayScore(result.displayScore??result.relevanceScore??result.score??0), type:evidenceType, snippet:result.snippet||evidence.snippet||evidence.context||result.text||"", text:result.text||evidence.context||"", matchedTerms:result.matchedTerms||evidence.matchedTerms||[], truncated:result.truncated??evidence.truncated??false, expanded:state.expandedEvidence.has(evidenceId), visual:(evidenceType==="visual"&&(result.visualAssetName||evidence.assetName))?`/api/documents/${result.documentId}/visual/${encodeURIComponent(result.visualAssetName||evidence.assetName)}`:null, tags:[evidenceType==="text"?"Text Evidence":evidenceType==="table"?"Table Evidence":"Visual Evidence",evidenceOrigin==="native"?"원문 추출":evidenceOrigin==="ocr"?"OCR 추출":"원문 + OCR",result.lowRelevance?"낮은 연관성":"매칭됨"] }}); }); }
function originalAction(doc){ const status=doc.sourceStatus||"unavailable"; const label=status==="cloud_available"?"MYBOX에서 원본 가져와 열기":status==="unavailable"?"원본 없음":"원본 열기"; return `<button class="open-source" data-open-original="${escape(doc.id)}" data-source-status="${escape(status)}" ${status==="unavailable"?"disabled":""}>${label} ${icons.arrow}</button>`; }
function resultCard({doc,unit}, i){ const evidenceText=unit.expanded?unit.text:unit.snippet; const highlighted=highlightEvidence(evidenceText,unit.matchedTerms); const toggle=unit.truncated?`<button class="evidence-toggle" type="button" data-evidence-expand="${escape(unit.evidenceId)}" aria-expanded="${unit.expanded}">${unit.expanded?"원문 접기":"원문 더 보기"}</button>`:""; return `<article class="result-card"><div class="rank">${String(i+1).padStart(2,"0")}</div><div class="result-main"><div class="doc-line"><span class="filetype ${(doc.type||"").toLowerCase()}">${escape(doc.type||"")}</span><span>${escape(doc.name||"")}</span><button class="dot-btn" aria-label="${escape(doc.name||"")} 추가 작업">${icons.more}</button></div><h3>${unit.type==="visual"?"시각 근거":unit.type==="table"?"표 셀 근거":"원문 근거"}</h3><p class="evidence-text">${highlighted}</p>${toggle}<div class="tags">${unit.tags.map((tag)=>`<span>${escape(tag)}</span>`).join("")}</div>${unit.visual?`<div class="visual-preview"><img src="${unit.visual}" alt="${escape(doc.name||"")} 시각 근거 미리보기"/><small>원본 시각 근거</small></div>`:""}<footer><div class="location"><span>근거 위치</span><b>${escape(unit.match)}</b><i></i><span>관련 범위 ${escape(unit.range)}</span></div><div class="score" title="검색 알고리즘이 산정한 상대적 지표입니다." aria-label="연관성 ${unit.score}점"><span>연관성 지표</span><b>${unit.score}</b><div><i style="width:${unit.score}%"></i></div></div></footer><div class="card-actions">${originalAction(doc)}<button class="feedback" data-feedback="${doc.id}" data-result-id="${unit.resultId||""}" data-unit-id="${unit.unitId||""}" data-rank="${unit.rank||i+1}" data-helpful="true">관련 있음 ${icons.check}</button><button class="feedback" data-feedback="${doc.id}" data-result-id="${unit.resultId||""}" data-unit-id="${unit.unitId||""}" data-rank="${unit.rank||i+1}" data-helpful="false">관련 없음</button></div></div></article>`; }
function searchPage(){ const results=formatResults(); const hasQuery=Boolean(state.query.trim()); const search=state.status?.search||state.status?.engines||{}; const warning=[search.fts||search.lexical,search.ann,search.semantic].filter(Boolean).some((value)=>value!=="healthy"); return `<main>${topbar("EVIDENCE SEARCH","무엇을 찾고 있나요?","등록한 문서에서 실제 근거와 위치를 찾아드려요.")} ${hasQuery?`<div class="query-bubble"><span>${escape(state.query)}</span></div>`:""}${warning?banner("검색 엔진 일부가 제한된 상태입니다. 가능한 경로의 결과를 계속 보여드립니다."):""}${!docs.length?`<div class="empty-state" data-onboarding-target="evidence-fallback" data-onboarding-fallback="true"><div>${icons.file}</div><h2>아직 등록된 문서가 없습니다</h2><p>문서를 등록하면 자연어로 필요한 실제 근거를 검색할 수 있습니다.</p><button class="primary" data-nav="add">문서 등록 시작</button></div>`:hasQuery&&!state.loading&&!results.length?`<div class="empty-state" data-onboarding-target="evidence-fallback" data-onboarding-fallback="true"><div>${icons.search}</div><h2>일치하는 근거가 없습니다</h2><p>다른 표현이나 문서 등록 상태를 확인해 보세요.</p></div>`:`<section class="result-head" data-onboarding-target="evidence-fallback"><div><p class="eyebrow">SEARCH RESULTS</p><h2><b>${results.length}</b>개의 근거를 찾았어요</h2></div><div class="search-status"><span class="good-dot"></span> ${state.loading?"검색 중":warning?"Local Search 제한됨":"Local Search 정상"}</div></section>${results.some((r)=>r.unit.tags.includes("낮은 연관성"))?banner("연관성이 낮은 결과도 실제 근거와 위치를 함께 표시합니다."):""}<div class="results">${results.map(resultCard).join("")}</div>`}<div class="search-composer" data-onboarding-target="search-composer" role="search"><label class="sr-only" for="query">문서 검색</label><div class="querybox"><span aria-hidden="true">${icons.spark}</span><input id="query" value="${escape(state.query)}" placeholder="예: DRT 도입을 검토한 자료 찾아줘"/><button id="run-search" aria-label="검색 실행">${icons.arrow}</button></div><div class="suggestions"><span>이렇게 물어보세요</span><button data-query="교통취약지역 선정 기준이 들어간 보고서">교통취약지역 선정 기준</button><button data-query="버스 이용객 감소 원인을 분석한 자료">버스 이용객 감소 원인</button></div></div></main>`; }
function jobCard(job){ const status=statusLabel[job.status]||job.status; const actions=job.status==="processing"?`<button data-job="pause" data-id="${job.id}">${icons.pause} 일시중지</button><button data-job="cancel" data-id="${job.id}">${icons.close} 취소</button>`:job.status==="queued"?`<button data-job="start" data-id="${job.id}">${icons.play} 지금 시작</button><button data-job="cancel" data-id="${job.id}">${icons.close} 대기 제거</button>`:job.status==="paused"?`<button data-job="resume" data-id="${job.id}">${icons.play} 재개</button><button data-job="cancel" data-id="${job.id}">${icons.close} 취소</button>`:job.status==="failed"?`<button data-job="retry" data-id="${job.id}">${icons.play} 재시도</button><button data-job="dismiss" data-id="${job.id}">${icons.close} 제거</button>`:""; return `<article class="job ${escape(job.status)}"><div class="job-top"><span class="job-state">${job.status==="processing"?"◌":job.status==="failed"?"!":job.status==="completed"?"✓":"Ⅱ"} ${status}</span><button class="dot-btn" aria-label="${escape(job.name)} 추가 작업">${icons.more}</button></div><h3>${escape(job.name)}</h3><p>${escape(job.kind||"registration")} · ${escape(job.mode||"lightweight")}</p><div class="job-progress"><div><b>${escape(job.detail||"")}</b><span>${job.progress??0}%</span></div><i><em style="width:${job.progress??0}%"></em></i></div>${actions?`<div class="job-actions">${actions}</div>`:""}</article>`; }
function addPage(){ const failed=state.jobs.filter((job)=>job.status==="failed").length; return `<main>${topbar("INGESTION","문서 등록","파일을 내부 저장소에 보관하고 페이지별 실제 텍스트를 로컬 색인에 추가합니다.")}${failed?banner(`${failed}개 작업이 실패했습니다. 작업 기록에서 원인을 확인하고 재처리하세요.`,"error"):""}<div class="split"><section class="upload-panel"><p class="eyebrow">NEW PROCESSING JOB</p><h2>무엇을 등록할까요?</h2><input id="file-input" type="file" multiple accept=".pdf,.pptx,.docx,.hwpx,.hwp" hidden/><div class="dropzone" data-onboarding-target="registration-dropzone"><div class="drop-icon" aria-hidden="true">${icons.add}</div><h3>지원 문서를 선택하세요</h3><p>PDF, PPTX, HWP, HWPX, DOCX · 최대 200 MB/파일</p><button class="secondary" id="choose-files">파일 선택</button></div><label class="field-label" for="mode-lightweight">처리 모드</label><div class="modes"><label class="mode selected"><input id="mode-lightweight" type="radio" checked value="lightweight" name="mode"/><span><b>경량 처리만</b><small>로컬 Parsing 및 페이지별 텍스트 색인</small></span><em>기본</em></label><label class="mode"><input type="radio" value="local-ai" name="mode"/><span><b>Local AI 허용</b><small>로컬 모델을 사용할 수 있습니다.</small></span></label><label class="mode external"><input type="radio" value="external-ai" name="mode"/><span><b>External AI 허용</b><small>실행 전에 외부 전송 범위를 안내합니다.</small></span></label></div><button class="primary wide" id="create-job">선택 파일 등록 ${icons.arrow}</button></section><section class="queue-panel"><div class="section-title"><div><p class="eyebrow">PROCESSING QUEUE</p><h2>처리 현황 <b>${state.jobs.length}</b></h2></div><span class="queue-state">${activeJobs().length?`${activeJobs().length}개 진행 중`:"대기 없음"}</span></div>${state.jobs.length?state.jobs.map(jobCard).join(""):"<div class=\"empty-state\"><div>✓</div><h2>처리 대기열이 비어 있습니다</h2><p>문서를 등록하면 여기에 작업 진행 상황이 표시됩니다.</p></div>"}<div class="queue-note"><span aria-hidden="true">i</span><p>추출에 성공한 페이지는 Text Evidence와 정확한 페이지 번호를 보존해 검색합니다.</p></div></section></div></main>`; }
function documentsPage(){ const partial=docs.filter((doc)=>doc.processingStatus==="partial").length; return `<main>${topbar("LIBRARY","문서 관리",`${docs.length}개 문서 · 로컬 저장소`,`<button class="primary" data-nav="add">${icons.add} 문서 등록</button>`)}${partial?banner(`${partial}개 문서가 부분 완료 상태입니다. 실패한 단위만 재처리할 수 있습니다.`):""}<div class="toolbar"><div class="mini-search">⌕ <label class="sr-only" for="doc-filter">문서 검색</label><input id="doc-filter" placeholder="파일명 또는 메타데이터 검색..."/></div><button>상태: 전체⌄</button><span></span><button>정렬: 최근 등록순⌄</button></div>${docs.length?`<section class="doc-table" aria-label="문서 목록"><div class="table-head"><span>문서</span><span>처리 상태</span><span>원본 상태</span><span>등록일</span><span>작업</span></div>${docs.map((doc)=>`<article class="doc-row"><div class="doc-name"><span class="filetype ${doc.type.toLowerCase()}">${escape(doc.type)}</span><div><b>${escape(doc.name)}</b><small>${doc.pages||0} 페이지 · ${escape(doc.ocrStatus||"OCR 상태 확인 중")}</small></div></div><span class="status ${doc.processingStatus==="partial"?"partial":"complete"}">${doc.processingStatus==="partial"?"! 부분 완료":"✓ 완료"}</span><span class="source ${doc.source==="사용 가능"?"available":"missing"}">${doc.source==="사용 가능"?"● 사용 가능":"○ 원본 누락"}</span><span>${escape(doc.date||"-")}</span><div class="row-actions"><button data-reprocess="${doc.id}">재처리</button><button data-delete="${doc.id}" class="delete">삭제</button></div></article>`).join("")}</section>`:`<div class="empty-state"><div>${icons.file}</div><h2>등록된 문서가 없습니다</h2><p>문서를 등록하면 로컬 검색 인덱스를 생성합니다.</p><button class="primary" data-nav="add">문서 등록 시작</button></div>`}<div class="details-card"><div><p class="eyebrow">STORAGE & INTEGRITY</p><h3>검색 데이터 상태</h3><p>원문 기반 Evidence와 페이지 Provenance를 로컬 저장소에 보존합니다.</p></div><button class="secondary" data-toast="저장소 상태를 확인했습니다">상세 확인</button></div></main>`; }
function settingsPage(){ const lock=activeJobs().length>0||state.status?.maintenance; const backups=state.mybox?.backups||[]; return `<main>${topbar("SETTINGS & OPERATIONS","설정 · 운영","저장소, AI 처리, 백업과 보안을 관리합니다.")}<div class="settings-grid"><section class="settings-card span2"><p class="eyebrow">LOCAL STORAGE</p><h2>내부 저장소</h2><div class="path"><span>▰</span><code>${escape(state.status?.dataDirectory||"확인 중")}</code></div><p class="muted">등록된 원본과 검색 데이터는 이 영구 로컬 저장소에서 관리됩니다.</p><input id="storage-target" class="backup-input" placeholder="이전할 새 폴더의 절대 경로"/><button class="secondary" id="migrate-storage">저장소 이전</button></section><section class="settings-card"><p class="eyebrow">AI DEFAULT</p><h2>기본 처리 모드</h2><div class="select-row"><b>경량 처리만</b><span>⌄</span></div><p class="muted">AI 없이도 핵심 검색 기능이 동작합니다.</p></section><section class="settings-card"><p class="eyebrow">RETRIEVAL</p><h2>검색 엔진 상태</h2><div class="engine"><span class="good-dot"></span><b>로컬 Vector Search</b><em>${state.status?.engines?.evidence||"확인 중"}</em></div><div class="engine"><span class="good-dot"></span><b>로컬 FTS</b><em>${state.status?.engines?.lexical||"확인 중"}</em></div></section><section class="settings-card span2"><p class="eyebrow">MYBOX CLOUD BACKUP</p><h2>원본 포함 MYBOX 백업</h2><p class="muted">사내 전용 설치판입니다. 설치 파일에 MYBOX 토큰이 포함되므로 설치 파일 외부 반출을 금지하고, 토큰 유출이 의심되면 즉시 폐기·재발급하세요.</p><p class="muted">문서 검색 데이터와 원본 파일을 함께 포함한 평문 백업입니다. 민감한 문서가 업로드될 수 있습니다.</p><div class="engine"><span class="${state.mybox?.connected?"good-dot":"bad-dot"}"></span><b>MYBOX 연결 상태</b><em>${state.mybox?.connected?"연결됨":"연결 안 됨"}</em></div><select id="mybox-backup-select" class="backup-input" ${backups.length?"":"disabled"}><option value="">${backups.length?"다운로드할 백업을 선택하세요":"MYBOX 백업이 없습니다"}</option>${backups.map((item)=>`<option value="${escape(item.resourceId)}">${escape(item.name)} · ${escape(item.modifiedAt||"")}</option>`).join("")}</select><div class="maintenance-actions"><button class="primary ${lock?"disabled":""}" id="mybox-upload">MYBOX에 원본+검색 DB 백업 업로드</button><button class="secondary ${lock||!backups.length?"disabled":""}" id="mybox-download">MYBOX에서 검색 DB만 동기화</button></div>${lock?`<div class="blocked" role="status">! 현재 처리 Queue 또는 Maintenance 작업이 끝날 때까지 시작할 수 없습니다.</div>`:""}</section><section class="settings-card"><p class="eyebrow">SYNONYMS</p><h2>동의어 · 약어</h2><input id="synonym-term" class="backup-input" aria-label="기준어" placeholder="기준어 (예: 결제)"/><input id="synonym-aliases" class="backup-input" aria-label="동의어를 쉼표로 구분" placeholder="동의어를 쉼표로 구분"/><button class="secondary" id="save-synonym">검색 확장어 저장</button><div id="synonym-list" class="muted" aria-live="polite">불러오는 중…</div></section><section class="settings-card"><p class="eyebrow">AUDIT</p><h2>최근 작업 기록</h2><div id="audit-list" class="muted" aria-live="polite">불러오는 중…</div></section><section class="settings-card danger"><p class="eyebrow">DATA</p><h2>전체 문서 데이터 삭제</h2><p class="muted">문서, 검색 데이터, 내부 원본을 영구 제거합니다.</p><input id="delete-confirmation" class="backup-input" aria-label="삭제 확인 문구" placeholder="DELETE ALL DOCUMENTS"/><button class="danger-btn ${lock?"disabled":""}" id="delete-all-data">전체 데이터 영구 삭제</button></section></div></main>`; }
function documentsPageV2(){ const partial=docs.filter((doc)=>doc.processingStatus==="partial").length; return `<main>${topbar("LIBRARY","문서 관리",`${docs.length}개 문서 · 로컬 저장소`,`<button class="primary" data-nav="add">${icons.add} 문서 등록</button>`)}${partial?banner(`${partial}개 문서가 부분 완료 상태입니다. 실패한 단위만 재처리할 수 있습니다.`):""}<div class="toolbar"><div class="mini-search">⌕ <label class="sr-only" for="doc-filter">문서 검색</label><input id="doc-filter" placeholder="파일명 또는 메타데이터 검색..."/></div><button>상태: 전체⌄</button><span></span><button>정렬: 최근 등록순⌄</button></div>${docs.length?`<section class="doc-table" aria-label="문서 목록"><div class="table-head"><span>문서</span><span>처리 상태</span><span>원본 상태</span><span>등록일</span><span>작업</span></div>${docs.map((doc)=>{ const local=doc.sourceStatus==="local_available"||doc.sourceStatus==="available"; const cloud=doc.sourceStatus==="cloud_available"; return `<article class="doc-row"><div class="doc-name"><span class="filetype ${doc.type.toLowerCase()}">${escape(doc.type)}</span><div><b>${escape(doc.name)}</b><small>${doc.pages||0} 페이지 · ${escape(doc.ocrStatus||"OCR 상태 확인 중")}</small></div></div><span class="status ${doc.processingStatus==="partial"?"partial":"complete"}">${doc.processingStatus==="partial"?"! 부분 완료":"✓ 완료"}</span><span class="source ${local?"available":cloud?"cloud":"missing"}">${local?"● 로컬 원본 있음":cloud?"☁ MYBOX 원본 있음":"○ 원본 없음"}</span><span>${escape(doc.date||"-")}</span><div class="row-actions"><button data-reprocess="${doc.id}">재처리</button><button data-delete="${doc.id}" class="delete">삭제</button></div></article>`; }).join("")}</section>`:`<div class="empty-state"><div>${icons.file}</div><h2>등록된 문서가 없습니다</h2><p>문서를 등록하면 로컬 검색 인덱스를 생성합니다.</p><button class="primary" data-nav="add">문서 등록 시작</button></div>`}<div class="details-card"><div><p class="eyebrow">STORAGE & INTEGRITY</p><h3>검색 데이터 상태</h3><p>원문 기반 Evidence와 페이지 Provenance를 로컬 저장소에 보존합니다.</p></div><button class="secondary" data-toast="저장소 상태를 확인했습니다">상세 확인</button></div></main>`; }
function settingsPageV2(){ const lock=activeJobs().length>0||state.status?.maintenance; const sync=state.mybox?.sync||{state:"idle",message:""}; const syncLabel={idle:"대기",syncing:"동기화 중",succeeded:"동기화 완료",failed:"동기화 실패"}[sync.state]||sync.state; const defaultMode=currentDefaultMode(); const external=externalStatus(); const enabled=state.externalAiToggleDraft??Boolean(external.enabled||defaultMode==="external-ai"); const modelId=externalModelId(); const warning=externalWarningText(); const connection=state.geminiConnectionStatus||external.lastConnection||{}; const connectionText=connection.status==="ready"?"연결됨":connection.status==="failed"?"연결 실패":"확인 필요"; const models=state.geminiModelsLoaded?state.geminiModels:[]; return `<main>${topbar("SETTINGS & OPERATIONS","설정 · 운영","저장소, AI 처리, 백업과 보안을 관리합니다.")}<div class="settings-grid"><section class="settings-card span2"><p class="eyebrow">LOCAL STORAGE</p><h2>내부 저장소</h2><div class="path"><span>▰</span><code>${escape(state.status?.dataDirectory||"확인 중")}</code></div><p class="muted">등록된 원본과 검색 데이터는 이 영구 로컬 저장소에서 관리됩니다.</p><input id="storage-target" class="backup-input" placeholder="이전할 새 폴더의 절대 경로"/><button class="secondary" id="migrate-storage">저장소 이전</button></section><section class="settings-card" data-onboarding-target="processing-mode"><p class="eyebrow">AI DEFAULT</p><h2>기본 처리 모드</h2><fieldset class="processing-default-options" aria-label="기본 처리 모드"><legend class="sr-only">기본 처리 모드</legend><label class="mode"><input id="default-processing-mode-installed" type="radio" name="default-processing-mode" value="installed-model" ${defaultMode==="installed-model"?"checked":""}/><span><b>설치된 모델 사용</b><small>설치된 로컬 모델을 우선 사용하고 준비되지 않으면 경량 처리로 진행합니다.</small></span></label><label class="mode external"><input id="default-processing-mode-external" type="radio" name="default-processing-mode" value="external-ai" ${defaultMode==="external-ai"?"checked":""}/><span><b>외부 AI 사용</b><small>Gemini를 우선 사용하고 준비되지 않으면 로컬 모델, 경량 처리 순으로 진행합니다.</small></span></label></fieldset><p class="muted processing-mode-note">${defaultMode==="external-ai"?"외부 AI가 새 작업의 기본 처리 모드입니다.":"설치된 로컬 모델을 사용하며, 준비되지 않으면 경량 처리로 진행합니다."}</p></section><section class="settings-card span2 external-ai-settings"><p class="eyebrow">EXTERNAL AI</p><h2>Gemini 설정</h2><p class="muted">문서 전처리 보조와 검색 보조 색인에만 사용합니다. 전체 원본 파일은 전송하지 않습니다.</p><div class="engine"><span class="${enabled&&external.ready?"good-dot":"bad-dot"}"></span><b>제공자 Gemini</b><em>${enabled?(external.ready?"준비됨":"준비 필요"):"사용 안 함"}</em></div><label class="toggle-row" for="external-ai-enabled"><input id="external-ai-enabled" type="checkbox" ${enabled?"checked":""}/><span>외부 AI 사용 ON/OFF</span></label><div class="external-ai-fields"><label class="field-label" for="gemini-api-key">Gemini API Key</label><input id="gemini-api-key" class="backup-input" type="password" autocomplete="off" aria-describedby="gemini-key-help" placeholder="이 PC에 암호화하여 저장할 Key"/><p id="gemini-key-help" class="muted">Key는 화면에 다시 표시하지 않으며, 저장·삭제는 이 PC에서만 수행합니다.</p><div class="maintenance-actions"><button class="secondary" id="save-gemini-key">Key 저장</button><button class="secondary" id="clear-gemini-key">저장된 Key 삭제</button></div></div><div class="model-row"><label class="field-label" for="gemini-model">Gemini 모델</label><select id="gemini-model" class="backup-input"><option value="">${modelId?escape(modelId):"모델을 새로고침해 선택하세요"}</option>${models.filter((model)=>model?.supportsGenerateContent!==false).map((model)=>`<option value="${escape(model.id)}" ${model.id===modelId?"selected":""}>${escape(model.displayName||model.id)}</option>`).join("")}</select><button class="secondary" id="refresh-gemini-models">모델 목록 새로고침</button></div><div class="connection-row"><button class="secondary" id="check-gemini-connection">연결 확인</button><p id="gemini-connection-status" class="muted" role="status">${connectionText}</p></div>${warning?`<div id="data-gemini-warning" class="blocked" role="status">${escape(warning)} 실제 작업은 설치된 모델, 경량 처리 순으로 진행됩니다.</div>`:`<div id="data-gemini-warning" class="blocked" role="status" hidden>Gemini 준비 상태를 확인하세요.</div>`}${!enabled?`<p class="muted external-off-warning" role="status">외부 AI를 끄면 신규 작업부터 외부 처리가 차단됩니다. 이미 등록된 큐 작업에는 영향이 없습니다.</p>`:""}</section><section class="settings-card"><p class="eyebrow">RETRIEVAL</p><h2>검색 엔진 상태</h2><div class="engine"><span class="good-dot"></span><b>로컬 Vector Search</b><em>${state.status?.engines?.evidence||"확인 중"}</em></div><div class="engine"><span class="good-dot"></span><b>로컬 FTS</b><em>${state.status?.engines?.lexical||"확인 중"}</em></div></section><section class="settings-card span2" data-onboarding-target="mybox"><p class="eyebrow">MYBOX CLOUD</p><h2>MYBOX 검색 DB 동기화</h2><p class="muted">최초로 비어 있는 로컬 저장소를 시작할 때만 자동 동기화합니다. 이후에는 이 버튼으로 <code>weki/knowledge-base.json</code>만 가져옵니다.</p><p class="muted">검색 DB와 원본 다운로드를 분리합니다. 검색은 로컬 색인을 사용하고, 원본은 검색 결과의 원본 열기 시 필요한 파일만 MYBOX에서 가져옵니다.</p><div class="engine"><span class="${state.mybox?.connected?"good-dot":"bad-dot"}"></span><b>MYBOX 연결 상태</b><em>${state.mybox?.connected?"연결됨":"연결 안 됨"}</em></div><div class="engine" aria-live="polite"><span class="${sync.state==="failed"?"bad-dot":sync.state==="syncing"?"pulse":"good-dot"}"></span><b>검색 DB 동기화 상태</b><em>${escape(syncLabel)}</em></div>${sync.message?`<p class="muted" role="status">${escape(sync.message)}</p>`:""}<div class="maintenance-actions"><button class="primary ${lock?"disabled":""}" id="mybox-upload">MYBOX에 백업 업로드</button><button class="secondary ${lock?"disabled":""}" id="mybox-sync">MYBOX 검색 DB 동기화</button></div>${lock?`<div class="blocked" role="status">! 현재 처리 Queue 또는 Maintenance 작업이 끝날 때까지 시작할 수 없습니다.</div>`:""}</section><section class="settings-card"><p class="eyebrow">SYNONYMS</p><h2>동의어 · 약어</h2><input id="synonym-term" class="backup-input" aria-label="기준어" placeholder="기준어 (예: 결제)"/><input id="synonym-aliases" class="backup-input" aria-label="동의어와 약어" placeholder="동의어를 쉼표로 구분"/><button class="secondary" id="save-synonym">검색 확장어 저장</button><div id="synonym-list" class="muted" aria-live="polite">불러오는 중…</div></section><section class="settings-card"><p class="eyebrow">AUDIT</p><h2>최근 작업 기록</h2><div id="audit-list" class="muted" aria-live="polite">불러오는 중…</div></section><section class="settings-card danger"><p class="eyebrow">DATA</p><h2>전체 문서 데이터 삭제</h2><p class="muted">문서, 검색 데이터, 내부 원본을 영구 제거합니다.</p><input id="delete-confirmation" class="backup-input" aria-label="삭제 확인 문구" placeholder="DELETE ALL DOCUMENTS"/><button class="danger-btn ${lock?"disabled":""}" id="delete-all-data">전체 데이터 영구 삭제</button></section></div></main>`; }
function dialog(){ if(!state.dialog)return ""; return `<div class="dialog-backdrop" data-dialog-backdrop><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1"><h2 id="dialog-title">${escape(state.dialog.title)}</h2><p>${escape(state.dialog.message)}</p><div class="dialog-actions"><button class="secondary" data-dialog-cancel>취소</button><button class="danger-btn" data-dialog-confirm>계속</button></div></section></div>`; }
function updateStorageHelpCopy(){ if(state.page!=="settings")return; const localCopy=document.querySelector('.settings-card.span2:not(#runtime-components-card):not(.external-ai-settings):not([data-onboarding-target="mybox"]) p.muted'); const myboxCopy=document.querySelector('[data-onboarding-target="mybox"] p.muted'); if(localCopy)localCopy.textContent="설치 폴더 옆 data 또는 선택한 저장소에 knowledge-base.json과 실제 원본 파일을 보관합니다. 설치 폴더에 쓸 수 없으면 관리자 권한 허용 여부를 먼저 묻습니다."; if(myboxCopy)myboxCopy.textContent=myboxLayoutHelp+" MYBOX 검색 DB 동기화는 knowledge-base.json만 내려받고, 원본은 원본 열기 시 필요한 파일만 가져옵니다."; }
document.addEventListener("click", async (event) => {
  const button = event.target.closest?.("[data-result-id]");
  if (!button || !state.searchSessionId) return;
  event.stopImmediatePropagation();
  const response = await fetch("/api/v2/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    sessionId: state.searchSessionId, resultId: button.dataset.resultId, unitId: button.dataset.unitId, rank: Number(button.dataset.rank) || 0,
    rankingVersion: state.rankingVersion, helpful: button.dataset.helpful !== "false",
  }) });
  state.toast = response.ok ? "검색 피드백을 기록했어요" : "피드백 기록에 실패했습니다.";
  render();
}, true);
function migrationNotice(){ const migration=state.status?.search?.migration; if(!migration||migration.status==="ready")return ""; const label=migration.status==="failed"?"검색 색인 이관 중 일부 항목이 실패했습니다.":"기존 검색 데이터를 새 검색 색인으로 이관 중입니다."; return `<div class="toast" role="status">${escape(label)} (${migration.completed||0}/${migration.total||0})</div>`; }
function render(){ const views={search:searchPage,add:addPage,documents:documentsPageV2,settings:settingsPageV2}; document.querySelector("#app").innerHTML=`<div class="app-shell">${nav()}${shellHeader()}${views[state.page]()}${migrationNotice()}${state.toast?`<div class="toast" role="status">${escape(state.toast)}<button data-close-toast aria-label="알림 닫기">×</button></div>`:""}${dialog()}</div>`; updateStorageHelpCopy(); bind(); if(state.page==="settings"){ wireOperations(); wireMybox(); } }
async function refresh(){ const shouldFetchMybox=!state.myboxLoaded||state.page==="settings"; const shouldFetchSettings=state.page==="settings"||state.page==="add"; const requests=[fetch("/api/documents"),fetch("/api/jobs"),fetch("/api/status")]; if(shouldFetchMybox)requests.push(fetch("/api/mybox/status")); if(shouldFetchSettings)requests.push(fetch("/api/settings")); const responses=await Promise.all(requests); const docData=await responses[0].json(), jobData=await responses[1].json(); state.status=await responses[2].json(); let responseIndex=3; if(shouldFetchMybox){state.mybox=await responses[responseIndex++].json();state.myboxLoaded=true;} if(shouldFetchSettings){const settingsData=await responses[responseIndex].json();state.settings=settingsData.settings||state.settings; if(settingsData.processing)state.status={...(state.status||{}),processing:settingsData.processing};} const semantic=state.status.search?.semantic; if(semantic&&typeof semantic==="object"){state.status.search.semanticDetails=semantic;state.status.search.semantic=semantic.status;} docs=docData.documents.map((doc)=>({...doc,type:doc.format,source:sourceStatusLabel(doc.sourceStatus),date:doc.registeredAt?new Date(doc.registeredAt).toLocaleDateString("ko-KR"):"-"})); state.jobs=jobData.jobs.slice(0,20); }
async function runSearch(loadMore=false){ const input=document.querySelector("#query"), query=input?.value.trim()||state.query; if(!query)return; if(!loadMore){state.searchCursor=null;state.searchHasMore=false;state.expandedEvidence.clear();} state.searchAbortController?.abort(); const controller=new AbortController(); state.searchAbortController=controller; state.query=query; state.loading=true; render(); try{ const pagination=loadMore?{sessionId:state.searchSessionId,cursor:state.searchCursor}:{}; const response=await fetch("/api/v2/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query,...pagination}),signal:controller.signal}); const data=await response.json(); state.searchSessionId=data.sessionId||state.searchSessionId; state.rankingVersion=data.rankingVersion||state.rankingVersion; const nextResults=(data.results||[]).map((row)=>({...row,fileName:row.documentName,score:row.relevanceScore,displayScore:row.displayScore,snippet:row.matchedEvidence?.snippet,text:row.matchedEvidence?.context,matchedTerms:row.matchedEvidence?.matchedTerms,truncated:row.matchedEvidence?.truncated,matchedPage:row.matchedEvidence?.pageStart,evidenceType:row.matchedEvidence?.type,evidenceOrigin:row.matchedEvidence?.origin,visualAssetName:row.matchedEvidence?.assetName})); state.apiResults=loadMore?[...state.apiResults,...nextResults]:nextResults; state.searchCursor=data.nextCursor||null; state.searchHasMore=Boolean(data.hasMore); state.toast=data.expansions?.length?`검색 확장: ${data.expansions.join(", ")}`:""; }catch(error){if(error.name!=="AbortError"){if(!loadMore)state.apiResults=[];state.toast="검색에 실패했습니다. 로컬 저장소 상태를 확인해 주세요.";}} finally{if(state.searchAbortController===controller){state.searchAbortController=null;state.loading=false;render();}} }
async function uploadFiles(){ const input=document.querySelector("#file-input"); if(!input?.files?.length){state.toast="등록할 파일을 먼저 선택해 주세요.";render();return;} const mode=document.querySelector('input[name="mode"]:checked')?.value||"lightweight"; const form=new FormData(); [...input.files].forEach((file)=>form.append("files",file));form.append("mode",mode);state.toast="문서를 처리 대기열에 추가하는 중…";render();try{const response=await fetch("/api/documents",{method:"POST",body:form});const data=await response.json();state.toast=response.ok?"문서를 처리 대기열에 추가했습니다.":data.error||"문서 등록에 실패했습니다.";await refresh();}catch{state.toast="문서 등록 중 네트워크 오류가 발생했습니다.";}render();}
async function restartApp(){ state.toast="Weki를 다시 시작하는 중입니다…"; render(); try{if(window.wekiApp?.restart){await window.wekiApp.restart();return;} location.reload();}catch{state.toast="자동 재시작을 실행하지 못했습니다. 창을 닫고 Weki를 다시 열어 주세요.";render();} }
function openDialog(title,message,onConfirm,onCancel){state.dialog={title,message,onConfirm,onCancel};render();document.querySelector(".dialog")?.focus();}
async function confirmDialogAction(){const action=state.dialog?.onConfirm;state.dialog=null;render();try{await action?.();}catch(error){state.toast=error.message||"작업에 실패했습니다.";}finally{render();}}
document.addEventListener("click",(event)=>{if(event.target.closest("#restart-app"))void restartApp();});
document.addEventListener("click",(event)=>{if(event.target.closest("[data-runtime-install]"))startRuntimePolling();});
function bind(){ document.querySelector("[data-onboarding-replay]")?.addEventListener("click",()=>void onboardingController?.start({replay:true})); document.querySelectorAll("[data-nav]").forEach((el)=>el.onclick=async()=>{state.page=el.dataset.nav;await refresh().catch(()=>{});render()});document.querySelectorAll("[data-query]").forEach((el)=>el.onclick=async()=>{state.query=el.dataset.query;await runSearch()});document.querySelector("#run-search")?.addEventListener("click",runSearch);document.querySelector("#query")?.addEventListener("keydown",(event)=>{if(event.key==="Enter")runSearch()});document.querySelector("#choose-files")?.addEventListener("click",()=>document.querySelector("#file-input")?.click());document.querySelector("#create-job")?.addEventListener("click",uploadFiles);document.querySelectorAll("[data-close-toast]").forEach((el)=>el.onclick=()=>{state.toast="";render()});document.querySelectorAll("[data-toast]").forEach((el)=>el.onclick=()=>{state.toast=el.dataset.toast;render()});document.querySelectorAll("[data-feedback]").forEach((el)=>el.onclick=async()=>{const response=await fetch("/api/feedback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:state.query,documentId:el.dataset.feedback,helpful:el.dataset.helpful!=="false"})});state.toast=response.ok?"검색 피드백을 기록했어요":"피드백 기록에 실패했습니다.";render()});document.querySelectorAll("[data-job]").forEach((el)=>el.onclick=async()=>{const response=await fetch(`/api/jobs/${el.dataset.id}/action`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:el.dataset.job})});state.toast=response.ok?"작업 상태를 업데이트했습니다.":"작업 상태를 업데이트하지 못했습니다.";await refresh();render()});document.querySelectorAll("[data-reprocess]").forEach((el)=>el.onclick=async()=>{const response=await fetch(`/api/documents/${el.dataset.reprocess}/reprocess`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"lightweight"})});state.toast=response.ok?"기존 검색 결과를 유지한 채 재처리 작업을 시작했습니다.":"재처리를 시작하지 못했습니다.";await refresh();render()});document.querySelectorAll("[data-delete]").forEach((el)=>el.onclick=()=>openDialog("문서를 삭제할까요?","문서와 검색 데이터가 삭제됩니다. 처리 중인 문서는 삭제할 수 없습니다.",async()=>{await fetch(`/api/documents/${el.dataset.delete}`,{method:"DELETE"});state.dialog=null;await refresh();state.toast="문서와 검색 데이터가 삭제되었습니다.";render()}));document.querySelector("#delete-all-data")?.addEventListener("click",()=>{const confirmation=document.querySelector("#delete-confirmation")?.value||"";if(confirmation!=="DELETE ALL DOCUMENTS"){state.toast="확인 문구가 일치하지 않습니다.";render();return;}openDialog("전체 데이터를 영구 삭제할까요?","문서·검색 데이터·내부 원본을 모두 제거하며 되돌릴 수 없습니다.",async()=>{const response=await fetch("/api/data",{method:"DELETE",headers:{"x-weki-confirmation":confirmation}});if(!response.ok)throw new Error("전체 데이터 삭제에 실패했습니다.");state.toast="전체 문서 데이터가 삭제되었습니다.";await refresh().catch(()=>{});})});document.querySelector("[data-dialog-cancel]")?.addEventListener("click",()=>{state.dialog=null;render()});document.querySelector("[data-dialog-confirm]")?.addEventListener("click",()=>void confirmDialogAction());document.querySelector("[data-dialog-backdrop]")?.addEventListener("click",(event)=>{if(event.target===event.currentTarget){state.dialog=null;render()}}); }
async function wireOperations(){ const synonymList=document.querySelector("#synonym-list"),auditList=document.querySelector("#audit-list");try{const data=await (await fetch("/api/synonyms")).json();if(synonymList)synonymList.innerHTML=data.entries.length?data.entries.map((entry)=>`<div>${escape(entry.term)} → ${escape(entry.aliases.join(", "))} <button data-remove-synonym="${entry.id}" aria-label="${escape(entry.term)} 삭제">삭제</button></div>`).join(""):"등록된 검색 확장어가 없습니다.";document.querySelectorAll("[data-remove-synonym]").forEach((el)=>el.onclick=async()=>{await fetch(`/api/synonyms/${el.dataset.removeSynonym}`,{method:"DELETE"});wireOperations()})}catch{if(synonymList)synonymList.textContent="동의어 목록을 불러오지 못했습니다."}try{const data=await (await fetch("/api/audit")).json();if(auditList)auditList.innerHTML=data.entries.length?data.entries.slice(0,8).map((entry)=>`<div>${new Date(entry.createdAt).toLocaleString("ko-KR")} · ${escape(entry.type)} · ${escape(entry.detail)}</div>`).join(""):"기록이 없습니다."}catch{if(auditList)auditList.textContent="작업 기록을 불러오지 못했습니다."}document.querySelector("#save-synonym")?.addEventListener("click",async()=>{const term=document.querySelector("#synonym-term")?.value||"",aliases=(document.querySelector("#synonym-aliases")?.value||"").split(",").map((item)=>item.trim()).filter(Boolean),response=await fetch("/api/synonyms",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({term,aliases})}),data=await response.json();state.toast=response.ok?"검색 확장어를 저장했습니다.":data.error;render()})}
document.addEventListener("click",(event)=>{const button=event.target.closest?.("[data-evidence-expand]");if(!button)return;const id=button.dataset.evidenceExpand;if(state.expandedEvidence.has(id))state.expandedEvidence.delete(id);else state.expandedEvidence.add(id);render()});
async function syncSynonymControls(){
  if(state.page!=="settings")return;
  const list=document.querySelector("#synonym-list"); if(!list)return;
  try{
    const [entriesResponse,suggestionsResponse]=await Promise.all([fetch("/api/synonyms"),fetch("/api/synonyms/suggestions")]);
    const entries=(await entriesResponse.json()).entries||[], suggestions=(await suggestionsResponse.json()).suggestions||[];
    const statusLabel={approved:"적용 중",draft:"승인 대기",rejected:"거절됨"};
    list.innerHTML=`${entries.length?entries.map((entry)=>`<div class="synonym-entry"><span><b>${escape(entry.term)}</b> → ${escape(entry.aliases.join(", "))}</span><small>${statusLabel[entry.status]||entry.status||"적용 중"}</small>${entry.status==="draft"?`<button data-approve-synonym="${escape(entry.id)}">승인</button><button data-reject-synonym="${escape(entry.id)}">거절</button>`:`<button data-remove-synonym="${escape(entry.id)}" aria-label="${escape(entry.term)} 삭제">삭제</button>`}</div>`).join(""):"등록된 검색 확장어가 없습니다."}${suggestions.length?`<div class="synonym-suggestions"><b>자동 추천 후보</b>${suggestions.map((item)=>`<div>${escape(item.term)} → ${escape(item.aliases.join(", "))}<button data-save-suggestion-term="${escape(item.term)}" data-save-suggestion-aliases="${escape(item.aliases.join(","))}">후보 저장</button></div>`).join("")}</div>`:""}`;
  }catch{list.textContent="동의어 목록을 불러오지 못했습니다.";}
}
document.addEventListener("click",async(event)=>{
  if(event.target.closest('[data-nav="settings"]'))setTimeout(syncSynonymControls,250);
  const approve=event.target.closest("[data-approve-synonym]"), reject=event.target.closest("[data-reject-synonym]");
  if(approve||reject){const id=(approve||reject).dataset.approveSynonym||(approve||reject).dataset.rejectSynonym;const response=await fetch(`/api/synonyms/${encodeURIComponent(id)}/decision`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:approve?"approved":"rejected"})});state.toast=response.ok?(approve?"동의어 추천을 승인했습니다.":"동의어 추천을 거절했습니다."):"동의어 추천 상태를 변경하지 못했습니다.";await syncSynonymControls();render();return;}
  const save=event.target.closest("[data-save-suggestion-term]");
  if(save){const response=await fetch("/api/synonyms/suggestions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({term:save.dataset.saveSuggestionTerm,aliases:save.dataset.saveSuggestionAliases.split(",")})});state.toast=response.ok?"추천 후보를 승인 대기 목록에 추가했습니다.":"추천 후보 저장에 실패했습니다.";await syncSynonymControls();render();}
});
async function legacyWireMybox(){
  const select=document.querySelector("#mybox-backup-select"),upload=document.querySelector("#mybox-upload"),download=document.querySelector("#mybox-download"),migrate=document.querySelector("#migrate-storage");
  try{
    const response=await fetch("/api/mybox/backups");
    const data=await response.json();
    state.mybox.backups=data.backups||[];
    if(select){
      select.disabled=!state.mybox.backups.length;
      select.innerHTML=state.mybox.backups.length?`<option value="">다운로드할 백업을 선택하세요</option>${state.mybox.backups.map((item)=>`<option value="${escape(item.resourceId)}">${escape(item.name)} · ${escape(item.modifiedAt||"")}</option>`).join("")}`:"<option value=\"\">MYBOX 백업이 없습니다</option>";
    }
  }catch{
    state.mybox.backups=[];
    if(select)select.innerHTML="<option value=\"\">MYBOX 백업 목록을 불러오지 못했습니다</option>";
  }
  const blocked=(element)=>element?.classList.contains("disabled");
  upload?.addEventListener("click",()=>{
    if(blocked(upload)){state.toast="Queue가 비어 있어야 MYBOX 백업을 시작할 수 있습니다.";render();return;}
    openDialog("원본 포함 평문 백업을 업로드할까요?","문서 검색 데이터와 원본 파일이 평문으로 MYBOX에 업로드됩니다.",async()=>{
      const response=await fetch("/api/mybox/upload",{method:"POST"});
      const data=await response.json();
      state.dialog=null;state.toast=response.ok?`${data.documents}개 문서를 MYBOX에 업로드했습니다.`:data.error||"MYBOX 업로드에 실패했습니다.";
      await refresh();render();
    });
  });
  download?.addEventListener("click",async()=>{
    if(blocked(download)){state.toast="Queue가 비어 있어야 MYBOX 복원을 시작할 수 있습니다.";render();return;}
    const resourceId=select?.value;
    if(!resourceId){state.toast="다운로드할 MYBOX 백업을 선택해 주세요.";render();return;}
    openDialog("MYBOX 백업을 병합할까요?","선택한 원본 포함 백업을 현재 로컬 문서와 Hash 기준으로 병합합니다. 서로 다른 문서는 모두 유지됩니다.",async()=>{
      const response=await fetch("/api/mybox/download",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({resourceId})});
      const data=await response.json();
      state.dialog=null;state.toast=response.ok?`${data.documents}개 문서를 병합했습니다.`:data.error||"MYBOX 다운로드에 실패했습니다.";
      await refresh();render();
    });
  });
  migrate?.addEventListener("click",async()=>{
    const targetPath=document.querySelector("#storage-target")?.value.trim();
    if(!targetPath){state.toast="이전할 새 폴더의 절대 경로를 입력해 주세요.";render();return;}
    const response=await fetch("/api/storage/migrate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({targetPath})});
    const data=await response.json();
    state.toast=response.ok?(data.sourceCleanupPending?"저장소를 이전했습니다. 앱을 재시작하면 이전 저장소의 잠긴 런타임도 정리합니다.":data.sourceRemoved?"저장소를 이전하고 기존 Weki 저장소를 정리했습니다. 앱을 재시작하면 새 위치를 사용합니다.":"저장소를 이전했지만 기존 폴더에 사용자 파일이 남아 있어 폴더 자체는 보존했습니다. 앱을 재시작하면 새 위치를 사용합니다."):data.error||"저장소 이전에 실패했습니다.";
    render();
  });
}
async function wireMyboxV2(){
  const upload=document.querySelector("#mybox-upload"), sync=document.querySelector("#mybox-sync"), migrate=document.querySelector("#migrate-storage");
  if(upload) upload.textContent="MYBOX에 원본+검색 DB 백업 업로드";
  if(sync) sync.textContent="MYBOX에서 검색 DB만 동기화";
  const blocked=(element)=>element?.classList.contains("disabled");
  upload?.addEventListener("click",()=>{
    if(blocked(upload)){state.toast="Queue가 비어 있어야 MYBOX 백업을 시작할 수 있습니다.";render();return;}
    openDialog("원본 포함 평문 백업을 업로드할까요?","검색 DB와 로컬에 있는 원본을 MYBOX의 신규 v2 구조로 업로드합니다. MYBOX에만 있는 원본은 기존 경로를 재사용합니다.",async()=>{
      const response=await fetch("/api/mybox/upload",{method:"POST"}); const data=await response.json(); state.dialog=null; state.toast=response.ok?`${data.documents}개 문서를 MYBOX에 업로드했습니다.`:data.error||"MYBOX 업로드에 실패했습니다."; await refresh(); render();
    });
  });
  sync?.addEventListener("click",()=>{
    if(blocked(sync)){state.toast="Queue가 비어 있어야 MYBOX 검색 DB 동기화를 시작할 수 있습니다.";render();return;}
    openDialog("MYBOX 검색 DB를 동기화할까요?","knowledge-base.json만 내려받습니다. 원본 파일은 검색 결과에서 원본을 열 때 필요한 만큼만 내려받습니다.",async()=>{
      state.dialog=null; state.mybox.sync={...(state.mybox.sync||{}),state:"syncing",message:"MYBOX 검색 DB를 동기화하는 중입니다."}; state.toast="MYBOX 검색 DB를 동기화하는 중…"; render();
      const response=await fetch("/api/mybox/sync",{method:"POST"}); const data=await response.json(); state.toast=response.ok?`${data.documents}개 문서를 동기화했습니다.`:data.error||"MYBOX 검색 DB 동기화에 실패했습니다."; await refresh(); render();
    });
  });
  migrate?.addEventListener("click",async()=>{
    const targetPath=document.querySelector("#storage-target")?.value.trim();
    if(!targetPath){state.toast="이전할 새 폴더의 절대 경로를 입력해 주세요.";render();return;}
    const response=await fetch("/api/storage/migrate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({targetPath})}); const data=await response.json();
    state.toast=response.ok?(data.sourceCleanupPending?"저장소를 이전했습니다. 앱을 재시작하면 이전 저장소의 잠긴 런타임도 정리합니다.":data.sourceRemoved?"저장소를 이전하고 기존 Weki 저장소를 정리했습니다. 앱을 재시작하면 새 위치를 사용합니다.":"저장소를 이전했지만 기존 폴더에 사용자 파일이 남아 있어 폴더 자체는 보존했습니다. 앱을 재시작하면 새 위치를 사용합니다."):data.error||"저장소 이전에 실패했습니다."; render();
  });
}
function wireMybox(){ return wireMyboxV2(); }
function selectedFileKey(file){ return [file.name,file.size,file.lastModified].join("::"); }
function appendSelectedFiles(files){ const keys=new Set(state.selectedFiles.map(selectedFileKey)); for(const file of Array.from(files||[])){ const key=selectedFileKey(file); if(!keys.has(key)){state.selectedFiles.push(file);keys.add(key);} } }
function removeSelectedFile(index){ state.selectedFiles.splice(index,1); }
function selectedFilesMarkup(){ if(!state.selectedFiles.length)return ""; return `<div class="selected-files" aria-label="선택한 문서 목록">${state.selectedFiles.map((file,index)=>`<div class="selected-file"><span><b>${escape(file.name)}</b><small>${formatBytes(file.size)}</small></span><button type="button" data-remove-selected-file="${index}" aria-label="${escape(file.name)} 제거">제거</button></div>`).join("")}</div>`; }
function syncSelectedFileList(){ if(state.page!=="add")return; const dropzone=document.querySelector(".dropzone"),heading=dropzone?.querySelector("h3"),input=document.querySelector("#file-input"); if(!dropzone)return; dropzone.querySelector(".selected-files")?.remove(); if(heading&&state.selectedFiles.length)heading.insertAdjacentHTML("afterend",selectedFilesMarkup()); const choose=document.querySelector("#choose-files"); if(choose)choose.textContent=state.selectedFiles.length?"파일 추가":"파일 선택"; input?.addEventListener("change",(event)=>{appendSelectedFiles(event.target.files);event.target.value="";render()}); document.querySelectorAll("[data-remove-selected-file]").forEach((button)=>button.addEventListener("click",()=>{removeSelectedFile(Number(button.dataset.removeSelectedFile));render()})); }
async function patchSettings(body){
  const response=await fetch("/api/settings",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||"설정을 저장하지 못했습니다.");
  if(data.settings)state.settings=data.settings;
  if(data.processing)state.status={...(state.status||{}),processing:data.processing};
  return data;
}
async function saveProcessingDefault(defaultProcessingMode,{consent=false}={}){
  state.processingDefaultDraft=defaultProcessingMode;
  const body={defaultProcessingMode};
  if(consent)body.externalAi={consentVersion:1,consentedAt:new Date().toISOString()};
  try{ await patchSettings(body); state.processingDefaultDraft=null; state.externalAiToggleDraft=null; state.toast="기본 처리 모드를 저장했습니다."; render(); }
  catch(error){ state.toast=error.message||"기본 처리 모드를 저장하지 못했습니다."; render(); }
}
function syncDefaultProcessingMode(){
  if(state.page!=="settings")return;
  const selected=state.processingDefaultDraft||currentDefaultMode();
  document.querySelectorAll('input[name="default-processing-mode"]').forEach((input)=>{ input.checked=input.value===selected; input.onchange=()=>void handleDefaultProcessingModeChange(input.value); });
  const note=document.querySelector(".processing-mode-note");
  if(note)note.textContent=selected==="external-ai"?"외부 AI가 새 작업의 기본 처리 모드입니다.":"설치된 로컬 모델을 사용하며, 준비되지 않으면 경량 처리로 진행합니다.";
}
async function saveExternalConsent(){
  const consentedAt=new Date().toISOString();
  await patchSettings({externalAi:{consentVersion:1,consentedAt}});
}
function requestExternalAiConsent({onConfirm,onCancel,saveConsent=true}={}){
  openDialog("외부 AI 사용에 동의할까요?",consentMessage(),async()=>{ if(saveConsent)await saveExternalConsent(); await onConfirm?.(); },onCancel);
}
function externalEnabled(){ return state.externalAiToggleDraft??Boolean(externalStatus().enabled||currentDefaultMode()==="external-ai"); }
async function handleDefaultProcessingModeChange(mode){
  const wasExternal=currentDefaultMode()==="external-ai";
  state.processingDefaultDraft=mode;
  if(mode==="external-ai"&&!wasExternal){
    requestExternalAiConsent({saveConsent:false,onConfirm:()=>saveProcessingDefault(mode,{consent:true}),onCancel:()=>{state.processingDefaultDraft=null;}});
    return;
  }
  await saveProcessingDefault(mode);
}
async function handleExternalToggleChange(checked){
  const wasEnabled=externalEnabled();
  state.externalAiToggleDraft=checked;
  if(checked&&!wasEnabled){
    requestExternalAiConsent({saveConsent:false,onConfirm:()=>patchSettings({externalAiEnabled:true,externalAi:{consentVersion:1,consentedAt:new Date().toISOString()}}).then(()=>{state.externalAiToggleDraft=null;state.toast="외부 AI 사용을 켰습니다.";render();}),onCancel:()=>{state.externalAiToggleDraft=false;}});
    return;
  }
  try{ await patchSettings({externalAiEnabled:checked}); state.externalAiToggleDraft=null; state.toast=checked?"외부 AI 사용을 켰습니다.":"외부 AI를 껐습니다. 신규 작업부터 외부 처리가 차단됩니다."; render(); }
  catch(error){ state.toast=error.message||"외부 AI 설정을 저장하지 못했습니다."; render(); }
}
async function refreshGeminiModels(){
  const button=document.querySelector("#refresh-gemini-models"); if(button)button.disabled=true;
  try{
    const response=await fetch("/api/ai/gemini/models"); const data=await response.json();
    if(!response.ok)throw new Error(externalFailureLabels[data.code||data.error]||"Gemini 모델 목록을 불러오지 못했습니다.");
    state.geminiModels=(data.models||[]).filter((model)=>model?.supportsGenerateContent!==false&&model?.id); state.geminiModelsLoaded=true; state.toast="Gemini 모델 목록을 새로고침했습니다."; render();
  }catch(error){state.geminiModelsLoaded=false;state.toast=error.message||"Gemini 모델 목록을 불러오지 못했습니다.";render();}
  finally{if(button)button.disabled=false;}
}
async function saveGeminiModel(modelId){
  const select=document.querySelector("#gemini-model"); if(select)select.disabled=true;
  try{ await patchSettings({externalAi:{modelId:modelId||null}}); state.geminiConnectionStatus=null; state.toast=modelId?"Gemini 모델을 저장했습니다.":"Gemini 모델 선택을 해제했습니다."; render(); }
  catch(error){state.toast=error.message||"Gemini 모델을 저장하지 못했습니다.";render();}
}
async function checkGeminiConnection(){
  const button=document.querySelector("#check-gemini-connection"),status=document.querySelector("#gemini-connection-status"); if(button)button.disabled=true; if(status)status.textContent="연결 확인 중…";
  try{
    const response=await fetch("/api/ai/gemini/check",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({})}); const data=await response.json();
    if(!response.ok)throw Object.assign(new Error(externalFailureLabels[data.code||data.error]||"Gemini 연결에 실패했습니다."),{code:data.code||data.error});
    state.geminiConnectionStatus={status:"ready",lastConnection:data.lastConnection||{status:"ready"}}; state.status={...(state.status||{}),processing:{...(state.status?.processing||{}),externalAi:{...(externalStatus()),ready:true,lastConnection:state.geminiConnectionStatus.lastConnection}}}; state.toast="Gemini 연결됨"; render();
  }catch(error){ const code=error.code||"external_ai_connection_failed"; const lastConnection={status:"failed",errorCode:code,checkedAt:new Date().toISOString()}; state.geminiConnectionStatus={status:"failed",errorCode:code,lastConnection}; state.status={...(state.status||{}),processing:{...(state.status?.processing||{}),externalAi:{...(externalStatus()),ready:false,lastConnection}}}; state.settings={...(state.settings||{}),externalAi:{...(state.settings?.externalAi||{}),lastConnection}}; state.toast=externalFailureLabels[code]||"Gemini 연결에 실패했습니다."; render(); }
  finally{if(button)button.disabled=false;}
}
function syncGeminiCredentialEditor(){
  if(state.page!=="settings")return;
  const input=document.querySelector("#gemini-api-key"),saveButton=document.querySelector("#save-gemini-key"),clearButton=document.querySelector("#clear-gemini-key"),message=document.querySelector("#gemini-key-message"); if(!input||!saveButton||!clearButton)return;
  let draftKey="";
  input.value="";
  input.addEventListener("input",()=>{draftKey=input.value;});
  const bridge=window.wekiAiCredentials;
  if(!bridge){saveButton.disabled=true;clearButton.disabled=true;if(message)message.textContent="설치된 Weki 앱에서만 Gemini Key를 관리할 수 있습니다.";return;}
  const credentialStatusPromise=window.wekiAiCredentials.getGeminiStatus?.(); if(credentialStatusPromise?.catch)void credentialStatusPromise.catch(()=>{});
  saveButton.addEventListener("click",async()=>{saveButton.disabled=true;clearButton.disabled=true;if(message)message.textContent="Key를 이 PC에 암호화하여 저장하는 중…";try{await window.wekiAiCredentials.saveGeminiKey(draftKey);draftKey="";input.value="";if(message)message.textContent="Gemini Key를 저장했습니다. 연결 확인은 별도로 실행하세요.";await refresh();render();}catch(error){if(message)message.textContent=error.message||"Gemini Key 저장에 실패했습니다.";}finally{saveButton.disabled=false;clearButton.disabled=false;}});
  clearButton.addEventListener("click",async()=>{saveButton.disabled=true;clearButton.disabled=true;if(message)message.textContent="저장된 Gemini Key를 삭제하는 중…";try{await window.wekiAiCredentials.clearGeminiKey();draftKey="";input.value="";state.geminiConnectionStatus=null;if(message)message.textContent="저장된 Gemini Key를 삭제했습니다. 외부 AI는 설치된 모델, 경량 처리 순으로 fallback합니다.";await refresh();render();}catch(error){if(message)message.textContent=error.message||"Gemini Key 삭제에 실패했습니다.";}finally{saveButton.disabled=false;clearButton.disabled=false;}});
}
function syncGeminiSettings(){
  if(state.page!=="settings")return;
  syncGeminiCredentialEditor();
  const modelSelect=document.querySelector("#gemini-model"); if(modelSelect&&!state.geminiModelsLoaded&&externalModelId()){const placeholder=modelSelect.querySelector('option[value=""]');if(placeholder){placeholder.value=externalModelId();placeholder.textContent=externalModelId();modelSelect.value=externalModelId();}}
  document.querySelector("#refresh-gemini-models")?.addEventListener("click",()=>void refreshGeminiModels());
  document.querySelector("#check-gemini-connection")?.addEventListener("click",()=>void checkGeminiConnection());
  document.querySelector("#gemini-model")?.addEventListener("change",(event)=>void saveGeminiModel(event.currentTarget.value));
  document.querySelector("#external-ai-enabled")?.addEventListener("change",(event)=>void handleExternalToggleChange(event.currentTarget.checked));
}
function runtimeInstallMetadata(id,entry=state.runtime?.components?.[id]){
  const local=state.runtime?.installable?.[id];
  const remote=state.myboxRuntime?.data?.runtimeComponents?.find((item)=>item?.id===id);
  const base=local|| (remote?{version:remote.version,sourceType:"mybox",requiresMybox:true}:null);
  const componentSourceType=entry?.sourceType||(entry?.requiresMybox?"mybox":null);
  const version=entry?.version||entry?.availableVersion||base?.version;
  const metadata=base||version||componentSourceType?{...base,...(version?{version}:{}),...(componentSourceType?{sourceType:componentSourceType}:{}),...(entry?.requiresMybox||componentSourceType==="mybox"?{requiresMybox:true}:{}),...(entry?.source?{source:entry.source}:{})}:null;
  if(id==="document-renderer"&&metadata?.sourceType!=="mybox")return null;
  return metadata;
}
function runtimeStatusText(entry){
  if(entry.requiresMybox&&entry.installable===false&&(entry.status==="missing"||entry.status==="failed")&&entry.reason==="runtime_pack_not_configured")return "MYBOX 배포본 없음";
  if(entry.status==="failed"&&entry.error)return `설치 실패: ${String(entry.error)}`;
  if(entry.status==="ready"&&!entry.applied)return "앱 재시작 필요";
  if(entry.status==="ready"&&entry.updateAvailable)return "업데이트 가능";
  if(entry.status==="missing"&&entry.reason==="runtime_pack_not_configured")return entry.requiresMybox?"MYBOX 배포본 없음":"배포 준비 중";
  return runtimeStatusLabels[entry.status]||healthStatusLabel(entry.status);
}
async function installAllRuntimeComponents(button){
  if(button.disabled||!state.runtime)return;
  const entries=state.runtime.components||{};
  const pending=["semantic-model","semantic-reranker","document-renderer"].filter((id)=>{
    const entry=entries[id];
    const metadata=runtimeInstallMetadata(id,entry);
    return entry&&((entry.status!=="ready")||entry.updateAvailable)&&metadata;
  });
  if(!pending.length){state.toast="설치 가능한 새 구성요소가 없습니다.";render();return;}
  if(!confirm("설치 가능한 고품질 검색 구성요소를 순서대로 설치할까요?"))return;
  button.disabled=true;state.runtimeBatchRequested=true;state.toast="고품질 검색 구성요소를 설치하는 중입니다…";render();
  startRuntimePolling();
  try{
    const response=await fetch("/api/runtime/components/install-all",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({componentIds:pending})});
    const data=await response.json();
    state.runtime=data.runtime||state.runtime;
    if(data.status==="ready")scheduleRuntimeRestart(data);
    state.toast=response.ok?"고품질 검색 구성요소 설치를 시작했습니다.":data.error||"고품질 검색 구성요소 설치에 실패했습니다.";
  }catch(error){state.toast=error.message||"고품질 검색 구성요소 설치에 실패했습니다.";}
  render();
}
function enhanceRuntimeCard(card,data){
  const entries=Object.values(data?.components||{});
  const description=card.querySelector(".runtime-description")||card.querySelector("p.muted:not(.runtime-restart-hint):not(.runtime-batch-message)");
  if(description){description.classList.add("runtime-description");description.textContent="세 가지 구성요소를 설치하면 의미 기반 검색과 검색 결과 정렬 품질이 향상됩니다. 필요한 항목만 설치하거나 전체 설치를 선택할 수 있습니다.";}
  card.querySelectorAll("[data-runtime-install]").forEach((button)=>button.remove());
  const rows=[...card.querySelectorAll(".engine")].slice(0,entries.length);
  rows.forEach((row,index)=>{
    const entry=entries[index];
    row.dataset.runtimeComponent=entry.id;
    const label=row.querySelector("b");
    if(label)label.textContent=runtimeComponentLabels[entry.id]||entry.id;
    const metadata=runtimeInstallMetadata(entry.id,entry);
    const action=runtimeAction(entry,metadata);
    row.querySelector(".runtime-row-action")?.remove();
    if(!action)return;
    const button=document.createElement("button");
    button.type="button";button.className="secondary runtime-row-action";button.textContent=action.label;button.disabled=action.disabled;
    if(!action.disabled){button.dataset.runtimeInstall="true";button.dataset.runtimeComponent=entry.id;button.dataset.runtimeVersion=metadata.version;button.addEventListener("click",()=>void installRuntimeComponent(button,{componentId:entry.id,version:metadata.version,source:metadata.sourceType==="mybox"?"mybox":null,manifestUrl:data?.manifestUrl||null}));}
    row.append(button);
  });
  const batchNote=runtimeBatchMessage(data?.installBatch)||(data?.installBatch?.status==="partial"?"설치 가능한 구성요소 설치가 완료되었습니다.":"");
  card.querySelector(".runtime-batch-message")?.remove();
  if(batchNote){const note=document.createElement("p");note.className="muted runtime-batch-message";note.setAttribute("role","status");note.setAttribute("aria-live","polite");note.textContent=batchNote;card.querySelector("#document-renderer-install-slot")?.before(note);}
  const restartHint=card.querySelector(".runtime-restart-hint");
  if(restartHint)restartHint.textContent="설치 후에는 앱을 다시 시작해야 새 구성요소가 적용됩니다.";
}
function syncRuntimeCardPresentation(card,data){
  if(!card)return;
  const entries=Object.values(data?.components||{});
  for(const entry of entries){
    const row=[...card.querySelectorAll(".engine")].find((item)=>item.dataset.runtimeComponent===entry.id);
    if(!row)continue;
    const label=row.querySelector("b"),status=row.querySelector("em");
    if(label)label.textContent=runtimeComponentLabels[entry.id]||entry.id;
    if(status){const statusText=runtimeStatusText(entry),source=entry.requiresMybox&&statusText!=="MYBOX 배포본 없음"?" · MYBOX 배포본":"";status.textContent=`${statusText}${source}`;}
  }
  let button=card.querySelector("[data-runtime-install-all]");
  if(!button){
    button=document.createElement("button");button.type="button";button.className="primary runtime-install-all";button.dataset.runtimeInstallAll="true";button.addEventListener("click",()=>void installAllRuntimeComponents(button));
    card.querySelector("h2")?.after(button);
  }
  const allReady=entries.length>=3&&entries.every((entry)=>entry.status==="ready"&&entry.applied&&!entry.updateAvailable);
  const installing=entries.some((entry)=>entry.status==="installing");
   const available=entries.some((entry)=>runtimeInstallMetadata(entry.id,entry)&&((entry.status!=="ready")||entry.updateAvailable));
  const restartRequired=entries.some((entry)=>entry.status==="ready"&&!entry.applied);
  button.disabled=installing||!available;
  button.textContent=allReady?"최신 상태":installing?"고품질 구성요소 설치 중…":restartRequired&&!available?"앱 재시작 필요":"전체 설치";
  if(installing)startRuntimePolling();
  enhanceRuntimeCard(card,data);
  ensureRuntimeCardHeader(card);
}
function ensureRuntimeCardHeader(card){
  const title=card?.querySelector("h2");
  if(!title)return;
  let header=card.querySelector(".runtime-card-header");
  if(!header){
    header=document.createElement("div");
    header.className="runtime-card-header";
    title.before(header);
    header.append(title);
  }
  const button=card.querySelector("[data-runtime-install-all]");
  if(button&&button.parentElement!==header)header.append(button);
}
function syncMockControls(){
  if(state.page==="add"){
    const semanticHealth=state.status?.search?.semantic;
    const semanticReady=state.status?.runtime?.components?.["semantic-model"]?.status==="ready"&&(semanticHealth==="healthy"||semanticHealth?.status==="healthy");
    const effectiveDefault=currentDocumentMode();
    const defaultInput=document.querySelector(`input[name="mode"][value="${effectiveDefault}"]`);
    if(defaultInput&&!document.querySelector('input[name="mode"]:checked')?.dataset.userSelected)defaultInput.checked=true;
    const previousMode=currentDocumentMode();
    document.querySelectorAll('input[name="mode"]').forEach((input)=>{
      input.onchange=()=>{ input.dataset.userSelected="true"; state.documentModeDraft=input.value; if(input.value==="external-ai"&&externalConsentVersion()!==1){ requestExternalAiConsent({onConfirm:()=>{state.documentModeDraft="external-ai";render();},onCancel:()=>{state.documentModeDraft=previousMode;}}); } };
      const enabled=input.value==="lightweight"||input.value==="external-ai"||(input.value==="local-ai"&&semanticReady);
      input.disabled=!enabled;
      const mode=input.closest(".mode");
      if(enabled){mode?.classList.remove("disabled");mode?.removeAttribute("aria-disabled");}
      else{mode?.classList.add("disabled");mode?.setAttribute("aria-disabled","true");}
      let status=mode?.querySelector("em");
      if(input.value!=="lightweight"){
        if(!status){status=document.createElement("em");mode?.append(status);}
        if(status)status.textContent=input.value==="local-ai"?(semanticReady?"사용 가능":"모델 설치 후"):input.value==="external-ai"?(externalConsentVersion()===1?"동의됨":"동의 필요"):"준비 중";
      }
    });
  }
  if(state.page==="settings"){
    syncDefaultProcessingMode();
    document.querySelectorAll(".settings-card .engine em").forEach((element)=>{element.textContent=healthStatusLabel(element.textContent.trim());});
    syncGeminiSettings();
  }
}
function syncMyboxCredentialStatus(){ if(state.page!=="settings")return; const card=document.querySelector("#mybox-upload")?.closest(".settings-card"); if(!card)return; card.querySelector(".mybox-credential-message")?.remove(); const credentialState=state.mybox?.credentialState||(!state.mybox?.connected?"missing":"available"); const message=state.mybox?.message||({missing:"MYBOX 토큰이 설정되지 않았습니다. 관리자에게 문의하세요.",unreadable:"MYBOX 토큰을 읽을 수 없습니다. 관리자에게 문의하세요.",invalid:"MYBOX 토큰 검증에 실패했습니다. 관리자에게 문의하세요.",unavailable:"MYBOX 연결을 확인할 수 없습니다. 네트워크 상태를 확인하세요."}[credentialState]||""); if(message&&!state.mybox?.connected){const note=document.createElement("p");note.className="muted mybox-credential-message";note.setAttribute("role","status");note.textContent=message;card.querySelector(".engine")?.after(note);} const blocked=["missing","unreadable","invalid"].includes(credentialState); card.querySelectorAll("#mybox-upload,#mybox-sync").forEach((button)=>{button.disabled=blocked;if(blocked){button.classList.add("disabled");button.setAttribute("aria-disabled","true");}else{button.classList.remove("disabled");button.removeAttribute("aria-disabled");}}); }
function applyMyboxCredentialResult(editor,result,message){ if(!result?.ok){const target=editor?.querySelector("#mybox-token-message");if(target)target.textContent=result?.error||message;return;} state.mybox={...state.mybox,credentialState:result.state,connected:result.state==="available",message:""}; const row=editor?.querySelector(".engine"),dot=row?.querySelector("span"),label=row?.querySelector("em"),labels={available:"토큰 저장됨",missing:"토큰 미설정",unreadable:"토큰을 읽을 수 없음",invalid:"토큰 검증 실패"}; if(dot)dot.className=result.state==="available"?"good-dot":"bad-dot"; if(label)label.textContent=labels[result.state]||result.state; const target=editor?.querySelector("#mybox-token-message");if(target)target.textContent=message;syncMyboxCredentialStatus(); }
function syncMyboxCredentialEditor(){ if(state.page!=="settings")return; const upload=document.querySelector("#mybox-upload"),card=upload?.closest(".settings-card"); if(!card||card.querySelector("#mybox-token"))return; const credentialState=state.mybox?.credentialState||"missing",labels={available:"토큰 저장됨",missing:"토큰 미설정",unreadable:"토큰을 읽을 수 없음",invalid:"토큰 검증 실패"}; const editor=document.createElement("div"); editor.className="mybox-credential-editor"; editor.innerHTML=`<div class="engine"><span class="${credentialState==="available"?"good-dot":"bad-dot"}"></span><b>로컬 MYBOX 토큰</b><em>${labels[credentialState]||credentialState}</em></div><p class="muted">토큰은 이 PC의 선택된 Weki 데이터 저장소에만 암호화하여 보관합니다. 값은 화면에 다시 표시하지 않습니다.</p><div class="token-actions"><input id="mybox-token" type="password" placeholder="MYBOX 토큰 입력" autocomplete="off"/><button class="secondary" id="save-mybox-token">토큰 저장</button><button class="secondary" id="clear-mybox-token">저장된 토큰 삭제</button></div><p class="muted" id="mybox-token-message" role="status"></p>`; card.insertBefore(editor,card.querySelector(".maintenance-actions")||null); const bridge=window.wekiCredentials, input=editor.querySelector("#mybox-token"),message=editor.querySelector("#mybox-token-message"),saveButton=editor.querySelector("#save-mybox-token"),clearButton=editor.querySelector("#clear-mybox-token"); if(!bridge){message.textContent="설치된 Weki 앱에서만 토큰을 관리할 수 있습니다."; editor.querySelectorAll("button").forEach((button)=>{button.disabled=true;}); return;} saveButton?.addEventListener("click",async()=>{saveButton.disabled=true;message.textContent="MYBOX 토큰을 저장하고 서버를 재연결하는 중입니다…";try{const result=await bridge.saveToken(input.value);input.value="";applyMyboxCredentialResult(editor,result,result?.ok?(result.applied?"MYBOX 토큰을 저장하고 즉시 적용했습니다.":"MYBOX 토큰을 저장했습니다. Weki를 다시 시작하면 적용됩니다."):result?.error||"MYBOX 토큰 저장에 실패했습니다.");}catch(error){message.textContent=error.message||"MYBOX 토큰 저장에 실패했습니다.";}finally{saveButton.disabled=false;}}); clearButton?.addEventListener("click",async()=>{clearButton.disabled=true;message.textContent="저장된 MYBOX 토큰을 삭제하고 서버를 재연결하는 중입니다…";try{const result=await bridge.clearToken();applyMyboxCredentialResult(editor,result,result?.ok?(result.applied?"저장된 MYBOX 토큰을 삭제하고 즉시 적용했습니다.":"저장된 MYBOX 토큰을 삭제했습니다."):result?.error||"MYBOX 토큰 삭제에 실패했습니다.");}catch(error){message.textContent=error.message||"MYBOX 토큰 삭제에 실패했습니다.";}finally{clearButton.disabled=false;}}); }
function scheduleRuntimeRestart(batch){
  if(!state.runtimeBatchRequested||state.runtimeRestartTimer||!shouldAutoRestart(batch,state.jobs))return;
  state.runtimeBatchRequested=false;
  state.toast="설치가 완료되었습니다. 3초 후 앱을 다시 시작합니다.";
  render();
  state.runtimeRestartTimer=setTimeout(()=>{state.runtimeRestartTimer=null;void restartApp();},3000);
}
function startRuntimePolling(){ if(state.runtimePollTimer||state.page!=="settings")return; state.runtimePollTimer=setInterval(async()=>{try{const latest=await (await fetch("/api/runtime/components")).json(); state.runtime=latest; state.runtimeLoading=false; await syncRuntimeComponents(); const jobs=await (await fetch("/api/jobs")).json(); state.jobs=(jobs.jobs||[]).slice(0,20); scheduleRuntimeRestart(latest.installBatch); if(!Object.values(latest.components||{}).some((entry)=>entry.status==="installing")&&latest.installBatch?.status!=="indexing"){clearInterval(state.runtimePollTimer);state.runtimePollTimer=null;}}catch{}},500); }
function resetMyboxRuntimeCache(){ state.myboxRuntime=null; state.myboxRuntimeFetchedAt=0; }
async function installRuntimeComponent(button,{componentId,version,source=null,manifestUrl=null}){
  const confirmation=source==="mybox"?"MYBOX runtime manifest에서 document-renderer를 설치할까요?":`${componentId} 구성요소를 다운로드할까요?`;
  if(!confirm(confirmation))return;
  button.disabled=true;
  const isRenderer=componentId==="document-renderer";
  if(isRenderer)state.myboxRendererInstalling=true;
  state.toast=source==="mybox"?"MYBOX renderer manifest를 확인하는 중입니다…":"구성요소 다운로드를 시작했습니다. 진행률을 표시합니다.";
  render();
  try{
    const body={componentId,version};
    if(source)body.source=source;
    if(manifestUrl)body.manifestUrl=manifestUrl;
    const response=await fetch("/api/runtime/components/install",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const data=await response.json();
    state.runtime=data.runtime||state.runtime;
    if(source==="mybox")resetMyboxRuntimeCache();
    state.toast=response.ok?"구성요소 설치를 완료했습니다. 우측 상단의 ‘앱 다시 시작’ 버튼을 눌러 적용하세요.":data.error||"구성요소 설치에 실패했습니다.";
  }catch(error){state.toast=error.message||"구성요소 설치에 실패했습니다.";}
  finally{if(isRenderer)state.myboxRendererInstalling=false;render();}
}
function mergeMyboxRuntimeCatalog(runtime){
  if(!state.runtime||!Array.isArray(runtime?.runtimeComponents))return false;
  let changed=false;
  state.runtime.installable={...(state.runtime.installable||{})};
  state.runtime.components={...(state.runtime.components||{})};
  for(const remote of runtime.runtimeComponents){
    const id=remote?.id;
    const current=state.runtime.components[id];
    if(!id||!current||!runtimeComponentLabels[id])continue;
    if(!state.runtime.installable[id]||current.status!=="ready"){
      state.runtime.installable[id]={...(state.runtime.installable[id]||{}),version:remote.version,source:"mybox",sourceType:"mybox",requiresMybox:true};
      changed=true;
    }
    if(current.status!=="ready"&&(current.availableVersion!==remote.version||current.reason==="runtime_pack_not_configured")){
      state.runtime.components[id]={...current,availableVersion:remote.version,installable:true,source:"mybox",sourceType:"mybox",requiresMybox:true,reason:null};
      changed=true;
    }
  }
  return changed;
}
function applyMyboxRuntimeAction(card,result){
  if(!card||state.page!=="settings")return;
  const slot=card.querySelector("#document-renderer-install-slot");
  if(!slot)return;
  const runtime=result?.data||{};
  const responseOk=result?.ok!==false;
  if(responseOk&&mergeMyboxRuntimeCatalog(runtime))syncRuntimeCardPresentation(card,state.runtime);
  const rendererStatus=state.runtime?.components?.["document-renderer"]?.status||null;
  const rendererInstallable=["ready","installing"].includes(rendererStatus)?null:state.runtime?.installable?.["document-renderer"]||null;
  const stateKey=JSON.stringify({ok:responseOk,configured:runtime.configured,manifest:runtime.structure?.manifest?.resourceId||null,manifestError:runtime.manifestError||null,components:runtime.runtimeComponents||[],error:runtime.error||null,rendererVersion:rendererInstallable?.version||null,installing:state.myboxRendererInstalling});
  if(card.dataset.myboxRuntimeState===stateKey)return;
  slot.replaceChildren();
  card.dataset.myboxRuntimeState=stateKey;
  const note=(message)=>{const element=document.createElement("p");element.id="mybox-runtime-message";element.className="muted";element.setAttribute("role","status");element.textContent=message;slot.append(element);};
  const fallback=()=>{if(!rendererInstallable)return false;note("문서 화면 처리기 배포본을 확인했습니다. 위의 전체 설치에서 함께 설치할 수 있습니다.");return true;};
  if(rendererInstallable){
    note("문서 화면 처리기 배포본을 확인했습니다. 위의 전체 설치에서 함께 설치할 수 있습니다.");return;
  }
  if(state.myboxRendererInstalling){note("document-renderer 설치 진행 중입니다. 완료되면 앱을 다시 시작하세요.");return;}
  if(!responseOk||!runtime?.configured){if(!fallback())note(runtime?.error||"MYBOX runtime 배포 상태를 확인할 수 없습니다.");return;}
  if(!runtime?.structure?.manifest){if(!fallback())note("MYBOX에 renderer 배포 manifest가 아직 게시되지 않았습니다. native parser와 OCR fallback을 사용합니다.");return;}
  if(runtime.manifestError){if(!fallback())note(`MYBOX renderer manifest를 읽을 수 없습니다: ${runtime.manifestError}`);return;}
  const renderer=runtime.runtimeComponents?.find((entry)=>entry?.id==="document-renderer");
  if(!renderer){if(!fallback())note("MYBOX runtime manifest에 document-renderer가 없어 native parser와 OCR fallback을 사용합니다.");return;}
   note("문서 화면 처리기 배포본을 확인했습니다. 위의 전체 설치에서 함께 설치할 수 있습니다.");
}
async function syncMyboxRuntimeAction(card,{force=false}={}){
  if(!card||state.page!=="settings")return;
  const now=Date.now();
  if(!force&&state.myboxRuntime&&now-state.myboxRuntimeFetchedAt<MYBOX_RUNTIME_CACHE_TTL){applyMyboxRuntimeAction(card,state.myboxRuntime);return;}
  if(!state.myboxRuntimePromise){
    state.myboxRuntimePromise=fetch("/api/mybox/runtime")
      .then(async(response)=>({ok:response.ok,data:await response.json()}))
      .catch((error)=>({ok:false,data:{configured:false,error:error.message||"MYBOX runtime 배포 상태를 확인할 수 없습니다."}}))
      .then((result)=>{state.myboxRuntime=result;state.myboxRuntimeFetchedAt=Date.now();return result;})
      .finally(()=>{state.myboxRuntimePromise=null;});
  }
  const result=await state.myboxRuntimePromise;
  if(document.body.contains(card))applyMyboxRuntimeAction(card,result);
}
async function syncRuntimeComponents(){
  if(state.page!=="settings")return;
  const grid=document.querySelector(".settings-grid"); if(!grid)return;
  let card=document.querySelector("#runtime-components-card");
  const updateCard=(data)=>{ const entries=Object.values(data?.components||{}), installable=data?.installable||{}; const statusLabel={ready:"준비됨",missing:"미설치",installing:"다운로드 중",failed:"설치 실패",unavailable:"사용 불가"}; const dotClass=(entry)=>entry.status==="ready"?"good-dot":entry.status==="failed"||entry.status==="missing"||entry.status==="unavailable"?"bad-dot":"processing-dot"; const installButtons=entries.filter((entry)=>entry.id!=="document-renderer"&&entry.status!=="ready"&&installable[entry.id]).map((entry)=>`<button class="secondary" data-runtime-install data-runtime-component="${escape(entry.id)}" data-runtime-version="${escape(installable[entry.id].version)}">${escape(entry.id)} 설치</button>`).join(""); const installControls=installButtons||(entries.some((entry)=>entry.id==="document-renderer")?"":`<p class="muted" role="status">현재 설치 가능한 선택형 구성요소가 없습니다.</p>`); const progress=entries.filter((entry)=>entry.status==="installing").map((entry)=>`<div class="runtime-progress" role="status"><b>${escape(entry.currentFile||entry.id)} 다운로드 중</b><span>${entry.completedFiles||0}/${entry.totalFiles||0} 파일 · ${entry.progress||0}%</span><i><em style="width:${entry.progress||0}%"></em></i></div>`).join(""); card.innerHTML=`<p class="eyebrow">OPTIONAL RUNTIME PACKS</p><h2>고품질 검색 구성요소</h2><p class="muted">semantic-model은 의미 검색용 모델입니다. document-renderer는 별도 공급 manifest가 있어야 설치할 수 있으며, 없을 때는 native parser와 OCR로 계속 처리합니다.</p>${entries.map((entry)=>`<div class="engine" data-runtime-component="${escape(entry.id)}"><span class="${dotClass(entry)}"></span><b>${escape(entry.id)}</b><em>${escape(statusLabel[entry.status]||entry.status)}${entry.reason==="runtime_pack_not_configured"?" · 배포 팩 없음":""}</em></div>`).join("")}${progress}${installControls}<div id="document-renderer-install-slot"></div>${entries.some((entry)=>entry.status==="ready"&&entry.id==="semantic-model")?`<p class="muted">의미 검색 모델이 준비되었습니다. 문서 등록에서 Local AI 허용을 선택할 수 있습니다.</p>`:""}<p class="muted runtime-restart-hint" role="status">구성요소 설치가 끝나면 우측 상단의 “앱 다시 시작” 버튼을 눌러 적용하세요.</p>`; card.querySelectorAll("[data-runtime-install]").forEach((button)=>button.addEventListener("click",()=>installRuntimeComponent(button,{componentId:button.dataset.runtimeComponent,version:button.dataset.runtimeVersion,manifestUrl:data?.manifestUrl||null}))); };
  if(!card){ card=document.createElement("section"); card.id="runtime-components-card"; card.className="settings-card span2"; grid.prepend(card); }
   if(state.runtime){updateCard(state.runtime);syncRuntimeCardPresentation(card,state.runtime);void syncMyboxRuntimeAction(card);}
  if(state.runtimeLoading)return;
   state.runtimeLoading=true; try{const data=await (await fetch("/api/runtime/components")).json(); state.runtime=data; updateCard(data); syncRuntimeCardPresentation(card,data); void syncMyboxRuntimeAction(card); if(Object.values(data.components||{}).some((entry)=>entry.status==="installing"))startRuntimePolling();}catch{} finally{state.runtimeLoading=false;}
}
function syncAppVersion(){ if(state.page!=="settings")return; const grid=document.querySelector(".settings-grid"); if(!grid||grid.querySelector("#app-version-info"))return; const info=document.createElement("section"); info.id="app-version-info"; info.className="settings-card"; info.innerHTML='<p class="eyebrow">APPLICATION</p><h2>Weki</h2><p class="muted"></p>'; info.querySelector("p.muted").textContent=`앱 버전 ${APP_VERSION}`; grid.append(info); }
function syncBrandIcon(){ const mark=document.querySelector(".brand-mark"); if(mark&&!mark.querySelector("img"))mark.innerHTML='<img src="/app-icon.png" alt="" />'; }
function syncMoreResults(){ const previous=document.querySelector("[data-more-results]"); previous?.remove(); if(state.page!=="search"||!state.searchHasMore||state.loading)return; const results=document.querySelector(".results"); if(!results)return; const button=document.createElement("button"); button.className="secondary more-results"; button.dataset.moreResults="true"; button.textContent="더 보기"; button.addEventListener("click",()=>runSearch(true)); results.after(button); }
const baseRender=render;
async function navigateOnboardingPage(nextPage){ if(state.page===nextPage)return; state.page=nextPage; await refresh().catch(()=>{}); render(); }
async function restoreOnboardingPage(previousPage){ if(state.page===previousPage)return; state.page=previousPage; await refresh().catch(()=>{}); render(); }
render=function(){ baseRender(); syncBrandIcon(); syncAppVersion(); syncSelectedFileList(); syncMockControls(); syncMyboxCredentialStatus(); syncMyboxCredentialEditor(); syncMoreResults(); onboardingController?.refreshTarget(); void syncRuntimeComponents(); };
onboardingController=createOnboardingController({ getCurrentPage:()=>state.page, navigateToPage:navigateOnboardingPage, restorePage:restoreOnboardingPage });
uploadFiles=async function(){ if(!state.selectedFiles.length){state.toast="등록할 파일을 먼저 선택해 주세요.";render();return;} const mode=document.querySelector('input[name="mode"]:checked')?.value||"lightweight"; const form=new FormData();state.selectedFiles.forEach((file)=>form.append("files",file));form.append("mode",mode);if(mode==="external-ai")form.append("consentVersion","1");state.toast="문서를 처리 대기열에 추가하는 중…";render();try{const response=await fetch("/api/documents",{method:"POST",body:form});const data=await response.json();if(response.ok){state.selectedFiles=[];state.documentModeDraft=null;}state.toast=response.ok&&data.processing?.fallbackReason?.startsWith("external_ai_")?"외부 AI를 사용할 수 없어 설치된 모델, 경량 처리 순으로 진행했습니다.":response.ok&&data.processing?.fallbackReason==="semantic_model_unavailable"?"Local AI 모델이 준비되지 않아 경량 처리로 전환했습니다. 구성요소를 설치한 뒤 다시 시도해 주세요.":response.ok?"문서를 처리 대기열에 추가했습니다.":data.code==="external_ai_consent_required"?"외부 AI 사용 동의가 필요합니다.":data.error||"문서 등록에 실패했습니다.";await refresh();}catch{state.toast="문서 등록 중 네트워크 오류가 발생했습니다.";}render();};
document.addEventListener("click",(event)=>{ if(event.target.closest('[data-nav="settings"]')) void refresh().then(render).catch(()=>{}); });
document.addEventListener("click",async(event)=>{
  const button=event.target.closest("[data-open-original]"); if(!button||button.dataset.busy||button.disabled)return;
  event.preventDefault(); button.dataset.busy="true"; state.toast=button.dataset.sourceStatus==="cloud_available"?"MYBOX에서 원본을 가져오는 중…":"원본을 여는 중…"; render();
  try { const response=await fetch(`/api/documents/${encodeURIComponent(button.dataset.openOriginal)}/original`); if(!response.ok){let data={};try{data=await response.json()}catch{} throw new Error(data.error||"원본을 사용할 수 없습니다.");} const blob=await response.blob(); const link=document.createElement("a"); link.href=URL.createObjectURL(blob); link.download=decodeURIComponent(response.headers.get("Content-Disposition")?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]||"")||"원본 파일"; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(link.href); state.toast="원본을 다운로드했습니다."; } catch(error){state.toast=error.message||"원본을 열지 못했습니다.";} render();
});
document.addEventListener("keydown",(event)=>{if(event.key==="Escape"&&state.dialog){state.dialog.onCancel?.();state.dialog=null;render()}});
document.addEventListener("click",(event)=>{if(!event.target.closest?.("[data-dialog-cancel]")||!state.dialog)return;state.dialog.onCancel?.();state.dialog=null;render();event.stopImmediatePropagation();},true);
refresh().then(()=>{render();const start=()=>void onboardingController?.autoStart();if(typeof window.requestAnimationFrame==="function")window.requestAnimationFrame(start);else setTimeout(start,0);}).catch(()=>{state.toast="로컬 저장소 연결에 실패했습니다.";render()});
let refreshInFlight = false;
setInterval(async () => {
  const trackingSync = state.page === "settings" && state.mybox?.sync?.state === "syncing";
  if ((state.page !== "add" && !trackingSync) || refreshInFlight || (state.page === "add" && !activeJobs().length)) return;
  refreshInFlight = true;
  try { await refresh(); render(); } catch { /* Keep the current queue visible until the server responds again. */ }
  finally { refreshInFlight = false; }
}, 1000);
