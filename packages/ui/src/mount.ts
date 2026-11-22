import { createStore, startSources, type maeraAST, type Store } from "@maera/core";
import { el } from "./dom.js";
import { injectStyles } from "./styles.js";
import { getRenderer } from "./widgets.js";

export interface MountOptions {
  /** Pakai store sendiri; default membuat store baru. */
  store?: Store;
  /** Jalankan data sources dari AST (default true). Isi false jika Anda mengisi store sendiri. */
  run?: boolean;
  /** Timpa tema dari `app.theme` (mis. "dark"). */
  theme?: string;
  /** Dipanggil saat polling source `rest` gagal. */
  onError?: (source: string, error: unknown) => void;
}

export interface MountHandle {
  store: Store;
  /** Hentikan source, lepas semua subscription, dan kosongkan container. */
  destroy(): void;
}

/** Render dashboard dari AST ke dalam `container`. */
export function mount(ast: maeraAST, container: HTMLElement, opts: MountOptions = {}): MountHandle {
  const doc = container.ownerDocument;
  injectStyles(doc);

  // Riwayat harus cukup untuk chart dengan `points` terbesar (default store hanya 100).
  const maxPoints = ast.widgets.reduce((m, w) => (typeof w.props["points"] === "number" ? Math.max(m, Math.ceil(w.props["points"])) : m), 100);
  const store = opts.store ?? createStore({ historyLimit: maxPoints });
  container.replaceChildren();
  container.classList.add("maera");
  container.dataset["theme"] = opts.theme ?? ast.app.theme;

  const header = el(doc, "header", "maera-header");
  header.append(el(doc, "h1", "maera-title", ast.app.title));

  const grid = el(doc, "div", "maera-grid");
  grid.style.gridTemplateColumns = `repeat(${ast.app.columns}, minmax(0, 1fr))`;

  const cleanups: Array<() => void> = [];

  for (const node of ast.widgets) {
    const card = el(doc, "section", "maera-widget");
    card.dataset["type"] = node.type;
    card.dataset["id"] = node.id;
    card.style.setProperty("--m-span", String(Math.min(node.span, ast.app.columns)));
    if (node.title) card.append(el(doc, "h2", "maera-widget-title", node.title));

    const body = el(doc, "div", "maera-widget-body");
    card.append(body);
    grid.append(card);

    const renderer = getRenderer(node.type);
    if (!renderer) {
      body.append(el(doc, "p", "maera-unsupported", `Widget '${node.type}' belum didukung oleh @maera/ui.`));
      continue;
    }
    try {
      const cleanup = renderer({ doc, node, card, body, store });
      if (cleanup) cleanups.push(cleanup);
    } catch (e) {
      body.replaceChildren(el(doc, "p", "maera-unsupported", `Gagal merender widget: ${(e as Error).message}`));
    }
  }

  container.append(header, grid);

  // Source dijalankan SETELAH widget berlangganan agar emisi pertama tidak terlewat.
  const runner = opts.run === false ? undefined : startSources(ast, store, opts.onError ? { onError: opts.onError } : {});

  return {
    store,
    destroy() {
      runner?.stop();
      cleanups.forEach((fn) => fn());
      container.replaceChildren();
      container.classList.remove("maera");
      delete container.dataset["theme"];
    },
  };
}