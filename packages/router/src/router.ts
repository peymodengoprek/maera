import { mount, type MountHandle, type MountOptions } from "@maera-js/ui";
import { createStore, startSources, type maeraAST, type Store, type SourceRunner, type SourceRunnerOptions } from "@maera-js/core";

export interface RouterOptions {
  root?: HTMLElement | string | null;
  container?: HTMLElement | string | null;
  el?: HTMLElement | string | null;
  target?: HTMLElement | string | null;
  store?: Store;
  manageSources?: boolean;
  fetch?: typeof globalThis.fetch;
  sourceOptions?: SourceRunnerOptions;
  onError?: (source: string, error: unknown) => void;
  theme?: string;
}

export interface CachedPage {
  url: string;
  html: string;
  title: string;
  ast: maeraAST | null;
  doc: Document;
}

function isElementLike(v: unknown): v is HTMLElement {
  return !!v && typeof v === "object" && typeof (v as HTMLElement).appendChild === "function" && typeof (v as HTMLElement).ownerDocument !== "undefined";
}

function resolveRoot(opts: RouterOptions, fallbackDoc: Document): HTMLElement {
  const candidates: unknown[] = [opts.root, opts.container, opts.el, opts.target];
  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === "string") {
      const found = fallbackDoc.querySelector(c);
      if (found instanceof HTMLElement) return found;
      const byId = fallbackDoc.getElementById(c.replace(/^#/, ""));
      if (byId instanceof HTMLElement) return byId;
    } else if (isElementLike(c)) {
      return c;
    }
  }
  let root = fallbackDoc.getElementById("maera-root");
  if (root instanceof HTMLElement) return root;
  root = fallbackDoc.createElement("div");
  root.id = "maera-root";
  fallbackDoc.body.appendChild(root);
  return root;
}

function normalizeAst(input: unknown): maeraAST | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  if (o.app && Array.isArray(o.widgets) && o.sources && typeof o.sources === "object") {
    return o as unknown as maeraAST;
  }
  for (const key of ["ast", "data", "maera", "payload", "result"]) {
    if (o[key] != null) {
      const r = normalizeAst(o[key]);
      if (r) return r;
    }
  }
  return null;
}

function sourceSignature(name: string, def: unknown): string {
  try {
    return `${name}:${JSON.stringify(def)}`;
  } catch {
    return `${name}:${String(def)}`;
  }
}

export class Router {
  readonly #options: RouterOptions;
  #doc: Document;
  #win: Window & typeof globalThis;
  #root: HTMLElement;
  #store: Store;
  #runners: Map<string, SourceRunner> = new Map();
  #mount: MountHandle | null = null;
  #cache: Map<string, CachedPage> = new Map();
  #prefetchCache: Map<string, Promise<CachedPage>> = new Map();
  #destroyed = false;
  #navigating = false;
  #sourceOpts: SourceRunnerOptions;
  #fetchImpl: typeof globalThis.fetch;
  #clickHandler: (e: Event) => void;
  #popHandler: () => void;

