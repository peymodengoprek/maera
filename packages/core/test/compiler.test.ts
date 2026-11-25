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

test("min >= max ditolak; cols dan rows di luar rentang ditolak", () => {
  const r = compile(base("  - type: gauge\n    bind: temp.value\n    min: 10\n    max: 5\n    cols: 20\n    rows: 10\n"));
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => e.code).sort(), ["OUT_OF_RANGE", "OUT_OF_RANGE", "OUT_OF_RANGE"]);
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
});

// ── switch & slider ───────────────────────────────────────────────

test("widget switch terkompilasi dengan label opsional", () => {
  const r = compile(
    withWidget(
      "  - type: switch\n    bind: temp.value\n    label: Pompa\n  - type: switch\n    bind: temp.value\n",
    ),
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.ast.widgets[0]!.type, "switch");
  assert.deepEqual(r.ast.widgets[0]!.bind, { s: "temp", p: ["value"] });
  assert.equal(r.ast.widgets[0]!.props["label"], "Pompa");
  assert.equal(r.ast.widgets[1]!.props["label"], undefined);
});

test("widget switch wajib bind", () => {
  const r = compile(withWidget("  - type: switch\n    label: X\n"));
  assert.equal(r.ok, false);
  assert.equal(r.errors[0]!.code, "MISSING_FIELD");
  assert.equal(r.errors[0]!.path, "widgets[0].bind");
});

test("widget switch menolak kunci asing dengan nomor baris", () => {
  const src = withWidget("  - type: switch\n    bind: temp.value\n    warna: merah\n");
  const r = compile(src);
  assert.equal(r.ok, false);
  const e = r.errors.find((x) => x.code === "UNKNOWN_KEY")!;
  assert.ok(e);
  assert.equal(e.path, "widgets[0].warna");
  assert.equal(e.line, 9);
  assert.match(src.split("\n")[e.line! - 1]!, /warna: merah/);
});

