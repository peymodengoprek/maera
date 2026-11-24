import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { compile, createStore } from "@maera-js/core";
import { mount } from "../src/mount.js";
import { CSS } from "../src/styles.js";

function setupDOM() {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const container = doc.createElement("div") as unknown as HTMLElement;
  doc.body.appendChild(container);
  return { window, doc, container };
}

/** Tunggu semua microtask Promise selesai. */
async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const CONTROL_YAML = `
app:
  title: Kontrol
sources:
  device:
    type: mock
widgets:
  - type: switch
    bind: device.power
    label: Daya
  - type: slider
    bind: device.level
    min: 0
    max: 100
    step: 5
`;

function mountControls() {
  const res = compile(CONTROL_YAML);
  assert.ok(res.ok, "YAML kontrol harus valid");
  if (!res.ok) throw new Error("unreachable");

  const { window, container } = setupDOM();
  const store = createStore();
  const handle = mount(res.ast, container, { store, run: false });

  const switchCard = container.querySelector<HTMLElement>('[data-type="switch"]')!;
  const switchWrap = switchCard.querySelector<HTMLElement>(".maera-switch")!;
  const switchInput = switchCard.querySelector<HTMLInputElement>(".maera-switch-input")!;
  const switchStatus = switchCard.querySelector<HTMLElement>(".maera-control-status")!;

  const sliderCard = container.querySelector<HTMLElement>('[data-type="slider"]')!;
  const sliderWrap = sliderCard.querySelector<HTMLElement>(".maera-slider")!;
  const sliderInput = sliderCard.querySelector<HTMLInputElement>(".maera-slider-input")!;
  const sliderValue = sliderCard.querySelector<HTMLElement>(".maera-slider-value")!;
  const sliderStatus = sliderCard.querySelector<HTMLElement>(".maera-control-status")!;

  return {
    window,
    container,
    store,
    handle,
    switchCard,
    switchWrap,
    switchInput,
    switchStatus,
    sliderCard,
    sliderWrap,
    sliderInput,
    sliderValue,
    sliderStatus,
  };
}

// ---------------------------------------------------------------------------
// 1. Audit Kontras Warna WCAG 2.1 (>= 4.5:1)
// ---------------------------------------------------------------------------

