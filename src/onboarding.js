export const ONBOARDING_STORAGE_KEY = "weki.onboarding.v1.completed";

const COMPLETED_VALUE = "completed";
const MOBILE_MAX_WIDTH = 640;
const DIALOG_GUTTER = 8;
const noop = () => {};

export const ONBOARDING_STEPS = Object.freeze([
  Object.freeze({ id: "registration-screen", page: "add", target: null, title: "문서 등록부터 시작해요", description: "문서 등록 화면에서 파일을 고르고 처리 방식을 정한 뒤 안전하게 시작할 수 있습니다." }),
  Object.freeze({ id: "choose-files", page: "add", target: "choose-files", title: "파일을 선택하세요", description: "파일 선택 버튼으로 탐색기를 열고 PDF, PPTX, HWPX, DOCX 같은 지원 문서를 고릅니다." }),
  Object.freeze({ id: "registration-mode", page: "add", target: "registration-mode", title: "처리 모드를 고르세요", description: "설치된 모델을 사용하거나 외부 AI 사용 여부를 문서별로 선택할 수 있습니다." }),
  Object.freeze({ id: "processing-queue", page: "add", target: "processing-queue", title: "처리 대기열을 확인하세요", description: "등록한 문서는 대기열에서 진행 상태와 결과를 확인할 수 있습니다." }),
  Object.freeze({ id: "documents-empty", page: "documents", target: "documents-empty", title: "문서를 관리하세요", description: "문서 관리에서는 등록된 문서와 처리 상태, 원본 상태를 한 곳에서 확인합니다." }),
  Object.freeze({ id: "search-composer", page: "search", target: "search-composer", title: "질문으로 검색하세요", description: "검색창에 자연어로 질문하면 등록한 문서에서 일치하는 근거를 찾습니다." }),
  Object.freeze({ id: "example-results", page: "onboarding-example", target: null, example: true, title: "검색 결과는 이렇게 보여요", description: "아래 카드는 실제 문서나 검색 결과가 아닌 안전한 화면 예시입니다." }),
  Object.freeze({ id: "example-evidence", page: "onboarding-example", target: null, example: true, title: "근거 위치를 확인하세요", description: "결과에서 페이지와 짧은 근거를 함께 확인할 수 있습니다." }),
  Object.freeze({ id: "mybox", page: "settings", target: "mybox", title: "MYBOX와 저장소를 확인하세요", description: "설정에서는 로컬 저장소와 MYBOX 연결 상태를 관리합니다." }),
]);

export function clampDialogPosition({ left, top, width, height, viewportWidth, viewportHeight, gutter = DIALOG_GUTTER }) {
  const safeGutter = Math.max(0, Number(gutter) || 0);
  const maxLeft = Math.max(safeGutter, (Number(viewportWidth) || 0) - (Number(width) || 0) - safeGutter);
  const maxTop = Math.max(safeGutter, (Number(viewportHeight) || 0) - (Number(height) || 0) - safeGutter);
  return {
    left: Math.min(maxLeft, Math.max(safeGutter, Number(left) || 0)),
    top: Math.min(maxTop, Math.max(safeGutter, Number(top) || 0)),
  };
}

function readStorage(storage) {
  try { return storage?.getItem?.(ONBOARDING_STORAGE_KEY) ?? null; } catch { return null; }
}

export function shouldAutoStartOnboarding(storage) { return readStorage(storage) !== COMPLETED_VALUE; }

export function completeOnboarding(storage) {
  try { storage?.setItem?.(ONBOARDING_STORAGE_KEY, COMPLETED_VALUE); } catch { /* locked profile */ }
}

function getWindow(options) {
  if (options.windowRef || options.window) return options.windowRef || options.window;
  if (typeof window !== "undefined") return window;
  return null;
}

function getDocument(options) {
  if (options.documentRef || options.document) return options.documentRef || options.document;
  if (typeof document !== "undefined") return document;
  return null;
}

function getStorage(options, windowRef) {
  if (options.storage !== undefined) return options.storage;
  try { return windowRef?.localStorage; } catch { return null; }
}

function nextFrame(windowRef) {
  if (typeof windowRef?.requestAnimationFrame === "function") return new Promise((resolve) => windowRef.requestAnimationFrame(resolve));
  return Promise.resolve();
}

