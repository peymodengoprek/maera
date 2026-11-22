import { load as loadYaml, type YAMLException } from "js-yaml";
import { buildLineIndex, lookupLine, type PathSeg } from "./lines.js";
import type {
  AppNode,
  Binding,
  CompileError,
  CompileErrorCode,
  CompileResult,
  Conditional,
  maeraAST,
  Outcome,
  SourceNode,
  Step,
  StatusLevel,
  WidgetNode,
  WidgetType,
} from "./types.js";
import { STATUS_LEVELS } from "./conditions.js";

/** Spesifikasi widget: apakah wajib `bind`, serta tipe properti tambahan. */
const WIDGET_SPECS: Record<
  WidgetType,
  {
    bind: "required" | "optional" | "none";
    props: Record<string, "number" | "string" | "boolean">;
  }
> = {
  stat: { bind: "required", props: { unit: "string", decimals: "number" } },
  gauge: {
    bind: "required",
    props: { min: "number", max: "number", unit: "string" },
  },
  chart: {
    bind: "required",
    props: { points: "number", unit: "string", min: "number", max: "number" },
  },
  status: { bind: "required", props: { on: "string", off: "string" } },
  text: { bind: "none", props: { content: "string" } },
};

export const WIDGET_TYPES = Object.keys(WIDGET_SPECS) as WidgetType[];

const BINDING_RE = /^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)+$/;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Ubah teks `temperature.value` menjadi { s: 'temperature', p: ['value'] } */
export function parseBinding(ref: string): Binding | null {
  if (!BINDING_RE.test(ref)) return null;
  const [s, ...p] = ref.split(".");
  return { s: s!, p };
}

function formatPath(path: PathSeg[]): string {
  return path.reduce<string>(
    (acc, seg) =>
      typeof seg === "number" ? `${acc}[${seg}]` : acc ? `${acc}.${seg}` : seg,
    "",
  );
}

/**
 * Kompilasi teks `index.maera` menjadi AST.
 * Tidak pernah melempar error untuk input tidak valid: kegagalan dikembalikan sebagai daftar `errors`.
 */
export function compile(source: string): CompileResult {
  const errors: CompileError[] = [];
  const lineIndex = buildLineIndex(source);

  const err = (code: CompileErrorCode, path: PathSeg[], message: string) => {
    errors.push({
      code,
      message,
      path: formatPath(path),
      line: lookupLine(lineIndex, path),
    });
  };

  // ── Tahap 1: Parse ──────────────────────────────────────────────
  let doc: unknown;
  try {
    doc = loadYaml(source);
  } catch (e) {
    const ye = e as YAMLException;
    return {
      ok: false,
      ast: null,
      errors: [
        {
          code: "YAML_SYNTAX",
          message: `Sintaks YAML tidak valid: ${ye.reason ?? ye.message}`,
          line: ye.mark ? ye.mark.line + 1 : null,
          path: "",
        },
      ],
    };
  }

  if (!isObj(doc)) {
    err(
      "INVALID_TYPE",
      [],
      "Isi index.maera harus berupa objek dengan kunci `app`, `sources`, dan `widgets`.",
    );
    return { ok: false, ast: null, errors };
  }

  // ── Tahap 2: Validasi ───────────────────────────────────────────
  const app = validateApp(doc["app"], err);
  const sources = validateSources(doc["sources"], err, lineIndex);
  const widgets = validateWidgets(doc["widgets"], err, lineIndex);

  // ── Tahap 3: Resolve binding ────────────────────────────────────
  for (const w of widgets) {
    if (!w.bind) continue;
    const idx = Number(w.id.slice(1));
    if (!(w.bind.s in sources)) {
      err(
        "UNKNOWN_SOURCE",
        ["widgets", idx, "bind"],
        `Sumber data '${w.bind.s}' tidak ditemukan. Tersedia: ${Object.keys(sources).join(", ") || "(kosong)"}.`,
      );
    }
  }

  if (errors.length > 0 || !app) return { ok: false, ast: null, errors };

  // ── Tahap 4: Output AST ─────────────────────────────────────────
  const ast: maeraAST = { app, sources, widgets };
  return { ok: true, ast, errors: [] };
}

