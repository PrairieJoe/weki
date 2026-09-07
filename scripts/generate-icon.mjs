import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourcePath = path.join(root, "public", "app-icon.png");
const icoPath = path.join(root, "build", "icon.ico");
const sizes = [16, 24, 32, 48, 64, 128, 256];

const image = await loadImage(await fs.readFile(sourcePath));
const pngBySize = sizes.map((size) => {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, size, size);
  return canvas.toBuffer("image/png");
});

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
const directory = Buffer.alloc(16 * sizes.length);
let offset = header.length + directory.length;
for (let index = 0; index < sizes.length; index += 1) {
  const entryOffset = index * 16;
  const size = sizes[index];
  directory.writeUInt8(size === 256 ? 0 : size, entryOffset);
  directory.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
  directory.writeUInt8(0, entryOffset + 2);
  directory.writeUInt8(0, entryOffset + 3);
  directory.writeUInt16LE(1, entryOffset + 4);
  directory.writeUInt16LE(32, entryOffset + 6);
  directory.writeUInt32LE(pngBySize[index].length, entryOffset + 8);
  directory.writeUInt32LE(offset, entryOffset + 12);
  offset += pngBySize[index].length;
}
await fs.mkdir(path.dirname(icoPath), { recursive: true });
await fs.writeFile(icoPath, Buffer.concat([header, directory, ...pngBySize]));
