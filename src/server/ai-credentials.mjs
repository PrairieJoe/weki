import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const provider = "gemini";

function credentialError(code, message) {
  return Object.assign(new Error(message), { code });
}

function encryptionAvailable(safeStorage) {
  return Boolean(safeStorage?.isEncryptionAvailable?.());
}

function parseRecord(raw) {
  const record = JSON.parse(raw);
  if (record?.format !== "weki-credential" || record.provider !== provider || record.version !== 1 || typeof record.ciphertext !== "string" || !record.ciphertext) {
    throw credentialError("CREDENTIAL_UNREADABLE", "Gemini credential format is invalid.");
  }
  return record;
}

export function createAiCredentialsStore({ filePath, safeStorage, fsImpl = fs, provider: requestedProvider = provider }) {
  if (requestedProvider !== provider) throw new Error("Only the Gemini credential provider is supported.");

  async function getStatus() {
    const available = encryptionAvailable(safeStorage);
    if (!available) return { provider, configured: false, encryptionAvailable: false };
    try {
      const record = parseRecord(await fsImpl.readFile(filePath, "utf8"));
      const apiKey = String(safeStorage.decryptString(Buffer.from(record.ciphertext, "base64")) || "").trim();
      return { provider, configured: Boolean(apiKey), encryptionAvailable: true };
    } catch (error) {
      if (error?.code === "ENOENT") return { provider, configured: false, encryptionAvailable: true };
      return { provider, configured: false, encryptionAvailable: true };
    }
  }

  async function saveApiKey(apiKey) {
    const normalizedApiKey = String(apiKey || "").trim();
    if (!normalizedApiKey) throw credentialError("INVALID_API_KEY", "Gemini API key is required.");
    if (!encryptionAvailable(safeStorage)) throw credentialError("ENCRYPTION_UNAVAILABLE", "Encrypted credential storage is unavailable.");
    const ciphertext = safeStorage.encryptString(normalizedApiKey).toString("base64");
    const record = { format: "weki-credential", provider, version: 1, ciphertext };
    const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
    await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await fsImpl.writeFile(temporary, JSON.stringify(record, null, 2), { encoding: "utf8", mode: 0o600 });
      await fsImpl.rename(temporary, filePath);
    } finally {
      await fsImpl.rm(temporary, { force: true }).catch(() => {});
    }
    return { provider, configured: true };
  }

  async function clearApiKey() {
    await fsImpl.rm(filePath, { force: true });
    return { provider, configured: false };
  }

  return { saveApiKey, clearApiKey, getStatus };
}
