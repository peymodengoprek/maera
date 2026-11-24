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
export interface WidgetSpec {
  bind: "required" | "optional" | "none";
  props: Record<string, "number" | "string" | "boolean">;
  cols?: number;
  rows?: number;
}

export const WIDGET_SPECS: Record<WidgetType, WidgetSpec> = {
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
  switch: { bind: "required", props: { label: "string" } },
  slider: {
    bind: "required",
    props: { min: "number", max: "number", step: "number" },
  },
};

export const WIDGET_TYPES = Object.keys(WIDGET_SPECS) as WidgetType[];

/** Deskripsi satu field source; dipakai validasi compiler sekaligus generator JSON Schema. */
export interface FieldSpec {
  type: "string" | "number" | "boolean" | "object";
  const?: string | number | boolean;
  enum?: readonly (string | number)[];
  description?: string;
  minimum?: number;
  minLength?: number;
  pattern?: string;
  format?: string;
  default?: unknown;
  additionalProperties?: FieldSpec;
}

export type SourceType = SourceNode["type"];

export interface SourceSpec {
  description: string;
  fields: Record<string, FieldSpec>;
  required: readonly string[];
}

const PATTERN_HTTP = "^https?:\\/\\/";
const PATTERN_WS = "^wss?:\\/\\/";

/** Spesifikasi source: satu sumber kebenaran untuk kunci, tipe, dan aturan wajib. */
export const SOURCE_SPECS: Record<SourceType, SourceSpec> = {
  mock: {
    description: "Nilai acak berkala untuk demo tanpa backend.",
    fields: {
      type: { type: "string", const: "mock", description: "Jenis source." },
      interval: {
        type: "number",
        minimum: 50,
        default: 1000,
        description: "Interval emisi data dalam milidetik (minimal 50).",
      },
      min: { type: "number", default: 0, description: "Nilai minimum acak." },
      max: { type: "number", default: 100, description: "Nilai maksimum acak." },
      unit: { type: "string", description: "Satuan nilai, mis. \"°C\"." },
    },
    required: ["type"],
  },
  rest: {
    description: "Ambil data JSON dari endpoint HTTP secara polling.",
    fields: {
      type: { type: "string", const: "rest", description: "Jenis source." },
      url: {
        type: "string",
        pattern: PATTERN_HTTP,
        description: "URL endpoint data (http:// atau https://).",
      },
      interval: {
        type: "number",
        minimum: 50,
        default: 5000,
        description: "Interval polling dalam milidetik (minimal 50).",
      },
      path: {
        type: "string",
        description: "Jalur titik ke bagian respons JSON, mis. data.temp.",
      },
      headers: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Header HTTP tambahan (nama -> nilai).",
      },
      write_url: {
        type: "string",
        pattern: PATTERN_HTTP,
        description: "URL tujuan operasi tulis (default memakai url).",
      },
      write_method: {
        type: "string",
        enum: ["POST", "PUT", "PATCH"],
        description: "Metode HTTP untuk operasi tulis (default POST).",
      },
    },
    required: ["type", "url"],
  },
  websocket: {
    description: "Terima data real-time dari koneksi WebSocket.",
    fields: {
      type: { type: "string", const: "websocket", description: "Jenis source." },
      url: {
        type: "string",
        pattern: PATTERN_WS,
        description: "URL WebSocket (ws:// atau wss://).",
      },
      path: {
        type: "string",
        description: "Jalur titik ke bagian pesan JSON, mis. data.temp.",
      },
      reconnect_ms: {
        type: "number",
        minimum: 50,
        default: 1000,
        description: "Interval reconnect awal dalam milidetik (minimal 50).",
      },
      max_reconnect_ms: {
        type: "number",
        minimum: 50,
        default: 30000,
        description: "Batas maksimum interval reconnect dalam milidetik.",
      },
    },
    required: ["type", "url"],
  },
  mqtt: {
    description: "Terima data real-time dari topik MQTT (WebSocket).",
    fields: {
      type: { type: "string", const: "mqtt", description: "Jenis source." },
      url: {
        type: "string",
        pattern: PATTERN_WS,
        description: "URL broker MQTT over WebSocket (ws:// atau wss://).",
      },
      topic: {
        type: "string",
        minLength: 1,
        description: "Topik MQTT yang di-subscribe.",
      },
      path: {
        type: "string",
        description: "Jalur titik ke bagian payload JSON, mis. data.temp.",
      },
      write_topic: {
        type: "string",
        minLength: 1,
        description: "Topik tujuan publish (default memakai topic).",
      },
      reconnect_ms: {
        type: "number",
        minimum: 50,
        default: 1000,
        description: "Interval reconnect awal dalam milidetik (minimal 50).",
      },
      max_reconnect_ms: {
        type: "number",
        minimum: 50,
        default: 30000,
        description: "Batas maksimum interval reconnect dalam milidetik.",
      },
    },
    required: ["type", "url", "topic"],
  },
};

