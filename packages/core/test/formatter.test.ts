import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compile,
  createCodeFrame,
  formatDiagnostics,
  formatLocation,
  toDiagnosticPayload,
} from "../src/index.js";

const invalidWidget = `app:
  title: T
sources:
  temp:
    type: mock
widgets:
  - type: banana
    bind: temp.value
`;

test("createCodeFrame menampilkan konteks, penanda baris, dan kolom", () => {
  const source = `app:
  title: T
sources:
  temp:
    type: mock
widgets:
  - type: banana
    bind: temp.value`;

  const frame = createCodeFrame(source, 7, {
    file: "index.maera",
    column: 11,
    contextLines: 1,
  });

  assert.ok(frame);
  assert.equal(frame.file, "index.maera");
  assert.equal(frame.line, 7);
  assert.equal(frame.column, 11);
  assert.equal(frame.startLine, 6);
  assert.equal(frame.endLine, 8);
  assert.equal(frame.lines.length, 3);
  assert.equal(frame.lines.filter((l) => l.highlight).length, 1);
  assert.equal(frame.lines.find((l) => l.highlight)!.caret, true);
  assert.match(frame.text, /> 7 \|   - type: banana/);
  assert.match(frame.text, /\^/);
});

test("createCodeFrame mengembalikan null untuk baris di luar jangkauan", () => {
  assert.equal(createCodeFrame("app:\n  title: T", 0), null);
  assert.equal(createCodeFrame("app:\n  title: T", 99), null);
  assert.equal(createCodeFrame("app:\n  title: T", null), null);
});

test("formatLocation menghasilkan file:line:column", () => {
  assert.equal(formatLocation("index.maera", 7, 5), "index.maera:7:5");
  assert.equal(formatLocation("index.maera", 7), "index.maera:7");
  assert.equal(formatLocation(undefined, 7, 5), "<maera>:7:5");
  assert.equal(formatLocation("index.maera", null, 5), "index.maera");
});

test("formatDiagnostics menampilkan code frame, lokasi, dan ringkasan", () => {
  const result = compile(invalidWidget);
  const text = formatDiagnostics(result, invalidWidget, { file: "index.maera" });

  assert.match(text, /error\[UNKNOWN_WIDGET\] index\.maera:7:5/);
  assert.match(text, /widgets\[0\]\.type/);
  assert.match(text, /> 7 \|   - type: banana/);
  assert.match(text, /1 errors, 0 warnings, 0 infos/);
  assert.equal(text.includes("\u001b["), false);
});

test("formatDiagnostics mendukung warna ANSI dan mengelompokkan diagnostik", () => {
  const source = `app:
  title: T
  titel: X
sources:
  temp:
    type: mock
widgets:
  - type: banana
    bind: temp.value
`;
  const result = compile(source);
  const plain = formatDiagnostics(result, source, { file: "index.maera", color: false });
  const colored = formatDiagnostics(result, source, { file: "index.maera", color: true });

  assert.match(plain, /── schema ──/);
  assert.match(plain, /── widget ──/);
  assert.equal(plain.includes("\u001b["), false);
  assert.equal(colored.includes("\u001b["), true);
});

test("toDiagnosticPayload menyertakan grouping, lokasi, code frame, dan saran", () => {
  const source = `app:
  title: T
sources:
  temp:
    type: mock
widgets:
  - type: stat
    bind: tempp.value
`;
  const result = compile(source);
  const payload = toDiagnosticPayload(result, source, { file: "index.maera" });

  assert.equal(payload.version, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.summary.errors, result.summary.errors);
  assert.ok(payload.diagnostics.length > 0);
  assert.ok(payload.groups.some((g) => g.name === "binding"));

  const unknown = payload.diagnostics.find((d) => d.code === "UNKNOWN_SOURCE")!;
  assert.equal(unknown.suggestion, "temp");
  assert.match(unknown.location, /^index\.maera:\d+:\d+$/);
  assert.ok(unknown.codeFrame);
  assert.match(unknown.codeFrame!.text, /> \d+ \|/);
  assert.equal(payload.text.includes("\u001b["), false);
});

test("toDiagnosticPayload memuat suppressed tetapi teks terminal tidak", () => {
  const source = `app:
  title: T
sources:
  temp:
    type: mock
    maxaaaaaaa: 1
widgets:
  - type: stat
    bind: temp.value
`;
  const result = compile(source);
  const payload = toDiagnosticPayload(result, source, { file: "index.maera" });

  assert.equal(payload.summary.suppressedCount, 1);
  assert.ok(payload.diagnostics.some((d) => d.suppressed));
  assert.equal(payload.text.includes("ditekan"), false);
  assert.match(payload.text, /suppressed/);
});
