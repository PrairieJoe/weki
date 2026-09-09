import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Development/default manifest for the official MIT-licensed E5 ONNX pack and
// the locally shipped Weki reranker pack. Production builds should replace
// this with a CI-signed manifest and public key.
const root = path.dirname(fileURLToPath(import.meta.url));
const rerankerPack = path.join(root, "packs", "semantic-reranker", "1.0.0", "reranker.mjs");
export const DEFAULT_SEMANTIC_COMPONENT = {
  id: "semantic-model",
  version: "1.0.0",
  license: "MIT",
  files: [
    {
      path: "model_O4.onnx",
      url: "https://huggingface.co/intfloat/multilingual-e5-small/resolve/main/onnx/model_O4.onnx?download=true",
      size: 235052531,
      sha256: "4654c156f3e4171abc9c716cdb771bf9116455d15ac1aab364aeeede0e3205b0",
    },
    {
      path: "tokenizer.json",
      url: "https://huggingface.co/intfloat/multilingual-e5-small/resolve/main/onnx/tokenizer.json?download=true",
      size: 17082730,
      sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
    },
    {
      path: "tokenizer_config.json",
      url: "https://huggingface.co/intfloat/multilingual-e5-small/resolve/main/onnx/tokenizer_config.json?download=true",
      size: 443,
      sha256: "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b",
    },
    {
      path: "config.json",
      url: "https://huggingface.co/intfloat/multilingual-e5-small/resolve/main/onnx/config.json?download=true",
      size: 653,
      sha256: "bbb7c1333fc4b3e27fbc9cd5d2070aabcc1d4dfb99917c3633e772f97545a6b6",
    },
    {
      path: "special_tokens_map.json",
      url: "https://huggingface.co/intfloat/multilingual-e5-small/resolve/main/onnx/special_tokens_map.json?download=true",
      size: 167,
      sha256: "d05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7",
    },
  ],
};

export const DEFAULT_RUNTIME_MANIFEST = {
  format: "weki-runtime-manifest",
  version: 1,
  appCompatibility: ">=1.0.0",
  license: "MIT",
  source: "https://huggingface.co/intfloat/multilingual-e5-small",
  components: [
    DEFAULT_SEMANTIC_COMPONENT,
    {
      id: "semantic-reranker",
      version: "1.0.0",
      license: "MIT",
      files: [{
        path: "reranker.mjs",
        url: pathToFileURL(rerankerPack).href,
        size: 982,
        sha256: "31db99da8c2d7c8a1df461ffe652fe2e29d14505a455edbbe6cd5364686e842e",
      }],
    },
  ],
};
