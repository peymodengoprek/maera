import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import type { Diagnostic, DiagnosticResult } from "@maera-js/core";
import {
  buildDiagnosticOutput,
  diagnosticsPlugin,
  loadDiagnostics,
} from "../src/diagnostics.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, "../src/bin.ts");
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

const invalidWidget = `app:
  title: T
sources:
  temp:
    type: mock
widgets:
  - type: banana
    bind: temp.value
`;

const validWidget = `app:
  title: T
sources:
  temp:
    type: mock
widgets:
  - type: stat
    bind: temp.value
`;

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "maera-cli-"));
}

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, ["--import", tsxLoader, cli, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Waktu tunggu habis.");
}

function stopProcess(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGKILL");
  }
}

test("maera build mencetak code frame dan membatalkan build saat ada error", () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "index.maera"), invalidWidget);
    const result = runCli(["build", "index.maera"], dir);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /error\[UNKNOWN_WIDGET\] index\.maera:7:5/);
    assert.match(result.stderr, /> 7 \|   - type: banana/);
    assert.match(result.stderr, /1 errors, 0 warnings, 0 infos/);
    assert.match(result.stderr, /Build dibatalkan: 1 error/);
    assert.equal(fs.existsSync(path.join(dir, "dist")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("maera build menghasilkan HTML saat tidak ada error", () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "index.maera"), validWidget);
    const result = runCli(["build", "index.maera", "-o", "out.html"], dir);

    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(dir, "out.html")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("buildDiagnosticOutput tidak membatalkan build saat hanya warning", async () => {
  const warning: Diagnostic = {
    code: "UNKNOWN_KEY",
    message: "Kunci 'titel' tidak dikenal.",
    line: 2,
    column: 3,
    path: "app.titel",
    severity: "warning",
    group: "schema",
    suggestion: "title",
  };
  const result: DiagnosticResult = {
    ok: true,
    diagnostics: [warning],
    summary: { errors: 0, warnings: 1, infos: 0, suppressedCount: 0, total: 1 },
    groups: { schema: [warning] },
  };

  const output = await buildDiagnosticOutput(result, "app:\n  titel: T\n", "index.maera");
  assert.equal(output.shouldAbort, false);
  assert.match(output.text, /warning\[UNKNOWN_KEY\] index\.maera:2:3/);
  assert.match(output.text, /> 2 \|   titel: T/);
  assert.match(output.text, /0 errors, 1 warnings, 0 infos/);
});

test("diagnosticsPlugin menyediakan payload terstruktur untuk dev server", async () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, "index.maera");
    fs.writeFileSync(file, invalidWidget);

    const loaded = await loadDiagnostics(file);
    assert.equal(loaded.payload.ok, false);
    assert.equal(loaded.result.ok, false);
    assert.match(loaded.payload.text, /UNKNOWN_WIDGET/);

    const built = await esbuild.build({
      stdin: {
        contents: 'import payload from "maera:diagnostics"; globalThis.__payload = payload;',
        resolveDir: dir,
        sourcefile: "entry.js",
        loader: "js",
      },
      bundle: true,
      write: false,
      format: "iife",
      logLevel: "silent",
      plugins: [diagnosticsPlugin(file)],
    });
    const code = built.outputFiles[0]!.text;
    assert.match(code, /"version":\s*1/);
    assert.match(code, /"ok":\s*false/);
    assert.match(code, /UNKNOWN_WIDGET/);
    assert.match(code, /"codeFrame"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("maera dev mengirim payload diagnostik ke app.js", async () => {
  const dir = tempDir();
  const port = await freePort();
  fs.writeFileSync(path.join(dir, "index.maera"), invalidWidget);

  const child = spawn(
    process.execPath,
    ["--import", tsxLoader, cli, "dev", "index.maera"],
    {
      cwd: dir,
      env: {
        ...process.env,
        NO_COLOR: "1",
        HOST: "127.0.0.1",
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    output += String(chunk);
  });

  try {
    await waitFor(() => output.includes("Dashboard aktif di"));
    const response = await fetch(`http://127.0.0.1:${port}/app.js`);
    assert.equal(response.status, 200);
    const code = await response.text();
    assert.match(code, /"version":\s*1/);
    assert.match(code, /"ok":\s*false/);
    assert.match(code, /UNKNOWN_WIDGET/);
    assert.match(code, /__MAERA_DIAGNOSTICS__/);
    assert.match(code, /maera-diagnostics-overlay/);
    assert.match(code, /createDiagnosticsView/);
  } finally {
    stopProcess(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
