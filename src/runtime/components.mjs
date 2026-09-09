import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const STATE_FILE = "component-state.json";
const MANIFEST_FILE = "manifest.json";
const installLocks = new Map();

function safeRelativePath(value) {
  const normalized = path.posix.normalize(String(value || "").replaceAll("\\", "/"));
  return Boolean(normalized) && normalized !== "." && !normalized.startsWith("../") && normalized !== ".." && !path.isAbsolute(normalized);
}

function compatibleVersion(appVersion, expression) {
  const requested = String(expression || "").trim();
  if (requested.startsWith(">=")) {
    const parse = (value) => String(value).replace(/^v/i, "").split(".").slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
    const actual = parse(appVersion); const minimum = parse(requested.slice(2));
    return actual[0] > minimum[0] || (actual[0] === minimum[0] && (actual[1] > minimum[1] || (actual[1] === minimum[1] && actual[2] >= minimum[2])));
  }
  return String(appVersion) === requested;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function canonicalManifestPayload(manifest) {
  const { signature: _signature, ...unsigned } = manifest || {};
  return JSON.stringify(canonicalize(unsigned));
}

export function validateManifest(manifest) {
  if (!manifest || manifest.format !== "weki-runtime-manifest" || manifest.version !== 1) return { ok: false, reason: "invalid_format" };
  if (!manifest.appCompatibility || !Array.isArray(manifest.components) || !manifest.components.length) return { ok: false, reason: "missing_components" };
  for (const component of manifest.components) {
    if (!component?.id || !component.version || !Array.isArray(component.files) || !component.files.length) return { ok: false, reason: "invalid_component" };
    for (const file of component.files) {
      if (!safeRelativePath(file.path) || !Number.isInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/i.test(file.sha256 || "")) return { ok: false, reason: "invalid_file" };
    }
  }
  return { ok: true };
}

export function verifyManifestSignature(manifest, publicKey) {
  if (!manifest?.signature || !publicKey) return false;
  try { return crypto.verify(null, Buffer.from(canonicalManifestPayload(manifest)), publicKey, Buffer.from(manifest.signature, "base64")); } catch { return false; }
}

async function readState(rootDirectory) {
  try { return JSON.parse(await fs.readFile(path.join(rootDirectory, STATE_FILE), "utf8")); } catch { return { format: "weki-runtime-state", version: 1, components: {} }; }
}

async function writeState(rootDirectory, state) {
  const temporary = path.join(rootDirectory, `${STATE_FILE}.${crypto.randomUUID()}.partial`);
  await fs.writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(temporary, path.join(rootDirectory, STATE_FILE));
}

export async function getComponentState(rootDirectory) {
  return readState(rootDirectory);
}

export function persistComponentFailure({ rootDirectory, componentId, version = null, error, sourceType = null, source = null, requiresMybox = false, reason = "runtime_install_failed" }) {
  return withInstallLock(rootDirectory, async () => {
    await fs.mkdir(rootDirectory, { recursive: true });
    const state = await readState(rootDirectory);
    const previous = state.components?.[componentId] || {};
    state.components[componentId] = {
      ...previous,
      id: componentId,
      version: version ?? previous.version ?? null,
      status: "failed",
      sourceType,
      source,
      requiresMybox,
      reason,
      error: String(error?.message || error || "runtime install failed"),
      updatedAt: new Date().toISOString(),
    };
    await writeState(rootDirectory, state);
    return state.components[componentId];
  });
}

function withInstallLock(rootDirectory, task) {
  const key = path.resolve(rootDirectory);
  const previous = installLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  installLocks.set(key, current);
  return current.finally(() => {
    if (installLocks.get(key) === current) installLocks.delete(key);
  });
}

async function installComponentUnlocked({ rootDirectory, manifest, componentId, version, fetchImpl = globalThis.fetch, publicKey = null, appVersion = "1.0.0", baseUrl = null, sourceType = null, source = null }) {
  const validation = validateManifest(manifest);
  if (!validation.ok) throw new Error(`runtime manifest is invalid: ${validation.reason}`);
  // Development/default manifests may be unsigned; whenever a signature is
  // present it is mandatory and must verify against the bundled public key.
  if (manifest.signature && (!publicKey || !verifyManifestSignature(manifest, publicKey))) throw new Error("runtime manifest signature verification failed");
  const component = manifest.components.find((entry) => entry.id === componentId && entry.version === version);
  if (!component) throw new Error(`runtime component not found: ${componentId}@${version}`);
  if (!compatibleVersion(appVersion, manifest.appCompatibility)) throw new Error("runtime component is incompatible with this app");
  await fs.mkdir(rootDirectory, { recursive: true });
  const state = await readState(rootDirectory);
  const totalFiles = component.files.length;
  const totalBytes = component.files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  state.components[componentId] = { id: componentId, version, status: "installing", progress: 0, completedFiles: 0, totalFiles, bytesDownloaded: 0, totalBytes, currentFile: component.files[0]?.path || null, sourceType, source, updatedAt: new Date().toISOString() };
  await writeState(rootDirectory, state);
  const componentRoot = path.join(rootDirectory, componentId);
  const stage = path.join(componentRoot, `${version}.partial-${crypto.randomUUID()}`);
  const target = path.join(componentRoot, version);
  const manifestStage = path.join(rootDirectory, `${MANIFEST_FILE}.partial-${crypto.randomUUID()}`);
  try {
    await fs.mkdir(componentRoot, { recursive: true });
    for (const entry of await fs.readdir(componentRoot)) if (entry.startsWith(`${version}.partial-`)) await fs.rm(path.join(componentRoot, entry), { recursive: true, force: true });
    for (const entry of await fs.readdir(rootDirectory)) if (entry.startsWith(`${MANIFEST_FILE}.partial-`)) await fs.rm(path.join(rootDirectory, entry), { force: true });
    await fs.mkdir(stage, { recursive: true });
    await fs.writeFile(manifestStage, JSON.stringify(manifest, null, 2), "utf8");
    for (const [index, file] of component.files.entries()) {
      if (!safeRelativePath(file.path)) throw new Error("runtime manifest contains an unsafe path");
      const fileSource = file.url || (baseUrl ? new URL(file.path, baseUrl).href : file.path);
      const response = await fetchWithRetry(fetchImpl, fileSource);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== file.size) throw new Error(`runtime size mismatch: ${file.path}`);
      const hash = crypto.createHash("sha256").update(bytes).digest("hex");
      if (hash.toLowerCase() !== file.sha256.toLowerCase()) throw new Error(`runtime hash mismatch: ${file.path}`);
      const destination = path.resolve(stage, file.path);
      const relativeDestination = path.relative(stage, destination);
      if (!relativeDestination || relativeDestination.startsWith("..") || path.isAbsolute(relativeDestination)) throw new Error("runtime manifest contains an unsafe path");
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, bytes);
      const progressState = state.components[componentId] || {};
      const completedFiles = index + 1;
      const bytesDownloaded = Number(progressState.bytesDownloaded || 0) + bytes.length;
      state.components[componentId] = { ...progressState, id: componentId, version, status: "installing", progress: Math.round((completedFiles / totalFiles) * 100), completedFiles, totalFiles, bytesDownloaded, totalBytes, currentFile: component.files[index + 1]?.path || null, sourceType, source, updatedAt: new Date().toISOString() };
      await writeState(rootDirectory, state);
    }
    await fs.mkdir(componentRoot, { recursive: true });
    const previous = `${target}.previous-${Date.now()}`;
    try { await fs.rename(target, previous); } catch (error) { if (error.code !== "ENOENT") throw error; }
    await fs.rename(stage, target);
    await fs.rename(manifestStage, path.join(rootDirectory, MANIFEST_FILE));
    state.components[componentId] = { ...state.components[componentId], id: componentId, version, status: "ready", progress: 100, completedFiles: totalFiles, totalFiles, bytesDownloaded: totalBytes, totalBytes, currentFile: null, path: target, sourceType, source, updatedAt: new Date().toISOString(), previousPath: previous };
    await writeState(rootDirectory, state);
    return state.components[componentId];
  } catch (error) {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
    await fs.rm(manifestStage, { force: true }).catch(() => {});
    state.components[componentId] = { ...state.components[componentId], id: componentId, version, status: "failed", sourceType, source, error: error.message, updatedAt: new Date().toISOString() };
    await writeState(rootDirectory, state);
    throw error;
  }
}

export function installComponent(options) {
  return withInstallLock(options.rootDirectory, () => installComponentUnlocked(options));
}

async function fetchWithRetry(fetchImpl, url, retries = 2) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(url);
      if (response?.ok || response?.status === 0) return response;
      const transient = [408, 425, 429, 500, 502, 503, 504].includes(Number(response.status));
      if (!transient) throw new Error(`runtime download failed: ${url}`);
      lastError = new Error(`runtime download failed: ${url}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
  }
  throw lastError || new Error(`runtime download failed: ${url}`);
}

export async function retryComponent(options) {
  return installComponent(options);
}
