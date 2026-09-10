export const ONBOARDING_STORAGE_KEY = "weki.onboarding.v1.completed";

export const ONBOARDING_STEPS = Object.freeze([
  Object.freeze({ page: "search", target: "search-composer", title: "문서에서 근거를 찾아보세요", description: "자연어로 질문하면 등록한 문서에서 실제 근거와 위치를 찾아드립니다." }),
  Object.freeze({ page: "add", target: "registration-dropzone", title: "문서를 등록하세요", description: "PDF, HWPX, DOCX 등의 문서를 등록하면 페이지별 검색 데이터가 만들어집니다." }),
  Object.freeze({ page: "search", target: "evidence-fallback", title: "결과와 근거를 확인하세요", description: "검색 결과는 문서명과 페이지 위치를 함께 보여주므로 원문을 바로 확인할 수 있습니다." }),
  Object.freeze({ page: "settings", target: "processing-mode", title: "처리 모드를 선택하세요", description: "설정에서 문서 처리 기본값과 로컬 AI 사용 여부를 확인할 수 있습니다." }),
  Object.freeze({ page: "settings", target: "mybox", title: "MYBOX를 연결할 수 있어요", description: "MYBOX에서는 검색 DB를 동기화하고 필요한 원본만 가져올 수 있습니다." }),
]);

const COMPLETED_VALUE = "completed";
const noop = () => {};

