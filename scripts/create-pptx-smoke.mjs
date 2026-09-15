import fs from "node:fs/promises";
import JSZip from "jszip";
import * as XLSX from "xlsx";

const output = process.argv[2];
if (!output) throw new Error("Usage: node scripts/create-pptx-smoke.mjs <output.pptx>");
const zip = new JSZip();
zip.file("ppt/slides/slide1.xml", `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>광화문광장 교통모니터링</a:t></a:r></a:p></p:txBody></p:sp><p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart></c:chart></c:chart></a:graphicData></a:graphic></p:graphicFrame><p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tr><a:tc><a:t>분기</a:t></a:tc><a:tc><a:t>매출</a:t></a:tc></a:tr><a:tr><a:tc><a:t>1분기</a:t></a:tc><a:tc><a:t>120</a:t></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`);
zip.file("ppt/slides/_rels/slide1.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`);
zip.file("ppt/charts/chart1.xml", `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:title><c:tx><c:rich><a:t>분기별 매출</a:t></c:rich></c:tx></c:title><c:barChart><c:ser><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>매출</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>1분기</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>120</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:chart>`);
zip.file("ppt/charts/_rels/chart1.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../embeddings/workbook1.xlsx"/></Relationships>`);
const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["분기", "매출"], ["1분기", 120]]), "Sheet1");
zip.file("ppt/embeddings/workbook1.xlsx", XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
zip.file("ppt/media/image1.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
await fs.writeFile(output, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
