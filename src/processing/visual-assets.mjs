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

function normalizeZipPath(value) {
  return String(value || "").replace(/\\/gu, "/").replace(/^\/+|^\.\//gu, "");
}

function normalizedPathParts(value) {
  const parts = normalizeZipPath(value).split("/");
  const result = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") result.pop();
    else result.push(part);
  }
  return result;
}

function resolveZipTarget(sourcePath, target) {
  const absolute = /^\s*\//u.test(String(target || ""));
  const normalizedTarget = normalizeZipPath(target);
  if (!normalizedTarget) return "";
  const targetParts = absolute
    ? normalizedTarget.split("/")
    : [...normalizedPathParts(sourcePath).slice(0, -1), ...normalizedTarget.split("/")];
  return normalizedPathParts(targetParts.join("/")).join("/");
}

function xmlAttribute(source, name) {
  const match = String(source || "").match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "iu"));
  return match?.[1] || "";
}

function relationshipPath(sourcePath) {
  const parts = normalizedPathParts(sourcePath);
  const fileName = parts.pop() || "";
  return [...parts, "_rels", `${fileName}.rels`].join("/");
}

async function documentRelationships(zip, sourcePath) {
  const relationshipFile = zip.file(relationshipPath(sourcePath));
  if (!relationshipFile) return new Map();
  let xml;
  try { xml = await relationshipFile.async("string"); } catch { return new Map(); }
  const relationships = new Map();
  for (const match of String(xml).matchAll(/<Relationship\b[^>]*>/giu)) {
    const id = xmlAttribute(match[0], "Id");
    const target = xmlAttribute(match[0], "Target");
    if (id && target) {
      try { relationships.set(id, decodeURIComponent(resolveZipTarget(sourcePath, target))); } catch { relationships.set(id, resolveZipTarget(sourcePath, target)); }
    }
  }
  return relationships;
}

export function splitDocxLogicalPages(xml) {
  const pages = [];
  let start = 0;
  const pageBreakPattern = /<w:br\b[^>]*(?:w:)?type\s*=\s*["']page["'][^>]*\/?\s*>|<w:lastRenderedPageBreak\b[^>]*\/?\s*>/giu;
  for (const match of String(xml || "").matchAll(pageBreakPattern)) {
    pages.push(String(xml || "").slice(start, match.index));
    start = match.index + match[0].length;
  }
  pages.push(String(xml || "").slice(start));
  return pages.length ? pages : [""];
}

function assetPathMatch(assetPaths, target) {
  const normalizedTarget = normalizeZipPath(target).toLowerCase();
  if (!normalizedTarget) return null;
  return assetPaths.find((assetPath) => {
    const normalizedAssetPath = normalizeZipPath(assetPath).toLowerCase();
    return normalizedAssetPath === normalizedTarget || normalizedAssetPath.endsWith(`/${normalizedTarget}`);
  }) || null;
}

function assetPageFallback(index, pageCount) {
  return pageCount > 0 ? (index % pageCount) + 1 : 1;
}

async function assetPageAssignments(zip, format, assetPaths, pagePaths) {
  if (!Array.isArray(pagePaths) || !pagePaths.length || !assetPaths.length) return new Map();
  const assignments = new Map();
  const pageXml = [];
  for (const pagePath of pagePaths) {
    try { pageXml.push(await zip.file(pagePath)?.async("string") || ""); } catch { pageXml.push(""); }
  }
  const pageCount = format === "docx" ? splitDocxLogicalPages(pageXml[0] || "").length : pageXml.length;
  if (format === "docx") {
    const relationships = await documentRelationships(zip, pagePaths[0]);
    const assetByPath = new Map(assetPaths.map((assetPath) => [normalizeZipPath(assetPath).toLowerCase(), assetPath]));
    for (const [pageIndex, xml] of splitDocxLogicalPages(pageXml[0] || "").entries()) {
      for (const match of String(xml).matchAll(/\b(?:r:)?embed\s*=\s*["']([^"']+)["']/giu)) {
        const target = relationships.get(match[1]);
        const assetPath = assetPathMatch(assetPaths, target) || assetByPath.get(normalizeZipPath(target).toLowerCase());
        if (assetPath && !assignments.has(assetPath)) assignments.set(assetPath, pageIndex + 1);
      }
    }
  } else if (format === "hwpx") {
    for (const assetPath of assetPaths) {
      const normalizedAssetPath = normalizeZipPath(assetPath).toLowerCase();
      const baseName = normalizedAssetPath.split("/").pop() || "";
      const stem = baseName.replace(/\.[^.]+$/u, "");
      const identifiers = [baseName, stem, normalizedAssetPath].filter((value) => value.length > 2);
      const pageIndex = pageXml.findIndex((xml) => {
        const normalizedXml = normalizeZipPath(xml).toLowerCase();
        return identifiers.some((identifier) => normalizedXml.includes(identifier));
      });
      if (pageIndex >= 0) assignments.set(assetPath, pageIndex + 1);
    }
  }
  for (const [index, assetPath] of assetPaths.entries()) {
    if (!assignments.has(assetPath)) assignments.set(assetPath, assetPageFallback(index, pageCount));
  }
  return assignments;
}

export async function collectZipVisualAssets(zip, format, { recognize, preserveBytes = false, pagePaths } = {}) {
  const normalizedFormat = String(format || "").toLowerCase();
  const paths = assetPaths(Object.keys(zip?.files || {}), normalizedFormat);
  const pageAssignments = await assetPageAssignments(zip, normalizedFormat, paths, pagePaths);
  const assets = [];
  for (const assetPath of paths) {
    const file = zip.file(assetPath);
    if (!file) continue;
    try {
      const bytes = await file.async("nodebuffer");
      const name = assetPath.split(/[\\/]/u).pop();
      const ocrText = typeof recognize === "function" ? String(await recognize(bytes) || "").replace(/\s+/gu, " ").trim() : "";
      const mime = mimeFor(name);
      assets.push({ name, mime, ocrText, ...(pageAssignments.has(assetPath) ? { page: pageAssignments.get(assetPath) } : {}), ...(preserveBytes ? { mimeType: mime, bytes } : {}) });
    } catch {
      // A damaged visual asset is omitted while the surrounding document remains searchable.
    }
  }
  return assets;
}
