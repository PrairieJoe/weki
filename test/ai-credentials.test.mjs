import assert from "node:assert/strict";
import test from "node:test";

test("external AI credentials never expose the API key in files, status, or errors", async () => {
  const { saveExternalAiCredential, credentialStatus } = await import("../src/server/ai-credentials.mjs");
  const apiKey = "AIza-v1.2.3-contract-secret";
  const result = await saveExternalAiCredential({ dataDir: ".test-data", apiKey });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(apiKey));
  assert.doesNotMatch(JSON.stringify(await credentialStatus({ dataDir: ".test-data" })), new RegExp(apiKey));
  await assert.rejects(() => saveExternalAiCredential({ dataDir: ".test-data", apiKey, fail: true }), (error) => {
    assert.doesNotMatch(JSON.stringify(error), new RegExp(apiKey));
    return true;
  });
});
