import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, "../src/bin.ts");
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, ["--import", tsxLoader, cli, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "maera-pages-"));
}

test("maera init creates pages/index.maera", () => {
  const dir = tempDir();
  try {
    const result = runCli(["init"], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(dir, "pages", "index.maera")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("maera init refuses overwrite without --force", () => {
  const dir = tempDir();
  try {
    runCli(["init"], dir);
    const result = runCli(["init"], dir);
    assert.notEqual(result.status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("maera add 404 creates pages/404.html", () => {
  const dir = tempDir();
  try {
    fs.mkdirSync(path.join(dir, "pages"));
    const result = runCli(["add", "404"], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(dir, "pages", "404.html")));
    const content = fs.readFileSync(path.join(dir, "pages", "404.html"), "utf8");
    assert.match(content, /maera\.css/);
    assert.match(content, /Kembali/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("maera build pages creates public modular output", () => {
  const dir = tempDir();
  try {
    runCli(["init"], dir);
    // add a nested page
    fs.mkdirSync(path.join(dir, "pages", "lantai-1"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "pages", "lantai-1", "hvac.maera"),
      "app:\n  title: HVAC\nsources:\n  temp:\n    type: mock\nwidgets:\n  - type: stat\n    bind: temp.value\n",
    );
    const result = runCli(["build"], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(dir, "public", "index.html")));
    assert.ok(fs.existsSync(path.join(dir, "public", "lantai-1", "hvac.html")));
    assert.ok(fs.existsSync(path.join(dir, "public", "src", "maera.css")));
    assert.ok(fs.existsSync(path.join(dir, "public", "src", "maera.js")));
    const indexHtml = fs.readFileSync(path.join(dir, "public", "index.html"), "utf8");
    assert.match(indexHtml, /id="maera-root"/);
    assert.match(indexHtml, /id="__MAERA_DATA__"/);
    assert.match(indexHtml, /\.\/src\/maera\.css/);
    assert.match(indexHtml, /\.\/src\/maera\.js/);
    const nestedHtml = fs.readFileSync(path.join(dir, "public", "lantai-1", "hvac.html"), "utf8");
    assert.match(nestedHtml, /\.\.\/src\/maera\.css/);
    assert.match(nestedHtml, /defer/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("maera build fails on missing pages", () => {
  const dir = tempDir();
  try {
    const result = runCli(["build"], dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /pages\//);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("static html inspection blocks build on server template tag", () => {
  const dir = tempDir();
  try {
    runCli(["init"], dir);
    fs.writeFileSync(path.join(dir, "pages", "bad.html"), "<html><body><?php echo 1; ?></body></html>");
    const result = runCli(["build"], dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SERVER_TEMPLATE_TAG/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pass-through html copied to public", () => {
  const dir = tempDir();
  try {
    runCli(["init"], dir);
    fs.writeFileSync(path.join(dir, "pages", "about.html"), "<html><body>about</body></html>");
    const result = runCli(["build"], dir);
    assert.equal(result.status, 0, result.stderr);
    const copied = fs.readFileSync(path.join(dir, "public", "about.html"), "utf8");
    assert.match(copied, /about/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
