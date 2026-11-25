/**
 * Formatter diagnostik murni (tanpa DOM/Node API) untuk terminal CLI dan
 * payload dev server. Semua data posisi berasal dari Diagnostic Engine.
 */
import type { Diagnostic, DiagnosticSummary, Severity } from "./types.js";

/** Bentuk minimal hasil kompilasi yang dibutuhkan formatter. */
export interface DiagnosticResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  summary: DiagnosticSummary;
  groups: Record<string, Diagnostic[]>;
}

export interface CodeFrameLine {
  line: number;
  text: string;
  highlight: boolean;
  caret: boolean;
}

export interface CodeFrame {
  file?: string;
  line: number;
  column: number | null;
  startLine: number;
  endLine: number;
  lines: CodeFrameLine[];
  /** Representasi teks polos tanpa warna ANSI. */
  text: string;
}

export interface CodeFrameOptions {
  file?: string;
  column?: number | null;
  contextLines?: number;
}

export interface FormatOptions extends CodeFrameOptions {
  color?: boolean;
  includeInfos?: boolean;
  includeSuppressed?: boolean;
}

export interface PayloadDiagnostic extends Diagnostic {
  /** Lokasi siap tampil, mis. `index.maera:7:5`. */
  location: string;
  codeFrame: CodeFrame | null;
}

export interface DiagnosticPayloadGroup {
  name: string;
  diagnostics: PayloadDiagnostic[];
}

export interface DiagnosticPayload {
  version: 1;
  ok: boolean;
  file?: string;
  summary: DiagnosticSummary;
  /** Teks polos siap ditampilkan di terminal/overlay. */
  text: string;
  diagnostics: PayloadDiagnostic[];
  groups: DiagnosticPayloadGroup[];
}

interface Palette {
  red: (s: string) => string;
  yellow: (s: string) => string;
  cyan: (s: string) => string;
  dim: (s: string) => string;
  bold: (s: string) => string;
}

const plain: Palette = {
  red: (s) => s,
  yellow: (s) => s,
  cyan: (s) => s,
  dim: (s) => s,
  bold: (s) => s,
};

function palette(color: boolean): Palette {
  if (!color) return plain;
  const wrap = (code: number) => (s: string) => `\u001b[${code}m${s}\u001b[0m`;
  return {
    red: wrap(31),
    yellow: wrap(33),
    cyan: wrap(36),
    dim: wrap(2),
    bold: wrap(1),
  };
}

function severityColor(severity: Severity, c: Palette): (s: string) => string {
  if (severity === "warning") return c.yellow;
  if (severity === "info") return c.cyan;
  return c.red;
}

function expandTabs(text: string, tabSize = 2): string {
  return text.replace(/\t/g, " ".repeat(tabSize));
}

/** Lokasi presisi `file:line:column`; kolom hanya ditambahkan bila tersedia. */
export function formatLocation(
  file: string | undefined,
  line: number | null | undefined,
  column?: number | null,
): string {
  const base = file ?? "<maera>";
  if (line == null) return base;
  return column != null ? `${base}:${line}:${column}` : `${base}:${line}`;
}

/** Bangun code frame bernomor baris dengan penanda baris/kolom. */
export function createCodeFrame(
  source: string,
  line: number | null | undefined,
  options: CodeFrameOptions = {},
): CodeFrame | null {
  if (line == null || !Number.isInteger(line) || line < 1) return null;
  const lines = source.split(/\r?\n/);
  if (line > lines.length) return null;

  const context = Math.max(0, options.contextLines ?? 2);
  const start = Math.max(1, line - context);
  const end = Math.min(lines.length, line + context);
  const width = String(end).length;
  const column = options.column ?? null;
  const frameLines: CodeFrameLine[] = [];
  const rendered: string[] = [];

  for (let n = start; n <= end; n++) {
    const text = lines[n - 1] ?? "";
    const highlight = n === line;
    const caret = highlight && column != null && column > 0;
    frameLines.push({ line: n, text, highlight, caret });
    rendered.push(`${highlight ? ">" : " "} ${String(n).padStart(width)} | ${text}`);
    if (caret) {
      const prefix = expandTabs(text.slice(0, Math.max(0, column - 1)));
      rendered.push(`${" ".repeat(2 + width)} | ${prefix}^`);
    }
  }

  return {
    file: options.file,
    line,
    column,
    startLine: start,
    endLine: end,
    lines: frameLines,
    text: rendered.join("\n"),
  };
}