type ErrFn = (code: CompileErrorCode, path: PathSeg[], message: string) => void;

function validateApp(raw: unknown, err: ErrFn): AppNode | null {
  if (raw === undefined) {
    err("MISSING_FIELD", [], "Bagian `app` wajib ada.");
    return null;
  }
  if (!isObj(raw)) {
    err("INVALID_TYPE", ["app"], "`app` harus berupa objek.");
    return null;
  }
  let ok = true;
  const title = raw["title"];
  if (typeof title !== "string" || title.trim() === "") {
    err(
      title === undefined ? "MISSING_FIELD" : "INVALID_TYPE",
      ["app", "title"],
      "`app.title` wajib berupa teks tidak kosong.",
    );
    ok = false;
  }
  const theme = raw["theme"] ?? "default";
  if (typeof theme !== "string") {
    err("INVALID_TYPE", ["app", "theme"], "`app.theme` harus berupa teks.");
    ok = false;
  }
  const columns = raw["columns"] ?? 12;
  if (!isNum(columns)) {
    err(
      "INVALID_TYPE",
      ["app", "columns"],
      "`app.columns` harus berupa angka.",
    );
    ok = false;
  } else if (!Number.isInteger(columns) || columns < 1 || columns > 12) {
    err(
      "OUT_OF_RANGE",
      ["app", "columns"],
      "`app.columns` harus bilangan bulat 1–12.",
    );
    ok = false;
  }
  if (!ok) return null;
  return {
    title: title as string,
    theme: theme as string,
    columns: columns as number,
  };
}

function validateSources(
  raw: unknown,
  err: ErrFn,
  li: Map<string, number>,
): Record<string, SourceNode> {
  const out: Record<string, SourceNode> = {};
  if (raw === undefined) {
    err("MISSING_FIELD", [], "Bagian `sources` wajib ada.");
    return out;
  }
  if (!isObj(raw)) {
    err(
      "INVALID_TYPE",
      ["sources"],
      "`sources` harus berupa objek: nama -> definisi.",
    );
    return out;
  }

  for (const [name, def] of Object.entries(raw)) {
    const base: PathSeg[] = ["sources", name];
    if (!/^[A-Za-z_][\w-]*$/.test(name)) {
      err(
        "INVALID_TYPE",
        base,
        `Nama source '${name}' tidak valid (huruf/angka/_/-, tidak boleh diawali angka).`,
      );
      continue;
    }
    if (!isObj(def)) {
      err("INVALID_TYPE", base, `Source '${name}' harus berupa objek.`);
      continue;
    }
    const line = lookupLine(li, base);
    const interval = def["interval"];
    if (interval !== undefined && (!isNum(interval) || interval < 50)) {
      err(
        "OUT_OF_RANGE",
        [...base, "interval"],
        `'interval' harus angka ≥ 50 (ms).`,
      );
      continue;
    }

    if (def["type"] === "mock") {
      const min = def["min"] ?? 0;
      const max = def["max"] ?? 100;
      if (!isNum(min) || !isNum(max)) {
        err(
          "INVALID_TYPE",
          [...base, isNum(min) ? "max" : "min"],
          "'min' dan 'max' harus berupa angka.",
        );
        continue;
      }
      if (min >= max) {
        err(
          "OUT_OF_RANGE",
          [...base, "min"],
          "'min' harus lebih kecil dari 'max'.",
        );
        continue;
      }
      const unit = def["unit"];
      if (unit !== undefined && typeof unit !== "string") {
        err("INVALID_TYPE", [...base, "unit"], "'unit' harus berupa teks.");
        continue;
      }
      out[name] = {
        type: "mock",
        interval: (interval as number | undefined) ?? 1000,
        min,
        max,
        ...(unit ? { unit } : {}),
        line,
      };
    } else if (def["type"] === "rest") {
      const url = def["url"];
      if (typeof url !== "string" || url === "") {
        err(
          url === undefined ? "MISSING_FIELD" : "INVALID_TYPE",
          [...base, "url"],
          "Source `rest` wajib punya `url` berupa teks.",
        );
        continue;
      }
      if (!/^https?:\/\//i.test(url)) {
        err(
          "INVALID_TYPE",
          [...base, "url"],
          "`url` harus diawali http:// atau https://.",
        );
        continue;
      }
      const path = def["path"];
      if (path !== undefined && typeof path !== "string") {
        err(
          "INVALID_TYPE",
          [...base, "path"],
          "'path' harus berupa teks, mis. `data.temp`.",
        );
        continue;
      }
      const headers = def["headers"];
      if (
        headers !== undefined &&
        (!isObj(headers) ||
          Object.values(headers).some((v) => typeof v !== "string"))
      ) {
        err(
          "INVALID_TYPE",
          [...base, "headers"],
          "'headers' harus berupa objek nama -> teks.",
        );
        continue;
      }
      out[name] = {
        type: "rest",
        url,
        interval: (interval as number | undefined) ?? 5000,
        ...(path ? { path } : {}),
        ...(headers ? { headers: headers as Record<string, string> } : {}),
        line,
      };
    } else {
      err(
        def["type"] === undefined ? "MISSING_FIELD" : "INVALID_TYPE",
        [...base, "type"],
        `Source '${name}' butuh \`type\`: "mock" atau "rest".`,
      );
    }
  }
  return out;
}

