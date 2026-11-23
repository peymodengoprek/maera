/**
 * Generator JSON Schema untuk file `*.maera`.
 * Semua aturan diturunkan dari satu sumber kebenaran: WIDGET_SPECS, SOURCE_SPECS,
 * STATUS_LEVELS, dan pola binding di compiler. Tidak ada daftar kunci/tipe duplikat.
 */
import {
  BINDING_PATTERN,
  CONDITIONAL_WIDGETS,
  SOURCE_SPECS,
  WIDGET_SPECS,
  WIDGET_TYPES,
  type FieldSpec,
  type SourceType,
} from "./compiler.js";
import { STATUS_LEVELS } from "./conditions.js";
import type { WidgetType } from "./types.js";

export type JsonSchema = Record<string, unknown>;

const DRAFT_07 = "http://json-schema.org/draft-07/schema#";
const SCHEMA_ID = "https://maera.dev/schema/maera.schema.json";

const WIDGET_DESCRIPTIONS: Record<WidgetType, string> = {
  stat: "Angka besar dengan unit dan jumlah desimal.",
  gauge: "Pengukur busur dengan rentang min/max.",
  chart: "Grafik tren dari riwayat nilai.",
  status: "Indikator status on/off dengan label.",
  text: "Teks statis tanpa binding.",
  switch: "Sakelar interaktif yang menulis ke source.",
  slider: "Slider interaktif yang menulis ke source.",
};

const PROP_DESCRIPTIONS: Record<string, string> = {
  unit: "Satuan yang ditampilkan, mis. \"°C\".",
  decimals: "Jumlah angka desimal.",
  min: "Batas bawah rentang.",
  max: "Batas atas rentang.",
  points: "Jumlah titik riwayat yang ditampilkan.",
  on: "Teks saat nilai benar (on).",
  off: "Teks saat nilai salah (off).",
  content: "Isi teks yang ditampilkan.",
  label: "Label kontrol.",
  step: "Langkah kenaikan slider (harus > 0).",
};

function fieldToSchema(field: FieldSpec): JsonSchema {
  const schema: JsonSchema = { type: field.type };
  if (field.const !== undefined) schema["const"] = field.const;
  if (field.enum !== undefined) schema["enum"] = [...field.enum];
  if (field.description !== undefined) schema["description"] = field.description;
  if (field.minimum !== undefined) schema["minimum"] = field.minimum;
  if (field.minLength !== undefined) schema["minLength"] = field.minLength;
  if (field.pattern !== undefined) schema["pattern"] = field.pattern;
  if (field.format !== undefined) schema["format"] = field.format;
  if (field.default !== undefined) schema["default"] = field.default;
  if (field.additionalProperties !== undefined) {
    schema["additionalProperties"] = fieldToSchema(field.additionalProperties);
  }
  return schema;
}

function buildAppSchema(): JsonSchema {
  return {
    type: "object",
    description: "Identitas dan tata letak dashboard.",
    additionalProperties: false,
    required: ["title"],
    properties: {
      title: {
        type: "string",
        minLength: 1,
        description: "Judul dashboard.",
      },
      theme: {
        type: "string",
        default: "default",
        description: "Nama tema tampilan.",
      },
      columns: {
        type: "integer",
        minimum: 1,
        maximum: 12,
        default: 12,
        description: "Jumlah kolom grid (1-12).",
      },
    },
  };
}

function buildSourceSchema(type: SourceType): JsonSchema {
  const spec = SOURCE_SPECS[type];
  const properties: JsonSchema = {};
  for (const [key, field] of Object.entries(spec.fields)) {
    properties[key] = fieldToSchema(field);
  }
  return {
    type: "object",
    description: spec.description,
    additionalProperties: false,
    required: [...spec.required],
    properties,
  };
}

const OUTCOME_SCHEMA: JsonSchema = {
  description: "Teks saja atau objek { text, status }.",
  oneOf: [
    { type: "string", minLength: 1 },
    {
      type: "object",
      additionalProperties: false,
      anyOf: [{ required: ["text"] }, { required: ["status"] }],
      properties: {
        text: { type: "string", minLength: 1, description: "Teks hasil." },
        status: {
          enum: [...STATUS_LEVELS],
          description: `Warna status: ${STATUS_LEVELS.join(", ")}.`,
        },
      },
    },
  ],
};

