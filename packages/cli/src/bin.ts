#!/usr/bin/env node
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import {
  buildDiagnosticOutput,
  diagnosticsPlugin,
  loadCore,
  loadDiagnostics,
  useColor,
} from './diagnostics.js';
import {
  assetPath,
  detectRouteCollisions,
  toPosix,
  findMaeraOutsidePages,
  getPagesDir,
  inspectHtmlContent,
  outputRelForMaera,
  scanPages,
} from './router.js';

const USAGE = `Pemakaian:
  maera dev [file.maera]                    Dev server dengan live reload (default)
  maera build [file.maera] [-o out.html]    Hasilkan output modular di public/ (default)
  maera init [--force]                     Buat pages/ dan pages/index.maera
  maera add 404 [--force]                  Buat pages/404.html
  maera schema [-o file.json]               Tulis JSON Schema untuk *.maera

Tanpa file, dicari folder pages/ (file-based routing).
Env untuk dev: PORT (3000), HOST (127.0.0.1)
`;

function die(message: string, withUsage = false): never {
  console.error(withUsage ? `${message}\n\n${USAGE}` : message);
  process.exit(1);
}

// ── helpers ────────────────────────────────────────────────────────

async function loadUiCss(): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sourceEntry = path.resolve(here, '../../ui/src/styles.ts');
  let stylesPath = sourceEntry;
  if (!fs.existsSync(sourceEntry)) {
    const req = createRequire(import.meta.url);
    const uiPkgJson = req.resolve('@maera-js/ui/package.json');
    stylesPath = path.join(path.dirname(uiPkgJson), 'dist', 'styles.js');
  }
  const mod = (await import(pathToFileURL(stylesPath).href)) as { CSS: string };
  return mod.CSS;
}

function inMonorepo(): boolean {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const coreSrc = path.resolve(here, '../../core/src/index.ts');
  const uiSrc = path.resolve(here, '../../ui/src/index.ts');
  const routerSrc = path.resolve(here, '../../router/src/index.ts');
  return fs.existsSync(coreSrc) && fs.existsSync(uiSrc) && fs.existsSync(routerSrc);
}

const cliDir = path.dirname(fileURLToPath(import.meta.url));

