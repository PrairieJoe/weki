import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const provider = "gemini";
const credentialKeys = ["ciphertext", "format", "provider", "version"];
const sortedCredentialKeys = credentialKeys.slice().sort();

function credentialError(code, message) {
  return Object.assign(new Error(message), { code });
}

function encryptionAvailable(safeStorage) {
  return Boolean(safeStorage?.isEncryptionAvailable?.());
}

function parseRecord(raw) {
  const record = JSON.parse(raw);
  const keys = record && typeof record === "object" && !Array.isArray(record) ? Object.keys(record).sort() : [];
  if (keys.length !== sortedCredentialKeys.length || keys.some((key, index) => key !== sortedCredentialKeys[index]) || record?.format !== "weki-credential" || record.provider !== provider || record.version !== 1 || typeof record.ciphertext !== "string" || !record.ciphertext) {
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

function safeReply(encryptionAvailable, configured) {
  let available = false;
  try { available = Boolean(encryptionAvailable()); } catch {}
  return { configured: Boolean(configured), encryptionAvailable: available };
}

async function currentConfigured(store) {
  try { return Boolean((await store.getStatus()).configured); } catch { return false; }
}

export function createAiCredentialIpcHandlers({ getStore, encryptionAvailable, reloadServer = async () => {} }) {
  return {
    async status() {
      try { return safeReply(encryptionAvailable, await currentConfigured(await getStore())); } catch { return safeReply(encryptionAvailable, false); }
    },
    async save(apiKey) {
      let store;
      try {
        store = await getStore();
        await store.saveApiKey(apiKey);
        try { await reloadServer(); } catch {}
        return safeReply(encryptionAvailable, true);
      } catch {
        return safeReply(encryptionAvailable, store ? await currentConfigured(store) : false);
      }
    },
    async clear() {
      let store;
      try {
        store = await getStore();
        await store.clearApiKey();
        try { await reloadServer(); } catch {}
        return safeReply(encryptionAvailable, false);
      } catch {
        return safeReply(encryptionAvailable, store ? await currentConfigured(store) : false);
      }
    },
  };
}

export function waitForLocalServerReady(child) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      child.removeListener("message", onMessage);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
    };
    const finish = (error) => {
      cleanup();
      if (error) reject(error); else resolve();
    };
    const onMessage = (message) => {
      if (message?.type === "weki-server-ready") finish();
    };
    const onError = (error) => finish(error);
    const onExit = (code, signal) => finish(Object.assign(new Error("Local Weki server exited before readiness."), { code, signal }));
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}
