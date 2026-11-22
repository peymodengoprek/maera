/** Fungsi murni (tanpa DOM) untuk memformat nilai widget. */

export const EMPTY = "—";

/** Format nilai untuk ditampilkan. `decimals` memaksa jumlah desimal; tanpa itu dibulatkan maksimal 2 desimal. */
export function formatValue(v: unknown, decimals?: number): string {
  if (v === undefined || v === null) return EMPTY;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return EMPTY;
    return decimals === undefined ? String(Math.round(v * 100) / 100) : v.toFixed(decimals);
  }
  return String(v);
}

/** Posisi nilai dalam rentang [min, max] sebagai 0..1. Nilai bukan angka -> 0. */
export function ratio(v: unknown, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || max <= min) return 0;
  return Math.min(1, Math.max(0, (v - min) / (max - min)));
}

const TRUE_WORDS = new Set(["true", "on", "1", "yes"]);
const FALSE_WORDS = new Set(["false", "off", "0", "no", ""]);

/**
 * Ubah nilai apa pun menjadi hidup/mati. `null` berarti tidak diketahui.
 * Angka: `>= threshold` jika threshold diberikan, jika tidak `!== 0`.
 */
/** Ubah nilai apa pun menjadi hidup/mati (angka: `!== 0`). `null` berarti tidak diketahui. */
export function toBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v !== 0 : null;
  if (typeof v === "string") {
    const k = v.trim().toLowerCase();
    if (TRUE_WORDS.has(k)) return true;
    if (FALSE_WORDS.has(k)) return false;
  }
  return null;
}

export interface ChartOptions {
  /** Batas sumbu Y; default mengikuti data */
  min?: number | undefined;
  max?: number | undefined;
  width?: number;
  height?: number;
  /** Ruang atas/bawah agar garis tidak menempel tepi */
  pad?: number;
}

export interface ChartGeometry {
  /** Atribut `d` untuk garis */
  line: string;
  /** Atribut `d` untuk area di bawah garis */
  area: string;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Hitung path SVG dari deret nilai. Data baru masuk dari kanan; jika data belum
 * penuh (`values.length < capacity`), sisi kiri dibiarkan kosong. Butuh ≥ 2 nilai.
 */
export function chartPath(values: number[], capacity: number, opts: ChartOptions = {}): ChartGeometry | null {
  const n = values.length;
  if (n < 2) return null;
  const { width = 300, height = 100, pad = 4 } = opts;
  const cap = Math.max(capacity, n);

  let lo = opts.min ?? Math.min(...values);
  let hi = opts.max ?? Math.max(...values);
  if (hi <= lo) {
    lo -= 1;
    hi += 1;
  }

  const pts = values.map((v, i) => {
    const x = r2(((cap - n + i) / (cap - 1)) * width);
    const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    const y = r2(pad + (1 - t) * (height - 2 * pad));
    return { x, y };
  });
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  return { line, area: `${line} L${last.x},${height} L${first.x},${height} Z` };
}