function aliasOptions(): Record<string, string> | undefined {
  if (!inMonorepo()) return undefined;
  return {
    '@maera-js/core': path.resolve(cliDir, '../../core/src/index.ts'),
    '@maera-js/ui': path.resolve(cliDir, '../../ui/src/index.ts'),
    '@maera-js/router': path.resolve(cliDir, '../../router/src/index.ts'),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Argumen parsing ────────────────────────────────────────────────

const [first, ...rest] = process.argv.slice(2);
if (first === '-h' || first === '--help') {
  console.log(USAGE);
  process.exit(0);
}

async function runSchema(args: string[]): Promise<void> {
  let outArg: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-h' || a === '--help') {
      console.log(USAGE);
      return;
    }
    if (a === '-o' || a === '--out') {
      outArg = args[++i];
      if (!outArg) die('Opsi -o membutuhkan nama file.', true);
    } else if (a.startsWith('-')) {
      die(`Opsi tidak dikenal: '${a}'`, true);
    } else {
      die(`Argumen tidak dikenal: '${a}'`, true);
    }
  }
  const { generateSchema } = await loadCore();
  const out = path.resolve(process.cwd(), outArg ?? path.join('schema', 'maera.schema.json'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(generateSchema(), null, 2)}\n`);
  console.log(`schema: ${path.relative(process.cwd(), out)}`);
}

async function runInit(args: string[]): Promise<void> {
  let force = false;
  for (const a of args) {
    if (a === '--force') force = true;
    else if (a === '-h' || a === '--help') {
      console.log(USAGE);
      return;
    } else {
      die(`Opsi tidak dikenal: '${a}'`, true);
    }
  }
  const root = process.cwd();
  const pagesDir = getPagesDir(root);
  fs.mkdirSync(pagesDir, { recursive: true });
  const indexPath = path.join(pagesDir, 'index.maera');
  if (fs.existsSync(indexPath) && !force) {
    die(`File sudah ada: ${path.relative(root, indexPath)}. Gunakan --force untuk menimpa.`);
  }
  const content = `app:
  title: Dashboard
sources:
  temp:
    type: mock
widgets:
  - type: stat
    bind: temp.value
`;
  const { compile } = await loadCore();
  const res = compile(content);
  if (!res.ok) die('Template init tidak valid.');
  fs.writeFileSync(indexPath, content);
  console.log(`✔ ${path.relative(root, indexPath)}`);
}

async function runAdd404(args: string[]): Promise<void> {
  let force = false;
  for (const a of args) {
    if (a === '--force') force = true;
    else if (a === '-h' || a === '--help') {
      console.log(USAGE);
      return;
    } else {
      die(`Opsi tidak dikenal: '${a}'`, true);
    }
  }
  const root = process.cwd();
  const pagesDir = getPagesDir(root);
  fs.mkdirSync(pagesDir, { recursive: true });
  const outPath = path.join(pagesDir, '404.html');
  if (fs.existsSync(outPath) && !force) {
    die(`File sudah ada: ${path.relative(root, outPath)}. Gunakan --force untuk menimpa.`);
  }
  const content = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>404 - Halaman Tidak Ditemukan</title>
<link rel="stylesheet" href="./src/maera.css">
<style>
  body { margin: 0; }
  .maera-404 { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; text-align: center; gap: 12px; }
  .maera-404 h1 { font-size: 4rem; margin: 0; color: var(--m-danger, #dc2626); }
  .maera-404 p { color: var(--m-muted, #667785); margin: 0; }
  .maera-404 a { color: var(--m-accent, #0f9d8a); font-weight: 600; text-decoration: none; }
  .maera-404 a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div id="maera-root">
  <div class="maera maera-404">
    <h1>404</h1>
    <p>Halaman yang Anda cari tidak ditemukan.</p>
    <a href="/">Kembali ke beranda</a>
  </div>
</div>
</body>
</html>
`;
  fs.writeFileSync(outPath, content);
  console.log(`✔ ${path.relative(root, outPath)}`);
}

// ── fail-safe pages ────────────────────────────────────────────────

function failSafePages(root: string, fileArg?: string): { mode: 'file'; file: string } | { mode: 'pages' } {
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

  // warnings: outside .maera
    const outside = findMaeraOutsidePages(root);
    if (!(globalThis as any).__maeraOutsideWarned) (globalThis as any).__maeraOutsideWarned = new Set();
    const warnedSet = (globalThis as any).__maeraOutsideWarned as Set<string>;
    for (const f of outside) {
    const key = `${root}:${toPosix(f)}`;
    if (warnedSet.has(key)) continue;
    warnedSet.add(key);
    console.warn(`warning[MAERA_OUTSIDE_PAGES] ${f}: file .maera di luar pages/ diabaikan.`);
  }

  // warnings: code files inside pages
  for (const f of scan.codeFiles) {
    console.warn(`warning[FRAMEWORK_FILE_IN_PAGES] pages/${f}: file kode framework di dalam pages/ diabaikan.`);
  }

  // route collisions
    const collisions = detectRouteCollisions(scan);
    if (collisions.length > 0) {
    for (const c of collisions) {
      console.error(`error[ROUTE_COLLISION] pages: rute '${c.base}' bertabrakan: ${c.files.join(', ')}`);
    }
    die('Build dibatalkan: tabrakan rute di pages/.');
  }

  // static html inspection
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

// ── bundle generation ──────────────────────────────────────────────

async function generateBundle(root: string, outJsPath: string): Promise<void> {
  const css = await loadUiCss();
  // css written separately
  void css;
  const bootstrap = `

function boot() {
  const rootEl = document.getElementById("maera-root");
  if (!rootEl) return;
  const dataScript = document.getElementById("__MAERA_DATA__");
  let ast = null;
  if (dataScript && dataScript.textContent) {
    try { ast = JSON.parse(dataScript.textContent.trim()); } catch (e) { console.error(e); }
  }
  if (ast) {
    try { mount(rootEl, ast); } catch (e) { console.error(e); }
  }
  try { createRouter(rootEl); } catch (e) { console.error(e); }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
`;
  const entry = `
import { mount } from "@maera-js/ui";
import { createRouter } from "@maera-js/router";
${bootstrap}
`;

    const aliases = aliasOptions();
    const built = await esbuild.build({
    stdin: { contents: entry, resolveDir: cliDir, sourcefile: 'maera-entry.js', loader: 'js' },
    bundle: true,
    format: 'iife',
    target: 'es2022',
    write: false,
    minify: false,
    nodePaths: [path.join(root, 'node_modules'), path.join(cliDir, '../../..')],
    ...(aliases ? { alias: aliases } : {}),
    logLevel: 'silent',
  });
    const code = built.outputFiles[0]!.text;
  fs.mkdirSync(path.dirname(outJsPath), { recursive: true });
  fs.writeFileSync(outJsPath, code);
}

// ── build pages mode ───────────────────────────────────────────────

async function runBuildPages(root: string): Promise<void> {
    const scan = scanPages(root);

  // compile all .maera first (diagnostics)
  const compiled: Array<{ page: (typeof scan.maera)[number]; ast: any; title: string }> = [];
  let hasError = false;
  for (const page of scan.maera) {
    const { compile } = await loadCore();
    const source = fs.readFileSync(page.absPath, 'utf8');
    const result = compile(source);
    const rel = path.relative(root, page.absPath);
    const diagnostics = await buildDiagnosticOutput(result, source, rel, { color: useColor(process.stderr) });
    if (diagnostics.text) process.stderr.write(`${diagnostics.text}\n`);
    if (!result.ok || diagnostics.shouldAbort) {
      hasError = true;
      continue;
    }
    compiled.push({ page, ast: result.ast, title: result.ast.app.title });
  }
  if (hasError) {
    die('Build dibatalkan: ada error pada halaman .maera.');
  }

    // clean public
  const publicDir = path.resolve(root, 'public');
    fs.rmSync(publicDir, { recursive: true, force: true });
    fs.mkdirSync(publicDir, { recursive: true });
  
  // assets
    const css = await loadUiCss();
    const srcDir = path.join(publicDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'maera.css'), css);
    await generateBundle(root, path.join(srcDir, 'maera.js'));
  
  // write html pages
  for (const c of compiled) {
    const outPath = path.join(publicDir, c.page.outRel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const depth = c.page.depth;
    const cssPath = assetPath(depth, 'maera.css');
    const jsPath = assetPath(depth, 'maera.js');
    const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(c.title)}</title>
<link rel="stylesheet" href="${cssPath}">
</head>
<body>
<div id="maera-root"></div>
<script id="__MAERA_DATA__" type="application/json">${JSON.stringify(c.ast)}</script>
<script src="${jsPath}" defer></script>
</body>
</html>
`;
    fs.writeFileSync(outPath, html);
  }

  // copy pass-through html
  for (const p of scan.html) {
    const outPath = path.join(publicDir, p.outRel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.copyFileSync(p.absPath, outPath);
  }

  console.log(`✔ public/ (${compiled.length} halaman, ${scan.html.length} html statis)`);
}

// ── build single file (override) ───────────────────────────────────

async function runBuildSingle(root: string, file: string, outArg?: string): Promise<void> {
  const { compile } = await loadCore();
  const source = fs.readFileSync(file, 'utf8');
  const result = compile(source);
  const rel = path.relative(root, file) || file;
  const diagnostics = await buildDiagnosticOutput(result, source, rel, { color: useColor(process.stderr) });
  if (diagnostics.text) process.stderr.write(`${diagnostics.text}\n`);
  if (!result.ok || diagnostics.shouldAbort) {
    die(`\nBuild dibatalkan: ${result.summary.errors} error di ${rel}.`);
  }

  const built = await esbuild.build({
    ...baseOptionsLike(file, mountEntryCode(file)),
    write: false,
    outfile: path.join(root, 'maera-app.js'),
    minify: true,
    legalComments: 'none',
  });
  const code = built.outputFiles[0]!.text;
  const html = page(result.ast.app.title, `<script>${code.replace(/<\/script/gi, '<\\/script')}</script>`);

  const out = path.resolve(root, outArg ?? path.join('public', `${path.basename(file, path.extname(file))}.html`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`✔ ${path.relative(root, out)}  (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB, mandiri: bisa dibuka langsung lewat file://)`);
}

function baseOptionsLike(file: string, contents: string): esbuild.BuildOptions {
  const ext = path.extname(file) || '.maera';
  return {
    stdin: { contents, resolveDir: cliDir, sourcefile: 'maera-entry.js', loader: 'js' },
    bundle: true,
    format: 'iife',
    target: 'es2022',
    loader: { [ext]: 'text' },
  };
}

function mountEntryCode(file: string): string {
  return `
import { compile } from "@maera-js/core";
import { mount } from "@maera-js/ui";
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
}

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

// ── dev single file ────────────────────────────────────────────────

async function runDevSingle(file: string): Promise<void> {
  const coreSrc = path.resolve(cliDir, '../../core/src/index.ts');
  const uiSrc = path.resolve(cliDir, '../../ui/src/index.ts');
  const inMono = fs.existsSync(coreSrc) && fs.existsSync(uiSrc);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maera-dev-'));
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  process.on('exit', cleanup);
  fs.writeFileSync(path.join(tmp, 'index.html'), page('maera', '<script src="./app.js"></script>'));

  const ctx = await esbuild.context({
    ...baseOptionsLike(file, devEntryCode(file)),
    outfile: path.join(tmp, 'app.js'),
    logLevel: 'info',
    plugins: [diagnosticsPlugin(file)],
    ...(inMono && { alias: { '@maera-js/core': coreSrc, '@maera-js/ui': uiSrc } }),
    banner: { js: `new EventSource('/esbuild').addEventListener('change', () => location.reload());` },
  });
  await ctx.watch();

  const host = process.env.HOST ?? '127.0.0.1';
  const { port } = await serveOnFreePort(ctx, tmp, host, Number(process.env.PORT ?? 3000));
  console.log(`maera dev: ${path.relative(process.cwd(), file) || file}`);
  console.log(`Dashboard aktif di http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);

  process.on('SIGINT', () => {
    void ctx.dispose().then(() => process.exit(0));
  });
  // keep process alive
  await new Promise(() => {});
}

function devEntryCode(file: string): string {
  return `
import { compile } from "@maera-js/core";
import { createDiagnosticsView, mount } from "@maera-js/ui";
import source from ${JSON.stringify(file)};
import payload from "maera:diagnostics";

const app = document.getElementById("app");
let active;

window.__MAERA_DIAGNOSTICS__ = payload;
window.dispatchEvent(new CustomEvent("maera:diagnostics", { detail: payload }));

const view = createDiagnosticsView(document, {
  render() {
    const result = compile(source);
    if (!result.ok) return;
    active?.destroy();
    document.title = result.ast.app.title;
    const warned = new Set();
    active = mount(result.ast, app, {
      onError(name, error) {
        if (warned.has(name)) return;
        warned.add(name);
        console.warn("[maera] source '" + name + "' gagal:", error);
      },
    });
  },
});

view.update(payload);
`;
}

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

// ── dev pages mode ─────────────────────────────────────────────────

async function runDevPages(root: string): Promise<void> {
  const host = process.env.HOST ?? '127.0.0.1';
  const startPort = Number(process.env.PORT ?? 3000);

  // initial fail-safe
  failSafePages(root); // prints warnings, may die

  // Collect MAERA_OUTSIDE_PAGES warnings for browser
  const outside = findMaeraOutsidePages(root);
  const outsideWarnings: Array<{ severity: string; code: string; message: string }> = [];
  if (!(globalThis as any).__maeraOutsideWarned) (globalThis as any).__maeraOutsideWarned = new Set();
  const warnedSet = (globalThis as any).__maeraOutsideWarned as Set<string>;
  for (const f of outside) {
    const key = `${root}:${toPosix(f)}`;
    if (warnedSet.has(key)) continue;
    warnedSet.add(key);
    outsideWarnings.push({
      severity: 'warning',
      code: 'MAERA_OUTSIDE_PAGES',
      message: `file .maera di luar pages/ diabaikan: ${f}`,
    });
    console.warn(`warning[MAERA_OUTSIDE_PAGES] ${f}: file .maera di luar pages/ diabaikan.`);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maera-dev-'));
  const genRoot = path.join(tmp, 'public');
  fs.mkdirSync(genRoot, { recursive: true });

  const aliases = aliasOptions();
  // bundle once
  const bundleCode = await (async () => {
    const bootstrap = `

function boot() {
  const rootEl = document.getElementById("maera-root");
  if (!rootEl) return;
  const dataScript = document.getElementById("__MAERA_DATA__");
  let ast = null;
  if (dataScript && dataScript.textContent) {
    try { ast = JSON.parse(dataScript.textContent.trim()); } catch (e) { console.error(e); }
  }
  if (ast) {
    try { mount(rootEl, ast); } catch (e) { console.error(e); }
  }
  try { createRouter(rootEl); } catch (e) { console.error(e); }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
`;
    const entry = `import { mount } from "@maera-js/ui";
import { createDiagnosticsView } from "@maera-js/ui";
import { createRouter } from "@maera-js/router";

let active;
let warned = new Set();
let diagnosticsView = null;

function initializeApp() {
  const rootEl = document.getElementById("maera-root");
  if (!rootEl) return;

  if (!diagnosticsView) {
    diagnosticsView = createDiagnosticsView(document);
  }

  const payload = window.__MAERA_DIAGNOSTICS__;
  if (payload) {
    diagnosticsView.update(payload);
  }

  if (!document.getElementById("__MAERA_DATA__")) return;
  const dataScript = document.getElementById("__MAERA_DATA__");
  let ast = null;
  if (dataScript && dataScript.textContent) {
    try { ast = JSON.parse(dataScript.textContent.trim()); } catch (e) { console.error(e); }
  }
  if (ast) {
    try { mount(rootEl, ast); } catch (e) { console.error(e); }
  } else {
    const payload = window.__MAERA_DIAGNOSTICS__;
    if (payload) {
      diagnosticsView.update(payload);
    }
  }
  try { createRouter(rootEl); } catch (e) { console.error(e); }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeApp);
} else {
  initializeApp();
}

// Listen for live diagnostics updates from event source
window.addEventListener("maera:diagnostics", (event) => {
  const payload = (event as CustomEvent).detail;
  if (diagnosticsView) {
    diagnosticsView.update(payload);
  }
});
`;
    const built = await esbuild.build({
      stdin: { contents: entry, resolveDir: cliDir, sourcefile: 'maera-entry.js', loader: 'js' },
      bundle: true,
      format: 'iife',
      target: 'es2022',
      write: false,
      minify: false,
      ...(aliases ? { alias: aliases } : {}),
      logLevel: 'silent',
    });
    return built.outputFiles[0]!.text;
  })();

  const css = await loadUiCss();

  // SSE clients
  const sseClients = new Set<import('node:http').ServerResponse>();

  async function generate(): Promise<void> {
    // clean genRoot
    fs.rmSync(genRoot, { recursive: true, force: true });
    fs.mkdirSync(genRoot, { recursive: true });
    const srcDir = path.join(genRoot, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'maera.css'), css);
    fs.writeFileSync(path.join(srcDir, 'maera.js'), bundleCode);

    const scan = scanPages(root);
    let overallHasError = false;
    const allDiagnostics: Array<{ severity: string; code: string; message: string; location?: string; path?: string }> = [];

    // Add MAERA_OUTSIDE_PAGES warnings from closure
    if (typeof outsideWarnings !== 'undefined') {
      for (const w of outsideWarnings) {
        allDiagnostics.push({
          severity: w.severity,
          code: w.code,
          message: w.message,
          location: '',
          path: '',
        });
      }
    }

    for (const page of scan.maera) {
      const source = fs.readFileSync(page.absPath, 'utf8');
      const { compile } = await loadCore();
      const result = compile(source);
      const outPath = path.join(genRoot, page.outRel);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      if (!result.ok) {
        overallHasError = true;
        for (const e of result.errors) {
          allDiagnostics.push({
            severity: e.severity ?? 'error',
            code: e.code ?? 'UNKNOWN',
            message: e.message ?? 'Unknown error',
            location: e.line != null ? `baris ${e.line}` : undefined,
            path: e.path ?? page.relPath,
          });
        }
        const errText = result.errors.map((e: any) => `baris ${e.line ?? '?'} [${e.code}] ${e.message}`).join('\n');
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Error</title></head><body><div id="maera-root"><pre style="color:#b00020;white-space:pre-wrap">${escapeHtml(errText)}</pre></div><script src="${assetPath(page.depth, 'maera.js')}" defer></script></body></html>`;
        fs.writeFileSync(outPath, html);
        continue;
      }
      const depth = page.depth;
      for (const d of result.diagnostics) {
        allDiagnostics.push({
          severity: d.severity,
          code: d.code,
          message: d.message,
          location: d.line != null ? `baris ${d.line}` : d.path ?? undefined,
          path: d.path,
        });
      }
      // Collect CDN warnings from this page's .maera source? No, CDN warnings are from .html files.
      // We'll collect them in the .html loop below.
      const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(result.ast.app.title)}</title>
<link rel="stylesheet" href="${assetPath(depth, 'maera.css')}">
</head>
<body>
<div id="maera-root"></div>
<script id="__MAERA_DATA__" type="application/json">${JSON.stringify(result.ast)}</script>
<script src="${assetPath(depth, 'maera.js')}" defer></script>
<script>
window.__MAERA_DIAGNOSTICS__ = ${JSON.stringify({ summary: { errors: overallHasError ? allDiagnostics.length : 0, warnings: allDiagnostics.filter((d: any) => d.severity === 'warning' || d.severity === 'info').length, infos: allDiagnostics.filter((d: any) => d.severity === 'info').length }, diagnostics: allDiagnostics })};
window.dispatchEvent(new CustomEvent("maera:diagnostics", { detail: window.__MAERA_DIAGNOSTICS__ }));
</script>
<script>
(function(){try{var es=new EventSource('/__maera_events');es.onmessage=function(event){const data=event.data||{};switch((event.event||'').toLowerCase()){case'init':const initPayload=JSON.parse(data.payload||'{}');if(initPayload.type==='update'){const view=document.querySelector('[maera-diagnostics]');if(view){view.__sdkUpdate__(initPayload.payload)}};break;case'update':const updPayload=JSON.parse(data.payload||'{}');if(updPayload.type==='diagnostics'){window.dispatchEvent(new CustomEvent("maera:diagnostics",{detail:updPayload.payload}))}else{if(updPayload.url&&location.pathname!==updPayload.url){location.reload()}};break;case'reload':location.reload();break;case'warning':window.dispatchEvent(new CustomEvent("maera:warning",{detail:JSON.parse(data.payload||'{}')}))};}catch(e){}};es.onopen=function(){es.send(JSON.stringify({type:'init'}))});es.onerror=function(){es.close();}};})();
</script>
</body>
</html>
`;
      fs.writeFileSync(outPath, html);
    }

    // Collect CDN warnings from .html files and add to allDiagnostics
    const cdnWarnings: Array<{ severity: string; code: string; message: string; location?: string; path?: string }> = [];
    for (const p of scan.html) {
      const content = fs.readFileSync(p.absPath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/https?:\/\//i.test(line)) {
          cdnWarnings.push({
            severity: 'warning',
            code: 'CDN_EXTERNAL_DEPENDENCY',
            message: 'Dependensi CDN eksternal (https://) terdeteksi.',
            location: String(i + 1),
            path: p.relPath,
          });
        }
      }
    }
    // Add CDN warnings to allDiagnostics
    for (const w of cdnWarnings) {
      allDiagnostics.push({
        severity: w.severity,
        code: w.code,
        message: w.message,
        location: w.location != null ? `baris ${w.location}` : undefined,
        path: w.path ? `pages/${w.path}` : undefined,
      });
    }

    for (const p of scan.html) {
      const outPath = path.join(genRoot, p.outRel);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      // inject reload script in-memory
      let htmlContent = fs.readFileSync(p.absPath, 'utf8');
      if (/<\/body>/i.test(htmlContent)) {
        htmlContent = htmlContent.replace(/<\/body>/i, `<script>(function(){try{var es=new EventSource('/__maera_reload');es.onmessage=function(){location.reload();};}catch(e){}})();</script></body>`);
      } else {
        htmlContent += `<script>(function(){try{var es=new EventSource('/__maera_reload');es.onmessage=function(){location.reload();}catch(e){}})();</script>`;
      }
      fs.writeFileSync(outPath, htmlContent);
    }

    // 404.html ensure
    const notFound = path.join(genRoot, '404.html');
    if (!fs.existsSync(notFound)) {
      fs.writeFileSync(notFound, `<!doctype html><html><head><meta charset="utf-8"><title>404</title><link rel="stylesheet" href="./src/maera.css"></head><body><div id="maera-root"><div class="maera"><h1>404</h1><p>Halaman tidak ditemukan.</p><a href="/">Kembali</a></div></div><script src="./src/maera.js" defer></script></body></html>`);
    }
  }

  generate();

  // file watching via polling with debounce
  let snapshot = takeSnapshot(root);
  const watcher = setInterval(() => {
    const next = takeSnapshot(root);
    if (next !== snapshot) {
      snapshot = next;
      void generate().catch((e) => console.error(e));
      // Send events to SSE clients
      const events: Array<{ type: string; payload: any }> = [];
      // Check for outside .maera changes
      const outside = findMaeraOutsidePages(root);
      if (outside.length > 0) {
        events.push({ type: 'outside', payload: outside });
      }
      // Check for diagnostics changes (simplified: always send full update)
      events.push({ type: 'update', payload: takeSnapshot(root) });
      for (const res of sseClients) {
        try {
          res.write(`data: ${JSON.stringify(events)}\n\n`);
        } catch { /* ignore */ }
      }
    }
  }, 100);

  // HTTP server
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    if (urlPath === '/__maera_reload') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 500\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (urlPath === '/__maera_events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // resolve file
    let rel = urlPath.replace(/^\/+/, '');
    if (rel === '') rel = 'index.html';
    let filePath = path.join(genRoot, rel);

    // try .html extension for extensionless routes
    if (!fs.existsSync(filePath) && !path.extname(rel)) {
      const candidate = filePath + '.html';
      if (fs.existsSync(candidate)) filePath = candidate;
    }
    // directory index
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mime = mimeFor(ext);
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
      return;
    }

    // 404
    const notFoundPath = path.join(genRoot, '404.html');
    if (fs.existsSync(notFoundPath)) {
      const data = fs.readFileSync(notFoundPath);
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
    }
  });

  function listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve(port));
    });
  }

  let port = startPort;
  for (let p = startPort; p < startPort + 10; p++) {
    try {
      port = await listen(p);
      break;
    } catch (e) {
      if (!/address already in use/i.test(String(e))) throw e;
    }
  }

  console.log(`maera dev: pages/`);
  console.log(`Dashboard aktif di http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);

  process.on('SIGINT', () => {
    clearInterval(watcher);
    server.close(() => process.exit(0));
  });
  await new Promise(() => {});
}

function takeSnapshot(root: string): string {
  const scan = scanPages(root);
  const parts: string[] = [];
  for (const p of [...scan.maera, ...scan.html]) {
    try {
      const stat = fs.statSync(p.absPath);
      parts.push(`${p.relPath}:${stat.mtimeMs}:${stat.size}`);
    } catch {
      parts.push(`${p.relPath}:missing`);
    }
  }
  for (const f of scan.codeFiles) {
    try {
      const st = fs.statSync(path.join(getPagesDir(root), f));
      parts.push(`code:${f}:${st.mtimeMs}`);
    } catch { /* ignore */ }
  }
  // outside maera
  const outside = findMaeraOutsidePages(root);
  parts.push(`outside:${outside.join(',')}`);
  return parts.join('|');
}

function mimeFor(ext: string): string {
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.ico': return 'image/x-icon';
    default: return 'application/octet-stream';
  }
}

// ── dispatch ───────────────────────────────────────────────────────

if (first === 'init') {
  await runInit(rest);
  process.exit(0);
}

if (first === 'add') {
  if (rest[0] !== '404') die(`Subcommand tidak dikenal: ${rest[0] ?? ''}`, true);
  await runAdd404(rest.slice(1));
  process.exit(0);
}

if (first === 'schema') {
  await runSchema(rest);
  process.exit(0);
}

const cmd = first ?? 'dev';
if (cmd !== 'dev' && cmd !== 'build') die(`Subcommand tidak dikenal: '${cmd}'`, true);
const isDev = cmd === 'dev';

// parse dev/build args
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

function formatEsbuildErrors(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'errors' in e && Array.isArray((e as any).errors)) {
    return (e as { errors: string[] }).errors.map((err: string) => `  - ${err}`).join('\n');
  }
  return String(e);
}

function fail(e: unknown): never {
  const msg = formatEsbuildErrors(e);
  console.error(msg || 'Build gagal tanpa pesan error');
  process.exit(1);
}

try {
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
} catch (e) {
  fail(e);
}










