import { evaluate, type Outcome, type Store, type WidgetNode } from "@maera-js/core";
import { el, svg } from "./dom.js";
import { EMPTY, chartPath, formatValue, ratio, toBool } from "./format.js";

export interface WidgetContext {
  doc: Document;
  node: WidgetNode;
  /** Kartu pembungkus widget (menerima atribut `data-status`) */
  card: HTMLElement;
  /** Elemen kosong tempat widget menggambar isinya */
  body: HTMLElement;
  store: Store;
}

/** Renderer menggambar ke `ctx.body`; boleh mengembalikan fungsi pembersih. */
export type WidgetRenderer = (ctx: WidgetContext) => void | (() => void);

const registry = new Map<string, WidgetRenderer>();

/** Daftarkan (atau ganti) renderer untuk sebuah tipe widget. */
export function registerWidget(type: string, renderer: WidgetRenderer): void {
  registry.set(type, renderer);
}

export function getRenderer(type: string): WidgetRenderer | undefined {
  return registry.get(type);
}

/** Panggil `apply` dengan nilai binding sekarang, lalu setiap kali nilainya berubah. */
function follow(ctx: WidgetContext, apply: (value: unknown) => void): () => void {
  const b = ctx.node.bind;
  if (!b) return () => {};
  apply(ctx.store.getBinding(b));
  return ctx.store.subBinding(b, apply);
}

/** Hasil `state:`/`steps:` untuk nilai ini (undefined jika widget tidak punya kondisi atau tidak ada yang cocok). */
function outcomeOf(ctx: WidgetContext, v: unknown): Outcome | undefined {
  return ctx.node.conditional ? evaluate(ctx.node.conditional, v) : undefined;
}

/** `status` mewarnai kartu lewat `data-status` (CSS: --m-status); `text` ditulis ke `caption`. */
function applyOutcome(ctx: WidgetContext, out: Outcome | undefined, caption?: HTMLElement): void {
  if (out?.status) ctx.card.dataset["status"] = out.status;
  else delete ctx.card.dataset["status"];
  if (caption) caption.textContent = out?.text ?? "";
}

const num = (v: unknown, fallback: number): number => (typeof v === "number" ? v : fallback);

/** Pesan error tulis yang ramah untuk ditampilkan di widget kontrol. */
function writeErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return detail ? `Gagal mengirim: ${detail}` : "Gagal mengirim nilai.";
}

/** Satuan: `unit` pada widget, jika tidak ada pakai `unit` dari data source. */
function unitOf(ctx: WidgetContext): string {
  const own = ctx.node.props["unit"];
  if (typeof own === "string") return own;
  const fromSource = ctx.node.bind ? ctx.store.get(ctx.node.bind.s)?.["unit"] : undefined;
  return typeof fromSource === "string" ? fromSource : "";
}

registerWidget("stat", (ctx) => {
  const { doc, body, node } = ctx;
  const wrap = el(doc, "div", "maera-stat");
  const value = el(doc, "span", "maera-stat-value");
  const unit = el(doc, "span", "maera-stat-unit");
  const caption = el(doc, "div", "maera-caption");
  wrap.append(value, unit);
  body.append(wrap, caption);
  const decimals = typeof node.props["decimals"] === "number" ? node.props["decimals"] : undefined;

  return follow(ctx, (v) => {
    value.textContent = formatValue(v, decimals);
    unit.textContent = v === undefined || v === null ? "" : unitOf(ctx);
  });
});

registerWidget("gauge", (ctx) => {
  const { doc, body, node } = ctx;
  const min = num(node.props["min"], 0);
  const max = num(node.props["max"], 100);

  // Setengah lingkaran dari kiri ke kanan lewat atas; pathLength=100 membuat dash = persen.
  const ARC = "M 20 100 A 80 80 0 0 1 180 100";
  const root = svg(doc, "svg", { viewBox: "0 0 200 125", class: "maera-gauge", role: "img" });
  const track = svg(doc, "path", { d: ARC, fill: "none", "stroke-width": 14, "stroke-linecap": "round", class: "maera-gauge-track" });
  const fill = svg(doc, "path", {
    d: ARC, fill: "none", "stroke-width": 14, "stroke-linecap": "round", pathLength: 100, class: "maera-gauge-fill",
  });
  const valueText = svg(doc, "text", { x: 100, y: 92, "text-anchor": "middle", class: "maera-gauge-value" });
  const unitText = svg(doc, "text", { x: 100, y: 110, "text-anchor": "middle", class: "maera-gauge-unit" });
  const minText = svg(doc, "text", { x: 20, y: 120, "text-anchor": "middle", class: "maera-gauge-limit" });
  const maxText = svg(doc, "text", { x: 180, y: 120, "text-anchor": "middle", class: "maera-gauge-limit" });
  minText.textContent = formatValue(min);
  maxText.textContent = formatValue(max);
  root.append(track, fill, valueText, unitText, minText, maxText);
  const caption = el(doc, "div", "maera-caption");
  body.append(root, caption);

  return follow(ctx, (v) => {
    const t = ratio(v, min, max);
    fill.setAttribute("stroke-dasharray", `${t * 100} 100`);
    fill.setAttribute("visibility", t > 0 ? "visible" : "hidden");
    valueText.textContent = formatValue(v);
    unitText.textContent = v === undefined || v === null ? "" : unitOf(ctx);
    root.setAttribute("aria-label", `${node.title ?? "Gauge"}: ${formatValue(v)}`);
    // Evaluasi kondisi ditangani universal di mount.ts
  });
});

