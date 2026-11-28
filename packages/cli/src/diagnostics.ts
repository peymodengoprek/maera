import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type * as esbuild from 'esbuild';
import type { CompileResult, DiagnosticPayload, DiagnosticResult } from '@maera-js/core';
import {
  findMaeraOutsidePages,
  getPagesDir,
  scanPages,
  toPosix,
  type ScanPagesResult,
} from './router.js';

type CoreModule = typeof import('@maera-js/core');

let corePromise: Promise<CoreModule> | undefined;

/**
 * Muat @maera-js/core. Saat CLI dijalankan dari src/ (monorepo/tsx) pakai
 * sumber TypeScript langsung agar `maera dev` tidak bergantung pada dist.
 */
export function loadCore(): Promise<CoreModule> {
  if (!corePromise) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const sourceEntry = path.resolve(here, '../../core/src/index.ts');
    const specifier =
      here.endsWith(`${path.sep}src`) && fs.existsSync(sourceEntry)
        ? pathToFileURL(sourceEntry).href
        : '@maera-js/core';
    corePromise = import(specifier) as Promise<CoreModule>;
  }
  return corePromise;
}

/** Warna ANSI hanya aktif di TTY dan tidak dimatikan lewat NO_COLOR. */
export function useColor(
  stream: { isTTY?: boolean },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(stream.isTTY) && env.NO_COLOR === undefined && env.TERM !== 'dumb';
}

export interface BuildDiagnosticOutput {
  text: string;
  shouldAbort: boolean;
}

/** Output build: error membatalkan build, warning tetap dilanjutkan. */
export async function buildDiagnosticOutput(
  result: DiagnosticResult,
  source: string,
  file: string,
  options: { color?: boolean; contextLines?: number } = {},
): Promise<BuildDiagnosticOutput> {
  const { formatDiagnostics } = await loadCore();
  return {
    text: formatDiagnostics(result, source, {
      file,
      color: options.color ?? false,
      contextLines: options.contextLines,
    }),
    shouldAbort: result.summary.errors > 0,
  };
}

export interface LoadedDiagnostics {
  source: string;
  result: CompileResult;
  payload: DiagnosticPayload;
}

/** Kompilasi file dan bangun payload diagnostik lengkap untuk dev server. */
export async function loadDiagnostics(file: string): Promise<LoadedDiagnostics> {
  const { compile, toDiagnosticPayload } = await loadCore();
  const source = fs.readFileSync(file, 'utf8');
  const result = compile(source);
  const payload = toDiagnosticPayload(result, source, { file });
  return { source, result, payload };
}

/** Virtual module `maera:diagnostics` yang diperbarui saat file berubah. */
export function diagnosticsPlugin(file: string): esbuild.Plugin {
  const namespace = 'maera-diagnostics';
  return {
    name: 'maera-diagnostics',
    setup(build) {
      build.onResolve({ filter: /^maera:diagnostics$/ }, () => ({
        path: 'maera:diagnostics',
        namespace,
      }));
      build.onLoad({ filter: /.*/, namespace }, async () => {
        const { payload } = await loadDiagnostics(file);
        const json = JSON.stringify(payload)
          .replace(/\u2028/g, '\\u2028')
          .replace(/\u2029/g, '\\u2029');
        return {
          contents: `export default ${json};`,
          loader: 'js',
          watchFiles: [file],
        };
      });
    },
  };
}

export function die(message: string, usage?: string): never {
  console.error(usage ? `${message}\n\n${usage}` : message);
  process.exit(1);
}

export interface HtmlInspectionIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  line: number | null;
}