test("widget slider terkompilasi dengan min/max/step", () => {
  const r = compile(
    withWidget(
      "  - type: slider\n    bind: temp.value\n    min: 0\n    max: 100\n    step: 5\n",
    ),
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const w = r.ast.widgets[0]!;
  assert.equal(w.type, "slider");
  assert.deepEqual(w.bind, { s: "temp", p: ["value"] });
  assert.equal(w.props["min"], 0);
  assert.equal(w.props["max"], 100);
  assert.equal(w.props["step"], 5);
});

test("widget slider wajib bind dan validasi min < max serta step > 0", () => {
  const r = compile(
    withWidget(
      "  - type: slider\n    min: 10\n    max: 5\n    step: 0\n",
    ),
  );
  assert.equal(r.ok, false);
  const paths = r.errors.map((e) => e.path);
  assert.ok(paths.includes("widgets[0].bind"));
  assert.ok(paths.includes("widgets[0].min"));
  assert.ok(paths.includes("widgets[0].step"));
  const codes = r.errors.map((e) => e.code);
  assert.ok(codes.includes("MISSING_FIELD"));
  assert.ok(codes.includes("OUT_OF_RANGE"));
});

test("widget slider menolak kunci asing dan tipe non-numerik", () => {
  const r = compile(
    withWidget("  - type: slider\n    bind: temp.value\n    min: abc\n    foo: 1\n"),
  );
  assert.equal(r.ok, false);
  const byPath = Object.fromEntries(r.errors.map((e) => [e.path, e]));
  assert.equal(byPath["widgets[0].min"]?.code, "INVALID_TYPE");
  assert.equal(byPath["widgets[0].foo"]?.code, "UNKNOWN_KEY");
});


test("opsi tulis source rest & mqtt diterima dan divalidasi", () => {
  const ok = compile(`app:
  title: T
sources:
  api:
    type: rest
    url: http://localhost/api
    write_url: http://localhost/api/pump
    write_method: put
  mq:
    type: mqtt
    url: wss://localhost/mqtt
    topic: in/topic
    write_topic: out/topic
widgets: []
`);
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  const rest = ok.ast.sources["api"]!;
  assert.equal(rest.type, "rest");
  if (rest.type === "rest") {
    assert.equal(rest.write_url, "http://localhost/api/pump");
    assert.equal(rest.write_method, "PUT");
  }
  const mq = ok.ast.sources["mq"]!;
  if (mq.type === "mqtt") assert.equal(mq.write_topic, "out/topic");

  const bad = compile(`app:
  title: T
sources:
  api:
    type: rest
    url: http://localhost/api
    write_url: ftp://x
    write_method: DELETE
  mq:
    type: mqtt
    url: wss://localhost/mqtt
    topic: in/topic
    write_topic: ""
widgets: []
`);
  assert.equal(bad.ok, false);
  const byPath = Object.fromEntries(bad.errors.map((e) => [e.path, e]));
  assert.equal(byPath["sources.api.write_url"]?.code, "INVALID_TYPE");
  assert.equal(byPath["sources.api.write_url"]?.line, 7);
  assert.equal(byPath["sources.api.write_method"]?.code, "INVALID_TYPE");
  assert.equal(byPath["sources.mq.write_topic"]?.code, "INVALID_TYPE");
});

test("kunci tidak dikenal pada level app ditolak dengan nomor baris dan pilihan valid", () => {
  const src = "app:\n  title: Test\n  titel: SalahKetik\n  colums: 12\nsources:\n  temp:\n    type: mock\nwidgets: []\n";
  const r = compile(src);
  assert.equal(r.ok, false);
  const errors = r.errors.filter((e) => e.code === "UNKNOWN_KEY");
  assert.equal(errors.length, 2);

  const e1 = errors.find((e) => e.path === "app.titel")!;
  assert.ok(e1);
  assert.equal(e1.line, 3);
  assert.match(e1.message, /title, theme/);

  const e2 = errors.find((e) => e.path === "app.colums")!;
  assert.ok(e2);
  assert.equal(e2.line, 4);
  assert.match(e2.message, /title, theme/);
});

test("kunci tidak dikenal pada level source ditolak (mock dan rest)", () => {
  const src = `app:
  title: T
sources:
  temp:
    type: mock
    intervall: 1000
  api:
    type: rest
    url: http://localhost:3000/api
    urll: http://localhost:3000/api
widgets: []
`;
  const r = compile(src);
  assert.equal(r.ok, false);
  const errors = r.errors.filter((e) => e.code === "UNKNOWN_KEY");
  assert.equal(errors.length, 2);

  const eMock = errors.find((e) => e.path === "sources.temp.intervall")!;
  assert.ok(eMock);
  assert.equal(eMock.line, 6);
  assert.match(eMock.message, /type, interval, min, max, unit/);

  const eRest = errors.find((e) => e.path === "sources.api.urll")!;
  assert.ok(eRest);
  assert.equal(eRest.line, 10);
  assert.match(eRest.message, /type, url, interval, path, headers/);
});

test("kunci tidak dikenal pada level widget ditolak untuk setiap tipe widget", () => {
  const src = `app:
  title: T
sources:
  temp:
    type: mock
widgets:
  - type: stat
    bind: temp.value
    titel: Suhu
  - type: chart
    bind: temp.value
    colums: 6
  - type: text
    content: Halo
    bind: temp.value
`;
  const r = compile(src);
  assert.equal(r.ok, false);
  const errors = r.errors.filter((e) => e.code === "UNKNOWN_KEY");
  assert.equal(errors.length, 2);

  const eStat = errors.find((e) => e.path === "widgets[0].titel")!;
  assert.ok(eStat);
  assert.equal(eStat.line, 9);
  assert.match(eStat.message, /type, title, cols, rows, state, steps, bind, unit, decimals/);

  const eChart = errors.find((e) => e.path === "widgets[1].colums")!;
  assert.ok(eChart);
  assert.equal(eChart.line, 12);
  assert.match(eChart.message, /type, title, cols, rows, state, steps, bind, points, unit, min, max/);

});

test("source websocket dan mqtt terkompilasi valid", () => {
  const src = `app:
  title: Realtime
sources:
  ws:
    type: websocket
    url: ws://localhost:8080/stream
    path: sensor.value
    reconnect_ms: 500
    max_reconnect_ms: 5000
  mq:
    type: mqtt
    url: wss://localhost:8083/mqtt
    topic: telemetry/greenhouse
    path: temp
widgets:
  - type: stat
    bind: ws.value
  - type: stat
    bind: mq.temp
`;
  const r = compile(src);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.ast.sources["ws"]?.type, "websocket");
  assert.equal(r.ast.sources["ws"]?.url, "ws://localhost:8080/stream");
  assert.equal(r.ast.sources["ws"]?.path, "sensor.value");
  assert.equal(r.ast.sources["ws"]?.reconnect_ms, 500);
  assert.equal(r.ast.sources["ws"]?.max_reconnect_ms, 5000);

  assert.equal(r.ast.sources["mq"]?.type, "mqtt");
  assert.equal(r.ast.sources["mq"]?.url, "wss://localhost:8083/mqtt");
  assert.equal(r.ast.sources["mq"]?.topic, "telemetry/greenhouse");
  assert.equal(r.ast.sources["mq"]?.path, "temp");
});

