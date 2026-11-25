import type { CodeFrame, DiagnosticPayload, PayloadDiagnostic } from "@maera-js/core";
import { el } from "./dom.js";
import { injectStyles } from "./styles.js";

export interface DiagnosticsViewOptions {
  /** Dipanggil setiap pembaruan valid (tanpa error) agar dashboard dirender ulang. */
  render?: () => void;
  /** Elemen induk overlay/panel; default `document.body`. */
  host?: HTMLElement;
}

/** Kontrol tampilan diagnostik yang bisa dipakai ulang saat live reload. */
export interface DiagnosticsView {
  /** Tampilkan overlay error, panel warning, atau bersihkan keduanya. */
  update(payload: DiagnosticPayload | null | undefined): void;
  /** Lepas event listener dan semua elemen diagnostik. */
  destroy(): void;
}

interface SummaryCounts {
  errors: number;
  warnings: number;
  infos: number;
  suppressed: number;
}

function summaryCounts(payload: DiagnosticPayload | null | undefined): SummaryCounts {
  return {
    errors: payload?.summary?.errors ?? 0,
    warnings: payload?.summary?.warnings ?? 0,
    infos: payload?.summary?.infos ?? 0,
    suppressed: payload?.summary?.suppressedCount ?? 0,
  };
}

function suggestionOf(diagnostic: PayloadDiagnostic): string | undefined {
  const suggestion = diagnostic.suggestion ?? diagnostic.suggestions?.[0];
  if (!suggestion) return undefined;
  return diagnostic.message.includes(suggestion) ? undefined : suggestion;
}

function plainText(payload: DiagnosticPayload): string {
  if (payload.text?.trim()) return payload.text;
  return payload.diagnostics
    .map((d) => {
      const path = d.path ? ` (${d.path})` : "";
      return `${d.severity}[${d.code}] ${d.location}${path}\n  ${d.message}`;
    })
    .join("\n");
}