registerWidget("text", (ctx) => {
  const { doc, body, node } = ctx;
  const content = node.props["content"];
  const hasContent = typeof content === "string";
  const p = el(doc, "p", "maera-text", hasContent ? content : "");
  body.append(p);

  if (!node.bind) return;

  return follow(ctx, (v) => {
    const display = v === undefined || v === null ? "—" : String(v);
    if (!hasContent) {
      p.textContent = display;
      return;
    }
    if (content.includes("{{value}}")) {
      p.textContent = content.split("{{value}}").join(display);
      return;
    }
    if (v === undefined || v === null) {
      p.textContent = content;
      return;
    }
    p.textContent = content;
  });
});

registerWidget("status", (ctx) => {
  const { doc, body, node } = ctx;
  const wrap = el(doc, "div", "maera-status");
  const dot = el(doc, "span", "maera-status-dot");
  const label = el(doc, "span", "maera-status-label");
  wrap.append(dot, label);
  body.append(wrap);

  const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
  const onText = str(node.props["on"], "ON");
  const offText = str(node.props["off"], "OFF");

  return follow(ctx, (v) => {
    // 1) state:/steps: untuk data angka. Titik menyala hanya jika ada `status`.
    const out = outcomeOf(ctx, v);
    if (out) {
      wrap.dataset["state"] = out.status ? "on" : "off";
      label.textContent = out.text ?? "";
      return;
    }
    // 2) on/off untuk data boolean (atau teks seperti "on"/"off").
    const state = toBool(v);
    wrap.dataset["state"] = state === null ? "unknown" : state ? "on" : "off";
    label.textContent = state === null ? EMPTY : state ? onText : offText;
  });
});

