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

export function toPosix(p: string): string {
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
        const rawRel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        const rel = toPosix(rawRel);
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

