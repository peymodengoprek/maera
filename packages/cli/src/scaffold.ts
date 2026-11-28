import fs from 'node:fs';
import path from 'node:path';
import { die, loadCore } from './diagnostics.js';
import { getPagesDir } from './router.js';

export async function runInit(args: string[], usage: string): Promise<void> {
  let force = false;
  for (const a of args) {
    if (a === '--force') force = true;
    else if (a === '-h' || a === '--help') {
      console.log(usage);
      return;
    } else {
      die(`Opsi tidak dikenal: '${a}'`, usage);
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

export async function runAdd404(args: string[], usage: string): Promise<void> {
  let force = false;
  for (const a of args) {
    if (a === '--force') force = true;
    else if (a === '-h' || a === '--help') {
      console.log(usage);
      return;
    } else {
      die(`Opsi tidak dikenal: '${a}'`, usage);
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
