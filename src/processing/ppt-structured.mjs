import * as XLSX from "xlsx";

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/giu, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"').replace(/&apos;/gu, "'");
}

function textValues(xml = "") {
  return [...String(xml).matchAll(/<(?:c:v|a:t)\b[^>]*>([\s\S]*?)<\/(?:c:v|a:t)>/gu)].map((match) => decodeXml(match[1]).trim()).filter(Boolean);
}

function cacheValues(xml = "") {
  const cache = String(xml).match(/<(?:c:strCache|c:numCache)[^>]*>([\s\S]*?)<\/(?:c:strCache|c:numCache)>/u)?.[1] || "";
  return [...cache.matchAll(/<c:pt\b[^>]*idx="(\d+)"[^>]*>[\s\S]*?<c:v[^>]*>([\s\S]*?)<\/c:v>[\s\S]*?<\/c:pt>/gu)]
    .sort((left, right) => Number(left[1]) - Number(right[1]))
    .map((match) => decodeXml(match[2]).trim())
    .filter(Boolean);
}

function referenceOf(xml = "") {
  return xml.match(/<c:f[^>]*>([\s\S]*?)<\/c:f>/u)?.[1]?.trim() || "";
}

function workbookValues(workbook, reference) {
  if (!workbook || !reference) return [];
  const match = reference.match(/^(?:'([^']+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/iu);
  if (!match) return [];
  const sheetName = match[1] || match[2];
  const sheet = workbook.Sheets[sheetName] || workbook.Sheets[decodeXml(sheetName)];
  if (!sheet) return [];
  const startColumn = XLSX.utils.decode_col(match[3].toUpperCase());
  const startRow = Number(match[4]) - 1;
  const endColumn = match[5] ? XLSX.utils.decode_col(match[5].toUpperCase()) : startColumn;
  const endRow = match[6] ? Number(match[6]) - 1 : startRow;
  const values = [];
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = startColumn; column <= endColumn; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const cell = sheet[address];
      if (cell?.v !== undefined && cell?.v !== null && String(cell.v).trim()) values.push(String(cell.v).trim());
    }
  }
  return values;
}

function referenceOrCache(workbook, fragment) {
  const reference = referenceOf(fragment);
  return cacheValues(fragment).length ? cacheValues(fragment) : workbookValues(workbook, reference);
}

function seriesName(workbook, fragment) {
  const tx = fragment.match(/<c:tx[\s\S]*?<\/c:tx>/u)?.[0] || "";
  return referenceOrCache(workbook, tx)[0] || textValues(tx)[0] || "";
}

function chartTitle(workbook, xml) {
  const title = xml.match(/<c:title[\s\S]*?<\/c:title>/u)?.[0] || "";
  return referenceOrCache(workbook, title)[0] || textValues(title).join(" ") || "";
}

export function parseEmbeddedWorkbook(buffer) {
  if (!buffer) return null;
  try { return XLSX.read(buffer, { type: "buffer", cellFormula: false, cellNF: false, cellStyles: false }); } catch { return null; }
}

export function parsePptChartXml(xml, { workbook = null, chartPath = null, workbookPath = null } = {}) {
  const source = String(xml || "");
  const chart = { title: chartTitle(workbook, source), categories: [], series: [], chartPath, workbookPath };
  const seriesXml = [...source.matchAll(/<c:ser\b[\s\S]*?<\/c:ser>/gu)].map((match) => match[0]);
  for (const item of seriesXml) {
    const categoryXml = item.match(/<c:cat\b[\s\S]*?<\/c:cat>/u)?.[0] || "";
    const valueXml = item.match(/<c:val\b[\s\S]*?<\/c:val>/u)?.[0] || "";
    const categories = referenceOrCache(workbook, categoryXml);
    const values = referenceOrCache(workbook, valueXml);
    const name = seriesName(workbook, item);
    chart.categories = chart.categories.length ? chart.categories : categories;
    chart.series.push({ name, categories, values });
  }
  if (!chart.title) chart.title = textValues(source.match(/<c:txTitle\b[\s\S]*?<\/c:txTitle>/u)?.[0] || "").join(" ");
  return chart;
}

export function parsePptChart({ xml, workbookBuffer = null, chartPath = null, workbookPath = null } = {}) {
  const workbook = parseEmbeddedWorkbook(workbookBuffer);
  return parsePptChartXml(xml, { workbook, chartPath, workbookPath });
}

export function parsePptTableXml(xml = "") {
  const rows = [...String(xml).matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/gu)].map((rowMatch) => {
    const row = [...rowMatch[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/gu)].map((cellMatch) =>
      [...cellMatch[0].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gu)].map((textMatch) => decodeXml(textMatch[1]).trim()).filter(Boolean).join(" ")
    );
    return row;
  }).filter((row) => row.some(Boolean));
  if (!rows.length) return null;
  return { headers: rows[0], rows: rows.slice(1), cells: rows.flatMap((row) => row.map((value) => ({ value }))) };
}

export function chartSearchText(chart) {
  return [chart?.title, ...(chart?.categories || []), ...(chart?.series || []).flatMap((series) => [series?.name, ...(series?.categories || []), ...(series?.values || [])])]
    .filter((value) => value !== undefined && value !== null && String(value).trim()).join(" | ");
}
