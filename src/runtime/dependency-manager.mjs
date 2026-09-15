import crypto from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const SHA256 = /^[a-f0-9]{64}$/iu;
const SAFE_NAME = /^[a-z0-9][a-z0-9_-]{1,63}$/iu;

export function validateDependencyManifest(manifest) {
  if (!manifest || !SAFE_NAME.test(String(manifest.name || ""))) throw new Error("Invalid dependency name");
  if (!/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/iu.test(String(manifest.version || ""))) throw new Error("Invalid dependency version");
  const url = manifest.url == null || manifest.url === "" ? null : String(manifest.url);
  if (url !== null && !/^https:\/\//iu.test(url)) throw new Error("Dependency URL must use HTTPS");
  if (!SHA256.test(String(manifest.sha256 || ""))) throw new Error("Dependency SHA-256 is invalid");
  const entrypoint = String(manifest.entrypoint || "");
  if (!entrypoint || path.isAbsolute(entrypoint) || entrypoint.split(/[\\/]+/u).includes("..")) throw new Error("Invalid dependency entrypoint");
  if (manifest.installMode !== "portable-extract-only") throw new Error("Unsupported dependency install mode");
  return {
    schemaVersion: 1,
    name: String(manifest.name),
    version: String(manifest.version),
    url,
    sha256: String(manifest.sha256).toLowerCase(),
    format: String(manifest.format || "paf-exe").toLowerCase(),
    entrypoint,
    installMode: "portable-extract-only",
  };
}

async function copyVerified(source, destination, expectedHash) {
  const hash = crypto.createHash("sha256");
  const digesting = new Transform({ transform(chunk, encoding, callback) { hash.update(chunk); callback(null, chunk); } });
  await pipeline(source, digesting, createWriteStream(destination, { flags: "wx" }));
  const actualHash = hash.digest("hex");
  if (actualHash !== expectedHash) {
    await fs.rm(destination, { force: true });
    throw new Error(`Dependency SHA-256 mismatch: expected ${expectedHash}, got ${actualHash}`);
  }
}

async function downloadVerified(url, destination, expectedHash, fetchImpl, { retries = 2, retryDelayMs = 250 } = {}) {
  const parsed = (() => { try { return new URL(url); } catch { return null; } })();
  const source = parsed?.hostname || parsed?.protocol?.replace(":", "") || "runtime source";
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    lastError = null;
    let response;
    try {
      response = await fetchImpl(url, { redirect: "error" });
    } catch (error) {
      const causeCode = error?.cause?.code ? ` (${error.cause.code})` : "";
      lastError = new Error(`Dependency download request failed (${source}): ${error?.message || "네트워크 요청 실패"}${causeCode}`);
    }
    if (!lastError && (!response?.ok || !response.body)) {
      lastError = new Error(`Dependency download failed (${source}, HTTP ${response?.status ?? "unknown"})`);
    }
    if (!lastError) {
      try {
        await copyVerified((await import("node:stream")).Readable.fromWeb(response.body), destination, expectedHash);
        return;
      } catch (error) {
        const causeCode = error?.cause?.code ? ` (${error.cause.code})` : "";
        lastError = new Error(`Dependency payload transfer failed (${source}): ${error?.message || "다운로드 스트림이 중단되었습니다"}${causeCode}`);
      }
    }
    await fs.rm(destination, { force: true }).catch(() => {});
    const retryable = !response || response.ok || [408, 425, 429, 500, 502, 503, 504].includes(Number(response.status));
    if (attempt < retries && retryable) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
      continue;
    }
    break;
  }
  throw lastError || new Error(`Dependency download failed (${source})`);
}

async function renameWithRetry(from, to, attempts = 8) {
  for (let attempt = 1; ; attempt += 1) {
    try { return await fs.rename(from, to); }
    catch (error) {
      if (!(process.platform === "win32" && ["EPERM", "EBUSY"].includes(error?.code)) || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
}

export async function ensureManagedDependency({ root, manifest, sourcePath, sourceUrl = null, fetchImpl = globalThis.fetch, install } = {}) {
  const pinned = validateDependencyManifest(manifest);
  if (typeof install !== "function") throw new Error("A dependency installer is required");
  const managedRoot = path.resolve(String(root || ""));
  await fs.mkdir(managedRoot, { recursive: true });
  const destination = path.join(managedRoot, pinned.name, pinned.version);
  const marker = path.join(destination, "dependency-manifest.json");
  try {
    const existing = JSON.parse(await fs.readFile(marker, "utf8"));
    const executable = path.resolve(destination, existing.entrypoint || pinned.entrypoint);
    if (existing.sha256 === pinned.sha256 && executable.startsWith(`${destination}${path.sep}`) && existsSync(executable)) return { status: "already-installed", destination, manifest: pinned };
  } catch { /* Install or repair the managed dependency below. */ }
  const stagingRoot = await fs.mkdtemp(path.join(managedRoot, ".staging-"));
  const stagedPath = path.join(stagingRoot, `payload.${pinned.format}`);
  const installRoot = path.join(stagingRoot, "installed");
  try {
    if (sourcePath) await copyVerified(createReadStream(path.resolve(String(sourcePath))), stagedPath, pinned.sha256);
    else {
      const downloadSource = sourceUrl || pinned.url;
      if (!downloadSource) throw new Error("Dependency source is required");
      await downloadVerified(downloadSource, stagedPath, pinned.sha256, fetchImpl);
    }
    await install({ stagedPath, destination: installRoot, manifest: pinned });
    await fs.mkdir(installRoot, { recursive: true });
    await fs.writeFile(path.join(installRoot, "dependency-manifest.json"), `${JSON.stringify(pinned, null, 2)}\n`, { flag: "wx" });
    const parent = path.dirname(destination);
    await fs.mkdir(parent, { recursive: true });
    const backup = path.join(parent, `.previous-${pinned.name}-${pinned.version}-${Date.now()}`);
    let previousMoved = false;
    let activated = false;
    try {
      try { await renameWithRetry(destination, backup); previousMoved = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
      await renameWithRetry(installRoot, destination);
      activated = true;
    } catch (error) {
      if (activated) await fs.rm(destination, { recursive: true, force: true }).catch(() => {});
      if (previousMoved) await renameWithRetry(backup, destination).catch(() => {});
      throw error;
    }
    if (previousMoved) await fs.rm(backup, { recursive: true, force: true }).catch(() => {});
    return { status: "installed", destination, manifest: pinned };
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export function resolveInstalledDependencyExecutable({ root, name, executable, expectedSha256 = null } = {}) {
  if (!root || !SAFE_NAME.test(String(name || "")) || !executable || path.isAbsolute(executable) || executable.split(/[\\/]+/u).includes("..")) return null;
  let versions;
  try { versions = readdirSync(path.join(path.resolve(root), name), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((left, right) => right.localeCompare(left, undefined, { numeric: true })); }
  catch { return null; }
  for (const version of versions) {
    const directory = path.join(path.resolve(root), name, version);
    try {
      const marker = JSON.parse(readFileSync(path.join(directory, "dependency-manifest.json"), "utf8"));
      if (marker.name !== name || marker.version !== version || !SHA256.test(String(marker.sha256 || "")) || (expectedSha256 && marker.sha256.toLowerCase() !== String(expectedSha256).toLowerCase())) continue;
      const candidate = path.resolve(directory, marker.entrypoint || executable);
      if (candidate.startsWith(`${directory}${path.sep}`) && existsSync(candidate)) return candidate;
    } catch { /* Try the next version. */ }
  }
  return null;
}
