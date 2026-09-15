import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { chartSearchText, parsePptChart, parsePptChartXml, parsePptTableXml } from "../src/processing/ppt-structured.mjs";

test("extracts native PPT chart title, categories, series and values from chart XML", () => {
  const xml = `
    <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
      <c:title><c:tx><c:rich><a:t>분기별 매출</a:t></c:rich></c:tx></c:title>
      <c:barChart><c:ser>
        <c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>2025년</c:v></c:pt></c:strCache></c:strRef></c:tx>
        <c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>1분기</c:v></c:pt><c:pt idx="1"><c:v>2분기</c:v></c:pt></c:strCache></c:strRef></c:cat>
        <c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>120</c:v></c:pt><c:pt idx="1"><c:v>180</c:v></c:pt></c:numCache></c:numRef></c:val>
      </c:ser></c:barChart>
    </c:chart>`;
  const chart = parsePptChartXml(xml, { chartPath: "ppt/charts/chart1.xml" });
  assert.equal(chart.title, "분기별 매출");
  assert.deepEqual(chart.categories, ["1분기", "2분기"]);
  assert.deepEqual(chart.series, [{ name: "2025년", categories: ["1분기", "2분기"], values: ["120", "180"] }]);
  assert.match(chartSearchText(chart), /180/u);
});

test("falls back to an embedded XLSX workbook when chart caches are absent", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["분기", "매출"], ["1분기", 120], ["2분기", 180]]), "Sheet1");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const chart = parsePptChart({
    workbookBuffer: buffer,
    xml: `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:barChart><c:ser><c:tx><c:strRef><c:f>Sheet1!$B$1</c:f></c:strRef></c:tx><c:cat><c:strRef><c:f>Sheet1!$A$2:$A$3</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f></c:numRef></c:numCache></c:val></c:ser></c:barChart></c:chart>`,
    workbookPath: "ppt/embeddings/workbook1.xlsx",
  });
  assert.deepEqual(chart.categories, ["1분기", "2분기"]);
  assert.deepEqual(chart.series[0].values, ["120", "180"]);
});

test("parses PPT native table cells into structured headers and rows", () => {
  const table = parsePptTableXml(`<a:tbl><a:tr><a:tc><a:t>항목</a:t></a:tc><a:tc><a:t>값</a:t></a:tc></a:tr><a:tr><a:tc><a:t>버스</a:t></a:tc><a:tc><a:t>10</a:t></a:tc></a:tr></a:tbl>`);
  assert.deepEqual(table.headers, ["항목", "값"]);
  assert.deepEqual(table.rows, [["버스", "10"]]);
  assert.equal(table.cells.length, 4);
});
