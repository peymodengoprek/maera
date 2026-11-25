import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type * as esbuild from 'esbuild';
import type { CompileResult, DiagnosticPayload, DiagnosticResult } from '@maera-js/core';

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