function validateWidgets(
  raw: unknown,
  err: ErrFn,
  li: Map<string, number>,
): WidgetNode[] {
  const out: WidgetNode[] = [];
  if (raw === undefined) {
    err("MISSING_FIELD", [], "Bagian `widgets` wajib ada.");
    return out;
  }
  if (!Array.isArray(raw)) {
    err(
      "INVALID_TYPE",
      ["widgets"],
      "`widgets` harus berupa daftar (sequence).",
    );
    return out;
  }

  raw.forEach((w, i) => {
    const base: PathSeg[] = ["widgets", i];
    if (!isObj(w)) {
      err("INVALID_TYPE", base, `Widget #${i + 1} harus berupa objek.`);
      return;
    }
    const type = w["type"];
    if (typeof type !== "string") {
      err(
        "MISSING_FIELD",
        [...base, "type"],
        `Widget #${i + 1} wajib punya \`type\`.`,
      );
      return;
    }
    if (!(type in WIDGET_SPECS)) {
      err(
        "UNKNOWN_WIDGET",
        [...base, "type"],
        `Tipe widget '${type}' tidak dikenal. Pilihan: ${WIDGET_TYPES.join(", ")}.`,
      );
      return;
    }
    const spec = WIDGET_SPECS[type as WidgetType];
    let ok = true;

    const title = w["title"];
    if (title !== undefined && typeof title !== "string") {
      err("INVALID_TYPE", [...base, "title"], "'title' harus berupa teks.");
      ok = false;
    }

    const span = w["span"] ?? 3;
    if (!isNum(span) || !Number.isInteger(span) || span < 1 || span > 12) {
      err(
        isNum(span) ? "OUT_OF_RANGE" : "INVALID_TYPE",
        [...base, "span"],
        "'span' harus bilangan bulat 1–12.",
      );
      ok = false;
    }

    let bind: Binding | undefined;
    const bindRaw = w["bind"];
    if (bindRaw === undefined) {
      if (spec.bind === "required") {
        err(
          "MISSING_FIELD",
          [...base, "bind"],
          `Widget '${type}' wajib punya \`bind\`, mis. \`temperature.value\`.`,
        );
        ok = false;
      }
    } else if (typeof bindRaw !== "string" || !parseBinding(bindRaw)) {
      err(
        "INVALID_BINDING",
        [...base, "bind"],
        `Binding '${String(bindRaw)}' tidak valid. Gunakan format \`source.properti\`.`,
      );
      ok = false;
    } else {
      bind = parseBinding(bindRaw)!;
    }

    const props: Record<string, unknown> = {};
    for (const [key, expected] of Object.entries(spec.props)) {
      const v = w[key];
      if (v === undefined) continue;
      if (typeof v !== expected || (expected === "number" && !isNum(v))) {
        err(
          "INVALID_TYPE",
          [...base, key],
          `'${key}' pada widget '${type}' harus bertipe ${expected}.`,
        );
        ok = false;
      } else {
        props[key] = v;
      }
    }
    if (
      isNum(props["min"]) &&
      isNum(props["max"]) &&
      props["min"] >= props["max"]
    ) {
      err(
        "OUT_OF_RANGE",
        [...base, "min"],
        "'min' harus lebih kecil dari 'max'.",
      );
      ok = false;
    }
    if (type === "text" && typeof props["content"] !== "string") {
      err(
        "MISSING_FIELD",
        [...base, "content"],
        "Widget `text` wajib punya `content`.",
      );
      ok = false;
    }

    const cond = parseConditional(w, base, type, err);
    if (!cond.ok) ok = false;

    if (!ok) return;
    out.push({
      id: `w${i}`,
      type: type as WidgetType,
      ...(typeof title === "string" ? { title } : {}),
      ...(bind ? { bind } : {}),
      span: span as number,
      props,
      ...(cond.value ? { conditional: cond.value } : {}),
      line: lookupLine(li, base),
    });
  });
  return out;
}

