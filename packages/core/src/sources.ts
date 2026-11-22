import { readPath, type Store } from "./store.js";
import type { maeraAST, MockSource, RestSource, SourceData } from "./types.js";

export interface SourceRunnerOptions {
  /** Implementasi fetch; default `globalThis.fetch` */
  fetch?: typeof globalThis.fetch;
  /** Generator acak 0..1; default `Math.random` (ganti untuk tes deterministik) */
  random?: () => number;
  /** Dipanggil saat polling `rest` gagal. Runner tetap lanjut polling. */
  onError?: (source: string, error: unknown) => void;
}

export interface SourceRunner {
  /** Hentikan semua timer dan batalkan request yang sedang berjalan. */
  stop(): void;
}

/** Jalankan semua source di AST dan dorong datanya ke store. */
export function startSources(ast: Pick<maeraAST, "sources">, store: Store, opts: SourceRunnerOptions = {}): SourceRunner {
  const stoppers: Array<() => void> = [];
  for (const [name, def] of Object.entries(ast.sources)) {
    stoppers.push(def.type === "mock" ? runMock(name, def, store, opts) : runRest(name, def, store, opts));
  }
  return { stop: () => stoppers.forEach((s) => s()) };
}

/** Random walk di dalam [min, max]; emisi pertama langsung terjadi. */
function runMock(name: string, def: MockSource, store: Store, opts: SourceRunnerOptions): () => void {
  const rnd = opts.random ?? Math.random;
  const span = def.max - def.min;
  let value = def.min + span * (0.3 + rnd() * 0.4);

  const tick = () => {
    value += (rnd() - 0.5) * span * 0.1;
    value = Math.min(def.max, Math.max(def.min, value));
    const data: SourceData = { value: Math.round(value * 100) / 100 };
    if (def.unit) data["unit"] = def.unit;
    store.set(name, data);
  };

  tick();
  const id = setInterval(tick, def.interval);
  return () => clearInterval(id);
}

/** Polling GET berurutan (tanpa request tumpang-tindih). */
function runRest(name: string, def: RestSource, store: Store, opts: SourceRunnerOptions): () => void {
  const doFetch = opts.fetch ?? globalThis.fetch;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ctrl: AbortController | undefined;

  const poll = async () => {
    ctrl = new AbortController();
    try {
      const res = await doFetch(def.url, { method: "GET", headers: def.headers ?? {}, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} dari ${def.url}`);
      const json: unknown = await res.json();
      const picked = def.path ? readPath(json, def.path.split(".")) : json;
      if (picked === undefined) throw new Error(`Jalur '${def.path}' tidak ditemukan pada respons.`);
      const data: SourceData =
        picked !== null && typeof picked === "object" && !Array.isArray(picked) ? (picked as SourceData) : { value: picked };
      if (!stopped) store.set(name, data);
    } catch (e) {
      if (!stopped) opts.onError?.(name, e);
    } finally {
      if (!stopped) timer = setTimeout(poll, def.interval);
    }
  };

  void poll();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    ctrl?.abort();
  };
}