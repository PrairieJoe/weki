import fs from "node:fs/promises";
import path from "node:path";

const DIMENSION = 384;

function prefix(kind, text) { return `${kind === "query" ? "query: " : "passage: "}${String(text || "").trim()}`; }

export async function createRuntimeEmbeddingProvider({ componentPath, modelFile = null, tokenizerFile = "tokenizer.json", tokenizerConfigFile = "tokenizer_config.json" } = {}) {
  let files;
  try { files = await fs.readdir(componentPath); } catch { return unavailable("model_files_missing"); }
  const resolvedModel = modelFile || files.find((file) => file.toLowerCase().endsWith(".onnx"));
  if (!resolvedModel || !files.includes(tokenizerFile) || !files.includes(tokenizerConfigFile)) return unavailable("model_files_missing");
  let Tokenizer;
  let ort;
  try {
    ({ Tokenizer } = await import("@huggingface/tokenizers"));
    ort = await import("onnxruntime-node");
  } catch { return unavailable("onnx_runtime_unavailable"); }
  let tokenizer;
  let session;
  let loading;
  const load = async () => {
    if (tokenizer && session) return;
    loading ||= (async () => {
      tokenizer = new Tokenizer(JSON.parse(await fs.readFile(path.join(componentPath, tokenizerFile), "utf8")), JSON.parse(await fs.readFile(path.join(componentPath, tokenizerConfigFile), "utf8")));
      session = await ort.InferenceSession.create(path.join(componentPath, resolvedModel), { executionProviders: ["cpu"] });
    })();
    await loading;
  };
  try { await load(); } catch { return unavailable("model_load_failed"); }
  return {
    available: true,
    dimension: DIMENSION,
    async embed(text, kind = "query") {
      await load();
      const encoded = tokenizer.encode(prefix(kind, text));
      const ids = encoded.ids.slice(0, 512);
      const mask = (encoded.attention_mask || ids.map(() => 1)).slice(0, ids.length);
      const inputs = { input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]), attention_mask: new ort.Tensor("int64", BigInt64Array.from(mask, BigInt), [1, ids.length]) };
      if (session.inputNames.includes("token_type_ids")) inputs.token_type_ids = new ort.Tensor("int64", new BigInt64Array(ids.length), [1, ids.length]);
      const output = await session.run(inputs);
      const tensor = output.last_hidden_state || output[session.outputNames[0]];
      const hidden = tensor.dims[tensor.dims.length - 1];
      const vector = new Float32Array(hidden);
      let divisor = 0;
      for (let token = 0; token < ids.length; token += 1) {
        if (!mask[token]) continue;
        divisor += 1;
        for (let index = 0; index < hidden; index += 1) vector[index] += tensor.data[token * hidden + index];
      }
      for (let index = 0; index < hidden; index += 1) vector[index] /= Math.max(1, divisor);
      let norm = 0; for (const value of vector) norm += value * value; norm = Math.sqrt(norm) || 1;
      return Array.from(vector, (value) => value / norm);
    },
  };
}

function unavailable(reason) {
  return { available: false, dimension: DIMENSION, reason, embed: async () => { throw new Error(reason); } };
}
