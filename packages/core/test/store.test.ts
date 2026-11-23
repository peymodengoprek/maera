import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, startSources, compile } from "../src/index.js";

test("set/get/getBinding", () => {
  const s = createStore();
  s.set("t", { value: 21, meta: { unit: "C" } });
  assert.equal(s.get("t")!["value"], 21);
  assert.equal(s.getBinding({ s: "t", p: ["meta", "unit"] }), "C");
  assert.equal(s.getBinding({ s: "nope", p: ["x"] }), undefined);
});

test("sub, wildcard, dan unsubscribe", () => {
  const s = createStore();
  const seen: string[] = [];
  const off = s.sub("a", (d) => seen.push(`a:${d["value"]}`));
  s.sub("*", (_d, src) => seen.push(`*:${src}`));
  s.set("a", { value: 1 });
  off();
  s.set("a", { value: 2 });
  assert.deepEqual(seen, ["a:1", "*:a", "*:a"]);
});

test("history dibatasi dan urut", () => {
  let t = 0;
  const s = createStore({ historyLimit: 3, now: () => ++t });
  for (let i = 1; i <= 5; i++) s.set("x", { value: i });
  assert.deepEqual(s.history("x").map((e) => e.data["value"]), [3, 4, 5]);
  assert.deepEqual(s.history("x", 2).map((e) => e.t), [4, 5]);
  assert.deepEqual(s.historyOf({ s: "x", p: ["value"] }).map((e) => e.v), [3, 4, 5]);
});

test("subBinding hanya terpanggil saat nilai berubah", () => {
  const s = createStore();
  const got: unknown[] = [];
  s.subBinding({ s: "x", p: ["value"] }, (v) => got.push(v));
  s.set("x", { value: 1 });
  s.set("x", { value: 1 });
  s.set("x", { value: 2 });
  assert.deepEqual(got, [1, 2]);
});

test("mock source: emisi langsung, tetap dalam rentang, berhenti saat stop()", async () => {
  const r = compile("app:\n  title: T\nsources:\n  t:\n    type: mock\n    interval: 50\n    min: 10\n    max: 20\n    unit: C\nwidgets: []\n");
  assert.ok(r.ok);
  if (!r.ok) return;
  const store = createStore();
  const runner = startSources(r.ast, store);
  assert.ok(store.get("t"), "emisi pertama harus sinkron");
  await new Promise((res) => setTimeout(res, 180));
  runner.stop();
  const n = store.history("t").length;
  assert.ok(n >= 3, `riwayat ${n}`);
  for (const e of store.history("t")) {
    const v = e.data["value"] as number;
    assert.ok(v >= 10 && v <= 20);
    assert.equal(e.data["unit"], "C");
  }
  await new Promise((res) => setTimeout(res, 120));
  assert.equal(store.history("t").length, n, "tidak boleh ada emisi setelah stop()");
});

test("rest source: ambil path, bungkus nilai primitif, lapor error, lanjut polling", async () => {  const r = compile("app:\n  title: T\nsources:\n  p:\n    type: rest\n    url: http://x/api\n    interval: 50\n    path: data.pump\nwidgets: []\n");
  assert.ok(r.ok);
  if (!r.ok) return;
  let calls = 0;
  const errors: string[] = [];
  const fakeFetch = (async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ data: { pump: calls % 2 === 0 } }) };
  }) as unknown as typeof fetch;
  const store = createStore();
  const runner = startSources(r.ast, store, { fetch: fakeFetch, onError: (s, e) => errors.push(`${s}:${(e as Error).message}`) });
  await new Promise((res) => setTimeout(res, 200));
  runner.stop();
  assert.equal(errors[0], "p:HTTP 500 dari http://x/api");
  assert.equal(typeof store.get("p")!["value"], "boolean");
  assert.ok(calls >= 3);
  const after = calls;
  await new Promise((res) => setTimeout(res, 120));
  assert.equal(calls, after, "polling berhenti setelah stop()");
});
// --- store.write() ---

test("write: reject jika source tidak punya writer", async () => {
  const s = createStore();
  await assert.rejects(
    () => s.write({ s: "ghost", p: ["value"] }, 1),
    /tidak mendukung operasi tulis/,
  );
});

test("write: memanggil writer terdaftar dan unsubscribe melepasnya", async () => {
  const s = createStore();
  const calls: Array<[string[], unknown]> = [];
  const off = s.registerWriter("dev", (b, v) => {
    calls.push([b.p, v]);
  });
  await s.write({ s: "dev", p: ["value"] }, true);
  assert.deepEqual(calls, [[["value"], true]]);
  off();
  await assert.rejects(() => s.write({ s: "dev", p: ["value"] }, false));
});

test("write: error dari writer diteruskan sebagai rejection", async () => {
  const s = createStore();
  s.registerWriter("dev", async () => {
    throw new Error("terputus");
  });
  await assert.rejects(
    () => s.write({ s: "dev", p: ["value"] }, 1),
    /terputus/,
  );
});

test("write mock: memperbarui nilai binding di store", async () => {
  const r = compile("app:\n  title: T\nsources:\n  t:\n    type: mock\n    interval: 50\nwidgets: []\n");
  assert.ok(r.ok);
  if (!r.ok) return;
  const store = createStore();
  const runner = startSources(r.ast, store);
  await store.write({ s: "t", p: ["value"] }, 42);
  assert.equal(store.getBinding({ s: "t", p: ["value"] }), 42);
  runner.stop();
  await assert.rejects(() => store.write({ s: "t", p: ["value"] }, 1));
});

test("write rest: POST JSON default, write_url/write_method, reject saat gagal", async () => {
  const r = compile("app:\n  title: T\nsources:\n  api:\n    type: rest\n    url: http://x/api\n    write_url: http://x/act\n    write_method: put\n    interval: 100000\nwidgets: []\n");
  assert.ok(r.ok);
  if (!r.ok) return;
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return { ok: true, status: 200, json: async () => ({}) };
  }) as unknown as typeof fetch;
  const store = createStore();
  const runner = startSources(r.ast, store, { fetch: fakeFetch });
  await store.write({ s: "api", p: ["value"] }, true);
  const req = requests[requests.length - 1]!;
  assert.equal(req.url, "http://x/act");
  assert.equal(req.init.method, "PUT");
  assert.deepEqual(JSON.parse(req.init.body as string), { path: "value", value: true });
  runner.stop();

  const failFetch = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
  const store2 = createStore();
  const runner2 = startSources(r.ast, store2, { fetch: failFetch });
  await assert.rejects(
    () => store2.write({ s: "api", p: ["value"] }, 1),
    /HTTP 500/,
  );
  runner2.stop();
  await assert.rejects(() => store2.write({ s: "api", p: ["value"] }, 1));
});


