import assert from "node:assert/strict";
import test from "node:test";

test("AI settings API exposes provider status without credential material", async () => {
  const { createAiSettingsRouter } = await import("../src/server/ai-settings-api.mjs");
  const secret = "AIza-settings-contract-secret";
  const response = await createAiSettingsRouter({ apiKey: secret }).handle(new Request("http://localhost/api/settings"));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(secret));
  assert.equal(body.externalAi.provider, "gemini");
});

test("external AI defaults off and requires consent version 1 on every off-to-on transition", async () => {
  const { createAiSettingsRouter } = await import("../src/server/ai-settings-api.mjs");
  const router = createAiSettingsRouter({ apiKey: "secret" });
  const call = async (method, body) => router.handle(new Request("http://localhost/api/settings", {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  assert.equal((await (await call("GET")).json()).externalAi.enabled, false);
  assert.equal((await call("PATCH", { externalAiEnabled: true })).status, 400);
  assert.equal((await call("PATCH", { externalAiEnabled: true, consentVersion: 0 })).status, 400);
  assert.equal((await call("PATCH", { externalAiEnabled: true, consentVersion: 1 })).status, 200);
  assert.equal((await call("PATCH", { externalAiEnabled: false })).status, 200);
  assert.equal((await call("PATCH", { externalAiEnabled: true })).status, 400);
  assert.equal((await call("PATCH", { externalAiEnabled: true, consentVersion: 1 })).status, 200);
});
