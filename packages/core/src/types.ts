/**
 * Kontrak publik @maera-js/core: AST, Binding, Source, dan CompileError.
 * File ini murni tipe — tidak ada logika runtime.
 */

/** Referensi data: `temperature.value` -> { s: 'temperature', p: ['value'] } */
export interface Binding {
  /** Nama source */
  s: string;
  /** Jalur properti di dalam data source */
  p: string[];
}

export interface AppNode {
  title: string;
  theme: string;
  /** Jumlah kolom grid (selalu 12) */
  columns: number;
}

export interface MockSource {
  type: "mock";
  /** Interval emisi data dalam ms */
  interval: number;
  min: number;
  max: number;
  unit?: string;
  line: number | null;
}

export interface RestSource {
  type: "rest";
  url: string;
  /** Interval polling dalam ms */
  interval: number;
  /** Jalur titik ke bagian respons JSON yang diambil, mis. `data.temp` */
  path?: string;
  headers?: Record<string, string>;
  /** URL tujuan untuk operasi tulis (default menggunakan `url`) */
  write_url?: string;
  /** Metode HTTP untuk operasi tulis (default `"POST"`) */
  write_method?: string;
  line: number | null;
}

export interface WebSocketSource {
  type: "websocket";
  url: string;
  /** Jalur titik ke bagian pesan JSON yang diambil, mis. `data.temp` */
  path?: string;
  /** Interval reconnect awal dalam ms (default 1000) */
  reconnect_ms?: number;
  /** Batas maksimum interval reconnect dalam ms (default 30000) */
  max_reconnect_ms?: number;
  line: number | null;
}

export interface MqttSource {
  type: "mqtt";
  url: string;
  topic: string;
  /** Jalur titik ke bagian payload JSON yang diambil, mis. `data.temp` */
  path?: string;
  /** Topik tujuan untuk operasi tulis/publish (default menggunakan `topic`) */
  write_topic?: string;
  /** Interval reconnect awal dalam ms (default 1000) */
  reconnect_ms?: number;
  /** Batas maksimum interval reconnect dalam ms (default 30000) */
  max_reconnect_ms?: number;
  line: number | null;
}

export type SourceNode = MockSource | RestSource | WebSocketSource | MqttSource;

export type WidgetType =
  | "stat"
  | "gauge"
  | "chart"
  | "status"
  | "text"
  | "switch"
  | "slider";

export type StatusLevel = "ok" | "info" | "warning" | "danger";

export interface Outcome {
  text?: string;
  status?: StatusLevel;
}

export interface Step {
  at: number | null;
  outcome: Outcome;
}

export type Conditional =
  | { kind: "steps"; steps: Step[] }
  | { kind: "state"; threshold: number; above?: Outcome; below?: Outcome; equal?: Outcome };

export interface WidgetNode {
  id: string;
  type: WidgetType;
  title?: string;
  bind?: Binding;
  cols: number;
  rows: number;
  props: Record<string, unknown>;
  line: number | null;
  conditional?: Conditional;
}

export interface maeraAST {
  app: AppNode;
  sources: Record<string, SourceNode>;
  widgets: WidgetNode[];
}

export type CompileErrorCode =
  | "YAML_SYNTAX"
  | "INVALID_TYPE"
  | "MISSING_FIELD"
  | "UNKNOWN_WIDGET"
  | "UNKNOWN_SOURCE"
  | "INVALID_BINDING"
  | "OUT_OF_RANGE"
  | "INVALID_STATUS"
  | "DUPLICATE_STEP"
  | "UNKNOWN_KEY"
  | "UNSUPPORTED";

export interface CompileError {
  code: CompileErrorCode;
  message: string;
  /** Nomor baris 1-based di index.maera, atau null jika tidak bisa dilacak */
  line: number | null;
  /** Jalur logis, mis. `widgets[1].bind` */
  path: string;
}

export type CompileResult =
  | { ok: true; ast: maeraAST; errors: [] }
  | { ok: false; ast: null; errors: CompileError[] };

/** Nilai satu source pada satu waktu: objek bebas, mis. { value: 24.1, unit: '°C' } */
export type SourceData = Record<string, unknown>;

export interface HistoryEntry {
  /** Epoch ms */
  t: number;
  data: SourceData;
}

export type Listener = (data: SourceData, source: string) => void;
export type Unsubscribe = () => void;
export type WriteHandler = (binding: Binding, value: unknown) => Promise<void> | void;