function activeElement(documentRef) { return documentRef?.activeElement || null; }

function createElement(documentRef, tag, className, text = "") {
  const element = documentRef.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function isMobile(windowRef, documentRef) {
  const width = Number(windowRef?.innerWidth) || Number(documentRef?.documentElement?.clientWidth) || 0;
  return width > 0 && width <= MOBILE_MAX_WIDTH;
}

function viewport(windowRef, documentRef) {
  return {
    width: Number(windowRef?.innerWidth) || Number(documentRef?.documentElement?.clientWidth) || 0,
    height: Number(windowRef?.innerHeight) || Number(documentRef?.documentElement?.clientHeight) || 0,
  };
}

function setPositionedClass(dialog, positioned) {
  if (!dialog) return;
  if (dialog.classList) {
    dialog.classList.toggle("onboarding-dialog--positioned", positioned);
    return;
  }
  const classes = String(dialog.className || "").split(/\s+/).filter(Boolean).filter((name) => name !== "onboarding-dialog--positioned");
  if (positioned) classes.push("onboarding-dialog--positioned");
  dialog.className = classes.join(" ");
}

function staticExample(documentRef, kind) {
  const example = createElement(documentRef, "section", `onboarding-example onboarding-example-${kind}`);
  example.setAttribute("data-onboarding-example", kind);
  example.setAttribute("aria-label", kind === "results" ? "검색 결과 예시" : "근거 예시");
  const label = createElement(documentRef, "p", "onboarding-example-label", kind === "results" ? "RESULT EXAMPLE" : "EVIDENCE EXAMPLE");
  const card = createElement(documentRef, "article", "onboarding-example-card");
  if (kind === "results") {
    card.append(createElement(documentRef, "strong", "", "운영 시간 변경 안내"), createElement(documentRef, "span", "", "p.3 · 일치한 근거"), createElement(documentRef, "p", "", "2026년 4월부터 운영 시간이 변경됩니다."));
  } else {
    card.append(createElement(documentRef, "span", "onboarding-example-link", "결과에서 근거로 이어짐"), createElement(documentRef, "strong", "", "p.3"), createElement(documentRef, "p", "", "2026년 4월부터 운영 시간이 변경됩니다."));
  }
  example.append(label, card);
  return example;
}

export function createOnboardingController(options = {}) {
  const windowRef = getWindow(options);
  const documentRef = getDocument(options);
  const storage = getStorage(options, windowRef);
  const getCurrentPage = options.getCurrentPage || (() => "search");
  const navigateToPage = options.navigateToPage || noop;
  const restorePage = options.restorePage || noop;
  const waitForRender = options.waitForRender || (() => nextFrame(windowRef));
  const rootId = options.rootId || "onboarding-root";
  const state = { active: false, index: 0, startingPage: null, previousFocus: null, previousFocusSelector: null, dialogPosition: null };
  let root = null;
  let boundKeydown = null;
  let dragHandle = null;
  let dragState = null;
  let completedInMemory = false;
  let transitionPromise = null;

  function getState() {
    return { active: state.active, index: state.index, step: ONBOARDING_STEPS[state.index] || null, dialogPosition: state.dialogPosition ? { ...state.dialogPosition } : null };
  }

  function targetElement(step) {
    if (!documentRef?.querySelector || !step?.target) return null;
    return documentRef.querySelector(`[data-onboarding-target="${step.target}"]`);
  }

  function isInViewport(rect) {
    const size = viewport(windowRef, documentRef);
    if (!size.width || !size.height) return true;
    const right = rect.right ?? rect.left + rect.width;
    const bottom = rect.bottom ?? rect.top + rect.height;
    return right > 0 && rect.left < size.width && bottom > 0 && rect.top < size.height;
  }

  function hideSpotlight(spotlight) {
    spotlight?.setAttribute("hidden", "true");
    if (root) root.dataset.onboardingFallback = "true";
  }

  function applySpotlight(spotlight, rect) {
    const padding = 8;
    spotlight.removeAttribute("hidden");
    spotlight.style.top = `${Math.max(4, rect.top - padding)}px`;
    spotlight.style.left = `${Math.max(4, rect.left - padding)}px`;
    spotlight.style.width = `${rect.width + padding * 2}px`;
    spotlight.style.height = `${rect.height + padding * 2}px`;
    root.dataset.onboardingFallback = "false";
  }

  async function positionSpotlight() {
    if (!root) return;
    const spotlight = root.querySelector("[data-onboarding-spotlight]");
    const stepIndex = state.index;
    const target = targetElement(ONBOARDING_STEPS[stepIndex]);
    if (!spotlight || !target?.getBoundingClientRect) { hideSpotlight(spotlight); return; }
    let rect = target.getBoundingClientRect();
    if (target.getAttribute?.("data-onboarding-fallback") === "true" || !(rect.width > 0 && rect.height > 0)) { hideSpotlight(spotlight); return; }
    if (!isInViewport(rect)) {
      try { target.scrollIntoView?.({ block: "center", inline: "nearest" }); } catch { /* centered fallback */ }
      await nextFrame(windowRef);
      if (!root || !state.active || state.index !== stepIndex) return;
      rect = target.getBoundingClientRect();
    }
    if (!(rect.width > 0 && rect.height > 0) || !isInViewport(rect)) { hideSpotlight(spotlight); return; }
    applySpotlight(spotlight, rect);
  }

  function resetDialogPosition() {
    state.dialogPosition = null;
    const dialog = root?.querySelector("[role=dialog]");
    if (dialog) {
      dialog.style.left = "";
      dialog.style.top = "";
      dialog.dataset.onboardingPosition = "center";
      setPositionedClass(dialog, false);
    }
  }

  function syncRootViewport() {
    if (!root) return;
    const size = viewport(windowRef, documentRef);
    if (size.width) root.style.width = `${size.width}px`;
    if (size.height) root.style.height = `${size.height}px`;
  }

  function applyDialogPosition(dialog) {
    if (!dialog) return;
    if (isMobile(windowRef, documentRef) || !state.dialogPosition) {
      dialog.style.left = "";
      dialog.style.top = "";
      dialog.dataset.onboardingPosition = "center";
      setPositionedClass(dialog, false);
      return;
    }
    const rect = dialog.getBoundingClientRect?.() || { width: 0, height: 0 };
    const size = viewport(windowRef, documentRef);
    const position = clampDialogPosition({ ...state.dialogPosition, width: rect.width, height: rect.height, viewportWidth: size.width, viewportHeight: size.height });
    state.dialogPosition = position;
    dialog.style.left = `${position.left}px`;
    dialog.style.top = `${position.top}px`;
    dialog.dataset.onboardingPosition = "custom";
    setPositionedClass(dialog, true);
  }

  function updateDialogPosition(event) {
    if (!dragState || !dragHandle || isMobile(windowRef, documentRef)) return;
    const dialog = root?.querySelector("[role=dialog]");
    if (!dialog || event.pointerId !== dragState.pointerId) return;
    const rect = dialog.getBoundingClientRect?.() || { width: 0, height: 0 };
    const size = viewport(windowRef, documentRef);
    state.dialogPosition = clampDialogPosition({
      left: dragState.startLeft + (Number(event.clientX) - dragState.startX),
      top: dragState.startTop + (Number(event.clientY) - dragState.startY),
      width: rect.width,
      height: rect.height,
      viewportWidth: size.width,
      viewportHeight: size.height,
    });
    applyDialogPosition(dialog);
  }

  const dragListeners = {
    pointerdown(event) {
      if (isMobile(windowRef, documentRef) || event.target !== dragHandle) return;
      const dialog = root?.querySelector("[role=dialog]");
      const rect = dialog?.getBoundingClientRect?.();
      if (!dialog || !rect) return;
      event.preventDefault();
      const position = state.dialogPosition || { left: rect.left, top: rect.top };
      dragState = { pointerId: event.pointerId, startX: Number(event.clientX) || 0, startY: Number(event.clientY) || 0, startLeft: position.left, startTop: position.top };
      try { dragHandle.setPointerCapture?.(event.pointerId); } catch { /* optional */ }
    },
    pointermove(event) { updateDialogPosition(event); },
    pointerup(event) { if (dragState?.pointerId === event.pointerId) cleanupDrag(); },
    pointercancel(event) { if (dragState?.pointerId === event.pointerId) cleanupDrag(); },
  };

  function cleanupDrag() {
    if (!dragHandle) { dragState = null; return; }
    for (const type of ["pointermove", "pointerup", "pointercancel"]) dragHandle.removeEventListener(type, dragListeners[type]);
    if (dragState?.pointerId != null) {
      try { dragHandle.releasePointerCapture?.(dragState.pointerId); } catch { /* already released */ }
    }
    dragHandle.removeEventListener("pointerdown", dragListeners.pointerdown);
    dragHandle = null;
    dragState = null;
  }

  function bindDrag(dialog) {
    cleanupDrag();
    dragHandle = dialog?.querySelector?.("[data-onboarding-drag-handle]") || null;
    if (!dragHandle) return;
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) dragHandle.addEventListener(type, dragListeners[type]);
  }

  function focusFirstControl() {
    root?.querySelector("[data-onboarding-next], [data-onboarding-previous], [data-onboarding-skip], [data-onboarding-close]")?.focus?.();
  }

  async function renderView() {
    if (!documentRef?.body || !state.active) return;
    const needsNewRoot = !root || !documentRef.body.contains(root);
    if (needsNewRoot) {
      cleanupDrag();
      if (root && boundKeydown) root.removeEventListener("keydown", boundKeydown);
      root = createElement(documentRef, "div", "onboarding-root");
      root.id = rootId;
      documentRef.body.append(root);
      boundKeydown = null;
    }
    syncRootViewport();
    cleanupDrag();
    const step = ONBOARDING_STEPS[state.index];
    const isFirst = state.index === 0;
    const isLast = state.index === ONBOARDING_STEPS.length - 1;
    root.innerHTML = "";
    const scrim = createElement(documentRef, "div", "onboarding-scrim");
    scrim.setAttribute("data-onboarding-scrim", "true");
    const spotlight = createElement(documentRef, "div", "onboarding-spotlight");
    spotlight.setAttribute("data-onboarding-spotlight", "true");
    spotlight.setAttribute("aria-hidden", "true");
    // Accessibility contract: role="dialog" aria-modal="true".
    const dialog = createElement(documentRef, "section", "onboarding-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "onboarding-title");
    dialog.setAttribute("aria-describedby", "onboarding-description");
    dialog.tabIndex = -1;
    dialog.dataset.onboardingPosition = state.dialogPosition && !isMobile(windowRef, documentRef) ? "custom" : "center";
    const close = createElement(documentRef, "button", "onboarding-close", "×");
    close.type = "button";
    close.setAttribute("data-onboarding-close", "true");
    close.setAttribute("aria-label", "온보딩 닫기");
    close.addEventListener("click", () => void closeTour());
    const progress = createElement(documentRef, "p", "onboarding-progress", `${state.index + 1} / ${ONBOARDING_STEPS.length}`);
    progress.setAttribute("data-onboarding-progress", "true");
    const title = createElement(documentRef, "h2", "onboarding-title", step.title);
    title.id = "onboarding-title";
    title.setAttribute("data-onboarding-drag-handle", "true");
    const description = createElement(documentRef, "p", "onboarding-description", step.description);
    description.id = "onboarding-description";
    const hint = createElement(documentRef, "p", "onboarding-hint", "이 안내에서는 실제 문서나 설정을 변경하지 않습니다.");
    const actions = createElement(documentRef, "div", "onboarding-actions");
    const skip = createElement(documentRef, "button", "onboarding-skip", "건너뛰기");
    skip.type = "button";
    skip.setAttribute("data-onboarding-skip", "true");
    skip.addEventListener("click", () => void skipTour());
    const navigation = createElement(documentRef, "div", "onboarding-navigation");
    const previous = createElement(documentRef, "button", "secondary", "이전");
    previous.type = "button";
    previous.disabled = isFirst;
    previous.setAttribute("data-onboarding-previous", "true");
    previous.addEventListener("click", () => void previousStep());
    const next = createElement(documentRef, "button", "primary", isLast ? "완료" : "다음");
    next.type = "button";
    next.setAttribute("data-onboarding-next", "true");
    next.addEventListener("click", () => void nextStep());
    navigation.append(previous, next);
    actions.append(skip, navigation);
    dialog.append(close, progress, title, description, hint);
    if (step.id === "example-results") dialog.append(staticExample(documentRef, "results"));
    if (step.id === "example-evidence") dialog.append(staticExample(documentRef, "evidence"));
    dialog.append(actions);
    root.append(scrim, spotlight, dialog);
    if (!boundKeydown) {
      boundKeydown = (event) => {
        if (!state.active) return;
        if (event.key === "Escape") { event.preventDefault(); void closeTour(); return; }
        if (event.key !== "Tab") return;
        const focusable = [...root.querySelectorAll("button:not([disabled])")];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && activeElement(documentRef) === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && activeElement(documentRef) === last) { event.preventDefault(); first.focus(); }
      };
      root.addEventListener("keydown", boundKeydown);
    }
    bindDrag(dialog);
    applyDialogPosition(dialog);
    await positionSpotlight();
    focusFirstControl();
  }

  function pageForStep(step) { return step.page === "onboarding-example" ? null : step.page; }

  async function performMoveTo(index) {
    const nextIndex = Math.max(0, Math.min(index, ONBOARDING_STEPS.length - 1));
    cleanupDrag();
    state.index = nextIndex;
    const targetPage = pageForStep(ONBOARDING_STEPS[state.index]);
    let currentPage = "search";
    try { currentPage = getCurrentPage() || "search"; } catch { currentPage = "search"; }
    if (targetPage && currentPage !== targetPage) {
      try { await navigateToPage(targetPage); } catch { /* explanation remains available */ }
      try { await waitForRender(); } catch { /* centered card remains usable */ }
    }
    await renderView();
  }

  function withTransition(work) {
    if (transitionPromise) return transitionPromise;
    let operation;
    operation = Promise.resolve().then(work).finally(() => { if (transitionPromise === operation) transitionPromise = null; });
    transitionPromise = operation;
    return operation;
  }

  function start(startOptions = {}) {
    return withTransition(async () => {
      if (startOptions.auto && !completedInMemory && !shouldAutoStartOnboarding(storage)) return;
      if (state.active) {
        resetDialogPosition();
        state.index = 0;
        await performMoveTo(0);
        return;
      }
      state.startingPage = (() => { try { return getCurrentPage() || "search"; } catch { return "search"; } })();
      state.previousFocus = activeElement(documentRef);
      state.previousFocusSelector = state.previousFocus?.matches?.("[data-onboarding-replay]") ? "[data-onboarding-replay]" : state.previousFocus?.id ? `#${state.previousFocus.id}` : null;
      state.active = true;
      state.index = 0;
      resetDialogPosition();
      await performMoveTo(0);
    });
  }

  async function finish() {
    if (!state.active) return;
    const startingPage = state.startingPage;
    const previousFocus = state.previousFocus;
    const previousFocusSelector = state.previousFocusSelector;
    cleanupDrag();
    state.active = false;
    state.startingPage = null;
    state.previousFocus = null;
    state.previousFocusSelector = null;
    state.dialogPosition = null;
    completeOnboarding(storage);
    completedInMemory = true;
    if (root) {
      if (boundKeydown) root.removeEventListener("keydown", boundKeydown);
      root.remove();
      root = null;
      boundKeydown = null;
    }
    if (startingPage != null) { try { await restorePage(startingPage); } catch { /* tour is complete */ } }
    const restoredFocus = previousFocus?.isConnected ? previousFocus : previousFocusSelector ? documentRef?.querySelector?.(previousFocusSelector) : null;
    restoredFocus?.focus?.();
  }

  function nextStep() {
    return withTransition(async () => {
      if (!state.active) return;
      if (state.index >= ONBOARDING_STEPS.length - 1) await finish();
      else await performMoveTo(state.index + 1);
    });
  }

  function previousStep() { return withTransition(async () => { if (state.active && state.index > 0) await performMoveTo(state.index - 1); }); }
  function skipTour() { return withTransition(() => finish()); }
  function closeTour() { return withTransition(() => finish()); }

  function refreshTarget() {
    if (!state.active) return undefined;
    syncRootViewport();
    applyDialogPosition(root?.querySelector("[role=dialog]"));
    return positionSpotlight();
  }

  async function autoStart() {
    if (completedInMemory || !shouldAutoStartOnboarding(storage)) return;
    await start({ auto: true });
  }

  if (windowRef?.addEventListener) {
    windowRef.addEventListener("resize", refreshTarget);
    windowRef.addEventListener("scroll", refreshTarget, true);
  }

  return { getState, start, next: nextStep, previous: previousStep, skip: skipTour, close: closeTour, autoStart, refreshTarget };
}
