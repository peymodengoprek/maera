import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { compile, toDiagnosticPayload, type DiagnosticPayload, type PayloadDiagnostic } from "@maera-js/core";
import { createDiagnosticsView } from "../src/diagnostics.js";

function setupDOM() {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const container = doc.createElement("div") as unknown as HTMLElement;
  doc.body.appendChild(container);
  return { window, doc, container };
}

function keyEvent(window: Window, key: string): Event {
  const Ctor = (window as unknown as { KeyboardEvent?: typeof KeyboardEvent }).KeyboardEvent;
  if (Ctor) return new Ctor("keydown", { key });
  const event = new window.Event("keydown");
  Object.defineProperty(event, "key", { value: key });
  return event;
}

const ERROR_DIAGNOSTIC: PayloadDiagnostic = {
  code: "UNKNOWN_WIDGET",
  message: "Widget 'guage' tidak dikenal.",
  line: 4,
  column: 5,
  path: "widgets[0].type",
  severity: "error",
  group: "schema",
  suggestion: "gauge",
  suggestions: ["gauge"],
  location: "index.maera:4:5",
  codeFrame: {
    file: "index.maera",
    line: 4,
    column: 5,
    startLine: 2,
    endLine: 5,
    lines: [
      { line: 2, text: "  title: Demo", highlight: false, caret: false },
      { line: 3, text: "widgets:", highlight: false, caret: false },
      { line: 4, text: "  - type: guage", highlight: true, caret: true },
      { line: 5, text: "    bind: dev.level", highlight: false, caret: false },
    ],
    text: "  2 |   title: Demo\n  3 | widgets:\n> 4 |   - type: guage\n    |     ^\n  5 |     bind: dev.level",
  },
};

const WARNING_DIAGNOSTIC: PayloadDiagnostic = {
  code: "UNKNOWN_KEY",
  message: "Kunci 'titel' tidak dikenal.",
  line: 2,
  column: 3,
  path: "app.titel",
  severity: "warning",
  group: "schema",
  suggestion: "title",
  suggestions: ["title"],
  location: "index.maera:2:3",
  codeFrame: {
    file: "index.maera",
    line: 2,
    column: 3,
    startLine: 1,
    endLine: 3,
    lines: [
      { line: 1, text: "app:", highlight: false, caret: false },
      { line: 2, text: "  titel: T", highlight: true, caret: true },
      { line: 3, text: "sources:", highlight: false, caret: false },
    ],
    text: "  1 | app:\n> 2 |   titel: T\n    |   ^\n  3 | sources:",
  },
};

function errorPayload(): DiagnosticPayload {
  return {
    version: 1,
    ok: false,
    file: "index.maera",
    summary: { errors: 1, warnings: 0, infos: 0, suppressedCount: 0, total: 1 },
    text: "error[UNKNOWN_WIDGET] index.maera:4:5 (widgets[0].type)",
    diagnostics: [ERROR_DIAGNOSTIC],
    groups: [{ name: "schema", diagnostics: [ERROR_DIAGNOSTIC] }],
  };
}

function warningPayload(): DiagnosticPayload {
  return {
    version: 1,
    ok: true,
    file: "index.maera",
    summary: { errors: 0, warnings: 1, infos: 0, suppressedCount: 0, total: 1 },
    text: "warning[UNKNOWN_KEY] index.maera:2:3 (app.titel)",
    diagnostics: [WARNING_DIAGNOSTIC],
    groups: [{ name: "schema", diagnostics: [WARNING_DIAGNOSTIC] }],
  };
}

function validPayload(): DiagnosticPayload {
  return {
    version: 1,
    ok: true,
    file: "index.maera",
    summary: { errors: 0, warnings: 0, infos: 0, suppressedCount: 0, total: 0 },
    text: "",
    diagnostics: [],
    groups: [],
  };
}

test("overlay menampilkan header, badge kode, lokasi, saran typo, dan code frame tersorot", () => {
  const { doc } = setupDOM();
  const view = createDiagnosticsView(doc);

  view.update(errorPayload());

  const overlay = doc.querySelector<HTMLElement>(".maera-diagnostics-overlay");
  assert.ok(overlay, "Overlay harus muncul saat ada error");
  const text = overlay.textContent ?? "";
  assert.match(text, /Build gagal/);
  assert.match(text, /1 error/);
  assert.match(text, /UNKNOWN_WIDGET/);
  assert.match(text, /index\.maera:4:5/);
  assert.match(text, /widgets\[0\]\.type/);
  assert.match(text, /Mungkin maksud Anda:\s*gauge/);

  const highlight = overlay.querySelector<HTMLElement>('.maera-code-frame-line[data-highlight="true"]');
  assert.ok(highlight, "Baris bermasalah harus disorot");
  assert.match(highlight.textContent ?? "", /type: guage/);

  const gutter = highlight.querySelector<HTMLElement>(".maera-code-frame-gutter");
  assert.equal(gutter?.textContent?.trim(), "4");

  view.destroy();
  assert.equal(doc.querySelector(".maera-diagnostics-overlay"), null);
});

