#!/usr/bin/env node
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `Pemakaian:
  maera dev [file.maera]                    Dev server dengan live reload (default)
  maera build [file.maera] [-o out.html]    Hasilkan 1 file HTML mandiri (default: dist/<nama>.html)

Tanpa file, dicari index.maera lalu examples/index.maera di folder saat ini.
Env untuk dev: PORT (3000), HOST (127.0.0.1)
`;

function die(message: string, withUsage = false): never {
  console.error(withUsage ? `${message}\n\n${USAGE}` : message);
  process.exit(1);
}

// ── Argumen ─────────────────────────────────────────────────────

const [first, ...rest] = process.argv.slice(2);
if (first === '-h' || first === '--help') {
  console.log(USAGE);
  process.exit(0);
}
const cmd = first ?? 'dev';
if (cmd !== 'dev' && cmd !== 'build') die(`Subcommand tidak dikenal: '${cmd}'`, true);
const isDev = cmd === 'dev';

let fileArg: string | undefined;
let outArg: string | undefined;
for (let i = 0; i < rest.length; i++) {
  const a = rest[i]!;
  if (a === '-h' || a === '--help') {
    console.log(USAGE);
    process.exit(0);
  } else if (a === '-o' || a === '--out') {
    outArg = rest[++i];
    if (!outArg) die('Opsi -o membutuhkan nama file.', true);
  } else if (a.startsWith('-')) {
    die(`Opsi tidak dikenal: '${a}'`, true);
  } else if (fileArg) {
    die('Hanya satu file .maera yang diterima.', true);
  } else {
    fileArg = a;
  }
}
if (outArg && isDev) die('Opsi -o hanya untuk `maera build`.', true);

const root = process.cwd();
const candidates = fileArg ? [fileArg] : ['index.maera', 'examples/index.maera'];
const file = candidates.map((c) => path.resolve(root, c)).find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
if (!file) {
  die(
    fileArg
      ? `File tidak ditemukan: ${fileArg}`
      : `Tidak menemukan index.maera atau examples/index.maera di ${root}.\nSebutkan file: maera ${cmd} path/ke/dashboard.maera`,
  );
}

/** Error build esbuild sudah dicetak rapi oleh esbuild sendiri; jangan tambah stack trace. */
function fail(e: unknown): never {
  if (!Array.isArray((e as { errors?: unknown }).errors)) console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}

// ── Entry virtual: compile + mount, tanpa file .ts buatan pengguna ──

const cliDir = path.dirname(fileURLToPath(import.meta.url));

const entryCode = `
import { compile } from "@maera/core";
import { mount } from "@maera/ui";
import source from ${JSON.stringify(file)};

const app = document.getElementById("app");
const result = compile(source);
if (!result.ok) {
  app.setAttribute("style", "padding:24px;font:14px/1.5 ui-monospace,Consolas,monospace;color:#b00020;white-space:pre-wrap");
  app.textContent = result.errors
    .map((e) => "baris " + (e.line == null ? "?" : e.line) + " [" + e.code + "] " + (e.path ? e.path + ": " : "") + e.message)
    .join("\\n");
} else {
  document.title = result.ast.app.title;
  const warned = new Set();
  mount(result.ast, app, {
    onError(name, error) {
      if (warned.has(name)) return;
      warned.add(name);
      console.warn("[maera] source '" + name + "' gagal:", error);
    },
  });
}
`;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page(title: string, script: string): string {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>html,body{margin:0;height:100%}#app{min-height:100%}</style>
</head>
<body>
<div id="app"></div>
${script}
</body>
</html>
`;
}

const baseOptions: esbuild.BuildOptions = {
  // resolveDir = lokasi CLI: @maera/core dan @maera/ui dicari dari node_modules milik CLI, bukan folder pengguna.
  stdin: { contents: entryCode, resolveDir: cliDir, sourcefile: 'maera-entry.js', loader: 'js' },
  bundle: true,
  format: 'iife',
  target: 'es2022',
  loader: { [path.extname(file) || '.maera']: 'text' },
};

// ── dev ─────────────────────────────────────────────────────────

/** Coba beberapa port berurutan jika port awal sudah terpakai. */
async function serveOnFreePort(ctx: esbuild.BuildContext, servedir: string, host: string, start: number) {
  for (let port = start; port < start + 10; port++) {
    try {
      return await ctx.serve({ servedir, host, port });
    } catch (e) {
      if (!/address already in use/i.test(String(e))) throw e;
    }
  }
  throw new Error(`Port ${start}-${start + 9} semuanya terpakai. Set PORT=<angka lain>.`);
}

async function runDev(): Promise<void> {
  // Di dalam monorepo, baca langsung src/ agar perubahan core/ui ikut ter-watch tanpa tsc.
  const coreSrc = path.resolve(cliDir, '../../core/src/index.ts');
  const uiSrc = path.resolve(cliDir, '../../ui/src/index.ts');
  const inMonorepo = fs.existsSync(coreSrc) && fs.existsSync(uiSrc);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maera-dev-'));
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  process.on('exit', cleanup);
  fs.writeFileSync(path.join(tmp, 'index.html'), page('maera', '<script src="./app.js"></script>'));

  const ctx = await esbuild.context({
    ...baseOptions,
    outfile: path.join(tmp, 'app.js'),
    logLevel: 'info',
    ...(inMonorepo && { alias: { '@maera/core': coreSrc, '@maera/ui': uiSrc } }),
    banner: { js: `new EventSource('/esbuild').addEventListener('change', () => location.reload());` },
  });
  await ctx.watch();

  const host = process.env.HOST ?? '127.0.0.1';
  const { port } = await serveOnFreePort(ctx, tmp, host, Number(process.env.PORT ?? 3000));
  console.log(`maera dev: ${path.relative(root, file!) || file}`);
  console.log(`Dashboard aktif di http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);

  process.on('SIGINT', () => {
    void ctx.dispose().then(() => process.exit(0));
  });
}

// ── build ───────────────────────────────────────────────────────

async function runBuild(): Promise<void> {
  // Validasi lebih dulu supaya tidak mengirim halaman yang rusak.
  const { compile } = await import('@maera/core');
  const result = compile(fs.readFileSync(file!, 'utf8'));
  const rel = path.relative(root, file!) || file!;
  if (!result.ok) {
    for (const e of result.errors) console.error(`${rel}:${e.line ?? 1}  [${e.code}] ${e.path ? e.path + ': ' : ''}${e.message}`);
    die(`\nBuild dibatalkan: ${result.errors.length} error di ${rel}.`);
  }

  const built = await esbuild.build({
    ...baseOptions,
    write: false,
    outfile: path.join(root, 'maera-app.js'),
    minify: true,
    legalComments: 'none',
  });
  const code = built.outputFiles[0]!.text;
  // Cegah `</script` di dalam bundel menutup tag lebih awal.
  const html = page(result.ast.app.title, `<script>${code.replace(/<\/script/gi, '<\\/script')}</script>`);

  const out = path.resolve(root, outArg ?? path.join('dist', `${path.basename(file!, path.extname(file!))}.html`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`✔ ${path.relative(root, out)}  (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB, mandiri: bisa dibuka langsung lewat file://)`);
}

try {
  await (isDev ? runDev() : runBuild());
} catch (e) {
  fail(e);
}