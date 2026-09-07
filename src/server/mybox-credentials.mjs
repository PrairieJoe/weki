import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const MYBOX_CREDENTIAL_RELATIVE_PATH = path.join("credentials", "mybox-token.json");
export const MYBOX_BOOTSTRAP_RELATIVE_PATH = path.join("credentials", ".mybox-token.bootstrap");

export function credentialPath(dataDir) {
  return path.join(dataDir, MYBOX_CREDENTIAL_RELATIVE_PATH);
}

export function bootstrapPath(dataDir) {
  return path.join(dataDir, MYBOX_BOOTSTRAP_RELATIVE_PATH);
}

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

export async function writeEncryptedToken(dataDir, ciphertext) {
  if (typeof ciphertext !== "string" || !ciphertext) throw new Error("암호화된 MYBOX 토큰이 비어 있습니다.");
  const destination = credentialPath(dataDir);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  const record = { format: "weki-credential", version: 1, provider: "mybox", ciphertext };
  try {
    await fs.writeFile(temporary, JSON.stringify(record, null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.rm(destination, { force: true });
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

export async function clearEncryptedToken(dataDir) {
  await fs.rm(credentialPath(dataDir), { force: true });
}

export async function loadEncryptedToken(dataDir, decryptToken) {
  const source = credentialPath(dataDir);
  if (!(await exists(source))) return { state: "missing", token: null };
  try {
    const record = JSON.parse(await fs.readFile(source, "utf8"));
    if (record?.format !== "weki-credential" || record.version !== 1 || record.provider !== "mybox" || typeof record.ciphertext !== "string" || !record.ciphertext) throw new Error("credential format");
    const token = String(await decryptToken(record.ciphertext) || "").trim();
    if (!token) throw new Error("empty token");
    return { state: "available", token };
  } catch (error) {
    return { state: "unreadable", token: null, error };
  }
}

export async function consumeTokenBootstrap(dataDir, encryptToken) {
  const source = bootstrapPath(dataDir);
  if (!(await exists(source))) return { state: "missing" };
  try {
    const token = (await fs.readFile(source, "utf8")).trim();
    if (!token) return { state: "missing" };
    const ciphertext = await encryptToken(token);
    await writeEncryptedToken(dataDir, ciphertext);
    return { state: "stored" };
  } catch (error) {
    return { state: "failed", error };
  } finally {
    await fs.rm(source, { force: true }).catch(() => {});
  }
}