function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    return [
      parseInt(clean[0]! + clean[0]!, 16),
      parseInt(clean[1]! + clean[1]!, 16),
      parseInt(clean[2]! + clean[2]!, 16),
    ];
  }
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs! + 0.7152 * gs! + 0.0722 * bs!;
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(...parseHex(hex1));
  const l2 = relativeLuminance(...parseHex(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function extractVar(block: string, varName: string): string {
  const m = block.match(new RegExp(`${varName}:\\s*(#[0-9a-fA-F]{3,6})`));
  if (!m?.[1]) throw new Error(`Variabel ${varName} tidak ditemukan di blok CSS.`);
  return m[1];
}

test("rasio kontras WCAG 2.1 >= 4.5:1 untuk semua status di tema terang dan gelap", () => {
  // Ambil blok tema terang (.maera { ... }) dan gelap (.maera[data-theme="dark"] { ... })
  const lightBlock = CSS.match(/\.maera\s*\{([^}]+)\}/)?.[1] ?? "";
  const darkBlock = CSS.match(/\.maera\[data-theme="dark"\]\s*\{([^}]+)\}/)?.[1] ?? "";

  assert.ok(lightBlock, "Blok tema terang harus ada di CSS");
  assert.ok(darkBlock, "Blok tema gelap harus ada di CSS");

  const lightSurface = extractVar(lightBlock, "--m-surface");
  const darkSurface = extractVar(darkBlock, "--m-surface");

  const statuses = ["--m-ok", "--m-info", "--m-warning", "--m-danger"] as const;

  for (const statusVar of statuses) {
    const lightColor = extractVar(lightBlock, statusVar);
    const lightRatio = contrastRatio(lightColor, lightSurface);
    assert.ok(
      lightRatio >= 4.5,
      `Tema terang: rasio kontras ${statusVar} (${lightColor}) vs ${lightSurface} adalah ${lightRatio.toFixed(2)}:1 (harus >= 4.5:1)`,
    );

    const darkColor = extractVar(darkBlock, statusVar);
    const darkRatio = contrastRatio(darkColor, darkSurface);
    assert.ok(
      darkRatio >= 4.5,
      `Tema gelap: rasio kontras ${statusVar} (${darkColor}) vs ${darkSurface} adalah ${darkRatio.toFixed(2)}:1 (harus >= 4.5:1)`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. Perubahan data-status & caption pada stat, gauge, dan status (state: & steps:)
// ---------------------------------------------------------------------------

test("widget stat merespons kondisi state: dengan mengubah data-status dan caption", () => {
  const yaml = `
app:
  title: Test Stat State
sources:
  sensor:
    type: mock
widgets:
  - type: stat
    bind: sensor.temp
    state:
      threshold: 30
      above:
        text: Panas
        status: danger
      below:
        text: Normal
        status: ok
      equal:
        text: Pas
        status: info
`;
  const res = compile(yaml);
  assert.ok(res.ok, "YAML harus valid");
  if (!res.ok) return;

  const { container } = setupDOM();
  const store = createStore();
  const handle = mount(res.ast, container, { store, run: false });

  const card = container.querySelector<HTMLElement>('[data-type="stat"]')!;
  const caption = card.querySelector<HTMLElement>(".maera-caption")!;
  const valueEl = card.querySelector<HTMLElement>(".maera-stat-value")!;

  // Nilai awal undefined
  assert.equal(card.dataset["status"], undefined);
  assert.equal(caption.textContent, "");

  // Di bawah threshold (25 < 30) -> below (status: ok, text: Normal)
  store.set("sensor", { temp: 25 });
  assert.equal(valueEl.textContent, "25");
  assert.equal(card.dataset["status"], "ok");
  assert.equal(caption.textContent, "Normal");

  // Tepat di threshold (30 == 30) -> equal (status: info, text: Pas)
  store.set("sensor", { temp: 30 });
  assert.equal(valueEl.textContent, "30");
  assert.equal(card.dataset["status"], "info");
  assert.equal(caption.textContent, "Pas");

  // Di atas threshold (35 > 30) -> above (status: danger, text: Panas)
  store.set("sensor", { temp: 35 });
  assert.equal(valueEl.textContent, "35");
  assert.equal(card.dataset["status"], "danger");
  assert.equal(caption.textContent, "Panas");

  handle.destroy();
});

test("widget gauge merespons kondisi steps: dengan mengubah data-status dan caption", () => {
  const yaml = `
app:
  title: Test Gauge Steps
sources:
  sensor:
    type: mock
widgets:
  - type: gauge
    bind: sensor.level
    min: 0
    max: 100
    steps:
      - at: 80
        text: Kritis
        status: danger
      - at: 50
        text: Waspada
        status: warning
      - at: 20
        text: Aman
        status: ok
      - text: Kosong
`;
  const res = compile(yaml);
  assert.ok(res.ok, "YAML harus valid");
  if (!res.ok) return;

  const { container } = setupDOM();
  const store = createStore();
  const handle = mount(res.ast, container, { store, run: false });

  const card = container.querySelector<HTMLElement>('[data-type="gauge"]')!;
  const caption = card.querySelector<HTMLElement>(".maera-caption")!;
  const valueSvg = card.querySelector<SVGElement>(".maera-gauge-value")!;

  // Di bawah semua at (< 20) -> fallback step tanpa at ("Kosong", status undefined)
  store.set("sensor", { level: 10 });
  assert.equal(valueSvg.textContent, "10");
  assert.equal(card.dataset["status"], undefined);
  assert.equal(caption.textContent, "Kosong");

  // Batas inklusif at: 20 -> ok, Aman
  store.set("sensor", { level: 20 });
  assert.equal(card.dataset["status"], "ok");
  assert.equal(caption.textContent, "Aman");

  // Antara 50 dan 80 (65) -> warning, Waspada
  store.set("sensor", { level: 65 });
  assert.equal(card.dataset["status"], "warning");
  assert.equal(caption.textContent, "Waspada");

  // at: 80 -> danger, Kritis
  store.set("sensor", { level: 85 });
  assert.equal(card.dataset["status"], "danger");
  assert.equal(caption.textContent, "Kritis");

  handle.destroy();
});

test("widget status merespons kondisi state: & steps: untuk data angka", () => {
  const yaml = `
app:
  title: Test Status Steps
sources:
  sensor:
    type: mock
widgets:
  - type: status
    bind: sensor.rpm
    steps:
      - at: 3000
        text: Overload
        status: danger
      - at: 1000
        text: Beroperasi
        status: ok
      - text: Siaga
`;
  const res = compile(yaml);
  assert.ok(res.ok, "YAML harus valid");
  if (!res.ok) return;

  const { container } = setupDOM();
  const store = createStore();
  const handle = mount(res.ast, container, { store, run: false });

  const card = container.querySelector<HTMLElement>('[data-type="status"]')!;
  const wrap = card.querySelector<HTMLElement>(".maera-status")!;
  const label = card.querySelector<HTMLElement>(".maera-status-label")!;

  // Nilai 500 -> Siaga (tanpa status -> wrap state off)
  store.set("sensor", { rpm: 500 });
  assert.equal(card.dataset["status"], undefined);
  assert.equal(wrap.dataset["state"], "off");
  assert.equal(label.textContent, "Siaga");

  // Nilai 1500 -> Beroperasi (status ok -> wrap state on)
  store.set("sensor", { rpm: 1500 });
  assert.equal(card.dataset["status"], "ok");
  assert.equal(wrap.dataset["state"], "on");
  assert.equal(label.textContent, "Beroperasi");

  // Nilai 3500 -> Overload (status danger -> wrap state on)
  store.set("sensor", { rpm: 3500 });
  assert.equal(card.dataset["status"], "danger");
  assert.equal(wrap.dataset["state"], "on");
  assert.equal(label.textContent, "Overload");

  handle.destroy();
});

// ---------------------------------------------------------------------------
// 3. Status titik indikator on, off, dan unknown pada widget status
// ---------------------------------------------------------------------------

test("widget status menampilkan status on, off, dan unknown untuk data boolean / teks", () => {
  const yaml = `
app:
  title: Test Status Dot
sources:
  pump:
    type: mock
widgets:
  - type: status
    bind: pump.active
    on: RUNNING
    off: STOPPED
`;
  const res = compile(yaml);
  assert.ok(res.ok, "YAML harus valid");
  if (!res.ok) return;

  const { container } = setupDOM();
  const store = createStore();
  const handle = mount(res.ast, container, { store, run: false });

  const card = container.querySelector<HTMLElement>('[data-type="status"]')!;
  const wrap = card.querySelector<HTMLElement>(".maera-status")!;
  const label = card.querySelector<HTMLElement>(".maera-status-label")!;

  // 1) Awal: nilai undefined -> unknown, label "-"
  assert.equal(wrap.dataset["state"], "unknown");
  assert.equal(label.textContent, "—");

  // 2) Aktif (true / "on" / 1) -> on, label "RUNNING"
  store.set("pump", { active: true });
  assert.equal(wrap.dataset["state"], "on");
  assert.equal(label.textContent, "RUNNING");

  store.set("pump", { active: "on" });
  assert.equal(wrap.dataset["state"], "on");
  assert.equal(label.textContent, "RUNNING");

  store.set("pump", { active: 1 });
  assert.equal(wrap.dataset["state"], "on");
  assert.equal(label.textContent, "RUNNING");

  // 3) Mati (false / "off" / 0) -> off, label "STOPPED"
  store.set("pump", { active: false });
  assert.equal(wrap.dataset["state"], "off");
  assert.equal(label.textContent, "STOPPED");

  store.set("pump", { active: "off" });
  assert.equal(wrap.dataset["state"], "off");
  assert.equal(label.textContent, "STOPPED");

  store.set("pump", { active: 0 });
  assert.equal(wrap.dataset["state"], "off");
  assert.equal(label.textContent, "STOPPED");

  // 4) Nilai rusak atau tidak dikenal -> unknown, label "—"
  store.set("pump", { active: "unknown-value" });
  assert.equal(wrap.dataset["state"], "unknown");
  assert.equal(label.textContent, "—");

  store.set("pump", { active: null });
  assert.equal(wrap.dataset["state"], "unknown");
  assert.equal(label.textContent, "—");

  handle.destroy();
});

// ---------------------------------------------------------------------------
// 4. destroy() melepas seluruh subscription dan menghentikan runner
// ---------------------------------------------------------------------------

test("destroy() melepas seluruh subscription store dan mengosongkan container", () => {
  const yaml = `
app:
  title: Test Destroy
sources:
  dev:
    type: mock
    interval: 50
    min: 1
    max: 10
widgets:
  - type: stat
    bind: dev.val
  - type: gauge
    bind: dev.val
  - type: status
    bind: dev.active
  - type: chart
    bind: dev.val
`;
  const res = compile(yaml);
  assert.ok(res.ok, "YAML harus valid");
  if (!res.ok) return;

  const { container } = setupDOM();
  const store = createStore();
  const handle = mount(res.ast, container, { store, run: false });

  // Pastikan widget ter-render
  assert.equal(container.classList.contains("maera"), true);
  assert.equal(container.querySelectorAll(".maera-widget").length, 4);

  const statCard = container.querySelector<HTMLElement>('[data-type="stat"]')!;
  const statVal = statCard.querySelector<HTMLElement>(".maera-stat-value")!;

  store.set("dev", { val: 42, active: true });
  assert.equal(statVal.textContent, "42");

  // Panggil destroy()
  handle.destroy();

  // Container dibersihkan
  assert.equal(container.children.length, 0);
  assert.equal(container.classList.contains("maera"), false);
  assert.equal(container.dataset["theme"], undefined);

  // Perubahan store setelah destroy() tidak boleh mempengaruhi elemen lama atau container
  store.set("dev", { val: 99, active: false });
  assert.equal(statVal.textContent, "42", "Nilai elemen lama tidak boleh berubah setelah destroy()");
  assert.equal(container.children.length, 0, "Container harus tetap kosong");
});

// ---------------------------------------------------------------------------
// 5. Widget kontrol interaktif: switch & slider
// ---------------------------------------------------------------------------

test("switch dan slider menyinkronkan nilai store ke DOM (termasuk min/max/step)", () => {
  const { store, handle, switchInput, switchWrap, sliderInput, sliderValue } = mountControls();

  // Nilai awal belum ada: switch unknown, slider memakai min.
  assert.equal(switchWrap.dataset["state"], "unknown");
  assert.equal(sliderInput.min, "0");
  assert.equal(sliderInput.max, "100");
  assert.equal(sliderInput.step, "5");
  assert.equal(sliderInput.value, "0");

  store.set("device", { power: true, level: 40 });
  assert.equal(switchInput.checked, true);
  assert.equal(switchWrap.dataset["state"], "on");
  assert.equal(sliderInput.value, "40");
  assert.equal(sliderValue.textContent, "40");

  store.set("device", { power: false, level: 75 });
  assert.equal(switchInput.checked, false);
  assert.equal(switchWrap.dataset["state"], "off");
  assert.equal(sliderInput.value, "75");
  assert.equal(sliderValue.textContent, "75");

  // Nilai numerik/teks juga dipetakan ke boolean.
  store.set("device", { power: 1, level: 75 });
  assert.equal(switchInput.checked, true);
  store.set("device", { power: "off", level: 75 });
  assert.equal(switchInput.checked, false);

  handle.destroy();
});

test("interaksi switch & slider memanggil store.write dan menampilkan status pending", async () => {
  const {
    window,
    store,
    handle,
    switchCard,
    switchWrap,
    switchInput,
    switchStatus,
    sliderCard,
    sliderWrap,
    sliderInput,
    sliderValue,
    sliderStatus,
  } = mountControls();

  store.set("device", { power: true, level: 40 });

  const writes: Array<{ path: string; value: unknown }> = [];
  let gate = deferred<void>();
  const unregister = store.registerWriter("device", (binding, value) => {
    writes.push({ path: binding.p.join("."), value });
    return gate.promise;
  });

  // --- switch: toggle -> pending -> resolved ---
  switchInput.checked = false;
  switchInput.dispatchEvent(new window.Event("change"));
  assert.deepEqual(writes.at(-1), { path: "power", value: false });
  assert.equal(switchInput.disabled, true);
  assert.equal(switchWrap.dataset["pending"], "true");
  assert.equal(switchCard.dataset["write"], "pending");
  assert.match(switchStatus.textContent ?? "", /menunggu konfirmasi/i);

  gate.resolve();
  await flush();
  assert.equal(switchInput.disabled, false);
  assert.equal(switchWrap.dataset["pending"], undefined);
  assert.equal(switchCard.dataset["write"], undefined);
  assert.equal(switchStatus.textContent, "");
  assert.equal(switchInput.checked, false);

  // --- slider: input hanya pratinjau label, change mengirim ke store ---
  gate = deferred<void>();
  sliderInput.value = "55";
  sliderInput.dispatchEvent(new window.Event("input"));
  assert.equal(sliderValue.textContent, "55");
  assert.equal(sliderStatus.textContent, "");
  assert.equal(sliderInput.disabled, false);
  assert.equal(writes.length, 1);

  sliderInput.dispatchEvent(new window.Event("change"));
  assert.deepEqual(writes.at(-1), { path: "level", value: 55 });
  assert.equal(writes.length, 2);
  assert.equal(sliderInput.disabled, true);
  assert.equal(sliderWrap.dataset["pending"], "true");
  assert.equal(sliderCard.dataset["write"], "pending");
  assert.match(sliderStatus.textContent ?? "", /menunggu konfirmasi/i);

  gate.resolve();
  await flush();
  assert.equal(sliderInput.disabled, false);
  assert.equal(sliderWrap.dataset["pending"], undefined);
  assert.equal(sliderStatus.textContent, "");
  assert.equal(sliderInput.value, "55");
  assert.equal(sliderValue.textContent, "55");

  unregister();
  handle.destroy();
});

test("kegagalan store.write menampilkan error dan mengembalikan kontrol ke nilai store", async () => {
  const {
    window,
    store,
    handle,
    switchCard,
    switchWrap,
    switchInput,
    switchStatus,
    sliderCard,
    sliderInput,
    sliderValue,
    sliderStatus,
  } = mountControls();

  store.set("device", { power: true, level: 40 });
  const unregister = store.registerWriter("device", () => Promise.reject(new Error("jaringan putus")));

  // Switch: posisi kembali ke nilai store terakhir (true).
  switchInput.checked = false;
  switchInput.dispatchEvent(new window.Event("change"));
  await flush();
  assert.equal(switchInput.checked, true);
  assert.equal(switchWrap.dataset["state"], "on");
  assert.equal(switchWrap.dataset["pending"], undefined);
  assert.equal(switchCard.dataset["write"], "error");
  assert.match(switchStatus.textContent ?? "", /gagal mengirim/i);
  assert.match(switchStatus.textContent ?? "", /jaringan putus/i);
  assert.equal(switchStatus.dataset["kind"], "error");
  assert.equal(switchInput.disabled, false);

  // Slider: posisi kembali ke nilai store terakhir (40).
  sliderInput.value = "85";
  sliderInput.dispatchEvent(new window.Event("change"));
  await flush();
  assert.equal(sliderInput.value, "40");
  assert.equal(sliderValue.textContent, "40");
  assert.equal(sliderCard.dataset["write"], "error");
  assert.match(sliderStatus.textContent ?? "", /gagal mengirim/i);
  assert.equal(sliderStatus.dataset["kind"], "error");
  assert.equal(sliderInput.disabled, false);

  unregister();
  handle.destroy();
});

test("destroy() melepas listener DOM dan subscription widget switch/slider", () => {
  const {
    window,
    store,
    handle,
    switchCard,
    switchInput,
    switchStatus,
    sliderCard,
    sliderInput,
    sliderValue,
    sliderStatus,
  } = mountControls();

  store.set("device", { power: true, level: 40 });

  let writes = 0;
  const unregister = store.registerWriter("device", () => {
    writes += 1;
  });

  handle.destroy();

  // Subscription sudah dilepas: perubahan store tidak boleh mengubah DOM lama.
  store.set("device", { power: false, level: 90 });
  assert.equal(switchInput.checked, true);
  assert.equal(sliderInput.value, "40");
  assert.equal(sliderValue.textContent, "40");
  assert.equal(switchStatus.textContent, "");
  assert.equal(sliderStatus.textContent, "");

  // Listener DOM sudah dilepas: event baru tidak boleh memicu penulisan.
  switchInput.checked = false;
  switchInput.dispatchEvent(new window.Event("change"));
  sliderInput.value = "90";
  sliderInput.dispatchEvent(new window.Event("change"));
  assert.equal(writes, 0);
  assert.equal(switchCard.dataset["write"], undefined);
  assert.equal(sliderCard.dataset["write"], undefined);

  unregister();
});

test("destroy() menghentikan background source runner (mock polling)", async () => {
  const yaml = `
app:
  title: Test Runner Stop
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
  const res = compile(yaml);
  assert.ok(res.ok, "YAML harus valid");
  if (!res.ok) return;

  const { container } = setupDOM();
  const handle = mount(res.ast, container, { run: true });

  // Tunggu beberapa emisi dari mock source
  await new Promise((resolve) => setTimeout(resolve, 180));
  const countBefore = handle.store.history("dev").length;
  assert.ok(countBefore >= 2, `Emisi sebelum destroy minimal 2, aktual: ${countBefore}`);

  // Hentikan via destroy()
  handle.destroy();

  // Tunggu lagi dan pastikan tidak ada emisi baru setelah destroy()
  await new Promise((resolve) => setTimeout(resolve, 140));
  const countAfter = handle.store.history("dev").length;
  assert.equal(countAfter, countBefore, "Emisi tidak boleh bertambah setelah destroy()");
});

// ---------------------------------------------------------------------------
// 6. Grid row-span dan fluid container queries
// ---------------------------------------------------------------------------

test("kartu widget menerapkan rentang kolom (cols) dan baris (rows) sesuai AST", () => {
  const yaml = `
app:
  title: Test Grid Layout
sources:
  sensor:
    type: mock
widgets:
  - type: stat
    bind: sensor.temp
    cols: 4
  - type: chart
    bind: sensor.temp
    cols: 8
    rows: 2
  - type: gauge
    bind: sensor.temp
    cols: 6
    rows: 3
`;
  const res = compile(yaml);
  assert.ok(res.ok, "YAML harus valid");
  if (!res.ok) return;

  const { container } = setupDOM();
  const store = createStore();
  const handle = mount(res.ast, container, { store, run: false });

  const statCard = container.querySelector<HTMLElement>('[data-type="stat"]')!;
  const chartCard = container.querySelector<HTMLElement>('[data-type="chart"]')!;
  const gaugeCard = container.querySelector<HTMLElement>('[data-type="gauge"]')!;

  // Default rows: 1 pada stat (cols: 4)
  assert.equal(statCard.style.gridColumn, "span 4");
  assert.equal(statCard.style.gridRow, "span 1");
  assert.equal(statCard.style.getPropertyValue("--m-cols"), "4");
  assert.equal(statCard.style.getPropertyValue("--m-rows"), "1");
  assert.equal(statCard.dataset["cols"], "4");
  assert.equal(statCard.dataset["rows"], "1");

  // rows: 2 pada chart (cols: 8)
  assert.equal(chartCard.style.gridColumn, "span 8");
  assert.equal(chartCard.style.gridRow, "span 2");
  assert.equal(chartCard.style.getPropertyValue("--m-cols"), "8");
  assert.equal(chartCard.style.getPropertyValue("--m-rows"), "2");
  assert.equal(chartCard.dataset["cols"], "8");
  assert.equal(chartCard.dataset["rows"], "2");

  // rows: 3 pada gauge (cols: 6)
  assert.equal(gaugeCard.style.gridColumn, "span 6");
  assert.equal(gaugeCard.style.gridRow, "span 3");
  assert.equal(gaugeCard.style.getPropertyValue("--m-cols"), "6");
  assert.equal(gaugeCard.style.getPropertyValue("--m-rows"), "3");
  assert.equal(gaugeCard.dataset["cols"], "6");
  assert.equal(gaugeCard.dataset["rows"], "3");

  handle.destroy();
});

// ---------------------------------------------------------------------------
// 7. Widget text dinamis & evaluasi universal state/steps
// ---------------------------------------------------------------------------

test("widget text merender nilai dinamis dari bind tunggal", () => {
  const yaml = `
app:
  title: Test Text Bind
sources:
  alerts:
    type: mock
widgets:
  - type: text
    bind: alerts.message
`;
  const res = compile(yaml);
  assert.ok(res.ok, "YAML harus valid");
  if (!res.ok) return;

  const { container } = setupDOM();
  const store = createStore();
  const handle = mount(res.ast, container, { store, run: false });

  const card = container.querySelector<HTMLElement>('[data-type="text"]')!;
  const textEl = card.querySelector<HTMLElement>(".maera-text")!;

  // Awal: belum ada nilai -> "—"
  assert.equal(textEl.textContent, "—");

  store.set("alerts", { message: "halo dunia" });
  assert.equal(textEl.textContent, "halo dunia");

  store.set("alerts", { message: 42 });
  assert.equal(textEl.textContent, "42");

  store.set("alerts", { message: null });
  assert.equal(textEl.textContent, "—");

  handle.destroy();
});

test("widget text mendukung kombinasi content + bind dengan interpolasi {{value}}", () => {
  const yaml = `
app:
  title: Test Text Content
sources:
  alerts:
    type: mock
widgets:
  - type: text
    bind: alerts.message
    content: "Info: {{value}}"
  - type: text
    bind: alerts.message
    content: "Tanpa placeholder"
`;
  const res = compile(yaml);
  assert.ok(res.ok, "YAML harus valid");
  if (!res.ok) return;

  const { container } = setupDOM();
  const store = createStore();
  const handle = mount(res.ast, container, { store, run: false });

  const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-type="text"]'));
  const interpCard = cards[0]!;
  const plainCard = cards[1]!;
  const interpEl = interpCard.querySelector<HTMLElement>(".maera-text")!;
  const plainEl = plainCard.querySelector<HTMLElement>(".maera-text")!;

  // Sebelum ada nilai
  assert.equal(interpEl.textContent, "Info: —");
  assert.equal(plainEl.textContent, "Tanpa placeholder");

  store.set("alerts", { message: "OK" });
  assert.equal(interpEl.textContent, "Info: OK");
  assert.equal(plainEl.textContent, "Tanpa placeholder");

  handle.destroy();
});

test("widget chart merespons evaluasi steps: dengan memperbarui data-status dan caption", () => {
  const yaml = `
app:
  title: Test Chart Steps
sources:
  sensor:
    type: mock
widgets:
  - type: chart
    bind: sensor.load
    steps:
      - at: 80
        text: Kritis
        status: danger
      - at: 50
        text: Waspada
        status: warning
      - text: Aman
`;
  const res = compile(yaml);
  assert.ok(res.ok, "YAML harus valid");
  if (!res.ok) return;

  const { container } = setupDOM();
  const store = createStore();
  const handle = mount(res.ast, container, { store, run: false });

  const card = container.querySelector<HTMLElement>('[data-type="chart"]')!;
  const caption = card.querySelector<HTMLElement>(".maera-caption")!;

  store.set("sensor", { load: 30 });
  assert.equal(card.dataset["status"], undefined);
  assert.equal(caption.textContent, "Aman");

  store.set("sensor", { load: 60 });
  assert.equal(card.dataset["status"], "warning");
  assert.equal(caption.textContent, "Waspada");

  store.set("sensor", { load: 90 });
  assert.equal(card.dataset["status"], "danger");
  assert.equal(caption.textContent, "Kritis");

  handle.destroy();
});

test("widget text merespons evaluasi state: string dengan memperbarui data-status dan caption", () => {
  const yaml = `
app:
  title: Test Text State
sources:
  alerts:
    type: mock
widgets:
  - type: text
    bind: alerts.code
    content: "Code: {{value}}"
    state:
      threshold: "ERR_CONN"
      equal:
        status: danger
        text: Koneksi Terputus
`;
  const res = compile(yaml);
  assert.ok(res.ok, "YAML harus valid");
  if (!res.ok) return;

  const { container } = setupDOM();
  const store = createStore();
  const handle = mount(res.ast, container, { store, run: false });

  const card = container.querySelector<HTMLElement>('[data-type="text"]')!;
  const caption = card.querySelector<HTMLElement>(".maera-caption")!;
  const textEl = card.querySelector<HTMLElement>(".maera-text")!;

  store.set("alerts", { code: "OK" });
  assert.equal(card.dataset["status"], undefined);
  assert.equal(caption.textContent, "");
  assert.equal(textEl.textContent, "Code: OK");

  store.set("alerts", { code: "ERR_CONN" });
  assert.equal(card.dataset["status"], "danger");
  assert.equal(caption.textContent, "Koneksi Terputus");
  assert.equal(textEl.textContent, "Code: ERR_CONN");

  handle.destroy();
});

test("widget switch merespons evaluasi steps: boolean dengan memperbarui data-status dan caption", () => {
  const yaml = `
app:
  title: Test Switch Steps
sources:
  device:
    type: mock
widgets:
  - type: switch
    bind: device.active
    steps:
      - at: true
        text: Aktif
        status: ok
      - at: false
        text: Nonaktif
        status: warning
`;
  const res = compile(yaml);
  assert.ok(res.ok, "YAML harus valid");
  if (!res.ok) return;

  const { container } = setupDOM();
  const store = createStore();
  const handle = mount(res.ast, container, { store, run: false });

  const card = container.querySelector<HTMLElement>('[data-type="switch"]')!;
  const caption = card.querySelector<HTMLElement>(".maera-caption")!;

  store.set("device", { active: true });
  assert.equal(card.dataset["status"], "ok");
  assert.equal(caption.textContent, "Aktif");

  store.set("device", { active: false });
  assert.equal(card.dataset["status"], "warning");
  assert.equal(caption.textContent, "Nonaktif");

  handle.destroy();
});

test("widget slider merespons evaluasi steps: dengan memperbarui data-status dan caption", () => {
  const yaml = `
app:
  title: Test Slider Steps
sources:
  device:
    type: mock
widgets:
  - type: slider
    bind: device.level
    min: 0
    max: 100
    steps:
      - at: 80
        text: Tinggi
        status: danger
      - text: Normal
`;
  const res = compile(yaml);
  assert.ok(res.ok, "YAML harus valid");
  if (!res.ok) return;

  const { container } = setupDOM();
  const store = createStore();
  const handle = mount(res.ast, container, { store, run: false });

  const card = container.querySelector<HTMLElement>('[data-type="slider"]')!;
  const caption = card.querySelector<HTMLElement>(".maera-caption")!;

  store.set("device", { level: 50 });
  assert.equal(card.dataset["status"], undefined);
  assert.equal(caption.textContent, "Normal");

  store.set("device", { level: 90 });
  assert.equal(card.dataset["status"], "danger");
  assert.equal(caption.textContent, "Tinggi");

  handle.destroy();
});

test("destroy() melepas subscription kondisi kartu dan binding text", () => {
  const yaml = `
app:
  title: Test Destroy Cond
sources:
  alerts:
    type: mock
widgets:
  - type: text
    bind: alerts.message
    content: "Info: {{value}}"
    state:
      threshold: "ERR"
      equal:
        status: danger
        text: Bahaya
`;
  const res = compile(yaml);
  assert.ok(res.ok, "YAML harus valid");
  if (!res.ok) return;

  const { container } = setupDOM();
  const store = createStore();
  const handle = mount(res.ast, container, { store, run: false });

  const card = container.querySelector<HTMLElement>('[data-type="text"]')!;
  const textEl = card.querySelector<HTMLElement>(".maera-text")!;
  const caption = card.querySelector<HTMLElement>(".maera-caption")!;

  store.set("alerts", { message: "hi" });
  assert.equal(textEl.textContent, "Info: hi");
  assert.equal(card.dataset["status"], undefined);

  store.set("alerts", { message: "ERR" });
  assert.equal(textEl.textContent, "Info: ERR");
  assert.equal(card.dataset["status"], "danger");
  assert.equal(caption.textContent, "Bahaya");

  handle.destroy();

  // Setelah destroy, DOM lama tidak berubah
  store.set("alerts", { message: "changed" });
  assert.equal(textEl.textContent, "Info: ERR");
  assert.equal(card.dataset["status"], "danger");
  assert.equal(caption.textContent, "Bahaya");
  assert.equal(container.children.length, 0);
});

test("CSS di styles.ts memuat aturan @container, grid-auto-rows: minmax(var(--m-row-height, 110px), auto), serta grid-auto-flow: row", () => {
  assert.match(CSS, /container-type:\s*inline-size/);
  assert.match(CSS, /grid-template-columns:\s*repeat\(12,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(CSS, /grid-auto-rows:\s*minmax\(var\(--m-row-height,\s*110px\),\s*auto\)/);
  assert.match(CSS, /grid-auto-flow:\s*row/);
  assert.match(CSS, /@container\s*\(max-width:\s*599px\)/);
  assert.match(CSS, /@container\s*\(min-width:\s*600px\)\s*and\s*\(max-width:\s*959px\)/);
  assert.match(CSS, /@container\s*\(min-width:\s*960px\)/);
  assert.match(CSS, /clamp\(/);
});

test("widget chart dan gauge ter-render utuh pada kartu dengan rows: 2", () => {
  const yaml = `
app:
  title: Test Widget Rows 2
sources:
  dev:
    type: mock
widgets:
  - type: chart
    title: Grafik Beban
    bind: dev.load
    cols: 8
    rows: 2
  - type: gauge
    title: Indikator Level
    bind: dev.level
    cols: 4
    rows: 2
    min: 0
    max: 100
`;
  const res = compile(yaml);
  assert.ok(res.ok, "YAML harus valid");
  if (!res.ok) return;

  const { container } = setupDOM();
  const store = createStore();
  store.set("dev", { load: 55, level: 70 });
  const handle = mount(res.ast, container, { store, run: false });

  const chartCard = container.querySelector<HTMLElement>('[data-type="chart"]')!;
  const gaugeCard = container.querySelector<HTMLElement>('[data-type="gauge"]')!;

  // Pastikan kartu ter-render dengan kelas dan dimensi rows: 2
  assert.ok(chartCard.classList.contains("maera-widget"));
  assert.ok(chartCard.classList.contains("maera-card"));
  assert.equal(chartCard.style.gridRow, "span 2");
  assert.equal(chartCard.style.gridColumn, "span 8");

  assert.ok(gaugeCard.classList.contains("maera-widget"));
  assert.ok(gaugeCard.classList.contains("maera-card"));
  assert.equal(gaugeCard.style.gridRow, "span 2");
  assert.equal(gaugeCard.style.gridColumn, "span 4");

  // Chart SVG & meta ada dan ter-render
  const chartSvg = chartCard.querySelector<SVGElement>(".maera-chart-svg");
  const chartLine = chartCard.querySelector<SVGElement>(".maera-chart-line");
  const chartMeta = chartCard.querySelector<HTMLElement>(".maera-chart-meta");
  assert.ok(chartSvg, "Chart SVG harus ter-render");
  assert.ok(chartLine, "Garis chart harus ada");
  assert.ok(chartMeta, "Metadata chart harus ada");

  // Gauge SVG & fills ada dan ter-render
  const gaugeSvg = gaugeCard.querySelector<SVGElement>(".maera-gauge");
  const gaugeFill = gaugeCard.querySelector<SVGElement>(".maera-gauge-fill");
  const gaugeValue = gaugeCard.querySelector<SVGElement>(".maera-gauge-value");
  assert.ok(gaugeSvg, "Gauge SVG harus ter-render");
  assert.ok(gaugeFill, "Path gauge fill harus ada");
  assert.equal(gaugeValue?.textContent, "70");

  handle.destroy();
});