test("tombol Salin Error menyalin teks dan tombol Tutup/Esc menutup overlay", async () => {
  const { window, doc } = setupDOM();
  const view = createDiagnosticsView(doc);

  let copied = "";
  Object.defineProperty(window.navigator, "clipboard", {
    value: {
      writeText: async (value: string) => {
        copied = value;
      },
    },
    configurable: true,
  });

  view.update(errorPayload());
  const firstOverlay = doc.querySelector<HTMLElement>(".maera-diagnostics-overlay");
  assert.ok(firstOverlay);
  const copy = firstOverlay.querySelector<HTMLButtonElement>(".maera-diagnostics-copy");
  assert.ok(copy);
  copy.dispatchEvent(new window.Event("click"));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.match(copied, /UNKNOWN_WIDGET/);
  assert.equal(copy.textContent, "Tersalin");

  const close = firstOverlay.querySelector<HTMLButtonElement>(".maera-diagnostics-close");
  assert.ok(close);
  close.dispatchEvent(new window.Event("click"));
  assert.equal(doc.querySelector(".maera-diagnostics-overlay"), null);

  view.update(errorPayload());
  assert.ok(doc.querySelector(".maera-diagnostics-overlay"));
  doc.dispatchEvent(keyEvent(window, "Escape"));
  assert.equal(doc.querySelector(".maera-diagnostics-overlay"), null);

  view.destroy();
});

test("overlay hilang dan dashboard dirender ulang saat pembaruan valid tanpa error", () => {
  const { doc, container } = setupDOM();
  let renders = 0;
  const view = createDiagnosticsView(doc, {
    render() {
      renders += 1;
      container.textContent = "dashboard";
    },
  });

  view.update(errorPayload());
  assert.ok(doc.querySelector(".maera-diagnostics-overlay"));

  view.update(validPayload());
  assert.equal(doc.querySelector(".maera-diagnostics-overlay"), null);
  assert.equal(doc.querySelector(".maera-diagnostics-panel"), null);
  assert.equal(renders, 1);
  assert.equal(container.textContent, "dashboard");

  doc.dispatchEvent(keyEvent(doc.defaultView!, "Escape"));
  assert.equal(doc.querySelector(".maera-diagnostics-overlay"), null);

  view.destroy();
});

test("panel warning tampil non-blocking, dashboard tetap dirender, dan bisa dibuka-tutup", () => {
  const { window, doc, container } = setupDOM();
  let renders = 0;
  const view = createDiagnosticsView(doc, {
    render() {
      renders += 1;
      container.textContent = "dashboard";
    },
  });

  view.update(warningPayload());

  assert.equal(doc.querySelector(".maera-diagnostics-overlay"), null);
  assert.equal(renders, 1, "Dashboard harus tetap dirender saat hanya warning");
  assert.equal(container.textContent, "dashboard");

  const panel = doc.querySelector<HTMLElement>(".maera-diagnostics-panel");
  assert.ok(panel, "Panel warning harus muncul");
  assert.equal(panel.dataset["open"], "true");
  const text = panel.textContent ?? "";
  assert.match(text, /1 peringatan/);
  assert.match(text, /UNKNOWN_KEY/);
  assert.match(text, /index\.maera:2:3/);

  const toggle = panel.querySelector<HTMLButtonElement>(".maera-diagnostics-panel-toggle");
  assert.ok(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  toggle.dispatchEvent(new window.Event("click"));
  assert.equal(panel.dataset["open"], "false");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  toggle.dispatchEvent(new window.Event("click"));
  assert.equal(panel.dataset["open"], "true");

  view.destroy();
  assert.equal(doc.querySelector(".maera-diagnostics-panel"), null);
});

test("event maera:diagnostics memperbarui tampilan tanpa memasang ulang listener", () => {
  const { window, doc } = setupDOM();
  const view = createDiagnosticsView(doc);

  window.dispatchEvent(
    new window.CustomEvent("maera:diagnostics", { detail: errorPayload() }),
  );
  assert.ok(doc.querySelector(".maera-diagnostics-overlay"));

  window.dispatchEvent(
    new window.CustomEvent("maera:diagnostics", { detail: validPayload() }),
  );
  assert.equal(doc.querySelector(".maera-diagnostics-overlay"), null);

  view.destroy();
  window.dispatchEvent(
    new window.CustomEvent("maera:diagnostics", { detail: errorPayload() }),
  );
  assert.equal(doc.querySelector(".maera-diagnostics-overlay"), null, "Listener harus dilepas saat destroy");
});

test("payload hasil compile nyata dapat dirender sebagai overlay beserta code frame", () => {
  const source = `app:
  title: Demo
widgets:
  - type: guage
    bind: dev.level
`;
  const result = compile(source);
  assert.equal(result.ok, false);

  const payload = toDiagnosticPayload(result, source, { file: "index.maera" });
  const { doc } = setupDOM();
  const view = createDiagnosticsView(doc);
  view.update(payload);

  const overlay = doc.querySelector<HTMLElement>(".maera-diagnostics-overlay");
  assert.ok(overlay);
  assert.match(overlay.textContent ?? "", /UNKNOWN_WIDGET/);
  assert.match(overlay.textContent ?? "", /index\.maera:4:5/);
  assert.ok(overlay.querySelector(".maera-code-frame"));

  view.destroy();
});
