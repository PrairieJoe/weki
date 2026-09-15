import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { ensureManagedDependency, resolveInstalledDependencyExecutable, validateDependencyManifest } from "../src/runtime/dependency-manager.mjs";
import { extractPortableArchive } from "../src/runtime/dependency-extractor.mjs";
import { DEFAULT_PRESENTATION_DEPENDENCY_MANIFEST } from "../src/runtime/presentation-manifest.mjs";
import { createPresentationRenderer } from "../src/processing/presentation-renderer.mjs";

test("LibreOffice manifest is pinned to MYBOX or offline-bundle acquisition", () => {
  const manifest = validateDependencyManifest(DEFAULT_PRESENTATION_DEPENDENCY_MANIFEST);
  assert.equal(manifest.name, "libreoffice");
  assert.equal(manifest.version, "26.2.4");
  assert.equal(manifest.url, null);
  assert.deepEqual(DEFAULT_PRESENTATION_DEPENDENCY_MANIFEST.acquisition, ["mybox", "offline-bundle"]);
  assert.equal(manifest.installMode, "portable-extract-only");
  assert.match(manifest.entrypoint, /^App\/libreoffice\/program\/soffice\.exe$/u);
});

test("managed dependency installation verifies the payload and is idempotent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "weki-dependency-manager-"));
  const payload = path.join(root, "payload.bin");
  const bytes = Buffer.from("pinned dependency payload");
  await fs.writeFile(payload, bytes);
  const manifest = {
    ...DEFAULT_PRESENTATION_DEPENDENCY_MANIFEST,
    name: "testdependency",
    version: "1.2.3",
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    entrypoint: "bin/run.exe",
  };
  let installs = 0;
  const install = async ({ destination }) => {
    installs += 1;
    await fs.mkdir(path.join(destination, "bin"), { recursive: true });
    await fs.writeFile(path.join(destination, "bin", "run.exe"), "executable");
  };
  const first = await ensureManagedDependency({ root, manifest, sourcePath: payload, install });
  const second = await ensureManagedDependency({ root, manifest, sourcePath: payload, install });
  assert.equal(first.status, "installed");
  assert.equal(second.status, "already-installed");
  assert.equal(installs, 1);
  assert.equal(resolveInstalledDependencyExecutable({ root, name: manifest.name, executable: manifest.entrypoint, expectedSha256: manifest.sha256 }), path.join(first.destination, manifest.entrypoint));
  await fs.rm(root, { recursive: true, force: true });
});

test("managed dependency installation rejects a source hash mismatch", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "weki-dependency-hash-"));
  const payload = path.join(root, "payload.bin");
  await fs.writeFile(payload, "tampered");
  await assert.rejects(
    ensureManagedDependency({
      root,
      manifest: { ...DEFAULT_PRESENTATION_DEPENDENCY_MANIFEST, name: "testdependency", version: "1.2.3", entrypoint: "run.exe" },
      sourcePath: payload,
      install: async () => {},
    }),
    /SHA-256 mismatch/u,
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("managed dependency can stream a verified payload from an alternate source URL", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "weki-dependency-source-"));
  const bytes = Buffer.from("MYBOX dependency payload");
  const manifest = {
    ...DEFAULT_PRESENTATION_DEPENDENCY_MANIFEST,
    name: "testdependency",
    version: "1.2.3",
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    entrypoint: "bin/run.exe",
  };
  let requestedUrl = null;
  const result = await ensureManagedDependency({
    root,
    manifest,
    sourceUrl: "mybox://runtime/testdependency/1.2.3/payload.bin",
    fetchImpl: async (url) => { requestedUrl = url; return new Response(bytes); },
    install: async ({ destination }) => {
      await fs.mkdir(path.join(destination, "bin"), { recursive: true });
      await fs.writeFile(path.join(destination, "bin", "run.exe"), "executable");
    },
  });
  assert.equal(result.status, "installed");
  assert.equal(requestedUrl, "mybox://runtime/testdependency/1.2.3/payload.bin");
  await fs.rm(root, { recursive: true, force: true });
});

test("managed dependency retries a payload stream that is interrupted", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "weki-dependency-stream-retry-"));
  const bytes = Buffer.from("MYBOX dependency payload after retry");
  const manifest = {
    ...DEFAULT_PRESENTATION_DEPENDENCY_MANIFEST,
    name: "testdependency",
    version: "1.2.3",
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    entrypoint: "bin/run.exe",
  };
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    if (attempts < 3) {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 5));
          controller.error(new Error("socket closed"));
        },
      }));
    }
    return new Response(bytes);
  };
  const result = await ensureManagedDependency({
    root,
    manifest,
    sourceUrl: "https://download.example/payload.paf.exe",
    fetchImpl,
    install: async ({ destination }) => {
      await fs.mkdir(path.join(destination, "bin"), { recursive: true });
      await fs.writeFile(path.join(destination, "bin", "run.exe"), "executable");
    },
  });
  assert.equal(result.status, "installed");
  assert.equal(attempts, 3);
  await fs.rm(root, { recursive: true, force: true });
});

test("managed dependency reports payload transfer failures separately from request failures", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "weki-dependency-stream-failure-"));
  await assert.rejects(
    ensureManagedDependency({
      root,
      manifest: { ...DEFAULT_PRESENTATION_DEPENDENCY_MANIFEST, name: "testdependency", version: "1.2.3", entrypoint: "run.exe" },
      sourceUrl: "https://download.example/payload.paf.exe",
      fetchImpl: async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error("socket closed")); } })),
      install: async () => {},
    }),
    /Dependency payload transfer failed \(download\.example\): socket closed/u,
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("managed dependency preserves the source when payload fetch fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "weki-dependency-fetch-failure-"));
  await assert.rejects(
    ensureManagedDependency({
      root,
      manifest: { ...DEFAULT_PRESENTATION_DEPENDENCY_MANIFEST, name: "testdependency", version: "1.2.3", entrypoint: "run.exe" },
      sourceUrl: "https://download.example/payload.paf.exe",
      fetchImpl: async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENETUNREACH" } }); },
      install: async () => {},
    }),
    /Dependency download request failed \(download\.example\): fetch failed \(ENETUNREACH\)/u,
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("portable archive extraction invokes the bundled extractor and normalizes architecture suffixes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "weki-dependency-extract-"));
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  const calls = [];
  const spawnImpl = (executable, args, options) => {
    calls.push({ executable, args, options });
    setImmediate(async () => {
      await fs.mkdir(path.join(root, "App", "libreoffice", "program"), { recursive: true });
      await fs.writeFile(path.join(root, "App", "libreoffice", "program", "soffice.exe_amd64.ABC"), "x");
      child.emit("close", 0);
    });
    return child;
  };
  await extractPortableArchive({ archivePath: "bundle.paf.exe", destination: root, extractorPath: "7z.exe", spawnImpl });
  assert.equal(calls[0].executable, "7z.exe");
  assert.deepEqual(calls[0].args, ["x", "-y", "bundle.paf.exe", `-o${root}`]);
  assert.equal(await fs.readFile(path.join(root, "App", "libreoffice", "program", "soffice.exe"), "utf8"), "x");
  await fs.rm(root, { recursive: true, force: true });
});

test("explicitly configured missing LibreOffice is reported as unavailable", async () => {
  const renderer = await createPresentationRenderer({ executablePath: path.join(os.tmpdir(), "weki-missing-soffice.exe") });
  assert.equal(renderer.available, false);
  assert.equal(renderer.reason, "libreoffice_executable_missing");
});
