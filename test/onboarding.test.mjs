import assert from "node:assert/strict";
import test from "node:test";
import {
  ONBOARDING_STEPS,
  ONBOARDING_STORAGE_KEY,
  completeOnboarding,
  createOnboardingController,
  shouldAutoStartOnboarding,
} from "../src/onboarding.js";

class FakeStorage {
  #values = new Map();

  constructor(initial = {}) {
    for (const [key, value] of Object.entries(initial)) this.#values.set(key, value);
  }

  getItem(key) {
    return this.#values.get(key) ?? null;
  }

  setItem(key, value) {
    this.#values.set(key, String(value));
  }
}

class FailingStorage {
  getItem() {
    throw new Error("storage unavailable");
  }

  setItem() {
    throw new Error("storage unavailable");
  }
}

test("온보딩은 고정된 키와 5단계 화면·대상 순서를 공개한다", () => {
  assert.equal(ONBOARDING_STORAGE_KEY, "weki.onboarding.v1.completed");
  assert.equal(ONBOARDING_STEPS.length, 5);
  assert.deepEqual(
    ONBOARDING_STEPS.map(({ page, target }) => ({ page, target })),
    [
      { page: "search", target: "search-composer" },
      { page: "add", target: "registration-dropzone" },
      { page: "search", target: "evidence-fallback" },
      { page: "settings", target: "processing-mode" },
      { page: "settings", target: "mybox" },
    ],
  );
});

test("온보딩 저장소 상태는 비어 있거나 읽기 실패 시 자동 시작을 허용한다", () => {
  assert.equal(shouldAutoStartOnboarding(new FakeStorage()), true);
  assert.equal(
    shouldAutoStartOnboarding(new FakeStorage({ [ONBOARDING_STORAGE_KEY]: "completed" })),
    false,
  );
  assert.equal(shouldAutoStartOnboarding(new FailingStorage()), true);
});

test("온보딩 완료는 정확한 값을 저장하고 저장소 오류를 전파하지 않는다", () => {
  const storage = new FakeStorage();
  assert.doesNotThrow(() => completeOnboarding(storage));
  assert.equal(storage.getItem(ONBOARDING_STORAGE_KEY), "completed");
  assert.doesNotThrow(() => completeOnboarding(new FailingStorage()));
});

test("온보딩 컨트롤러는 재생 시 1단계에서 시작하고 이전·다음 경계를 지킨다", async () => {
  let page = "documents";
  const navigatedPages = [];
  const storage = new FakeStorage();
  const controller = createOnboardingController({
    storage,
    getCurrentPage: () => page,
    navigateToPage: async (nextPage) => {
      page = nextPage;
      navigatedPages.push(nextPage);
    },
    restorePage: async (previousPage) => {
      page = previousPage;
    },
  });

  await controller.start();
  assert.equal(controller.getState().active, true);
  assert.equal(controller.getState().index, 0);
  assert.equal(controller.getState().step.target, "search-composer");
  assert.equal(page, "search");

  await controller.previous();
  assert.equal(controller.getState().index, 0);
  await controller.next();
  assert.equal(controller.getState().index, 1);
  assert.equal(controller.getState().step.target, "registration-dropzone");
  assert.deepEqual(navigatedPages, ["search", "add"]);
});

test("온보딩 완료와 건너뛰기는 완료 상태를 저장하고 시작 화면으로 복귀한다", async () => {
  let page = "documents";
  const restoredPages = [];
  const storage = new FakeStorage();
  const controller = createOnboardingController({
    storage,
    getCurrentPage: () => page,
    navigateToPage: async (nextPage) => {
      page = nextPage;
    },
    restorePage: async (previousPage) => {
      page = previousPage;
      restoredPages.push(previousPage);
    },
  });

  await controller.start();
  for (let index = 0; index < ONBOARDING_STEPS.length; index += 1) await controller.next();

  assert.equal(controller.getState().active, false);
  assert.equal(storage.getItem(ONBOARDING_STORAGE_KEY), "completed");
  assert.equal(page, "documents");
  assert.deepEqual(restoredPages, ["documents"]);

  await controller.start();
  assert.equal(controller.getState().index, 0);
  await controller.skip();
  assert.equal(controller.getState().active, false);
  assert.equal(page, "documents");
  assert.deepEqual(restoredPages, ["documents", "documents"]);
});