function groupDiagnostics(
  result: DiagnosticResult,
  includeInfos: boolean,
  includeSuppressed: boolean,
): Array<[string, Diagnostic[]]> {
  const grouped: Array<[string, Diagnostic[]]> = [];
  const seen = new Set<string>();
  for (const [name, diagnostics] of Object.entries(result.groups ?? {})) {
    const filtered = diagnostics.filter((d) => {
      if (!includeSuppressed && d.suppressed) return false;
      if (!includeInfos && d.severity === "info") return false;
      return true;
    });
    if (filtered.length === 0) continue;
    grouped.push([name, filtered]);
    seen.add(name);
  }
  // Jaga kompatibilitas bila pemanggil hanya menyediakan `diagnostics`.
  for (const d of result.diagnostics) {
    const name = d.group ?? "schema";
    if (seen.has(name)) continue;
    if (!includeSuppressed && d.suppressed) continue;
    if (!includeInfos && d.severity === "info") continue;
    const existing = grouped.find(([g]) => g === name);
    if (existing) existing[1].push(d);
    else {
      grouped.push([name, [d]]);
      seen.add(name);
    }
  }
  return grouped;
}

function formatSummary(summary: DiagnosticSummary, c: Palette): string {
  const parts = [
    `${summary.errors} errors`,
    `${summary.warnings} warnings`,
    `${summary.infos} infos`,
  ];
  if (summary.suppressedCount > 0) parts.push(`${summary.suppressedCount} suppressed`);
  const text = parts.join(", ");
  if (summary.errors > 0) return c.red(c.bold(text));
  if (summary.warnings > 0) return c.yellow(c.bold(text));
  return c.dim(text);
}

function formatOne(
  diagnostic: Diagnostic,
  source: string,
  options: FormatOptions,
  c: Palette,
): string {
  const location = formatLocation(options.file, diagnostic.line, diagnostic.column);
  const label = severityColor(diagnostic.severity, c)(
    `${diagnostic.severity}[${diagnostic.code}]`,
  );
  const path = diagnostic.path ? ` ${c.dim(`(${diagnostic.path})`)}` : "";
  const out = [`${label} ${location}${path}`, `  ${diagnostic.message}`];

  if (diagnostic.suggestion && !diagnostic.message.includes(diagnostic.suggestion)) {
    out.push(`  ${c.cyan(`help: Mungkin maksud Anda '${diagnostic.suggestion}'.`)}`);
  }

  const frame = createCodeFrame(source, diagnostic.line, {
    file: options.file,
    column: diagnostic.column,
    contextLines: options.contextLines,
  });
  if (frame) {
    out.push(
      frame.text
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n"),
    );
  }
  return out.join("\n");
}

/** Format diagnostik untuk terminal, dikelompokkan per tahap pipeline. */
export function formatDiagnostics(
  result: DiagnosticResult,
  source: string,
  options: FormatOptions = {},
): string {
  const includeInfos = options.includeInfos ?? true;
  const includeSuppressed = options.includeSuppressed ?? false;
  const grouped = groupDiagnostics(result, includeInfos, includeSuppressed);
  if (grouped.length === 0) return "";

  const c = palette(options.color ?? false);
  const out: string[] = [];
  for (const [name, diagnostics] of grouped) {
    if (grouped.length > 1) out.push(c.bold(c.dim(`── ${name} ──`)));
    for (const diagnostic of diagnostics) out.push(formatOne(diagnostic, source, options, c));
  }
  out.push(formatSummary(result.summary, c));
  return out.join("\n");
}

function toPayloadDiagnostic(
  diagnostic: Diagnostic,
  source: string,
  options: CodeFrameOptions,
): PayloadDiagnostic {
  return {
    ...diagnostic,
    location: formatLocation(options.file, diagnostic.line, diagnostic.column),
    codeFrame: createCodeFrame(source, diagnostic.line, {
      file: options.file,
      column: diagnostic.column,
      contextLines: options.contextLines,
    }),
  };
}

/** Struktur JSON lengkap yang siap dikirim ke klien browser/dev server. */
export function toDiagnosticPayload(
  result: DiagnosticResult,
  source: string,
  options: FormatOptions = {},
): DiagnosticPayload {
  const grouped = groupDiagnostics(result, true, true);
  const diagnostics: PayloadDiagnostic[] = [];
  const groups: DiagnosticPayloadGroup[] = [];

  for (const [name, items] of grouped) {
    const payloadItems = items.map((d) => toPayloadDiagnostic(d, source, options));
    groups.push({ name, diagnostics: payloadItems });
    diagnostics.push(...payloadItems);
  }

  return {
    version: 1,
    ok: result.ok,
    file: options.file,
    summary: { ...result.summary },
    text: formatDiagnostics(result, source, {
      ...options,
      color: false,
      includeSuppressed: false,
    }),
    diagnostics,
    groups,
  };
}