registerWidget("switch", (ctx) => {
  const { doc, body, node, store } = ctx;
  const b = node.bind;

  const wrap = el(doc, "div", "maera-switch");
  const labelEl = el(doc, "label", "maera-switch-label");
  const input = doc.createElement("input");
  input.type = "checkbox";
  input.className = "maera-switch-input";
  const labelText = node.props["label"];
  const text = el(doc, "span", "maera-switch-text", typeof labelText === "string" ? labelText : "");
  labelEl.append(input, text);

  const status = el(doc, "p", "maera-control-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  wrap.append(labelEl, status);
  body.append(wrap);

  if (!b) {
    input.disabled = true;
    return;
  }

  let storeValue: unknown = store.getBinding(b);
  let displayValue: unknown = storeValue;
  let pending = false;
  let error = "";

  const render = () => {
    const state = toBool(displayValue);
    input.checked = state === true;
    input.disabled = pending;
    wrap.dataset["state"] = state === null ? "unknown" : state ? "on" : "off";

    if (pending) {
      wrap.dataset["pending"] = "true";
      ctx.card.dataset["write"] = "pending";
      status.dataset["kind"] = "pending";
      status.textContent = "Menunggu konfirmasi…";
    } else if (error) {
      delete wrap.dataset["pending"];
      ctx.card.dataset["write"] = "error";
      status.dataset["kind"] = "error";
      status.textContent = error;
    } else {
      delete wrap.dataset["pending"];
      delete ctx.card.dataset["write"];
      delete status.dataset["kind"];
      status.textContent = "";
    }
  };

  const unsubscribe = store.subBinding(b, (v) => {
    storeValue = v;
    displayValue = v;
    render();
  });

  const onChange = () => {
    if (pending) return;
    const next = input.checked;
    displayValue = next;
    pending = true;
    error = "";
    render();

    void store.write(b, next).then(
      () => {
        pending = false;
        if (toBool(storeValue) !== next) displayValue = next;
        render();
      },
      (e: unknown) => {
        pending = false;
        error = writeErrorMessage(e);
        displayValue = storeValue;
        render();
      },
    );
  };

  input.addEventListener("change", onChange);
  render();

  return () => {
    input.removeEventListener("change", onChange);
    unsubscribe();
    delete ctx.card.dataset["write"];
  };
});

registerWidget("slider", (ctx) => {
  const { doc, body, node, store } = ctx;
  const b = node.bind;

  const min = num(node.props["min"], 0);
  const configuredMax = num(node.props["max"], min + 100);
  const max = configuredMax > min ? configuredMax : min + 1;
  const step = num(node.props["step"], 1) > 0 ? num(node.props["step"], 1) : 1;

  const wrap = el(doc, "div", "maera-slider");
  const head = el(doc, "div", "maera-slider-head");
  const valueLabel = el(doc, "span", "maera-slider-value");
  const input = doc.createElement("input");
  input.type = "range";
  input.className = "maera-slider-input";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.setAttribute("aria-label", node.title ?? "Slider");
  head.append(valueLabel);
  const status = el(doc, "p", "maera-control-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  wrap.append(head, input, status);
  body.append(wrap);

  if (!b) {
    input.disabled = true;
    return;
  }

  const asNumber = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const clamp = (n: number): number => Math.min(max, Math.max(min, n));

  let storeValue = asNumber(store.getBinding(b));
  let displayValue = storeValue;
  let pending = false;
  let error = "";

  const render = () => {
    input.value = String(clamp(displayValue ?? min));
    valueLabel.textContent = displayValue === null ? EMPTY : formatValue(displayValue);
    input.disabled = pending;

    if (pending) {
      wrap.dataset["pending"] = "true";
      ctx.card.dataset["write"] = "pending";
      status.dataset["kind"] = "pending";
      status.textContent = "Menunggu konfirmasi…";
    } else if (error) {
      delete wrap.dataset["pending"];
      ctx.card.dataset["write"] = "error";
      status.dataset["kind"] = "error";
      status.textContent = error;
    } else {
      delete wrap.dataset["pending"];
      delete ctx.card.dataset["write"];
      delete status.dataset["kind"];
      status.textContent = "";
    }
  };

  const unsubscribe = store.subBinding(b, (v) => {
    storeValue = asNumber(v);
    displayValue = storeValue;
    render();
  });

  const onInput = () => {
    if (pending) return;
    const next = Number(input.value);
    if (!Number.isFinite(next)) return;
    error = "";
    displayValue = next;
    render();
  };

  const onChange = () => {
    if (pending) return;
    const next = Number(input.value);
    if (!Number.isFinite(next)) return;

    displayValue = next;
    pending = true;
    error = "";
    render();

    void store.write(b, next).then(
      () => {
        pending = false;
        if (storeValue !== next) displayValue = next;
        render();
      },
      (e: unknown) => {
        pending = false;
        error = writeErrorMessage(e);
        displayValue = storeValue;
        render();
      },
    );
  };

  input.addEventListener("input", onInput);
  input.addEventListener("change", onChange);
  render();

  return () => {
    input.removeEventListener("input", onInput);
    input.removeEventListener("change", onChange);
    unsubscribe();
    delete ctx.card.dataset["write"];
  };
});

registerWidget("chart", (ctx) => {
  const { doc, body, node, store } = ctx;
  const b = node.bind;
  if (!b) return;

  const capacity = Math.max(2, Math.round(num(node.props["points"], 60)));
  const min = typeof node.props["min"] === "number" ? node.props["min"] : undefined;
  const max = typeof node.props["max"] === "number" ? node.props["max"] : undefined;
  const W = 300;
  const H = 100;

  const root = svg(doc, "svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", class: "maera-chart-svg", role: "img" });
  for (const y of [25, 50, 75]) root.append(svg(doc, "line", { x1: 0, x2: W, y1: y, y2: y, class: "maera-chart-grid" }));
  const area = svg(doc, "path", { class: "maera-chart-area" });
  const line = svg(doc, "path", { class: "maera-chart-line" });
  root.append(area, line);

  const meta = el(doc, "div", "maera-chart-meta");
  const now = el(doc, "span", "maera-chart-now");
  const range = el(doc, "span", "maera-chart-range");
  meta.append(now, range);
  body.classList.add("maera-chart-body");
  body.append(root, meta);

  const redraw = () => {
    const values = store
      .historyOf(b, capacity)
      .map((e) => e.v)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const g = chartPath(values, capacity, { min, max, width: W, height: H, pad: 4 });
    line.setAttribute("d", g?.line ?? "");
    area.setAttribute("d", g?.area ?? "");
    const last = values[values.length - 1];
    now.textContent = last === undefined ? EMPTY : `${formatValue(last)} ${unitOf(ctx)}`.trim();
    range.textContent = values.length ? `min ${formatValue(Math.min(...values))} · maks ${formatValue(Math.max(...values))}` : "";
    root.setAttribute("aria-label", `${node.title ?? "Grafik"}: ${now.textContent}`);
  };

  redraw();
  // Chart perlu semua emisi (riwayat bertambah walau nilainya sama), jadi pakai sub, bukan subBinding.
  return store.sub(b.s, redraw);
});