test("온보딩 닫기는 건너뛰기와 동일하게 완료 처리하고 시작 화면을 복귀시킨다", async () => {
  let page = "settings";
  const restoredPages = [];
  const controller = createOnboardingController({
    storage: new FakeStorage(),
    getCurrentPage: () => page,
    navigateToPage: async (nextPage) => {
      page = nextPage;
    },
    restorePage: async (previousPage) => {
      page = previousPage;
      restoredPages.push(previousPage);
    },
  });

  await controller.start();
  await controller.close();
  assert.equal(controller.getState().active, false);
  assert.equal(page, "settings");
  assert.deepEqual(restoredPages, ["settings"]);
});

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("온보딩은 진행 중 중복 next 호출을 무시해 단계를 건너뛰지 않는다", async () => {
  let page = "search";
  let navigationStarted;
  let navigationRelease;
  let navigationCount = 0;
  const storage = new FakeStorage();
  const controller = createOnboardingController({
    storage,
    getCurrentPage: () => page,
    navigateToPage: async (nextPage) => {
      page = nextPage;
      navigationCount += 1;
      if (navigationCount === 1) {
        navigationStarted.resolve();
        await navigationRelease.promise;
      }
    },
    restorePage: async (previousPage) => {
      page = previousPage;
    },
  });

  await controller.start();
  navigationStarted = deferred();
  navigationRelease = deferred();
  const firstNext = controller.next();
  await navigationStarted.promise;
  const secondNext = controller.next();

  assert.equal(controller.getState().index, 1);
  navigationRelease.resolve();
  await Promise.all([firstNext, secondNext]);
  assert.equal(controller.getState().index, 1);
});

test("온보딩은 진행 중 중복 previous 호출을 무시해 단계를 건너뛰지 않는다", async () => {
  let page = "search";
  let deferAddNavigation = false;
  let navigationStarted;
  let navigationRelease;
  const controller = createOnboardingController({
    storage: new FakeStorage(),
    getCurrentPage: () => page,
    navigateToPage: async (nextPage) => {
      page = nextPage;
      if (deferAddNavigation && nextPage === "add") {
        navigationStarted.resolve();
        await navigationRelease.promise;
      }
    },
    restorePage: async (previousPage) => {
      page = previousPage;
    },
  });

  await controller.start();
  await controller.next();
  await controller.next();
  assert.equal(controller.getState().index, 2);

  deferAddNavigation = true;
  navigationStarted = deferred();
  navigationRelease = deferred();
  const firstPrevious = controller.previous();
  await navigationStarted.promise;
  const secondPrevious = controller.previous();

  assert.equal(controller.getState().index, 1);
  navigationRelease.resolve();
  await Promise.all([firstPrevious, secondPrevious]);
  assert.equal(controller.getState().index, 1);
});

class FakeElement {
  constructor(documentRef, tagName) {
    this.ownerDocument = documentRef;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.dataset = {};
    this.textContent = "";
    this.disabled = false;
    this.rect = { top: 0, left: 0, width: 0, height: 0 };
    this.afterScrollRect = null;
    this.scrollCalls = 0;
    this.parentNode = null;
  }

  set className(value) {
    this._className = value;
  }

  get className() {
    return this._className || "";
  }

  set id(value) {
    this._id = value;
  }

  get id() {
    return this._id || "";
  }

  set tabIndex(value) {
    this._tabIndex = value;
  }

  get tabIndex() {
    return this._tabIndex;
  }

