import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { compile, createStore, startSources } from "@maera-js/core";
import { mount } from "../src/mount.js";

function setupDOM() {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const container = doc.createElement("div") as unknown as HTMLElement;
  doc.body.appendChild(container);
  return { window, doc, container };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const YAML = `
app:
  title: Test Lifecycle
sources:
  dev:
    type: mock
    interval: 50
    min: 10
    max: 20
widgets:
  - type: stat
    bind: dev.value
`;

test("default mount(container, ast) stops source on destroy", async () => {
  const res = compile(YAML);
  assert.ok(res.ok);
  if (!res.ok) return;
  const { container } = setupDOM();
  const handle = mount(container, res.ast);
  await sleep(180);
  const before = handle.store.history("dev").length;
  assert.ok(before >= 2);
  handle.destroy();
  await sleep(140);
  const after = handle.store.history("dev").length;
  assert.equal(after, before);
  assert.equal(container.childElementCount, 0);
});

test("external store + manageSources:false keeps source running after destroy", async () => {
  const res = compile(YAML);
  assert.ok(res.ok);
  if (!res.ok) return;
  const { container } = setupDOM();
  const store = createStore();
  const runner = startSources(res.ast, store);
  const handle = mount(container, res.ast, { store, manageSources: false });
  assert.equal(handle.store, store);
  await sleep(180);
  const before = store.history("dev").length;
  assert.ok(before >= 2);
  handle.destroy();
  assert.equal(container.childElementCount, 0);
  await sleep(140);
  const after = store.history("dev").length;
  assert.ok(after > before, "source eksternal harus tetap berjalan");
  runner.stop();
});

test("manageSources:false does not start internal sources", async () => {
  const res = compile(YAML);
  assert.ok(res.ok);
  if (!res.ok) return;
  const { container } = setupDOM();
  const store = createStore();
  const handle = mount(container, res.ast, { store, manageSources: false });
  await sleep(180);
  assert.equal(store.history("dev").length, 0);
  handle.destroy();
});

test("backward-compat mount(ast, container) still works", async () => {
  const res = compile(YAML);
  assert.ok(res.ok);
  if (!res.ok) return;
  const { container } = setupDOM();
  const handle = mount(res.ast, container, { run: true });
  await sleep(120);
  assert.ok(handle.store.history("dev").length >= 1);
  handle.destroy();
});