  constructor(rootOrOptions?: HTMLElement | string | RouterOptions | null, options?: RouterOptions) {
    let opts: RouterOptions = {};
    if (rootOrOptions && typeof rootOrOptions === "object" && !isElementLike(rootOrOptions) && !(rootOrOptions instanceof String)) {
      // could be options object
      const o = rootOrOptions as Record<string, unknown>;
      if ("root" in o || "container" in o || "store" in o || "fetch" in o || "sourceOptions" in o || "theme" in o || "onError" in o) {
        opts = rootOrOptions as RouterOptions;
      } else if (typeof (rootOrOptions as { appendChild?: unknown }).appendChild === "function") {
        opts = { ...(options ?? {}), root: rootOrOptions as HTMLElement };
      } else {
        opts = { ...(options ?? {}), ...((rootOrOptions as RouterOptions) ?? {}) };
      }
    } else if (typeof rootOrOptions === "string") {
      opts = { ...(options ?? {}), root: rootOrOptions };
    } else if (isElementLike(rootOrOptions)) {
      opts = { ...(options ?? {}), root: rootOrOptions as HTMLElement };
    } else if (rootOrOptions == null) {
      opts = options ?? {};
    } else {
      opts = { ...(options ?? {}), ...(rootOrOptions as RouterOptions) };
    }

    if (options) opts = { ...opts, ...options };

    this.#options = opts;
    const docCandidate = isElementLike(opts.root ?? opts.container ?? opts.el ?? opts.target)
      ? (opts.root ?? opts.container ?? opts.el ?? opts.target) as HTMLElement
      : null;
    const baseDoc = docCandidate?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
    if (!baseDoc) {
      throw new Error("Router membutuhkan document.");
    }
    this.#doc = baseDoc;
    this.#win = (baseDoc.defaultView ?? (typeof window !== "undefined" ? window : null)) as Window & typeof globalThis;
    if (!this.#win) throw new Error("Router membutuhkan window.");
    this.#root = resolveRoot(opts, this.#doc);
    this.#store = opts.store ?? createStore();
    this.#sourceOpts = opts.sourceOptions ?? {};
    if (opts.onError) {
      const prev = this.#sourceOpts.onError;
      this.#sourceOpts = { ...this.#sourceOpts, onError: (s, e) => { opts.onError?.(s, e); prev?.(s, e); } };
    }
    this.#fetchImpl = opts.fetch ?? this.#win.fetch?.bind(this.#win) ?? globalThis.fetch?.bind(globalThis);

    this.#clickHandler = (e: Event) => this.#onClick(e);
    this.#popHandler = () => this.#onPopState();
    this.#doc.addEventListener("click", this.#clickHandler, true);
    this.#win.addEventListener("popstate", this.#popHandler);
  }

  get store(): Store {
    return this.#store;
  }

  get root(): HTMLElement {
    return this.#root;
  }

  #onClick(e: Event): void {
    if (this.#destroyed) return;
    const target = e.target as Node | null;
    let a: HTMLAnchorElement | null = null;
    let cur: Node | null = target;
    while (cur && cur !== this.#doc) {
      if (cur.nodeName === "A") { a = cur as HTMLAnchorElement; break; }
      cur = cur.parentNode;
    }
    if (!a) return;
    const hrefAttr = a.getAttribute("href");
    if (!hrefAttr) return;
    if (a.target === "_blank") return;
    if (a.hasAttribute("download")) return;
    if (hrefAttr.trim().startsWith("#")) return;
    let url: URL;
    try {
      url = new URL(hrefAttr, this.#win.location.href);
    } catch {
      return;
    }
    if (url.origin !== this.#win.location.origin) return;
    if (url.hash && url.pathname === this.#win.location.pathname && url.search === this.#win.location.search) return;
    e.preventDefault();
    void this.push(url.href);
  }

  #onPopState(): void {
    if (this.#destroyed || this.#navigating) return;
    void this.#navigate(this.#win.location.href, "none");
  }

  async #fetchAndCache(url: string): Promise<CachedPage> {
    const key = new URL(url, this.#win.location.href).href;
    if (this.#cache.has(key)) return this.#cache.get(key)!;
    let existing = this.#prefetchCache.get(key);
    if (existing) return existing;
    const p = this.#doFetch(url);
    this.#prefetchCache.set(key, p);
    try {
      const page = await p;
      this.#cache.set(key, page);
      return page;
    } finally {
      this.#prefetchCache.delete(key);
    }
  }

  async #doFetch(url: string): Promise<CachedPage> {
    const res = await this.#fetchImpl(url);
    let html: string;
    let finalUrl = url;
    if (!res.ok) {
      // 404 / error fallback
      if (res.status === 404) {
        try {
          const fb = await this.#fetchImpl("/404.html");
          if (fb.ok) html = await fb.text();
          else html = await res.text();
        } catch {
          html = await res.text().catch(() => "");
        }
      } else {
        html = await res.text().catch(() => "");
      }
    } else {
      html = await res.text();
    }
    const DP = (this.#win as any).DOMParser ?? (globalThis as any).DOMParser;
    const doc = new DP().parseFromString(html, "text/html");
    const script = doc.querySelector("script#__MAERA_DATA__");
    let ast: maeraAST | null = null;
    if (script && script.textContent) {
      const text = script.textContent.trim();
      try {
        ast = normalizeAst(JSON.parse(text));
      } catch {
        const m = text.match(/\{[\s\S]*\}/);
        if (m) {
          try {
            ast = normalizeAst(JSON.parse(m[0]));
          } catch {
            ast = null;
          }
        } else {
          ast = null;
        }
      }
    }
    const title = (doc.title && doc.title.trim()) || ast?.app?.title || url;
    return { url: finalUrl, html, title, ast, doc };
  }

  async #navigate(url: string, mode: "push" | "replace" | "none"): Promise<void> {
    if (this.#destroyed) return;
    this.#navigating = true;
    try {
      const target = new URL(url, this.#win.location.href);
      const page = await this.#fetchAndCache(url);
      // sync sources
      if (page.ast) {
        await this.#syncSources(page.ast);
      }
      // swap
      if (page.ast) {
        this.#mount?.destroy();
        this.#mount = mount(this.#root, page.ast, {
          store: this.#store,
          manageSources: false,
          theme: this.#options.theme,
          onError: this.#options.onError,
        } as MountOptions);
      } else {
        // static fallback
        this.#mount?.destroy();
        this.#mount = null;
        const srcRoot = page.doc.getElementById("maera-root");
        const sourceHtml = srcRoot ? srcRoot.innerHTML : (page.doc.body?.innerHTML ?? "");
        this.#root.innerHTML = sourceHtml;
      }
      this.#doc.title = page.title;
      if (mode === "push") {
        this.#win.history.pushState({ maera: true }, "", target.href);
      } else if (mode === "replace") {
        this.#win.history.replaceState({ maera: true }, "", target.href);
      }
    } catch (e) {
      // graceful
      try {
        this.#doc.title = this.#doc.title;
      } catch {
        // ignore
      }
    } finally {
      this.#navigating = false;
    }
  }

  async #syncSources(ast: maeraAST): Promise<void> {
    const newSigs = new Set<string>();
    const toStart: Array<{ sig: string; name: string; def: unknown }> = [];
    const sources = (ast.sources ?? {}) as Record<string, unknown>;
    for (const [name, def] of Object.entries(sources)) {
      const sig = sourceSignature(name, def);
      newSigs.add(sig);
      if (!this.#runners.has(sig)) toStart.push({ sig, name, def });
    }
    // stop removed
    for (const [sig, runner] of [...this.#runners.entries()]) {
      if (!newSigs.has(sig)) {
        try { runner.stop(); } catch { /* ignore */ }
        this.#runners.delete(sig);
      }
    }
    // start new
    for (const item of toStart) {
      const mini = { sources: { [item.name]: item.def } } as unknown as Pick<maeraAST, "sources">;
      const runner = startSources(mini as maeraAST, this.#store, this.#sourceOpts);
      this.#runners.set(item.sig, runner);
    }
  }

  push(url: string): Promise<void> {
    return this.#navigate(url, "push");
  }

  replace(url: string): Promise<void> {
    return this.#navigate(url, "replace");
  }

  prefetch(url: string): Promise<CachedPage> {
    const target = new URL(url, this.#win.location.href).href;
    return this.#fetchAndCache(target);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#doc.removeEventListener("click", this.#clickHandler, true);
    this.#win.removeEventListener("popstate", this.#popHandler);
    try { this.#mount?.destroy(); } catch { /* ignore */ }
    this.#mount = null;
    for (const runner of this.#runners.values()) {
      try { runner.stop(); } catch { /* ignore */ }
    }
    this.#runners.clear();
    this.#cache.clear();
    this.#prefetchCache.clear();
  }
}

export function createRouter(rootOrOptions?: HTMLElement | string | RouterOptions | null, options?: RouterOptions): Router {
  return new Router(rootOrOptions, options);
}

export const MaeraRouter = Router;
export const createMaeraRouter = createRouter;
export const initRouter = createRouter;
export const startRouter = createRouter;

export default createRouter;