  set innerHTML(value) {
    if (value === "") {
      for (const child of this.children) child.parentNode = null;
      this.children = [];
    }
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
  }

  remove() {
    this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }

  contains(node) {
    return this === node || this.children.some((child) => child.contains(node));
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes.set(name, stringValue);
    if (name === "id") this.id = stringValue;
    if (name === "disabled") this.disabled = true;
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[key] = stringValue;
    }
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "disabled") this.disabled = false;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    this.listeners.set(type, handlers.filter((entry) => entry !== handler));
  }

  listenerCount(type) {
    return (this.listeners.get(type) || []).length;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  scrollIntoView() {
    this.scrollCalls += 1;
    if (this.afterScrollRect) this.rect = this.afterScrollRect;
  }

  matches(selector) {
    return selector.split(",").some((part) => {
      const normalized = part.trim();
      if (normalized === "button:not([disabled])") return this.tagName === "BUTTON" && !this.disabled;
      if (normalized === "[data-onboarding-spotlight]") return this.attributes.has("data-onboarding-spotlight");
      if (normalized === "[data-onboarding-next]") return this.attributes.has("data-onboarding-next");
      if (normalized === "[data-onboarding-previous]") return this.attributes.has("data-onboarding-previous");
      if (normalized === "[data-onboarding-skip]") return this.attributes.has("data-onboarding-skip");
      if (normalized === "[data-onboarding-close]") return this.attributes.has("data-onboarding-close");
      const target = normalized.match(/^\[data-onboarding-target="([^"]+)"\]$/);
      if (target) return this.dataset.onboardingTarget === target[1];
      if (normalized.startsWith("#")) return this.id === normalized.slice(1);
      return false;
    });
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }
}

class FakeDocument {
  constructor() {
    this.activeElement = null;
    this.body = new FakeElement(this, "body");
  }

  createElement(tagName) {
    return new FakeElement(this, tagName);
  }

  querySelector(selector) {
    return this.body.querySelector(selector);
  }
}

function createFakeWindow() {
  return {
    innerWidth: 800,
    innerHeight: 600,
    addEventListener() {},
    requestAnimationFrame(callback) {
      queueMicrotask(() => callback(Date.now()));
    },
  };
}

test("온보딩 대상이 viewport 밖에 남으면 스크롤 후 중앙 카드 fallback을 사용한다", async () => {
  const documentRef = new FakeDocument();
  const target = documentRef.createElement("div");
  target.setAttribute("data-onboarding-target", "search-composer");
  target.rect = { top: 1000, left: 20, width: 300, height: 40 };
  target.afterScrollRect = { top: 700, left: 20, width: 300, height: 40 };
  documentRef.body.append(target);

  const controller = createOnboardingController({
    documentRef,
    windowRef: createFakeWindow(),
    storage: new FakeStorage(),
    getCurrentPage: () => "search",
  });
  await controller.start();

  const root = documentRef.querySelector("#onboarding-root");
  const spotlight = root.querySelector("[data-onboarding-spotlight]");
  assert.equal(target.scrollCalls, 1);
  assert.equal(root.dataset.onboardingFallback, "true");
  assert.equal(spotlight.hasAttribute("hidden"), true);
});

test("온보딩 단계 렌더링은 동일 root에 keydown 핸들러를 중복 등록하지 않는다", async () => {
  const documentRef = new FakeDocument();
  const controller = createOnboardingController({
    documentRef,
    windowRef: createFakeWindow(),
    storage: new FakeStorage(),
    getCurrentPage: () => "search",
    navigateToPage: async () => {},
  });
  await controller.start();
  const root = documentRef.querySelector("#onboarding-root");
  assert.equal(root.listenerCount("keydown"), 1);

  await controller.next();
  assert.equal(root.listenerCount("keydown"), 1);
  await controller.previous();
  assert.equal(root.listenerCount("keydown"), 1);
});
