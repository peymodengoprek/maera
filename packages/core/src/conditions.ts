import type { Conditional, Outcome, StatusLevel } from "./types.js";

/** Nilai `status` yang diizinkan, urut dari paling aman ke paling genting. */
export const STATUS_LEVELS: readonly StatusLevel[] = ["ok", "info", "warning", "danger"];

/**
 * Tentukan hasil tampilan untuk sebuah nilai. Fungsi murni, tanpa DOM.
 * Mengembalikan `undefined` jika nilai tidak ada atau tidak ada kondisi yang cocok.
 *
 * - `steps`: untuk angka, langkah pertama (dari `at` terbesar) dengan nilai >= at;
 *   untuk teks/boolean, pencocokan sama dengan (`value === at`).
 *   `at` kosong (`null`) = cadangan (fallback).
 * - `state`: untuk angka, nilai < threshold -> below, > threshold -> above, == threshold -> equal
 *   (jika `equal` tidak ditulis, dihitung sebagai `above`).
 *   untuk teks/boolean, nilai === threshold -> equal.
 */
export function evaluate(cond: Conditional, value: unknown): Outcome | undefined {
  if (value === undefined || value === null) return undefined;
  if (cond.kind === "state") {
    if (typeof cond.threshold === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
      if (value < cond.threshold) return cond.below;
      if (value === cond.threshold) return cond.equal ?? cond.above;
      return cond.above;
    }
    if (value === cond.threshold) {
      return cond.equal;
    }
    return undefined;
  }

  // cond.kind === "steps"
  const firstAt = cond.steps.find((s) => s.at !== null)?.at;
  if (typeof firstAt === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    for (const step of cond.steps) {
      if (step.at === null || value >= (step.at as number)) return step.outcome;
    }
    return undefined;
  }

  for (const step of cond.steps) {
    if (step.at !== null && value === step.at) return step.outcome;
  }
  const fallback = cond.steps.find((s) => s.at === null);
  return fallback?.outcome;
}