export function inspectHtmlContent(content: string): HtmlInspectionIssue[] {
  const issues: HtmlInspectionIssue[] = [];
  const lines = content.split(/\r?\n/);

  const allowedAsset = (value: string): boolean => {
    const v = value.trim();
    if (!v || v.startsWith('#') || v.startsWith('mailto:') || v.startsWith('data:') || v.startsWith('javascript:')) return true;
    if (/^https?:\/\//i.test(v)) return true; // handled as CDN warning separately
    const normalized = v.replace(/^\.\//, '').replace(/^\//, '');
    if (normalized === 'src/maera.css' || normalized === 'src/maera.js') return true;
    if (normalized.endsWith('src/maera.css') || normalized.endsWith('src/maera.js')) return true;
    if (!/\.[a-z0-9]+$/i.test(v) || /\.html?$/i.test(v)) return true;
    return false;
  };

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;

    if (/<\?php/i.test(line) || /<%/.test(line)) {
      issues.push({ severity: 'error', code: 'SERVER_TEMPLATE_TAG', message: 'Tag template server (<?php/<%) terdeteksi.', line: lineNo });
    }
    if (/\{\{[\s\S]*?\}\}/.test(line)) {
      issues.push({ severity: 'error', code: 'SERVER_TEMPLATE_TAG', message: 'Tag template server ({{...}}) terdeteksi.', line: lineNo });
    }

    const importMatches = line.matchAll(/import\s+(?:[^'"]*?\s+from\s+)?['"][^'"]+['"]/g);
    for (const _m of importMatches) {
      issues.push({ severity: 'error', code: 'JS_MODULE_IMPORT', message: 'Import modul JS mentah terdeteksi.', line: lineNo });
    }
    if (/import\s*\(/.test(line)) {
      issues.push({ severity: 'error', code: 'JS_MODULE_IMPORT', message: 'Import dinamis modul JS terdeteksi.', line: lineNo });
    }

    if (/https?:\/\//i.test(line)) {
      issues.push({ severity: 'warning', code: 'CDN_EXTERNAL_DEPENDENCY', message: 'Dependensi CDN eksternal (https://) terdeteksi.', line: lineNo });
    }

    const assetMatches = line.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi);
    for (const m of assetMatches) {
      const value = m[1] ?? '';
      if (/^https?:\/\//i.test(value)) continue;
      if (!allowedAsset(value)) {
        issues.push({ severity: 'error', code: 'LOCAL_ASSET_REFERENCE', message: `Referensi aset lokal di luar /src/maera.{css,js}: ${value}`, line: lineNo });
      }
    }
  });

  // de-duplicate identical consecutive issues
  const dedup: HtmlInspectionIssue[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    const key = `${issue.severity}:${issue.code}:${issue.line}:${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(issue);
  }
  return dedup;
}

export interface RouteCollision {
  base: string;
  files: string[];
}

export function detectRouteCollisions(scan: ScanPagesResult): RouteCollision[] {
  const byOut = new Map<string, string[]>();
  for (const p of scan.maera) {
    const list = byOut.get(p.outRel) ?? [];
    list.push(p.relPath);
    byOut.set(p.outRel, list);
  }
  for (const p of scan.html) {
    const list = byOut.get(p.outRel) ?? [];
    list.push(p.relPath);
    byOut.set(p.outRel, list);
  }
  const collisions: RouteCollision[] = [];
  for (const [outRel, files] of byOut.entries()) {
    if (files.length > 1) collisions.push({ base: outRel, files: [...files].sort() });
  }
  collisions.sort((a, b) => a.base.localeCompare(b.base));
  return collisions;
}

export type FailSafeResult = { mode: 'file'; file: string } | { mode: 'pages' };

export function warnOutsidePages(root: string): Array<{ severity: string; code: string; message: string }> {
  const outside = findMaeraOutsidePages(root);
  const globalStore = globalThis as { __maeraOutsideWarned?: Set<string> };
  if (!globalStore.__maeraOutsideWarned) globalStore.__maeraOutsideWarned = new Set();
  const warnedSet = globalStore.__maeraOutsideWarned;
  const warnings: Array<{ severity: string; code: string; message: string }> = [];

  for (const f of outside) {
    const key = `${root}:${toPosix(f)}`;
    if (warnedSet.has(key)) continue;
    warnedSet.add(key);
    warnings.push({
      severity: 'warning',
      code: 'MAERA_OUTSIDE_PAGES',
      message: `file .maera di luar pages/ diabaikan: ${f}`,
    });
    console.warn(`warning[MAERA_OUTSIDE_PAGES] ${f}: file .maera di luar pages/ diabaikan.`);
  }
  return warnings;
}

export function failSafePages(root: string, fileArg?: string): FailSafeResult {
  if (fileArg) {
    const file = path.resolve(root, fileArg);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      die(`File tidak ditemukan: ${fileArg}`);
    }
    return { mode: 'file', file };
  }

  const pagesDir = getPagesDir(root);
  if (!fs.existsSync(pagesDir) || !fs.statSync(pagesDir).isDirectory()) {
    die(`Folder pages/ tidak ditemukan di ${root}.\nJalankan \`maera init\` untuk membuat struktur awal.`);
  }

  const scan = scanPages(root);
  if (scan.maera.length === 0 && scan.html.length === 0) {
    die(`Folder pages/ kosong di ${root}.\nJalankan \`maera init\` untuk membuat struktur awal.`);
  }

  warnOutsidePages(root);

  for (const f of scan.codeFiles) {
    console.warn(`warning[FRAMEWORK_FILE_IN_PAGES] pages/${f}: file kode framework di dalam pages/ diabaikan.`);
  }

  const collisions = detectRouteCollisions(scan);
  if (collisions.length > 0) {
    for (const c of collisions) {
      console.error(`error[ROUTE_COLLISION] pages: rute '${c.base}' bertabrakan: ${c.files.join(', ')}`);
    }
    die('Build dibatalkan: tabrakan rute di pages/.');
  }

  let hasHtmlError = false;
  for (const p of scan.html) {
    const content = fs.readFileSync(p.absPath, 'utf8');
    const issues = inspectHtmlContent(content);
    for (const issue of issues) {
      const loc = issue.line ? `${path.relative(root, p.absPath)}:${issue.line}` : path.relative(root, p.absPath);
      if (issue.severity === 'error') {
        hasHtmlError = true;
        console.error(`error[${issue.code}] ${loc}: ${issue.message}`);
      } else {
        console.warn(`warning[${issue.code}] ${loc}: ${issue.message}`);
      }
    }
  }
  if (hasHtmlError) {
    die('Build dibatalkan: inspeksi statis pages/*.html gagal.');
  }

  return { mode: 'pages' };
}