// ── state: / steps: ───────────────────────────────────────────────

const CONDITIONAL_WIDGETS = new Set<string>(["status", "gauge", "stat"]);
const STATE_KEYS = new Set(["threshold", "above", "below", "equal"]);
const STEP_KEYS = new Set(["at", "text", "status"]);

function unknownKeys(
  raw: Obj,
  allowed: Set<string>,
  path: PathSeg[],
  err: ErrFn,
): boolean {
  let ok = true;
  for (const key of Object.keys(raw)) {
    if (allowed.has(key)) continue;
    err(
      "UNKNOWN_KEY",
      [...path, key],
      `Kunci '${key}' tidak dikenal. Pilihan: ${[...allowed].join(", ")}.`,
    );
    ok = false;
  }
  return ok;
}

/** Hasil tampilan: teks saja (`Panas`) atau objek `{ text, status }`. */
function parseOutcome(
  raw: unknown,
  path: PathSeg[],
  err: ErrFn,
): Outcome | null {
  if (typeof raw === "string") {
    if (raw.trim() === "") {
      err("INVALID_TYPE", path, "Teks tidak boleh kosong.");
      return null;
    }
    return { text: raw };
  }
  if (!isObj(raw)) {
    err(
      "INVALID_TYPE",
      path,
      "Harus berupa teks atau objek { text, status }. Angka perlu tanda kutip jika dimaksudkan sebagai teks.",
    );
    return null;
  }
  let ok = unknownKeys(raw, new Set(["text", "status"]), path, err);
  const text = raw["text"];
  const status = raw["status"];
  if (text !== undefined && typeof text !== "string") {
    err(
      "INVALID_TYPE",
      [...path, "text"],
      "'text' harus berupa teks (beri tanda kutip jika berupa angka).",
    );
    ok = false;
  }
  if (
    status !== undefined &&
    !(STATUS_LEVELS as readonly unknown[]).includes(status)
  ) {
    err(
      "INVALID_STATUS",
      [...path, "status"],
      `Status '${String(status)}' tidak valid. Pilihan: ${STATUS_LEVELS.join(", ")}.`,
    );
    ok = false;
  }
  if (ok && text === undefined && status === undefined) {
    err("MISSING_FIELD", path, "Isi minimal salah satu: text atau status.");
    ok = false;
  }
  if (!ok) return null;
  return {
    ...(typeof text === "string" ? { text } : {}),
    ...(status !== undefined ? { status: status as StatusLevel } : {}),
  };
}

