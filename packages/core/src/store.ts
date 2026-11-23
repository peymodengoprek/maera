import type {
  Binding,
  HistoryEntry,
  Listener,
  SourceData,
  Unsubscribe,
  WriteHandler,
} from "./types.js";

export interface StoreOptions {
  /** Maksimum entri riwayat per source (default 100) */
  historyLimit?: number;
  /** Penyedia waktu, bisa diganti untuk testing */
  now?: () => number;
}

const WILDCARD = "*";

/** Ambil nilai bersarang dari objek menurut jalur properti. */
export function readPath(data: unknown, path: readonly string[]): unknown {
  let cur: unknown = data;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * Reactive pub-sub store: menyimpan nilai terbaru dan riwayat tiap source.
 * Tidak bergantung pada DOM sehingga bisa dipakai di browser, Node, maupun CLI.
 */
export class Store {
  readonly #latest = new Map<string, SourceData>();
  readonly #history = new Map<string, HistoryEntry[]>();
  readonly #listeners = new Map<string, Set<Listener>>();
  readonly #writers = new Map<string, WriteHandler>();
  readonly #limit: number;
  readonly #now: () => number;

  constructor(opts: StoreOptions = {}) {
    this.#limit = Math.max(1, opts.historyLimit ?? 100);
    this.#now = opts.now ?? Date.now;
  }

  /** Simpan data baru untuk sebuah source, catat ke riwayat, lalu beri tahu subscriber. */
  set(source: string, data: SourceData): void {
    this.#latest.set(source, data);
    let h = this.#history.get(source);
    if (!h) this.#history.set(source, (h = []));
    h.push({ t: this.#now(), data });
    if (h.length > this.#limit) h.splice(0, h.length - this.#limit);

    // Salin agar subscriber yang unsub di tengah emisi tidak mengganggu iterasi.
    for (const key of [source, WILDCARD]) {
      const set = this.#listeners.get(key);
      if (set) for (const fn of [...set]) fn(data, source);
    }
  }

  /** Data terbaru sebuah source (undefined jika belum ada). */
  get(source: string): SourceData | undefined {
    return this.#latest.get(source);
  }

  /** Nilai terbaru untuk sebuah binding, mis. { s:'temperature', p:['value'] }. */
  getBinding(b: Binding): unknown {
    return readPath(this.#latest.get(b.s), b.p);
  }

  /** Riwayat sebuah source (terlama -> terbaru). `limit` mengambil N entri terakhir. */
  history(source: string, limit?: number): readonly HistoryEntry[] {
    const h = this.#history.get(source) ?? [];
    return limit === undefined ? [...h] : h.slice(-Math.max(0, limit));
  }

  /** Riwayat nilai sebuah binding sebagai deret { t, v }. Entri tanpa nilai dilewati. */
  historyOf(b: Binding, limit?: number): { t: number; v: unknown }[] {
    return this.history(b.s, limit)
      .map((e) => ({ t: e.t, v: readPath(e.data, b.p) }))
      .filter((e) => e.v !== undefined);
  }

  /** Berlangganan perubahan sebuah source. Gunakan `'*'` untuk semua source. */
  sub(source: string, fn: Listener): Unsubscribe {
    let set = this.#listeners.get(source);
    if (!set) this.#listeners.set(source, (set = new Set()));
    set.add(fn);
    return () => {
      set!.delete(fn);
    };
  }

  /** Berlangganan perubahan nilai sebuah binding; dipanggil hanya saat nilainya berubah. */
  subBinding(b: Binding, fn: (value: unknown) => void): Unsubscribe {
    let prev = this.getBinding(b);
    return this.sub(b.s, (data) => {
      const next = readPath(data, b.p);
      if (Object.is(next, prev)) return;
      prev = next;
      fn(next);
    });
  }

  /** Daftarkan handler operasi tulis untuk sebuah source. */
  registerWriter(source: string, fn: WriteHandler): Unsubscribe {
    this.#writers.set(source, fn);
    return () => {
      if (this.#writers.get(source) === fn) {
        this.#writers.delete(source);
      }
    };
  }

  /** Kirim nilai baru ke source melalui writer yang terdaftar. */
  async write(b: Binding, value: unknown): Promise<void> {
    const handler = this.#writers.get(b.s);
    if (!handler) {
      throw new Error(
        `Source '${b.s}' tidak mendukung operasi tulis atau belum aktif.`,
      );
    }
    await handler(b, value);
  }

  /** Hapus semua data, subscriber, dan writer. */
  clear(): void {
    this.#latest.clear();
    this.#history.clear();
    this.#listeners.clear();
    this.#writers.clear();
  }
}

export function createStore(opts?: StoreOptions): Store {
  return new Store(opts);
}