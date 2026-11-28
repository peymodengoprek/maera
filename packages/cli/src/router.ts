import fs from "node:fs";
import path from "node:path";

export const CODE_EXTENSIONS = new Set([
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".css",
  ".scss",
  ".vue",
]);

export const PAGE_CODE_EXTENSIONS = new Set([".jsx", ".tsx", ".ts", ".vue", ".css", ".js"]);

export interface PageEntry {
  absPath: string;
  relPath: string;
  kind: "maera" | "html";
  outRel: string;
  depth: number;
}

export interface ScanPagesResult {
  pagesDir: string;
  exists: boolean;
  maera: PageEntry[];
  html: PageEntry[];
  codeFiles: string[];
  allFiles: string[];
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}

export function getPagesDir(root: string): string {
  return path.resolve(root, "pages");
}

export function scanPages(root: string): ScanPagesResult {
  const pagesDir = getPagesDir(root);
  const result: ScanPagesResult = {
    pagesDir,
    exists: false,
    maera: [],
    html: [],
    codeFiles: [],
    allFiles: [],
  };
  if (!fs.existsSync(pagesDir)) return result;
  const stat = fs.statSync(pagesDir);
  if (!stat.isDirectory()) return result;
  result.exists = true;

  function walk(dir: string, relPrefix: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || isHiddenName(entry.name)) continue;
        const nextPrefix = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        walk(path.join(dir, entry.name), nextPrefix);
      } else if (entry.isFile()) {
        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        result.allFiles.push(rel);
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === ".maera") {
          const outRel = outputRelForMaera(rel);
          result.maera.push({
            absPath: path.join(dir, entry.name),
            relPath: rel,
            kind: "maera",
            outRel,
            depth: routeDepth(outRel),
          });
        } else if (ext === ".html") {
          result.html.push({
            absPath: path.join(dir, entry.name),
            relPath: rel,
            kind: "html",
            outRel: rel,
            depth: routeDepth(rel),
          });
        } else if (CODE_EXTENSIONS.has(ext)) {
          result.codeFiles.push(rel);
        }
      }
    }
  }

  walk(pagesDir, "");
  result.maera.sort((a, b) => a.relPath.localeCompare(b.relPath));
  result.html.sort((a, b) => a.relPath.localeCompare(b.relPath));
  result.codeFiles.sort();
  result.allFiles.sort();
  return result;
}

export function outputRelForMaera(relSource: string): string {
  const parsed = path.posix.parse(toPosix(relSource));
  const dir = parsed.dir;
  const name = parsed.name;
  const outName = `${name}.html`;
  return dir ? `${dir}/${outName}` : outName;
}

export function routeDepth(outRel: string): number {
  return toPosix(outRel).split("/").length - 1;
}

export function assetPath(depth: number, file: string): string {
  if (depth <= 0) return `./src/${file}`;
  return `${"../".repeat(depth)}src/${file}`;
}

export function findMaeraOutsidePages(root: string): string[] {
  const pagesDir = getPagesDir(root);
  const found: string[] = [];

  function walk(dir: string, relPrefix: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || isHiddenName(entry.name)) continue;
        if (path.resolve(dir, entry.name) === pagesDir) continue;
        const nextPrefix = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        walk(path.join(dir, entry.name), nextPrefix);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".maera") {
        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        found.push(rel);
      }
    }
  }

  walk(root, "");
  found.sort();
  return found;
}

export interface HtmlInspectionIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  line: number | null;
}

export function inspectHtmlContent(content: string): HtmlInspectionIssue[] {
  const issues: HtmlInspectionIssue[] = [];
  const lines = content.split(/\r?\n/);

  const allowedAsset = (value: string): boolean => {
    const v = value.trim();
    if (!v || v.startsWith("#") || v.startsWith("mailto:") || v.startsWith("data:") || v.startsWith("javascript:")) return true;
    if (/^https?:\/\//i.test(v)) return true; // handled as CDN warning separately
    const normalized = v.replace(/^\.\//, "").replace(/^\//, "");
    if (normalized === "src/maera.css" || normalized === "src/maera.js") return true;
    if (normalized.endsWith("src/maera.css") || normalized.endsWith("src/maera.js")) return true;
    if (!/\.[a-z0-9]+$/i.test(v) || /\.html?$/i.test(v)) return true;
    return false;
  };

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;

    if (/<\?php/i.test(line) || /<%/.test(line)) {
      issues.push({ severity: "error", code: "SERVER_TEMPLATE_TAG", message: "Tag template server (<?php/<%) terdeteksi.", line: lineNo });
    }
    if (/\{\{[\s\S]*?\}\}/.test(line)) {
      issues.push({ severity: "error", code: "SERVER_TEMPLATE_TAG", message: "Tag template server ({{...}}) terdeteksi.", line: lineNo });
    }

    const importMatches = line.matchAll(/import\s+(?:[^'"]*?\s+from\s+)?['"][^'"]+['"]/g);
    for (const m of importMatches) {
      issues.push({ severity: "error", code: "JS_MODULE_IMPORT", message: "Import modul JS mentah terdeteksi.", line: lineNo });
    }
    if (/import\s*\(/.test(line)) {
      issues.push({ severity: "error", code: "JS_MODULE_IMPORT", message: "Import dinamis modul JS terdeteksi.", line: lineNo });
    }

    if (/https?:\/\//i.test(line)) {
      issues.push({ severity: "warning", code: "CDN_EXTERNAL_DEPENDENCY", message: "Dependensi CDN eksternal (https://) terdeteksi.", line: lineNo });
    }

    const assetMatches = line.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi);
    for (const m of assetMatches) {
      const value = m[1] ?? "";
      if (/^https?:\/\//i.test(value)) continue;
      if (!allowedAsset(value)) {
        issues.push({ severity: "error", code: "LOCAL_ASSET_REFERENCE", message: `Referensi aset lokal di luar /src/maera.{css,js}: ${value}`, line: lineNo });
      }
    }
  });

  // de-duplicate identical consecutive issues
  const dedup: HtmlInspectionIssue[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    const key = `${issue.severity}:${issue.code}:${issue.line}:${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(issue);
  }
  return dedup;
}

export function detectRouteCollisions(scan: ScanPagesResult): Array<{ base: string; files: string[] }> {
  const byOut = new Map<string, string[]>();
  for (const p of scan.maera) {
    const list = byOut.get(p.outRel) ?? [];
    list.push(p.relPath);
    byOut.set(p.outRel, list);
  }
  for (const p of scan.html) {
    const list = byOut.get(p.outRel) ?? [];
    list.push(p.relPath);
    byOut.set(p.outRel, list);
  }
  const collisions: Array<{ base: string; files: string[] }> = [];
  for (const [outRel, files] of byOut.entries()) {
    if (files.length > 1) collisions.push({ base: outRel, files: [...files].sort() });
  }
  collisions.sort((a, b) => a.base.localeCompare(b.base));
  return collisions;
}


