import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cliPkgJson = path.resolve(here, "../package.json");
const require = createRequire(import.meta.url);

function getExportedPackageJson(pkgPath: string): string {
  const pkgJson = require.resolve(path.join(pkgPath, "package.json"));
  const pkg = require(pkgJson);
  return JSON.stringify(pkg.exports);
}

test("semua @maera-js/* di generateBundle terdaftar di cli dependencies", () => {
  const pkg = require(cliPkgJson);
  const dependencies = pkg.dependencies || {};

  const requiredPkgs = ["@maera-js/core", "@maera-js/ui", "@maera-js/router"];

  for (const pkgName of requiredPkgs) {
    assert.ok(
      dependencies[pkgName],
      `${pkgName} harus ada di dependencies @maera-js/cli`
    );
  }
});

test("@maera-js/* setiap paket mengexport ./package.json", () => {
  const requiredPkgs = ["@maera-js/core", "@maera-js/ui", "@maera-js/router"];

  for (const pkgName of requiredPkgs) {
    const resolved = require.resolve(path.join(pkgName, "package.json"));
    const pkgExports = require(resolved).exports;
    assert.ok(
      "/package.json" in pkgExports,
      `${pkgName} harus mengandung eksport "./package.json"`
    );
  }
});

test("simulasi proyek eksternal build sukses dengan @maera-js/* dari node_modules", async () => {
  const { generateBundle } = await import("../src/bin.ts");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "maera-external-"));

  try {
    await generateBundle(tmpDir, path.join(tmpDir, "src", "maera.js"));

    const jsPath = path.join(tmpDir, "src", "maera.js");
    assert.ok(fs.existsSync(jsPath), "file maera.js harus terbentuk");

    const content = fs.readFileSync(jsPath, "utf8");
    assert.match(content, /import.*from "@maera-js\/ui"/);
    assert.match(content, /import.*from "@maera-js\/router"/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});