import * as esbuild from 'esbuild';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { aliasOptions, baseOptionsLike, cliDir, escapeHtml, loadUiCss, page } from './bundler.js';
import { diagnosticsPlugin, failSafePages, loadCore, warnOutsidePages } from './diagnostics.js';
import { assetPath, findMaeraOutsidePages, getPagesDir, scanPages, toPosix } from './router.js';

export function devEntryCode(file: string): string {
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

export async function serveOnFreePort(
  ctx: esbuild.BuildContext,
  servedir: string,
  host: string,
  start: number,
): Promise<esbuild.ServeResult> {
  for (let port = start; port < start + 10; port++) {
    try {
      return await ctx.serve({ servedir, host, port });
    } catch (e) {
      if (!/address already in use/i.test(String(e))) throw e;
    }
  }
  throw new Error(`Port ${start}-${start + 9} semuanya terpakai. Set PORT=<angka lain>.`);
}

export async function runDevSingle(file: string): Promise<void> {
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

  await new Promise(() => {});
}

export function takeSnapshot(root: string): string {
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
    } catch {
      /* ignore */
    }
  }
  const outside = findMaeraOutsidePages(root);
  parts.push(`outside:${outside.join(',')}`);
  return parts.join('|');
}

export function mimeFor(ext: string): string {
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

export async function runDevPages(root: string): Promise<void> {
  const host = process.env.HOST ?? '127.0.0.1';
  const startPort = Number(process.env.PORT ?? 3000);

  failSafePages(root);

  const outsideWarnings = warnOutsidePages(root);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maera-dev-'));
  const genRoot = path.join(tmp, 'public');
  fs.mkdirSync(genRoot, { recursive: true });

  const aliases = aliasOptions();
  const bundleCode = await (async () => {
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

window.addEventListener("maera:diagnostics", (event) => {
  const payload = event.detail;
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

  const sseClients = new Set<http.ServerResponse>();

  async function generate(): Promise<void> {
    fs.rmSync(genRoot, { recursive: true, force: true });
    fs.mkdirSync(genRoot, { recursive: true });
    const srcDir = path.join(genRoot, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'maera.css'), css);
    fs.writeFileSync(path.join(srcDir, 'maera.js'), bundleCode);

    const scan = scanPages(root);
    let overallHasError = false;
    const allDiagnostics: Array<{ severity: string; code: string; message: string; location?: string; path?: string }> = [];

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

    for (const pageItem of scan.maera) {
      const source = fs.readFileSync(pageItem.absPath, 'utf8');
      const { compile } = await loadCore();
      const result = compile(source);
      const outPath = path.join(genRoot, pageItem.outRel);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      if (!result.ok) {
        overallHasError = true;
        for (const e of result.errors) {
          allDiagnostics.push({
            severity: e.severity ?? 'error',
            code: e.code ?? 'UNKNOWN',
            message: e.message ?? 'Unknown error',
            location: e.line != null ? `baris ${e.line}` : undefined,
            path: e.path ?? pageItem.relPath,
          });
        }
        const errText = result.errors.map((e) => `baris ${e.line ?? '?'} [${e.code}] ${e.message}`).join('\n');
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Error</title></head><body><div id="maera-root"><pre style="color:#b00020;white-space:pre-wrap">${escapeHtml(errText)}</pre></div><script src="${assetPath(pageItem.depth, 'maera.js')}" defer></script></body></html>`;
        fs.writeFileSync(outPath, html);
        continue;
      }
      const depth = pageItem.depth;
      for (const d of result.diagnostics) {
        allDiagnostics.push({
          severity: d.severity,
          code: d.code,
          message: d.message,
          location: d.line != null ? `baris ${d.line}` : d.path ?? undefined,
          path: d.path,
        });
      }
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
window.__MAERA_DIAGNOSTICS__ = ${JSON.stringify({ summary: { errors: overallHasError ? allDiagnostics.length : 0, warnings: allDiagnostics.filter((d: { severity: string }) => d.severity === 'warning' || d.severity === 'info').length, infos: allDiagnostics.filter((d: { severity: string }) => d.severity === 'info').length }, diagnostics: allDiagnostics })};
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

    const cdnWarnings: Array<{ severity: string; code: string; message: string; location?: string; path?: string }> = [];
    for (const p of scan.html) {
      const content = fs.readFileSync(p.absPath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
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
      let htmlContent = fs.readFileSync(p.absPath, 'utf8');
      if (/<\/body>/i.test(htmlContent)) {
        htmlContent = htmlContent.replace(/<\/body>/i, `<script>(function(){try{var es=new EventSource('/__maera_reload');es.onmessage=function(){location.reload();};}catch(e){}})();</script></body>`);
      } else {
        htmlContent += `<script>(function(){try{var es=new EventSource('/__maera_reload');es.onmessage=function(){location.reload();}catch(e){}})();</script>`;
      }
      fs.writeFileSync(outPath, htmlContent);
    }

    const notFound = path.join(genRoot, '404.html');
    if (!fs.existsSync(notFound)) {
      fs.writeFileSync(
        notFound,
        `<!doctype html><html><head><meta charset="utf-8"><title>404</title><link rel="stylesheet" href="./src/maera.css"></head><body><div id="maera-root"><div class="maera"><h1>404</h1><p>Halaman tidak ditemukan.</p><a href="/">Kembali</a></div></div><script src="./src/maera.js" defer></script></body></html>`,
      );
    }
  }

  await generate();

  let snapshot = takeSnapshot(root);
  const watcher = setInterval(() => {
    const next = takeSnapshot(root);
    if (next !== snapshot) {
      snapshot = next;
      void generate().catch((e) => console.error(e));
      const events: Array<{ type: string; payload: unknown }> = [];
      const outside = findMaeraOutsidePages(root);
      if (outside.length > 0) {
        events.push({ type: 'outside', payload: outside });
      }
      events.push({ type: 'update', payload: takeSnapshot(root) });
      for (const res of sseClients) {
        try {
          res.write(`data: ${JSON.stringify(events)}\n\n`);
        } catch {
          /* ignore */
        }
      }
    }
  }, 100);

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

    let rel = urlPath.replace(/^\/+/, '');
    if (rel === '') rel = 'index.html';
    let filePath = path.join(genRoot, rel);

    if (!fs.existsSync(filePath) && !path.extname(rel)) {
      const candidate = filePath + '.html';
      if (fs.existsSync(candidate)) filePath = candidate;
    }
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
