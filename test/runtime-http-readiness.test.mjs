import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import readiness from "../src/runtime/http-readiness.cjs";

const { requestWithTimeout } = readiness;

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

test("startup readiness bounds a local request whose headers never arrive", async (context) => {
  const server = createServer((_request, response) => {
    setTimeout(() => response.end("ready"), 400);
  });
  const url = await listen(server);
  context.after(() => close(server));

  await assert.rejects(requestWithTimeout(url, { timeoutMs: 50 }), /HTTP request timed out/u);
});

test("startup readiness bounds a local status response whose body never finishes", async (context) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.write('{"ready":');
    setTimeout(() => response.end("true}"), 400);
  });
  const url = await listen(server);
  context.after(() => close(server));

  await assert.rejects(requestWithTimeout(url, { timeoutMs: 50, parseJson: true }), /HTTP request timed out/u);
});