const STATE_SCHEMA: JsonSchema = {
  type: "object",
  description: "Kondisi berbasis ambang batas tunggal.",
  additionalProperties: false,
  required: ["threshold"],
  anyOf: [{ required: ["above"] }, { required: ["below"] }, { required: ["equal"] }],
  properties: {
    threshold: {
      type: "number",
      description: "Batas pembanding (inklusif untuk above/equal).",
    },
    above: OUTCOME_SCHEMA,
    below: OUTCOME_SCHEMA,
    equal: OUTCOME_SCHEMA,
  },
};

const STEPS_SCHEMA: JsonSchema = {
  type: "array",
  description:
    "Daftar langkah; langkah dengan `at` terbesar yang cocok dipakai. Satu langkah tanpa `at` menjadi cadangan.",
  minItems: 1,
  items: {
    type: "object",
    additionalProperties: false,
    anyOf: [{ required: ["text"] }, { required: ["status"] }],
    properties: {
      at: {
        type: "number",
        description: "Ambang inklusif (value >= at). Kosongkan untuk cadangan.",
      },
      text: { type: "string", minLength: 1, description: "Teks hasil." },
      status: {
        enum: [...STATUS_LEVELS],
        description: `Warna status: ${STATUS_LEVELS.join(", ")}.`,
      },
    },
  },
};

function propSchema(type: WidgetType, key: string, propType: string): JsonSchema {
  const schema: JsonSchema = { type: propType };
  if (key === "step" && type === "slider") schema["exclusiveMinimum"] = 0;
  if (PROP_DESCRIPTIONS[key] !== undefined) {
    schema["description"] = PROP_DESCRIPTIONS[key];
  }
  return schema;
}

function buildWidgetSchema(type: WidgetType): JsonSchema {
  const spec = WIDGET_SPECS[type];
  const properties: JsonSchema = {
    type: {
      const: type,
      description: `Widget ${type}: ${WIDGET_DESCRIPTIONS[type]}`,
    },
    title: { type: "string", description: "Judul widget (opsional)." },
    span: {
      type: "integer",
      minimum: 1,
      maximum: 12,
      default: 3,
      description: "Lebar widget dalam kolom grid (1-12).",
    },
  };
  const required: string[] = ["type"];

  if (spec.bind !== "none") {
    properties["bind"] = {
      type: "string",
      pattern: BINDING_PATTERN,
      description: "Binding ke data source dengan format `<source>.<path>`.",
    };
    if (spec.bind === "required") required.push("bind");
  }

  for (const [key, propType] of Object.entries(spec.props)) {
    properties[key] = propSchema(type, key, propType);
  }

  if (CONDITIONAL_WIDGETS.has(type)) {
    properties["state"] = STATE_SCHEMA;
    properties["steps"] = STEPS_SCHEMA;
  }

  if (type === "text") required.push("content");

  const schema: JsonSchema = {
    type: "object",
    description: WIDGET_DESCRIPTIONS[type],
    additionalProperties: false,
    required,
    properties,
  };

  if (CONDITIONAL_WIDGETS.has(type)) {
    schema["allOf"] = [{ not: { required: ["state", "steps"] } }];
  }

  return schema;
}

/** Bangun JSON Schema draft-07 untuk file `*.maera` dari spesifikasi core. */
export function generateSchema(): JsonSchema {
  const sourceSchemas = (Object.keys(SOURCE_SPECS) as SourceType[]).map(
    buildSourceSchema,
  );
  return {
    $schema: DRAFT_07,
    $id: SCHEMA_ID,
    title: "Maera Dashboard",
    description:
      "Skema untuk file *.maera: satu file mendefinisikan satu dashboard IoT deklaratif.",
    type: "object",
    additionalProperties: false,
    required: ["app", "sources", "widgets"],
    properties: {
      app: buildAppSchema(),
      sources: {
        type: "object",
        description: "Peta nama source -> definisi source.",
        additionalProperties: { oneOf: sourceSchemas },
      },
      widgets: {
        type: "array",
        description: "Daftar widget yang ditampilkan pada grid.",
        items: { oneOf: WIDGET_TYPES.map(buildWidgetSchema) },
      },
    },
  };
}
