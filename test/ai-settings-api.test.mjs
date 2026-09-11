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