function fallbackCopy(doc: Document, text: string): boolean {
  try {
    const area = doc.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-9999px";
    area.style.opacity = "0";
    doc.body.appendChild(area);
    area.select();
    area.setSelectionRange?.(0, text.length);
    const executable = (doc as Document & { execCommand?: (command: string) => boolean }).execCommand;
    const ok = typeof executable === "function" ? executable.call(doc, "copy") : false;
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function copyText(doc: Document, text: string): Promise<boolean> {
  const clipboard = doc.defaultView?.navigator?.clipboard;
  if (clipboard && typeof clipboard.writeText === "function") {
    return clipboard.writeText(text).then(
      () => true,
      () => fallbackCopy(doc, text),
    );
  }
  return Promise.resolve(fallbackCopy(doc, text));
}

function buildCodeFrame(doc: Document, frame: CodeFrame): HTMLElement {
  const pre = el(doc, "pre", "maera-code-frame");
  pre.setAttribute("aria-label", `Code frame ${frame.file ?? ""}`.trim());
  const code = el(doc, "code", "maera-code-frame-body");
  const width = String(frame.endLine).length;

  for (const line of frame.lines) {
    const row = el(doc, "span", "maera-code-frame-line");
    if (line.highlight) row.dataset["highlight"] = "true";
    const gutter = el(doc, "span", "maera-code-frame-gutter", String(line.line).padStart(width, " "));
    const text = el(doc, "span", "maera-code-frame-text", line.text || " ");
    row.append(gutter, doc.createTextNode(" | "), text);
    if (line.caret) {
      row.append(el(doc, "span", "maera-code-frame-caret", "  ^"));
    }
    code.append(row);
  }

  pre.append(code);
  return pre;
}

function buildDiagnostic(doc: Document, diagnostic: PayloadDiagnostic): HTMLElement {
  const article = el(doc, "article", "maera-diagnostic");
  article.dataset["severity"] = diagnostic.severity;

  const meta = el(doc, "div", "maera-diagnostic-meta");
  const badge = el(doc, "span", "maera-diagnostic-code", diagnostic.code);
  badge.dataset["code"] = diagnostic.code;
  meta.append(badge);
  meta.append(el(doc, "span", "maera-diagnostic-location", diagnostic.location));
  if (diagnostic.path) meta.append(el(doc, "span", "maera-diagnostic-path", diagnostic.path));
  article.append(meta);

  article.append(el(doc, "p", "maera-diagnostic-message", diagnostic.message));

  const suggestion = suggestionOf(diagnostic);
  if (suggestion) {
    const hint = el(doc, "p", "maera-diagnostic-suggestion", "Mungkin maksud Anda: ");
    hint.append(el(doc, "code", undefined, suggestion), doc.createTextNode("."));
    article.append(hint);
  }

  if (diagnostic.codeFrame) article.append(buildCodeFrame(doc, diagnostic.codeFrame));
  return article;
}

function buildOverlay(
  doc: Document,
  payload: DiagnosticPayload,
  host: HTMLElement,
  onClose: () => void,
): HTMLElement {
  const overlay = el(doc, "div", "maera-diagnostics-overlay");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "maera-diagnostics-title");
  overlay.tabIndex = -1;

  const shell = el(doc, "div", "maera-diagnostics");
  const header = el(doc, "header", "maera-diagnostics-header");
  const heading = el(doc, "div", "maera-diagnostics-heading");

  heading.append(el(doc, "p", "maera-diagnostics-kicker", "Maera · diagnostik dev"));
  const title = el(doc, "h2", "maera-diagnostics-title", "Build gagal");
  title.id = "maera-diagnostics-title";
  heading.append(title);

  const counts = summaryCounts(payload);
  const parts = [`${counts.errors} error`, `${counts.warnings} warning`];
  if (counts.infos > 0) parts.push(`${counts.infos} info`);
  if (counts.suppressed > 0) parts.push(`${counts.suppressed} suppressed`);
  heading.append(el(doc, "p", "maera-diagnostics-summary", parts.join(" · ")));

  const actions = el(doc, "div", "maera-diagnostics-actions");
  const copyButton = el(doc, "button", "maera-diagnostics-copy", "Salin Error");
  copyButton.type = "button";
  const closeButton = el(doc, "button", "maera-diagnostics-close", "Tutup");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Tutup overlay diagnostik");
  actions.append(copyButton, closeButton);
  header.append(heading, actions);

  const body = el(doc, "div", "maera-diagnostics-body");
  const errors = payload.diagnostics.filter((d) => d.severity === "error");
  if (errors.length === 0) {
    body.append(el(doc, "p", "maera-diagnostic-message", payload.text || "Build gagal."));
  } else {
    for (const diagnostic of errors) body.append(buildDiagnostic(doc, diagnostic));
  }

  shell.append(header, body);
  overlay.append(shell);

  copyButton.addEventListener("click", () => {
    void copyText(doc, plainText(payload)).then((ok) => {
      copyButton.textContent = ok ? "Tersalin" : "Gagal menyalin";
      copyButton.dataset["state"] = ok ? "copied" : "failed";
    });
  });
  closeButton.addEventListener("click", onClose);

  host.append(overlay);
  closeButton.focus();
  return overlay;
}

function buildWarningPanel(doc: Document, payload: DiagnosticPayload, host: HTMLElement): HTMLElement {
  const panel = el(doc, "section", "maera-diagnostics-panel");
  panel.dataset["open"] = "true";
  panel.setAttribute("aria-label", "Peringatan diagnostik");

  const toggle = el(doc, "button", "maera-diagnostics-panel-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "true");

  const icon = el(doc, "span", "maera-diagnostics-panel-icon", "!");
  icon.setAttribute("aria-hidden", "true");
  const counts = summaryCounts(payload);
  const total = counts.warnings + counts.infos;
  toggle.append(icon, el(doc, "span", "maera-diagnostics-panel-count", `${total} peringatan`));

  const list = el(doc, "ul", "maera-diagnostics-panel-list");
  const warnings = payload.diagnostics.filter(
    (d) => d.severity === "warning" || d.severity === "info",
  );
  for (const diagnostic of warnings) {
    const item = el(doc, "li", "maera-diagnostics-panel-item");
    item.dataset["severity"] = diagnostic.severity;
    item.append(el(doc, "span", "maera-diagnostic-code", diagnostic.code));
    item.append(el(doc, "span", "maera-diagnostic-location", diagnostic.location));
    item.append(el(doc, "span", "maera-diagnostic-message", diagnostic.message));
    list.append(item);
  }

  panel.append(toggle, list);
  toggle.addEventListener("click", () => {
    const open = panel.dataset["open"] !== "true";
    panel.dataset["open"] = String(open);
    toggle.setAttribute("aria-expanded", String(open));
  });

  host.append(panel);
  return panel;
}

/**
 * Buat view diagnostik dev. Secara default mendengarkan event
 * `maera:diagnostics` di `window`, sehingga payload baru otomatis mengganti
 * overlay/panel tanpa memasang ulang listener.
 */
export function createDiagnosticsView(
  doc: Document,
  options: DiagnosticsViewOptions = {},
): DiagnosticsView {
  injectStyles(doc);
  const win = doc.defaultView;
  const host = options.host ?? doc.body;
  let overlay: HTMLElement | null = null;
  let panel: HTMLElement | null = null;
  let keyHandler: ((event: Event) => void) | null = null;

  const removeOverlay = (): void => {
    if (keyHandler) {
      doc.removeEventListener("keydown", keyHandler);
      keyHandler = null;
    }
    overlay?.remove();
    overlay = null;
  };

  const removePanel = (): void => {
    panel?.remove();
    panel = null;
  };

  const showOverlay = (payload: DiagnosticPayload): void => {
    removeOverlay();
    overlay = buildOverlay(doc, payload, host, removeOverlay);
    keyHandler = (event: Event) => {
      if ((event as KeyboardEvent).key !== "Escape") return;
      event.preventDefault();
      removeOverlay();
    };
    doc.addEventListener("keydown", keyHandler);
  };

  const showPanel = (payload: DiagnosticPayload): void => {
    removePanel();
    panel = buildWarningPanel(doc, payload, host);
  };

  const update = (payload: DiagnosticPayload | null | undefined): void => {
    const counts = summaryCounts(payload);
    const hasError =
      counts.errors > 0 || Boolean(payload?.diagnostics.some((d) => d.severity === "error"));

    if (hasError && payload) {
      removePanel();
      showOverlay(payload);
      return;
    }

    removeOverlay();
    options.render?.();

    const hasWarning =
      counts.warnings > 0 ||
      counts.infos > 0 ||
      Boolean(payload?.diagnostics.some((d) => d.severity === "warning" || d.severity === "info"));

    if (hasWarning && payload) showPanel(payload);
    else removePanel();
  };

  const onDiagnostics = (event: Event): void => {
    update((event as CustomEvent<DiagnosticPayload>).detail);
  };
  win?.addEventListener("maera:diagnostics", onDiagnostics);

  return {
    update,
    destroy() {
      win?.removeEventListener("maera:diagnostics", onDiagnostics);
      removeOverlay();
      removePanel();
    },
  };
}