test("validasi kesalahan websocket dan mqtt dilaporkan dengan path dan nomor baris", () => {
  const src = `app:
  title: Realtime Errors
sources:
  bad_ws:
    type: websocket
    url: http://localhost:8080
    path: 123
    unknown_prop: abc
  missing_ws:
    type: websocket
  bad_mq:
    type: mqtt
    url: ftp://localhost:8083
    topic: ""
    reconnect_ms: 10
  missing_mq_topic:
    type: mqtt
    url: ws://localhost:8083
    reconnect_ms: 5000
    max_reconnect_ms: 1000
widgets: []
`;
  const r = compile(src);
  assert.equal(r.ok, false);

  const byPath = Object.fromEntries(r.errors.map((e) => [e.path, e]));

  assert.equal(byPath["sources.bad_ws.url"]?.code, "INVALID_TYPE");
  assert.equal(byPath["sources.bad_ws.url"]?.line, 6);

  assert.equal(byPath["sources.bad_ws.path"]?.code, "INVALID_TYPE");
  assert.equal(byPath["sources.bad_ws.path"]?.line, 7);

  assert.equal(byPath["sources.bad_ws.unknown_prop"]?.code, "UNKNOWN_KEY");
  assert.equal(byPath["sources.bad_ws.unknown_prop"]?.line, 8);
  assert.match(byPath["sources.bad_ws.unknown_prop"]?.message ?? "", /type, url, path, reconnect_ms, max_reconnect_ms/);

  assert.equal(byPath["sources.missing_ws.url"]?.code, "MISSING_FIELD");
  assert.equal(byPath["sources.missing_ws.url"]?.line, 9);

  assert.equal(byPath["sources.bad_mq.url"]?.code, "INVALID_TYPE");
  assert.equal(byPath["sources.bad_mq.url"]?.line, 13);

  assert.equal(byPath["sources.bad_mq.topic"]?.code, "INVALID_TYPE");
  assert.equal(byPath["sources.bad_mq.topic"]?.line, 14);

  assert.equal(byPath["sources.bad_mq.reconnect_ms"]?.code, "OUT_OF_RANGE");
  assert.equal(byPath["sources.bad_mq.reconnect_ms"]?.line, 15);

  assert.equal(byPath["sources.missing_mq_topic.topic"]?.code, "MISSING_FIELD");
  assert.equal(byPath["sources.missing_mq_topic.topic"]?.line, 16);

  assert.equal(byPath["sources.missing_mq_topic.reconnect_ms"]?.code, "OUT_OF_RANGE");
  assert.equal(byPath["sources.missing_mq_topic.reconnect_ms"]?.line, 19);
});

test("penolakan app.columns dengan UNKNOWN_KEY dan nomor baris akurat", () => {
  const src = `app:
  title: Test
  columns: 12
sources:
  temp:
    type: mock
widgets: []
`;
  const r = compile(src);
  assert.equal(r.ok, false);
  const err = r.errors.find((e) => e.path === "app.columns")!;
  assert.ok(err);
  assert.equal(err.code, "UNKNOWN_KEY");
  assert.equal(err.line, 3);
  assert.match(err.message, /title, theme/);
});

test("penolakan widget.span dengan UNKNOWN_KEY, nomor baris akurat, dan saran cols", () => {
  const src = base("  - type: stat\n    bind: temp.value\n    span: 4\n");
  const r = compile(src);
  assert.equal(r.ok, false);
  const err = r.errors.find((e) => e.path === "widgets[0].span")!;
  assert.ok(err);
  assert.equal(err.code, "UNKNOWN_KEY");
  assert.equal(err.line, 9);
  assert.match(err.message, /cols/);
});

test("penerimaan dan default nilai cols (1..12) serta rows (1..6) di AST", () => {
  const src = base("  - type: stat\n    bind: temp.value\n");
  const r = compile(src);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.ast.app.columns, 12);
  assert.equal(r.ast.widgets[0]!.cols, 3);
  assert.equal(r.ast.widgets[0]!.rows, 1);

  const custom = base("  - type: chart\n    bind: temp.value\n    cols: 8\n    rows: 2\n");
  const r2 = compile(custom);
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  assert.equal(r2.ast.widgets[0]!.cols, 8);
  assert.equal(r2.ast.widgets[0]!.rows, 2);
});

