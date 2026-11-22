/** Kompilasi examples/index.maera dan cetak hasilnya. Jalankan: npm run check:example */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compile } from "../src/index.js";

const file = process.argv[2] ?? fileURLToPath(new URL("../../../examples/index.maera", import.meta.url));
const result = compile(readFileSync(file, "utf8"));

if (result.ok) {
  const { app, sources, widgets } = result.ast;
  console.log(`✔ ${file}`);
  console.log(`  app      : ${app.title} (tema: ${app.theme}, ${app.columns} kolom)`);
  console.log(`  sources  : ${Object.entries(sources).map(([n, s]) => `${n}<${s.type}>`).join(", ")}`);
  console.log(`  widgets  : ${widgets.map((w) => w.type + (w.bind ? `(${w.bind.s}.${w.bind.p.join(".")})` : "")).join(", ")}`);
} else {
  console.error(`✘ ${file}`);
  for (const e of result.errors) console.error(`  baris ${e.line ?? "?"} [${e.code}] ${e.path ? e.path + ": " : ""}${e.message}`);
  process.exit(1);
}