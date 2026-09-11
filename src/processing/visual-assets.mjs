const imagePattern = /\.(?:png|jpe?g|webp|bmp|tiff?)$/iu;

function extensionForMime(mime) {
  const normalized = String(mime || "").toLowerCase();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/bmp") return "bmp";
  if (normalized === "image/tiff") return "tif";
  return "png";
}

export function extractRenderedSvgVisualAssets(svg, { page = 1 } = {}) {
  const tags = String(svg || "").match(/<image\b[^>]*>/giu) || [];
  return tags.flatMap((tag, index) => {
    const match = tag.match(/(?:href|xlink:href)=["'](data:(image\/[a-z0-9.+-]+);base64,([^"']+))["']/iu);
    if (!match) return [];
    const mime = match[2].toLowerCase();
    try {
      return [{
        name: `page-${Number(page) || 1}-image-${index + 1}.${extensionForMime(mime)}`,
        mime,
        mimeType: mime,
        bytes: Buffer.from(match[3], "base64"),
        source: "rendered-page",
        page: Number(page) || 1,
      }];
    } catch {
      return [];
    }
  });
}

function mimeFor(name) {
  const lower = String(name).toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff";
  return "image/jpeg";
}

function assetPaths(files, format) {
  const prefix = format === "pptx" ? "ppt/media/" : format === "docx" ? "word/media/" : "bindata/";
  return files.filter((file) => {
    const lower = file.toLowerCase();
    if (!imagePattern.test(lower)) return false;
    return format === "hwpx" ? lower.includes("bindata/") || lower.includes("contents/") : lower.startsWith(prefix);
  }).sort();
}

export async function collectZipVisualAssets(zip, format, { recognize, preserveBytes = false } = {}) {
  const normalizedFormat = String(format || "").toLowerCase();
  const paths = assetPaths(Object.keys(zip?.files || {}), normalizedFormat);
  const assets = [];
  for (const assetPath of paths) {
    const file = zip.file(assetPath);
    if (!file) continue;
    try {
      const bytes = await file.async("nodebuffer");
      const name = assetPath.split(/[\\/]/u).pop();
      const ocrText = typeof recognize === "function" ? String(await recognize(bytes) || "").replace(/\s+/gu, " ").trim() : "";
      const mime = mimeFor(name);
      assets.push({ name, mime, ocrText, ...(preserveBytes ? { mimeType: mime, bytes } : {}) });
    } catch {
      // A damaged visual asset is omitted while the surrounding document remains searchable.
    }
  }
  return assets;
}
