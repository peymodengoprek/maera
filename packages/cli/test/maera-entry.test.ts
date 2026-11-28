import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, "../src/bin.ts");
const require = createRequire(import.meta.url);
const tsxLoader = pathToFileURL(require.resolve("tsx")).href;

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

test("GET /app.js returns valid JS bundle from maera dev server", async () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "index.maera"), validWidget);

    const port = await freePort();
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
      assert.equal(response.status, 200, `Expected 200 but got ${response.status}`);
      const code = await response.text();
      assert.ok(code.length > 0, "Response should not be empty");
      assert.match(code, /"version":\s*1/, "Should contain version");
    } finally {
      stopProcess(child);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});