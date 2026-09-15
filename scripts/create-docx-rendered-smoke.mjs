import fs from "node:fs/promises";
import JSZip from "jszip";
import { createCanvas } from "@napi-rs/canvas";

const output = process.argv[2];
if (!output) throw new Error("Usage: node scripts/create-docx-rendered-smoke.mjs <output.docx>");

const canvas = createCanvas(1400, 700);
const context = canvas.getContext("2d");
context.fillStyle = "#ffffff";
context.fillRect(0, 0, 1400, 700);
context.fillStyle = "#111827";
context.font = "bold 64px Arial";
context.fillText("OCR_ONLY_DOCX_PAGE_1357", 110, 330);
const image = canvas.toBuffer("image/png");
const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const zip = new JSZip();
zip.file("[Content_Types].xml", `${xmlHeader}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
zip.file("_rels/.rels", `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
zip.file("word/document.xml", `${xmlHeader}<w:document xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:drawing><wp:inline><wp:extent cx="10000000" cy="5000000"/><wp:docPr id="1" name="OCR-only document image"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="10000000" cy="5000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`);
zip.file("word/_rels/document.xml.rels", `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`);
zip.file("word/styles.xml", `${xmlHeader}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr/></w:rPrDefault><w:pPrDefault><w:pPr/></w:pPrDefault></w:docDefaults></w:styles>`);
zip.file("word/media/image1.png", image);
await fs.writeFile(output, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
