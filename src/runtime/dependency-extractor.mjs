import { spawn } from "node:child_process";
import { readdir, rename } from "node:fs/promises";
import path from "node:path";

function normalizeExtractedName(name) {
  return String(name).replace(/_(?:amd64|x86|arm64)\.[A-F0-9_]+$/iu, "");
}

async function normalizeExtractedFiles(root) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  for (const entry of entries) {
    const current = path.join(root, entry.name);
    if (entry.isDirectory()) await normalizeExtractedFiles(current);
    else {
      const normalized = normalizeExtractedName(entry.name);
      if (normalized !== entry.name) await rename(current, path.join(root, normalized)).catch(() => {});
    }
  }
}

export function extractPortableArchive({ archivePath, destination, extractorPath = process.env.WEKI_7Z_PATH || "7z.exe", spawnImpl = spawn } = {}) {
  if (process.platform !== "win32") return Promise.reject(new Error("LibreOffice Portable extraction is supported on Windows only"));
  if (!archivePath || !destination) return Promise.reject(new Error("Archive path and extraction destination are required"));
  return new Promise((resolve, reject) => {
    const child = spawnImpl(String(extractorPath), ["x", "-y", String(archivePath), `-o${String(destination)}`], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", async (code) => {
      if (code !== 0) return reject(new Error(`LibreOffice Portable extraction failed (${code}): ${stderr.trim()}`));
      try { await normalizeExtractedFiles(String(destination)); resolve({ destination: String(destination), extractor: String(extractorPath) }); }
      catch (error) { reject(error); }
    });
  });
}
