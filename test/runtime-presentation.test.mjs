import test from "node:test";
import assert from "node:assert/strict";
import { runtimeAction, shouldAutoRestart, runtimeBatchMessage } from "../src/runtime/presentation.mjs";

test("runtime actions use Korean labels and disable latest components", () => {
  assert.deepEqual(runtimeAction({ status: "missing" }, { version: "1.0.0" }), { label: "설치", disabled: false });
  assert.deepEqual(runtimeAction({ status: "ready", updateAvailable: true }, { version: "1.1.0" }), { label: "업데이트", disabled: false });
  assert.deepEqual(runtimeAction({ status: "installing" }, { version: "1.0.0" }), { label: "진행 중", disabled: true });
  assert.deepEqual(runtimeAction({ status: "failed" }, { version: "1.0.0" }), { label: "재시도", disabled: false });
  assert.deepEqual(runtimeAction({ status: "ready", applied: false, updateAvailable: false }, { version: "1.0.0" }), { label: "재시작 필요", disabled: true });
  assert.deepEqual(runtimeAction({ status: "ready", applied: true, updateAvailable: false }, { version: "1.0.0" }), { label: "최신 상태", disabled: true });
  assert.deepEqual(runtimeAction({ status: "missing", reason: "runtime_pack_not_configured" }, null), null);
});

test("document-renderer actions require a MYBOX source", () => {
  assert.deepEqual(runtimeAction({ id: "document-renderer", status: "missing" }, { version: "1.0.0", sourceType: "mybox" }), { label: "설치", disabled: false });
  assert.deepEqual(runtimeAction({ id: "document-renderer", status: "failed" }, { sourceType: "mybox" }), { label: "재시도", disabled: false });
  assert.equal(runtimeAction({ id: "document-renderer", status: "missing" }, { version: "1.0.0", sourceType: "public" }), null);
  assert.equal(runtimeAction({ id: "document-renderer", status: "failed" }, { version: "1.0.0", sourceType: "bundled" }), null);
});

test("runtime batch only requests restart after a complete successful install", () => {
  assert.equal(shouldAutoRestart({ status: "ready", installed: ["semantic-reranker"], unavailable: [], failed: [] }, []), true);
  assert.equal(shouldAutoRestart({ status: "partial", installed: [], unavailable: ["document-renderer"], failed: [] }, []), false);
  assert.equal(shouldAutoRestart({ status: "partial", installed: ["semantic-reranker"], unavailable: ["document-renderer"], failed: [] }, []), true);
  assert.equal(shouldAutoRestart({ status: "failed", installed: ["semantic-reranker"], failed: [{ id: "semantic-reranker" }] }, []), false);
  assert.equal(shouldAutoRestart({ status: "ready", installed: ["semantic-reranker"], unavailable: [], failed: [] }, [{ status: "processing" }]), false);
});

test("runtime batch message explains unavailable components", () => {
  assert.equal(
    runtimeBatchMessage({ status: "partial", installed: ["semantic-reranker"], unavailable: ["document-renderer"], failed: [] }),
    "설치 가능한 구성요소 설치가 완료되었습니다. 문서 화면 처리기는 MYBOX 배포본이 없어 보류되었습니다.",
  );
  assert.equal(
    runtimeBatchMessage({ status: "failed", failed: [{ id: "semantic-reranker", error: "runtime hash mismatch" }] }),
    "일부 구성요소 설치에 실패했습니다: 검색 결과 재정렬 모델: runtime hash mismatch. 오류 원인을 확인하고 재시도하세요.",
  );
  assert.equal(runtimeBatchMessage({ status: "partial", skipped: ["document-renderer"] }), "문서 화면 처리기는 배포본이 없어 설치하지 못했습니다.");
  assert.equal(runtimeBatchMessage({ status: "ready", installed: ["semantic-reranker"], unavailable: [], failed: [] }), "모든 검색 구성요소 설치가 완료되었습니다.");
});
