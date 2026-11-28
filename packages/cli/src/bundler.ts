import * as esbuild from 'esbuild';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildDiagnosticOutput, die, loadCore, useColor } from './diagnostics.js';
import { assetPath, scanPages } from './router.js';

export const cliDir = path.dirname(fileURLToPath(import.meta.url));

export async function loadUiCss(): Promise<string> {
  const sourceEntry = path.resolve(cliDir, '../../ui/src/styles.ts');
  let stylesPath = sourceEntry;
  if (!fs.existsSync(sourceEntry)) {
    const req = createRequire(import.meta.url);
    const uiPkgJson = req.resolve('@maera-js/ui/package.json');
    stylesPath = path.join(path.dirname(uiPkgJson), 'dist', 'styles.js');
  }
  const mod = (await import(pathToFileURL(stylesPath).href)) as { CSS: string };
  return mod.CSS;
}

export function inMonorepo(): boolean {
  const coreSrc = path.resolve(cliDir, '../../core/src/index.ts');
  const uiSrc = path.resolve(cliDir, '../../ui/src/index.ts');
  const routerSrc = path.resolve(cliDir, '../../router/src/index.ts');
  return fs.existsSync(coreSrc) && fs.existsSync(uiSrc) && fs.existsSync(routerSrc);
}

export function aliasOptions(): Record<string, string> | undefined {
  if (!inMonorepo()) return undefined;
  return {
    '@maera-js/core': path.resolve(cliDir, '../../core/src/index.ts'),
    '@maera-js/ui': path.resolve(cliDir, '../../ui/src/index.ts'),
    '@maera-js/router': path.resolve(cliDir, '../../router/src/index.ts'),
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function baseOptionsLike(file: string, contents: string): esbuild.BuildOptions {
  const ext = path.extname(file) || '.maera';
  return {
    stdin: { contents, resolveDir: cliDir, sourcefile: 'maera-entry.js', loader: 'js' },
    bundle: true,
    format: 'iife',
    target: 'es2022',
    loader: { [ext]: 'text' },
  };
}

export function mountEntryCode(file: string): string {
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

export function page(title: string, script: string): string {
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

export async function generateBundle(root: string, outJsPath: string): Promise<void> {
  const css = await loadUiCss();
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

export async function runBuildPages(root: string): Promise<void> {
  const scan = scanPages(root);

  const compiled: Array<{ page: (typeof scan.maera)[number]; ast: unknown; title: string }> = [];
  let hasError = false;
  for (const p of scan.maera) {
    const { compile } = await loadCore();
    const source = fs.readFileSync(p.absPath, 'utf8');
    const result = compile(source);
    const rel = path.relative(root, p.absPath);
    const diagnostics = await buildDiagnosticOutput(result, source, rel, { color: useColor(process.stderr) });
    if (diagnostics.text) process.stderr.write(`${diagnostics.text}\n`);
    if (!result.ok || diagnostics.shouldAbort) {
      hasError = true;
      continue;
    }
    compiled.push({ page: p, ast: result.ast, title: result.ast.app.title });
  }
  if (hasError) {
    die('Build dibatalkan: ada error pada halaman .maera.');
  }

  const publicDir = path.resolve(root, 'public');
  fs.rmSync(publicDir, { recursive: true, force: true });
  fs.mkdirSync(publicDir, { recursive: true });

  const css = await loadUiCss();
  const srcDir = path.join(publicDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'maera.css'), css);
  await generateBundle(root, path.join(srcDir, 'maera.js'));

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

  for (const p of scan.html) {
    const outPath = path.join(publicDir, p.outRel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.copyFileSync(p.absPath, outPath);
  }

  console.log(`✔ public/ (${compiled.length} halaman, ${scan.html.length} html statis)`);
}

export async function runBuildSingle(root: string, file: string, outArg?: string): Promise<void> {
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