const sourceKeys = (type: SourceType): Set<string> =>
  new Set(Object.keys(SOURCE_SPECS[type].fields));

export const CONDITIONAL_WIDGETS = new Set<string>(["status", "gauge", "stat"]);
const CONDITIONAL_KEYS = new Set(["state", "steps"]);
const APP_KEYS = new Set(["title", "theme"]);
const SOURCE_MOCK_KEYS = sourceKeys("mock");
const SOURCE_REST_KEYS = sourceKeys("rest");
const SOURCE_WEBSOCKET_KEYS = sourceKeys("websocket");
const SOURCE_MQTT_KEYS = sourceKeys("mqtt");

const WIDGET_ALLOWED_KEYS: Record<WidgetType, Set<string>> = Object.fromEntries(
  (Object.keys(WIDGET_SPECS) as WidgetType[]).map((type) => {
    const spec = WIDGET_SPECS[type];
    const keys = ["type", "title", "cols", "rows"];
    if (spec.bind !== "none") keys.push("bind");
    keys.push(...Object.keys(spec.props));
    if (CONDITIONAL_WIDGETS.has(type)) {
      keys.push("state", "steps");
    }
    return [type, new Set(keys)];
  }),
) as Record<WidgetType, Set<string>>;

const BINDING_RE = /^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)+$/;

