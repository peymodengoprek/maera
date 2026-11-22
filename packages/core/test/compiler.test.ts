import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile, parseBinding } from "../src/index.js";

const example = readFileSync(new URL("../../../examples/index.maera", import.meta.url), "utf8");

test("contoh index.maera terkompilasi tanpa error", () => {
  const r = compile(example);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.ast.app.title, "Greenhouse Monitor");
  assert.deepEqual(Object.keys(r.ast.sources), ["temperature", "humidity"]);
  assert.equal(r.ast.widgets.length, 5);
  assert.deepEqual(r.ast.widgets[0]!.bind, { s: "temperature", p: ["value"] });
  assert.equal(r.ast.widgets[0]!.props["max"], 50);
  assert.equal(r.ast.widgets[0]!.id, "w0");
});

test("parseBinding", () => {
  assert.deepEqual(parseBinding("a.b.c"), { s: "a", p: ["b", "c"] });
  assert.equal(parseBinding("noDot"), null);
  assert.equal(parseBinding("a..b"), null);
});

test("sintaks YAML rusak -> error dengan nomor baris", () => {
  const r = compile("app:\n  title: x\n sources: [");
  assert.equal(r.ok, false);
  assert.equal(r.errors[0]!.code, "YAML_SYNTAX");
  assert.ok(r.errors[0]!.line !== null);
});

test("bagian wajib hilang", () => {
  const r = compile("foo: 1");
  assert.equal(r.ok, false);
  const codes = r.errors.map((e) => e.path);
  assert.deepEqual(codes, ["", "", ""]);
  assert.equal(r.errors.length, 3);
});

const base = (widgets: string) => `app:
  title: T
sources:
  temp:
    type: mock
widgets:
${widgets}`;

test("widget tak dikenal dilaporkan dengan baris yang benar", () => {
  const src = base("  - type: stat\n    bind: temp.value\n  - type: banana\n    bind: temp.value\n");
  const r = compile(src);
  assert.equal(r.ok, false);
  const e = r.errors[0]!;
  assert.equal(e.code, "UNKNOWN_WIDGET");
  assert.equal(e.path, "widgets[1].type");
  assert.match(src.split("\n")[e.line! - 1]!, /type: banana/);
});

test("binding ke source yang tidak ada", () => {
  const src = base("  - type: stat\n    bind: ghost.value\n");
  const r = compile(src);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0]!.code, "UNKNOWN_SOURCE");
  assert.equal(r.errors[0]!.path, "widgets[0].bind");
  assert.equal(src.split("\n")[r.errors[0]!.line! - 1]!.trim(), "bind: ghost.value");
});

test("binding berformat salah & tipe properti salah", () => {
  const r = compile(base("  - type: gauge\n    bind: tempvalue\n    min: abc\n"));
  assert.equal(r.ok, false);
  const codes = r.errors.map((e) => e.code).sort();
  assert.deepEqual(codes, ["INVALID_BINDING", "INVALID_TYPE"]);
});

test("min >= max ditolak; span di luar rentang ditolak", () => {
  const r = compile(base("  - type: gauge\n    bind: temp.value\n    min: 10\n    max: 5\n    span: 20\n"));
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => e.code).sort(), ["OUT_OF_RANGE", "OUT_OF_RANGE"]);
});

test("widget text wajib content; widget lain wajib bind", () => {
  const r = compile(base("  - type: text\n  - type: stat\n"));
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => e.path), ["widgets[0].content", "widgets[1].bind"]);
});

test("source rest butuh url http(s)", () => {
  const r = compile("app:\n  title: T\nsources:\n  x:\n    type: rest\n    url: ftp://a\nwidgets: []\n");
  assert.equal(r.ok, false);
  assert.equal(r.errors[0]!.path, "sources.x.url");
  assert.equal(r.errors[0]!.line, 6);
});

test("sequence sejajar dengan induk (tanpa indentasi) tetap terlacak", () => {
  const src = "app:\n  title: T\nsources:\n  t:\n    type: mock\nwidgets:\n- type: nope\n";
  const r = compile(src);
  assert.equal(r.errors[0]!.line, 7);
});

// ── state: / steps: ───────────────────────────────────────────────

const withWidget = (w: string) => base(w);

test("state: bentuk string dan objek terkompilasi", () => {
  const r = compile(
    withWidget(
      "  - type: status\n    bind: temp.value\n    state:\n      threshold: 30\n      above: { text: Panas, status: danger }\n      below: Normal\n",
    ),
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.ast.widgets[0]!.conditional, {
    kind: "state",
    threshold: 30,
    above: { text: "Panas", status: "danger" },
    below: { text: "Normal" },
  });
});

test("steps: diurutkan menurun, cadangan (tanpa at) paling akhir", () => {
  const r = compile(
    withWidget(
      "  - type: gauge\n    bind: temp.value\n    steps:\n      - text: Dingin\n      - at: 20\n        status: warning\n      - at: 80\n        text: Penuh\n        status: ok\n",
    ),
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const c = r.ast.widgets[0]!.conditional!;
  assert.equal(c.kind, "steps");
  if (c.kind === "steps") assert.deepEqual(c.steps.map((s) => s.at), [80, 20, null]);
});

test("steps: kesalahan dilaporkan dengan path dan baris yang benar", () => {
  const src = withWidget(
    "  - type: gauge\n    bind: temp.value\n    steps:\n      - at: 50\n        status: denger\n      - at: 50\n        text: X\n      - at: 10\n",
  );
  const r = compile(src);
  assert.equal(r.ok, false);
  const byCode = Object.fromEntries(r.errors.map((e) => [e.code, e]));
  assert.equal(byCode["INVALID_STATUS"]!.path, "widgets[0].steps[0].status");
  assert.match(src.split("\n")[byCode["INVALID_STATUS"]!.line! - 1]!, /status: denger/);
  assert.equal(byCode["DUPLICATE_STEP"]!.path, "widgets[0].steps[1].at");
  assert.match(src.split("\n")[byCode["DUPLICATE_STEP"]!.line! - 1]!, /at: 50/);
  assert.equal(byCode["MISSING_FIELD"]!.path, "widgets[0].steps[2]");
});

test("state: threshold wajib, kunci salah ketik ditolak, minimal satu hasil", () => {
  const r1 = compile(withWidget("  - type: stat\n    bind: temp.value\n    state:\n      above: Panas\n"));
  assert.equal(r1.errors[0]!.path, "widgets[0].state.threshold");
  const r2 = compile(withWidget("  - type: stat\n    bind: temp.value\n    state:\n      threshold: 5\n      abov: Panas\n"));
  assert.equal(r2.errors.some((e) => e.code === "UNKNOWN_KEY" && e.path === "widgets[0].state.abov"), true);
  const r3 = compile(withWidget("  - type: stat\n    bind: temp.value\n    state:\n      threshold: 5\n"));
  assert.equal(r3.errors[0]!.code, "MISSING_FIELD");
});

test("state dan steps tidak boleh bersamaan; widget lain menolaknya", () => {
  const both = compile(
    withWidget("  - type: stat\n    bind: temp.value\n    state: { threshold: 1, above: A }\n    steps:\n      - at: 1\n        text: A\n"),
  );
  assert.equal(both.ok, false);
  const chart = compile(withWidget("  - type: chart\n    bind: temp.value\n    state: { threshold: 1, above: A }\n"));
  assert.equal(chart.errors[0]!.code, "UNSUPPORTED");
});