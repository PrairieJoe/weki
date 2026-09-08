import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installComponent } from "../src/runtime/components.mjs";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDirectory = process.env.WEKI_DATA_DIR || path.join(projectRoot, ".weki-data");
const runtimeRoot = process.env.WEKI_RUNTIME_DIR || path.join(dataDirectory, "runtime", "v1");
const sourceRoot = "https://huggingface.co/intfloat/multilingual-e5-small/resolve/main/onnx";
const filesToFetch = [
  { path: "model_O4.onnx", url: `${sourceRoot}/model_O4.onnx?download=true` },
  { path: "tokenizer.json", url: `${sourceRoot}/tokenizer.json?download=true` },
  { path: "tokenizer_config.json", url: `${sourceRoot}/tokenizer_config.json?download=true` },
  { path: "config.json", url: `${sourceRoot}/config.json?download=true` },
  { path: "special_tokens_map.json", url: `${sourceRoot}/special_tokens_map.json?download=true` },
];

await fs.mkdir(runtimeRoot, { recursive: true });
const downloadRoot = await fs.mkdtemp(path.join(os.tmpdir(), "weki-e5-download-"));
const localFiles = new Map();
try {
  for (const file of filesToFetch) {
    const response = await fetch(file.url);
    if (!response.ok) throw new Error(`model download failed: ${file.path} (${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const localPath = path.join(downloadRoot, file.path);
    await fs.writeFile(localPath, bytes);
    localFiles.set(file.path, bytes);
    file.size = bytes.length;
    file.sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  }

  const manifest = {
    format: "weki-runtime-manifest",
    version: 1,
    appCompatibility: ">=1.0.0",
    license: "MIT",
    source: "https://huggingface.co/intfloat/multilingual-e5-small",
    components: [{ id: "semantic-model", version: "1.0.0", license: "MIT", files: filesToFetch }],
  };
  const component = await installComponent({
    rootDirectory: runtimeRoot,
    manifest,
    componentId: "semantic-model",
    version: "1.0.0",
    fetchImpl: async (url) => {
      const name = path.basename(new URL(url).pathname);
      const bytes = localFiles.get(name);
      return bytes ? new Response(bytes, { status: 200 }) : new Response("not found", { status: 404 });
    },
  });
  console.log(JSON.stringify({ runtimeRoot, component, manifest }, null, 2));
} finally {
  await fs.rm(downloadRoot, { recursive: true, force: true });
}