/** Pola teks binding `<source>.<path>` untuk validasi dan autocomplete editor. */
export const BINDING_PATTERN = BINDING_RE.source;

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
  let ok = unknownKeys(raw, APP_KEYS, ["app"], err);
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
  if (!ok) return null;
  return {
    title: title as string,
    theme: theme as string,
    columns: 12,
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
    const type = def["type"];
    if (
      type !== "mock" &&
      type !== "rest" &&
      type !== "websocket" &&
      type !== "mqtt"
    ) {
      err(
        type === undefined ? "MISSING_FIELD" : "INVALID_TYPE",
        [...base, "type"],
        `Source '${name}' butuh \`type\`: "mock", "rest", "websocket", atau "mqtt".`,
      );
      continue;
    }

    const allowed =
      type === "mock"
        ? SOURCE_MOCK_KEYS
        : type === "rest"
          ? SOURCE_REST_KEYS
          : type === "websocket"
            ? SOURCE_WEBSOCKET_KEYS
            : SOURCE_MQTT_KEYS;
    let ok = unknownKeys(def, allowed, base, err);

    if (type === "mock" || type === "rest") {
      const interval = def["interval"];
      if (interval !== undefined && (!isNum(interval) || interval < 50)) {
        err(
          "OUT_OF_RANGE",
          [...base, "interval"],
          `'interval' harus angka ≥ 50 (ms).`,
        );
        ok = false;
      }
    }

    if (type === "websocket" || type === "mqtt") {
      const reconnectMs = def["reconnect_ms"];
      if (reconnectMs !== undefined && (!isNum(reconnectMs) || reconnectMs < 50)) {
        err(
          !isNum(reconnectMs) ? "INVALID_TYPE" : "OUT_OF_RANGE",
          [...base, "reconnect_ms"],
          "'reconnect_ms' harus angka ≥ 50 (ms).",
        );
        ok = false;
      }
      const maxReconnectMs = def["max_reconnect_ms"];
      if (maxReconnectMs !== undefined && (!isNum(maxReconnectMs) || maxReconnectMs < 50)) {
        err(
          !isNum(maxReconnectMs) ? "INVALID_TYPE" : "OUT_OF_RANGE",
          [...base, "max_reconnect_ms"],
          "'max_reconnect_ms' harus angka ≥ 50 (ms).",
        );
        ok = false;
      }
      if (isNum(reconnectMs) && isNum(maxReconnectMs) && reconnectMs > maxReconnectMs) {
        err(
          "OUT_OF_RANGE",
          [...base, "reconnect_ms"],
          "'reconnect_ms' tidak boleh lebih besar dari 'max_reconnect_ms'.",
        );
        ok = false;
      }
    }

    if (type === "mock") {
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
      if (!ok) continue;
      out[name] = {
        type: "mock",
        interval: (def["interval"] as number | undefined) ?? 1000,
        min,
        max,
        ...(unit ? { unit } : {}),
        line,
      };
    } else if (type === "rest") {
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
      const writeUrl = def["write_url"];
      if (writeUrl !== undefined) {
        if (typeof writeUrl !== "string" || !/^https?:\/\//i.test(writeUrl)) {
          err(
            "INVALID_TYPE",
            [...base, "write_url"],
            "`write_url` harus berupa teks diawali http:// atau https://.",
          );
          ok = false;
        }
      }
      const writeMethod = def["write_method"];
      let normalizedMethod: string | undefined;
      if (writeMethod !== undefined) {
        if (
          typeof writeMethod !== "string" ||
          !["POST", "PUT", "PATCH"].includes(writeMethod.toUpperCase())
        ) {
          err(
            "INVALID_TYPE",
            [...base, "write_method"],
            "`write_method` harus berupa POST, PUT, atau PATCH.",
          );
          ok = false;
        } else {
          normalizedMethod = writeMethod.toUpperCase();
        }
      }
      if (!ok) continue;
      out[name] = {
        type: "rest",
        url,
        interval: (def["interval"] as number | undefined) ?? 5000,
        ...(typeof path === `string` && path ? { path } : {}),
        ...(headers ? { headers: headers as Record<string, string> } : {}),
        ...(typeof writeUrl === "string" ? { write_url: writeUrl } : {}),
        ...(normalizedMethod ? { write_method: normalizedMethod } : {}),
        line,
      };
    } else if (type === "websocket") {
      const url = def["url"];
      if (typeof url !== "string" || url === "") {
        err(
          url === undefined ? "MISSING_FIELD" : "INVALID_TYPE",
          [...base, "url"],
          "Source `websocket` wajib punya `url` berupa teks.",
        );
        ok = false;
      } else if (!/^wss?:\/\//i.test(url)) {
        err(
          "INVALID_TYPE",
          [...base, "url"],
          "`url` harus diawali ws:// atau wss://.",
        );
        ok = false;
      }
      const path = def["path"];
      if (path !== undefined && typeof path !== "string") {
        err(
          "INVALID_TYPE",
          [...base, "path"],
          "'path' harus berupa teks, mis. `data.temp`.",
        );
        ok = false;
      }
      if (!ok) continue;
      out[name] = {
        type: "websocket",
        url: url as string,
        ...(typeof path === `string` && path ? { path } : {}),
        ...(isNum(def["reconnect_ms"]) ? { reconnect_ms: def["reconnect_ms"] } : {}),
        ...(isNum(def["max_reconnect_ms"]) ? { max_reconnect_ms: def["max_reconnect_ms"] } : {}),
        line,
      };
    } else {
      const url = def["url"];
      if (typeof url !== "string" || url === "") {
        err(
          url === undefined ? "MISSING_FIELD" : "INVALID_TYPE",
          [...base, "url"],
          "Source `mqtt` wajib punya `url` berupa teks.",
        );
        ok = false;
      } else if (!/^wss?:\/\//i.test(url)) {
        err(
          "INVALID_TYPE",
          [...base, "url"],
          "`url` harus diawali ws:// atau wss://.",
        );
        ok = false;
      }
      const topic = def["topic"];
      if (topic === undefined) {
        err(
          "MISSING_FIELD",
          [...base, "topic"],
          "Source `mqtt` wajib punya `topic` berupa teks.",
        );
        ok = false;
      } else if (typeof topic !== "string" || topic.trim() === "") {
        err(
          "INVALID_TYPE",
          [...base, "topic"],
          "'topic' harus berupa teks tidak kosong.",
        );
        ok = false;
      }
      const path = def["path"];
      if (path !== undefined && typeof path !== "string") {
        err(
          "INVALID_TYPE",
          [...base, "path"],
          "'path' harus berupa teks, mis. `data.temp`.",
        );
        ok = false;
      }
      const writeTopic = def["write_topic"];
      if (
        writeTopic !== undefined &&
        (typeof writeTopic !== "string" || writeTopic.trim() === "")
      ) {
        err(
          "INVALID_TYPE",
          [...base, "write_topic"],
          "'write_topic' harus berupa teks tidak kosong.",
        );
        ok = false;
      }
      if (!ok) continue;
      out[name] = {
        type: "mqtt",
        url: url as string,
        topic: topic as string,
        ...(typeof path === `string` && path ? { path } : {}),
        ...(typeof writeTopic === "string" ? { write_topic: writeTopic } : {}),
        ...(isNum(def["reconnect_ms"]) ? { reconnect_ms: def["reconnect_ms"] } : {}),
        ...(isNum(def["max_reconnect_ms"]) ? { max_reconnect_ms: def["max_reconnect_ms"] } : {}),
        line,
      };
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

    const allowed = WIDGET_ALLOWED_KEYS[type as WidgetType];
    const ignore = CONDITIONAL_WIDGETS.has(type) ? undefined : CONDITIONAL_KEYS;
    if (!unknownKeys(w, allowed, base, err, ignore)) {
      ok = false;
    }

    const title = w["title"];
    if (title !== undefined && typeof title !== "string") {
      err("INVALID_TYPE", [...base, "title"], "'title' harus berupa teks.");
      ok = false;
    }

    const cols = w["cols"] ?? spec.cols ?? 3;
    if (!isNum(cols) || !Number.isInteger(cols) || cols < 1 || cols > 12) {
      err(
        !isNum(cols) ? "INVALID_TYPE" : "OUT_OF_RANGE",
        [...base, "cols"],
        "'cols' harus bilangan bulat 1–12.",
      );
      ok = false;
    }

    const rows = w["rows"] ?? spec.rows ?? 1;
    if (!isNum(rows) || !Number.isInteger(rows) || rows < 1 || rows > 6) {
      err(
        !isNum(rows) ? "INVALID_TYPE" : "OUT_OF_RANGE",
        [...base, "rows"],
        "'rows' harus bilangan bulat 1–6.",
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
    } else if (spec.bind === "none") {
      // bind tidak diizinkan pada widget ini; sudah dilaporkan oleh unknownKeys
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
    if (type === "slider" && isNum(props["step"]) && props["step"] <= 0) {
      err(
        "OUT_OF_RANGE",
        [...base, "step"],
        "'step' pada widget 'slider' harus lebih besar dari 0.",
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
      cols: cols as number,
      rows: rows as number,
      props,
      ...(cond.value ? { conditional: cond.value } : {}),
      line: lookupLine(li, base),
    });
  });
  return out;
}

// ── state: / steps: ───────────────────────────────────────────────

const STATE_KEYS = new Set(["threshold", "above", "below", "equal"]);
const STEP_KEYS = new Set(["at", "text", "status"]);

function unknownKeys(
  raw: Obj,
  allowed: Set<string>,
  path: PathSeg[],
  err: ErrFn,
  ignore?: Set<string>,
): boolean {
  let ok = true;
  for (const key of Object.keys(raw)) {
    if (allowed.has(key) || ignore?.has(key)) continue;
    const hint = key === "span" ? " Gunakan 'cols' untuk menentukan lebar kolom." : "";
    err(
      "UNKNOWN_KEY",
      [...path, key],
      `Kunci '${key}' tidak dikenal.${hint} Pilihan: ${[...allowed].join(", ")}.`,
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