function readStorage(storage) {
  try {
    return storage?.getItem?.(ONBOARDING_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function shouldAutoStartOnboarding(storage) {
  return readStorage(storage) !== COMPLETED_VALUE;
}

export function completeOnboarding(storage) {
  try {
    storage?.setItem?.(ONBOARDING_STORAGE_KEY, COMPLETED_VALUE);
  } catch {
    // A private browsing policy or a locked profile must not block the tour.
  }
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
  try {
    return windowRef?.localStorage;
  } catch {
    return null;
  }
}

function nextFrame(windowRef) {
  if (typeof windowRef?.requestAnimationFrame === "function") {
    return new Promise((resolve) => windowRef.requestAnimationFrame(resolve));
  }
  return Promise.resolve();
}

function activeElement(documentRef) {
  return documentRef?.activeElement || null;
}

function textContent(element, value) {
  if (element) element.textContent = value;
}

function createElement(documentRef, tag, className, text = "") {
  const element = documentRef.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
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
  const state = { active: false, index: 0, startingPage: null, previousFocus: null, previousFocusSelector: null };
  let root = null;
  let boundKeydown = null;
  let completedInMemory = false;
  let transitionPromise = null;

  function getState() {
    return { active: state.active, index: state.index, step: ONBOARDING_STEPS[state.index] || null };
  }

  function targetElement(step) {
    if (!documentRef?.querySelector || !step) return null;
    return documentRef.querySelector(`[data-onboarding-target="${step.target}"]`);
  }

  function isInViewport(rect) {
    const viewportWidth = Number(windowRef?.innerWidth) || Number(documentRef?.documentElement?.clientWidth) || null;
    const viewportHeight = Number(windowRef?.innerHeight) || Number(documentRef?.documentElement?.clientHeight) || null;
    if (!viewportWidth || !viewportHeight) return true;
    const right = rect.right ?? rect.left + rect.width;
    const bottom = rect.bottom ?? rect.top + rect.height;
    return right > 0 && rect.left < viewportWidth && bottom > 0 && rect.top < viewportHeight;
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
    if (!spotlight || !target?.getBoundingClientRect) {
      hideSpotlight(spotlight);
      return;
    }
    if (target.getAttribute?.("data-onboarding-fallback") === "true") {
      hideSpotlight(spotlight);
      return;
    }
    let rect = target.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) {
      hideSpotlight(spotlight);
      return;
    }
    if (!isInViewport(rect)) {
      try {
        target.scrollIntoView?.({ block: "center", inline: "nearest" });
      } catch {
        try {
          target.scrollIntoView?.();
        } catch {
          // The centered fallback remains available when scrolling is unavailable.
        }
      }
      try {
        await nextFrame(windowRef);
      } catch {
        // The latest synchronous geometry is still safe to inspect.
      }
      if (!root || !state.active || state.index !== stepIndex) return;
      rect = target.getBoundingClientRect();
    }
    if (!(rect.width > 0 && rect.height > 0) || !isInViewport(rect)) {
      hideSpotlight(spotlight);
      return;
    }
    applySpotlight(spotlight, rect);
  }

  function focusFirstControl() {
    const control = root?.querySelector("[data-onboarding-next], [data-onboarding-previous], [data-onboarding-skip], [data-onboarding-close]");
    control?.focus?.();
  }

  async function renderView() {
    if (!documentRef?.body || !state.active) return;
    const needsNewRoot = !root || !documentRef.body.contains(root);
    if (needsNewRoot) {
      if (root && boundKeydown) root.removeEventListener("keydown", boundKeydown);
      root = createElement(documentRef, "div", "onboarding-root");
      root.id = rootId;
      documentRef.body.append(root);
      boundKeydown = null;
    }
    const step = ONBOARDING_STEPS[state.index];
    const isFirst = state.index === 0;
    const isLast = state.index === ONBOARDING_STEPS.length - 1;
    root.innerHTML = "";
    const scrim = createElement(documentRef, "div", "onboarding-scrim");
    scrim.setAttribute("data-onboarding-scrim", "true");
    const spotlight = createElement(documentRef, "div", "onboarding-spotlight");
    spotlight.setAttribute("data-onboarding-spotlight", "true");
    spotlight.setAttribute("aria-hidden", "true");
    // Native accessibility contract: role="dialog" aria-modal="true".
    const dialog = createElement(documentRef, "section", "onboarding-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "onboarding-title");
    dialog.setAttribute("aria-describedby", "onboarding-description");
    dialog.tabIndex = -1;

    const close = createElement(documentRef, "button", "onboarding-close", "×");
    close.type = "button";
    close.setAttribute("data-onboarding-close", "true");
    close.setAttribute("aria-label", "온보딩 닫기");
    close.addEventListener("click", () => void closeTour());
    const progress = createElement(documentRef, "p", "onboarding-progress");
    progress.setAttribute("data-onboarding-progress", "true");
    textContent(progress, `${state.index + 1} / ${ONBOARDING_STEPS.length}`);
    const title = createElement(documentRef, "h2", "onboarding-title", step.title);
    title.id = "onboarding-title";
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
    previous.setAttribute("data-onboarding-previous", "true");
    previous.disabled = isFirst;
    previous.addEventListener("click", () => void previousStep());
    const next = createElement(documentRef, "button", "primary", isLast ? "완료" : "다음");
    next.type = "button";
    next.setAttribute("data-onboarding-next", "true");
    next.addEventListener("click", () => void nextStep());
    navigation.append(previous, next);
    actions.append(skip, navigation);
    dialog.append(close, progress, title, description, hint, actions);
    root.append(scrim, spotlight, dialog);
    if (!boundKeydown) {
      boundKeydown = (event) => {
        if (!state.active) return;
        if (event.key === "Escape") {
          event.preventDefault();
          void closeTour();
          return;
        }
        if (event.key !== "Tab") return;
        const focusable = [...root.querySelectorAll("button:not([disabled])")];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && activeElement(documentRef) === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && activeElement(documentRef) === last) {
          event.preventDefault();
          first.focus();
        }
      };
      root.addEventListener("keydown", boundKeydown);
    }
    await positionSpotlight();
    focusFirstControl();
  }

  async function performMoveTo(index) {
    const nextIndex = Math.max(0, Math.min(index, ONBOARDING_STEPS.length - 1));
    state.index = nextIndex;
    const targetPage = ONBOARDING_STEPS[state.index].page;
    let currentPage = "search";
    try {
      currentPage = getCurrentPage() || "search";
    } catch {
      currentPage = "search";
    }
    if (currentPage !== targetPage) {
      try {
        await navigateToPage(targetPage);
      } catch {
        // Keep the explanation available even if a background refresh is unavailable.
      }
      try {
        await waitForRender();
      } catch {
        // Rendering is best effort; the centered card remains usable.
      }
    }
    await renderView();
  }

  function withTransition(work) {
    if (transitionPromise) return transitionPromise;
    let operation;
    operation = Promise.resolve().then(work).finally(() => {
      if (transitionPromise === operation) transitionPromise = null;
    });
    transitionPromise = operation;
    return operation;
  }

  function start(startOptions = {}) {
    return withTransition(async () => {
      if (state.active) {
        state.index = 0;
        await performMoveTo(0);
        return;
      }
      state.startingPage = (() => {
        try {
          return getCurrentPage() || "search";
        } catch {
          return "search";
        }
      })();
      state.previousFocus = activeElement(documentRef);
      state.previousFocusSelector = state.previousFocus?.matches?.("[data-onboarding-replay]") ? "[data-onboarding-replay]" : state.previousFocus?.id ? `#${state.previousFocus.id}` : null;
      state.active = true;
      state.index = 0;
      if (startOptions.auto && !shouldAutoStartOnboarding(storage) && !completedInMemory) {
        state.active = false;
        return;
      }
      await performMoveTo(0);
    });
  }

  async function finish() {
    if (!state.active) return;
    const startingPage = state.startingPage;
    const previousFocus = state.previousFocus;
    const previousFocusSelector = state.previousFocusSelector;
    state.active = false;
    state.startingPage = null;
    state.previousFocus = null;
    state.previousFocusSelector = null;
    completeOnboarding(storage);
    completedInMemory = true;
    if (root) {
      if (boundKeydown) root.removeEventListener("keydown", boundKeydown);
      root.remove();
      root = null;
      boundKeydown = null;
    }
    if (startingPage != null) {
      try {
        await restorePage(startingPage);
      } catch {
        // The tour is complete even if the original page cannot be restored.
      }
    }
    const restoredFocus = previousFocus?.isConnected ? previousFocus : previousFocusSelector ? documentRef?.querySelector?.(previousFocusSelector) : null;
    restoredFocus?.focus?.();
  }

  function nextStep() {
    return withTransition(async () => {
      if (!state.active) return;
      if (state.index >= ONBOARDING_STEPS.length - 1) {
        await finish();
        return;
      }
      await performMoveTo(state.index + 1);
    });
  }

  function previousStep() {
    return withTransition(async () => {
      if (!state.active || state.index === 0) return;
      await performMoveTo(state.index - 1);
    });
  }

  function skipTour() {
    return withTransition(() => finish());
  }

  function closeTour() {
    return withTransition(() => finish());
  }

  function refreshTarget() {
    if (state.active) return positionSpotlight();
    return undefined;
  }

  async function autoStart() {
    if (completedInMemory || !shouldAutoStartOnboarding(storage)) return;
    await start({ auto: true });
  }

  if (windowRef?.addEventListener) {
    windowRef.addEventListener("resize", refreshTarget);
    windowRef.addEventListener("scroll", refreshTarget, true);
  }

  return {
    getState,
    start,
    next: nextStep,
    previous: previousStep,
    skip: skipTour,
    close: closeTour,
    autoStart,
    refreshTarget,
  };
}
