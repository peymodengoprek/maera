import { test } from "node:test";
import assert from "node:assert/strict";
import { formatValue, ratio, toBool, chartPath, EMPTY } from "../src/format.js";

test("formatValue", () => {
  assert.equal(formatValue(undefined), EMPTY);
  assert.equal(formatValue(null), EMPTY);
  assert.equal(formatValue(NaN), EMPTY);
  assert.equal(formatValue(24.1234), "24.12");
  assert.equal(formatValue(24), "24");
  assert.equal(formatValue(24.1234, 1), "24.1");
  assert.equal(formatValue(24, 2), "24.00");
  assert.equal(formatValue(true), "true");
  assert.equal(formatValue("ON"), "ON");
});

test("ratio", () => {
  assert.equal(ratio(25, 0, 50), 0.5);
  assert.equal(ratio(-10, 0, 50), 0);
  assert.equal(ratio(999, 0, 50), 1);
  assert.equal(ratio(undefined, 0, 50), 0);
  assert.equal(ratio("x", 0, 50), 0);
  assert.equal(ratio(5, 10, 10), 0);
});

test("toBool", () => {
  assert.equal(toBool(undefined), null);
  assert.equal(toBool(true), true);
  assert.equal(toBool(0), false);
  assert.equal(toBool(5), true);
  assert.equal(toBool("ON"), true);
  assert.equal(toBool("off"), false);
  assert.equal(toBool("???"), null);
  assert.equal(toBool(NaN), null);
});

test("chartPath", () => {
  assert.equal(chartPath([1], 10), null);
  const full = chartPath([0, 10], 2, { min: 0, max: 10, width: 100, height: 100, pad: 0 })!;
  assert.equal(full.line, "M0,100 L100,0");
  assert.equal(full.area, "M0,100 L100,0 L100,100 L0,100 Z");
  // data belum penuh: masuk dari kanan
  const part = chartPath([0, 10], 4, { min: 0, max: 10, width: 100, height: 100, pad: 0 })!;
  assert.equal(part.line, "M66.67,100 L100,0");
  // deret datar tidak menghasilkan NaN
  assert.ok(!chartPath([5, 5, 5], 3)!.line.includes("NaN"));
});