test("cascade suppression: source invalid tidak memicu UNKNOWN_SOURCE", () => {
  const src = `app:
  title: T
sources:
  temp:
    type: mock
    maxaaaaaaa: 1
widgets:
  - type: stat
    bind: temp.value
`;
  const r = compile(src);
  assert.equal(r.ok, false);
  assert.equal(r.errors.some((e) => e.code === "UNKNOWN_SOURCE"), false);
  assert.equal(r.summary.suppressedCount, 1);
  assert.equal(r.suppressed[0]?.code, "UNKNOWN_SOURCE");
});

test("typo suggestion pada UNKNOWN_KEY menyertakan saran", () => {
  const src = `app:
  title: T
  titel: X
sources:
  temp:
    type: mock
widgets: []
`;
  const r = compile(src);
  const e = r.errors.find((x) => x.path === "app.titel")!;
  assert.ok(e.suggestion === "title" || /title/.test(e.message));
});

test("severity dan summary tersedia", () => {
  const src = `app:
  title: T
sources:
  temp:
    type: mock
widgets: []
`;
  const r = compile(src);
  // valid -> no errors
  assert.equal(r.ok, true);
  assert.equal(r.summary.errors, 0);
  assert.equal(r.summary.warnings, 0);
  assert.equal(r.summary.infos, 0);
  assert.ok(r.summary.suppressedCount === 0);
});

test("UNKNOWN_SOURCE typo suggestion", () => {
  const src = `app:
  title: T
sources:
  temp:
    type: mock
widgets:
  - type: stat
    bind: tempp.value
`;
  const r = compile(src);
  const e = r.errors.find((x) => x.code === "UNKNOWN_SOURCE")!;
  assert.ok(e);
  assert.ok(e.suggestion === "temp" || /temp/.test(e.message));
});

test("penolakan cols < 1, cols > 12, rows < 1, rows > 6, dan nilai non-integer", () => {
  const src = base(`  - type: stat
    bind: temp.value
    cols: 0
  - type: stat
    bind: temp.value
    cols: 13
  - type: stat
    bind: temp.value
    cols: 2.5
  - type: stat
    bind: temp.value
    cols: "bukan angka"
  - type: stat
    bind: temp.value
    rows: 0
  - type: stat
    bind: temp.value
    rows: 7
  - type: stat
    bind: temp.value
    rows: 1.5
  - type: stat
    bind: temp.value
    rows: "bukan angka"
`);
  const r = compile(src);
  assert.equal(r.ok, false);
  const byPath = r.errors;
  assert.equal(byPath.length, 8);

  assert.equal(byPath[0]!.path, "widgets[0].cols");
  assert.equal(byPath[0]!.code, "OUT_OF_RANGE");
  assert.equal(byPath[0]!.line, 9);

  assert.equal(byPath[1]!.path, "widgets[1].cols");
  assert.equal(byPath[1]!.code, "OUT_OF_RANGE");
  assert.equal(byPath[1]!.line, 12);

  assert.equal(byPath[2]!.path, "widgets[2].cols");
  assert.equal(byPath[2]!.code, "OUT_OF_RANGE");
  assert.equal(byPath[2]!.line, 15);

  assert.equal(byPath[3]!.path, "widgets[3].cols");
  assert.equal(byPath[3]!.code, "INVALID_TYPE");
  assert.equal(byPath[3]!.line, 18);

  assert.equal(byPath[4]!.path, "widgets[4].rows");
  assert.equal(byPath[4]!.code, "OUT_OF_RANGE");
  assert.equal(byPath[4]!.line, 21);

  assert.equal(byPath[5]!.path, "widgets[5].rows");
  assert.equal(byPath[5]!.code, "OUT_OF_RANGE");
  assert.equal(byPath[5]!.line, 24);

  assert.equal(byPath[6]!.path, "widgets[6].rows");
  assert.equal(byPath[6]!.code, "OUT_OF_RANGE");
  assert.equal(byPath[6]!.line, 27);

  assert.equal(byPath[7]!.path, "widgets[7].rows");
  assert.equal(byPath[7]!.code, "INVALID_TYPE");
  assert.equal(byPath[7]!.line, 30);
});
