import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";

const execFileAsync = promisify(execFile);

function executableCandidates() {
  return [
    process.env.WEKI_LIBREOFFICE_PATH,
    process.env.LIBREOFFICE_PATH,
    process.platform === "win32" ? "soffice.exe" : "soffice",
    process.platform === "win32" ? "C:\\Program Files\\LibreOffice\\program\\soffice.exe" : "/usr/bin/soffice",
    process.platform === "win32" ? "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe" : "/usr/local/bin/soffice",
  ].filter(Boolean);
}

function findExecutable() {
  for (const candidate of executableCandidates()) {
    if (path.isAbsolute(candidate)) {
      try { if (fsSync.existsSync(candidate)) return candidate; } catch { /* Continue with the next candidate. */ }
    } else {
      const result = spawnSync(process.platform === "win32" ? "where.exe" : "which", [candidate], { encoding: "utf8", windowsHide: true });
      if (result.status === 0) return result.stdout.split(/\r?\n/u).find(Boolean)?.trim() || candidate;
    }
  }
  return null;
}

export async function createPresentationRenderer({ executablePath = null, scale = 1.5 } = {}) {
  if (executablePath) {
    try {
      if (!fsSync.existsSync(executablePath)) return { available: false, reason: "libreoffice_executable_missing", executable: executablePath, renderPages: async () => [] };
    } catch {
      return { available: false, reason: "libreoffice_executable_missing", executable: executablePath, renderPages: async () => [] };
    }
  }
  const executable = executablePath || findExecutable();
  if (!executable) return { available: false, reason: "libreoffice_unavailable", renderPages: async () => [] };
  return {
    available: true,
    executable,
    async renderPages(buffer, format = "pptx") {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), "weki-ppt-render-"));
      const normalizedFormat = String(format || "pptx").toLowerCase();
      if (!["pptx", "docx"].includes(normalizedFormat)) throw new Error(`Unsupported Office render format: ${normalizedFormat}`);
      const inputPath = path.join(directory, `input.${normalizedFormat}`);
      try {
        await fs.writeFile(inputPath, buffer);
        const profileUrl = pathToFileURL(path.join(directory, "profile")).href;
        await execFileAsync(executable, [
          `-env:UserInstallation=${profileUrl}`,
          "--headless",
          "--invisible",
          "--nologo",
          "--nodefault",
          "--norestore",
          "--nolockcheck",
          "--nofirststartwizard",
          "--convert-to",
          "pdf",
          "--outdir",
          directory,
          inputPath,
        ], { windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024 });
        const pdfPath = path.join(directory, "input.pdf"); const pdfBuffer = await fs.readFile(pdfPath);
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(pdfBuffer), disableWorker: true }).promise; const pages = [];
        try {
          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber); const viewport = page.getViewport({ scale });
            const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
            await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
            pages.push(canvas.toBuffer("image/png"));
          }
        } finally { pdf.cleanup?.(); await pdf.destroy?.(); }
        return pages;
      } finally { await fs.rm(directory, { recursive: true, force: true }); }
    },
  };
}
