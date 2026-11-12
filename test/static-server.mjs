// Regression tests: local-static-server.js, the zero-dependency server that puts a report or
// fix tracker on http://127.0.0.1 so a cookie exception for that address can unblock its
// storage (pando-0648). It must stay on loopback, serve one folder read-only, and refuse any
// path that leaves the folder — ../ raw or percent-encoded, and a symlink pointing out.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createRequire } from "node:module";
import { run } from "./lib/report-fixture.mjs";

const require = createRequire(import.meta.url);
const { start } = require("../local-static-server.js");

const base = fs.mkdtempSync(path.join(os.tmpdir(), "cw-static-"));
const root = path.join(base, "served");
fs.mkdirSync(path.join(root, "sub dir"), { recursive: true });
fs.writeFileSync(path.join(root, "tracker.html"), "<!DOCTYPE html><title>t</title>");
fs.writeFileSync(path.join(root, "sub dir", "state.json"), '{"a":1}');
fs.writeFileSync(path.join(base, "secret.txt"), "outside");
fs.symlinkSync(path.join(base, "secret.txt"), path.join(root, "link.txt"));

const { server, url } = await start({ root, port: 0 });
const { port } = server.address();

// A raw request line, so the client does not normalise ../ away before it is sent.
const raw = (target, method = "GET") => new Promise((resolve, reject) => {
  // write, not end: a half-closed socket can drop a streamed (async) response; the server closes
  // it after replying because of Connection: close.
  const s = net.connect(port, "127.0.0.1", () => s.write(`${method} ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
  let buf = ""; s.on("data", (c) => (buf += c)); s.on("end", () => resolve(buf)); s.on("error", reject);
});
const status = (r) => Number(r.split(" ")[1]);

const tests = {
  "binds to 127.0.0.1 only and prints that address"() {
    assert.strictEqual(server.address().address, "127.0.0.1");
    assert.strictEqual(url, `http://127.0.0.1:${port}/`);
  },
  async "serves a file with its type, and HEAD sends no body"() {
    const r = await fetch(url + "tracker.html");
    assert.strictEqual(r.status, 200);
    assert.match(r.headers.get("content-type"), /^text\/html/);
    assert.strictEqual(await r.text(), "<!DOCTYPE html><title>t</title>");
    const h = await raw("/sub%20dir/state.json", "HEAD");
    assert.strictEqual(status(h), 200);
    assert.match(h, /application\/json/);
    assert.ok(h.endsWith("\r\n\r\n"), "no body after the headers");
  },
  async "lists a folder, linking each entry, and redirects a folder without its slash"() {
    const r = await fetch(url);
    const body = await r.text();
    assert.match(body, /href="\/tracker\.html"/);
    assert.match(body, /href="\/sub%20dir\/"/);
    const nr = await fetch(url + "sub%20dir", { redirect: "manual" });
    assert.strictEqual(nr.status, 301);
    assert.strictEqual(nr.headers.get("location"), "/sub%20dir/");
  },
  async "refuses every path that leaves the folder"() {
    for (const t of ["/../secret.txt", "/sub%20dir/../../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/link.txt"]) {
      const r = await raw(t);
      assert.ok([403, 404].includes(status(r)), `${t} -> ${status(r)}`);
      assert.ok(!r.includes("outside"), `${t} leaked the outside file`);
    }
    assert.strictEqual(status(await raw("/%00")), 403);
  },
  async "answers 404 for a missing file and 405 for a write"() {
    assert.strictEqual((await fetch(url + "nope.html")).status, 404);
    assert.strictEqual((await fetch(url + "tracker.html", { method: "POST", body: "x" })).status, 405);
  },
  async "stops"() {
    await new Promise((r) => server.close(r));
    fs.rmSync(base, { recursive: true, force: true });
  },
};

run(tests);
