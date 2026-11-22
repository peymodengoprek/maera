import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, evaluate, type Conditional } from "../src/index.js";

const steps: Conditional = {
  kind: "steps",
  steps: [
    { at: 100, outcome: { text: "Penuh", status: "ok" } },
    { at: 50, outcome: { text: "Setengah", status: "warning" } },
    { at: 20, outcome: { text: "Hampir habis", status: "danger" } },
  ],
};

test("steps: nilai >= at terbesar yang cocok (batas inklusif)", () => {
  assert.equal(evaluate(steps, 100)?.text, "Penuh");
  assert.equal(evaluate(steps, 120)?.text, "Penuh");
  assert.equal(evaluate(steps, 99.9)?.text, "Setengah");
  assert.equal(evaluate(steps, 50)?.text, "Setengah");
  assert.equal(evaluate(steps, 20)?.status, "danger");
  assert.equal(evaluate(steps, 19.9), undefined); // di bawah semua `at`, tanpa cadangan
});

test("steps: cadangan menangkap nilai di bawah semua at", () => {
  const c: Conditional = { kind: "steps", steps: [...(steps as { steps: never[] }).steps, { at: null, outcome: { text: "Kosong" } }] };
  assert.equal(evaluate(c, -5)?.text, "Kosong");
  assert.equal(evaluate(c, 60)?.text, "Setengah");
});

test("state: above / below / equal", () => {
  const c: Conditional = {
    kind: "state",
    threshold: 30,
    above: { text: "Panas", status: "danger" },
    below: { text: "Normal" },
    equal: { text: "Pas" },
  };
  assert.equal(evaluate(c, 31)?.text, "Panas");
  assert.equal(evaluate(c, 29.99)?.text, "Normal");
  assert.equal(evaluate(c, 30)?.text, "Pas");
});

test("state: tanpa equal, nilai tepat di threshold dihitung above", () => {
  const c: Conditional = { kind: "state", threshold: 30, above: { text: "Panas" }, below: { text: "Normal" } };
  assert.equal(evaluate(c, 30)?.text, "Panas");
});

test("state: hasil yang tidak ditulis -> undefined; bukan angka -> undefined", () => {
  const c: Conditional = { kind: "state", threshold: 30, above: { text: "Panas" } };
  assert.equal(evaluate(c, 10), undefined);
  assert.equal(evaluate(c, "40"), undefined);
  assert.equal(evaluate(c, undefined), undefined);
  assert.equal(evaluate(c, NaN), undefined);
});

test("integrasi: compile lalu evaluate", () => {
  const r = compile(
    "app:\n  title: T\nsources:\n  b:\n    type: mock\nwidgets:\n  - type: gauge\n    bind: b.value\n    steps:\n      - at: 50\n        text: Cukup\n      - at: 0\n        text: Rendah\n        status: danger\n",
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  const c = r.ast.widgets[0]!.conditional!;
  assert.equal(evaluate(c, 75)?.text, "Cukup");
  assert.equal(evaluate(c, 10)?.status, "danger");
});