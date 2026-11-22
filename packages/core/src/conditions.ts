import type { Conditional, Outcome, StatusLevel } from "./types.js";

/** Nilai `status` yang diizinkan, urut dari paling aman ke paling genting. */
export const STATUS_LEVELS: readonly StatusLevel[] = ["ok", "info", "warning", "danger"];

/**
 * Tentukan hasil tampilan untuk sebuah nilai. Fungsi murni, tanpa DOM.
 * Mengembalikan `undefined` jika nilai bukan angka atau tidak ada kondisi yang cocok.
 *
 * - `steps`: langkah pertama (dari `at` terbesar) dengan nilai >= at; `at` kosong = cadangan.
 * - `state`: nilai < threshold -> below, > threshold -> above, == threshold -> equal
 *   (jika `equal` tidak ditulis, dihitung sebagai `above`).
 */
export function evaluate(cond: Conditional, value: unknown): Outcome | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (cond.kind === "state") {
    if (value < cond.threshold) return cond.below;
    if (value === cond.threshold) return cond.equal ?? cond.above;
    return cond.above;
  }
  for (const step of cond.steps) {
    if (step.at === null || value >= step.at) return step.outcome;
  }
  return undefined;
}