function parseConditional(
  w: Obj,
  base: PathSeg[],
  type: string,
  err: ErrFn,
): { ok: boolean; value?: Conditional } {
  const hasState = w["state"] !== undefined;
  const hasSteps = w["steps"] !== undefined;
  if (!hasState && !hasSteps) return { ok: true };
  if (!CONDITIONAL_WIDGETS.has(type)) {
    err(
      "UNSUPPORTED",
      [...base, hasState ? "state" : "steps"],
      `Widget '${type}' tidak mendukung state/steps. Didukung: status, gauge, stat.`,
    );
    return { ok: false };
  }
  if (hasState && hasSteps) {
    err(
      "INVALID_TYPE",
      [...base, "steps"],
      "Pilih salah satu: `state` atau `steps`, tidak keduanya.",
    );
    return { ok: false };
  }
  const value = hasState
    ? parseState(w["state"], [...base, "state"], err)
    : parseSteps(w["steps"], [...base, "steps"], err);
  return value ? { ok: true, value } : { ok: false };
}

function parseState(
  raw: unknown,
  path: PathSeg[],
  err: ErrFn,
): Conditional | null {
  if (!isObj(raw)) {
    err(
      "INVALID_TYPE",
      path,
      "`state` harus berupa objek: threshold, above, below, equal.",
    );
    return null;
  }
  let ok = unknownKeys(raw, STATE_KEYS, path, err);
  const threshold = raw["threshold"];
  if (!isNum(threshold)) {
    err(
      threshold === undefined ? "MISSING_FIELD" : "INVALID_TYPE",
      [...path, "threshold"],
      "`state.threshold` wajib berupa angka.",
    );
    ok = false;
  }
  const outs: { above?: Outcome; below?: Outcome; equal?: Outcome } = {};
  let any = false;
  for (const k of ["above", "below", "equal"] as const) {
    if (raw[k] === undefined) continue;
    any = true;
    const o = parseOutcome(raw[k], [...path, k], err);
    if (o) outs[k] = o;
    else ok = false;
  }
  if (ok && !any) {
    err(
      "MISSING_FIELD",
      path,
      "Isi minimal salah satu: above, below, atau equal.",
    );
    ok = false;
  }
  return ok ? { kind: "state", threshold: threshold as number, ...outs } : null;
}

function parseSteps(
  raw: unknown,
  path: PathSeg[],
  err: ErrFn,
): Conditional | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    err(
      "INVALID_TYPE",
      path,
      "`steps` harus berupa daftar tidak kosong, mis. `- at: 50` lalu `text` / `status`.",
    );
    return null;
  }
  let ok = true;
  const steps: Step[] = [];
  const seen = new Set<number>();
  let hasFallback = false;

  raw.forEach((item, i) => {
    const p: PathSeg[] = [...path, i];
    if (!isObj(item)) {
      err(
        "INVALID_TYPE",
        p,
        "Setiap langkah harus berupa objek: at, text, status.",
      );
      ok = false;
      return;
    }
    if (!unknownKeys(item, STEP_KEYS, p, err)) ok = false;

    let at: number | null = null;
    const rawAt = item["at"];
    if (rawAt === undefined) {
      if (hasFallback) {
        err(
          "DUPLICATE_STEP",
          p,
          "Hanya satu langkah tanpa `at` (cadangan) yang diperbolehkan.",
        );
        ok = false;
      }
      hasFallback = true;
    } else if (!isNum(rawAt)) {
      err("INVALID_TYPE", [...p, "at"], "`at` harus berupa angka.");
      ok = false;
    } else {
      if (seen.has(rawAt)) {
        err(
          "DUPLICATE_STEP",
          [...p, "at"],
          `Nilai at: ${rawAt} sudah dipakai langkah lain.`,
        );
        ok = false;
      }
      seen.add(rawAt);
      at = rawAt;
    }

    const outcomeRaw: Obj = {};
    if (item["text"] !== undefined) outcomeRaw["text"] = item["text"];
    if (item["status"] !== undefined) outcomeRaw["status"] = item["status"];
    const outcome = parseOutcome(outcomeRaw, p, err);
    if (outcome) steps.push({ at, outcome });
    else ok = false;
  });

  if (!ok) return null;
  // Terbesar dulu; cadangan (at = null) paling akhir.
  steps.sort((a, b) => (a.at === null ? 1 : b.at === null ? -1 : b.at - a.at));
  return { kind: "steps", steps };
}
