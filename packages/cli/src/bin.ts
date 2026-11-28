#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBuildPages, runBuildSingle } from './bundler.js';
import { runDevPages, runDevSingle } from './dev-server.js';
import { die, failSafePages, loadCore } from './diagnostics.js';
import { runAdd404, runInit } from './scaffold.js';

export { generateBundle } from './bundler.js';

const USAGE = `Pemakaian:
  maera dev [file.maera]                    Dev server dengan live reload (default)
  maera build [file.maera] [-o out.html]    Hasilkan output modular di public/ (default)
  maera init [--force]                     Buat pages/ dan pages/index.maera
  maera add 404 [--force]                  Buat pages/404.html
  maera schema [-o file.json]               Tulis JSON Schema untuk *.maera

Tanpa file, dicari folder pages/ (file-based routing).
Env untuk dev: PORT (3000), HOST (127.0.0.1)
`;

export async function runSchema(args: string[]): Promise<void> {
  let outArg: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-h' || a === '--help') {
      console.log(USAGE);
      return;
    }
    if (a === '-o' || a === '--out') {
      outArg = args[++i];
      if (!outArg) die('Opsi -o membutuhkan nama file.', USAGE);
    } else if (a.startsWith('-')) {
      die(`Opsi tidak dikenal: '${a}'`, USAGE);
    } else {
      die(`Argumen tidak dikenal: '${a}'`, USAGE);
    }
  }
  const { generateSchema } = await loadCore();
  const out = path.resolve(process.cwd(), outArg ?? path.join('schema', 'maera.schema.json'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(generateSchema(), null, 2)}\n`);
  console.log(`schema: ${path.relative(process.cwd(), out)}`);
}

export async function main(): Promise<void> {
  const [first, ...rest] = process.argv.slice(2);
  if (first === '-h' || first === '--help') {
    console.log(USAGE);
    return;
  }

  if (first === 'init') {
    await runInit(rest, USAGE);
    return;
  }

  if (first === 'add') {
    if (rest[0] !== '404') die(`Subcommand tidak dikenal: ${rest[0] ?? ''}`, USAGE);
    await runAdd404(rest.slice(1), USAGE);
    return;
  }

  if (first === 'schema') {
    await runSchema(rest);
    return;
  }

  const cmd = first ?? 'dev';
  if (cmd !== 'dev' && cmd !== 'build') die(`Subcommand tidak dikenal: '${cmd}'`, USAGE);
  const isDev = cmd === 'dev';

  let fileArg: string | undefined;
  let outArg: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '-h' || a === '--help') {
      console.log(USAGE);
      return;
    } else if (a === '-o' || a === '--out') {
      outArg = rest[++i];
      if (!outArg) die('Opsi -o membutuhkan nama file.', USAGE);
    } else if (a.startsWith('-')) {
      die(`Opsi tidak dikenal: '${a}'`, USAGE);
    } else if (fileArg) {
      die('Hanya satu file .maera yang diterima.', USAGE);
    } else {
      fileArg = a;
    }
  }
  if (outArg && isDev) die('Opsi -o hanya untuk `maera build`.', USAGE);

  const root = process.cwd();

  if (isDev) {
    const fsResult = failSafePages(root, fileArg);
    if (fsResult.mode === 'file') {
      await runDevSingle(fsResult.file);
    } else {
      await runDevPages(root);
    }
  } else {
    const fsResult = failSafePages(root, fileArg);
    if (fsResult.mode === 'file') {
      await runBuildSingle(root, fsResult.file, outArg);
    } else {
      await runBuildPages(root);
    }
  }
}

function formatEsbuildErrors(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && e !== null && 'errors' in e && Array.isArray((e as { errors: unknown }).errors)) {
    return (e as { errors: string[] }).errors.map((err: string) => `  - ${err}`).join('\n');
  }
  return String(e);
}

function fail(e: unknown): never {
  const msg = formatEsbuildErrors(e);
  console.error(msg || 'Build gagal tanpa pesan error');
  process.exit(1);
}

export function isMainModule(): boolean {
  if (!import.meta.url) return false;
  try {
    const currentFile = fs.realpathSync(fileURLToPath(import.meta.url));
    const mainFile = process.argv[1] ? fs.realpathSync(process.argv[1]) : '';
    return currentFile === mainFile;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  void main().catch(fail);
}
