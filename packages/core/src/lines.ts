/**
 * Pelacak baris ringan untuk YAML bergaya blok (block style).
 *
 * js-yaml tidak mengekspos posisi per-node, jadi kita membangun indeks
 * jalur -> nomor baris dengan memindai indentasi. Cukup untuk format
 * index.maera (mapping & sequence bergaya blok). Untuk sintaks flow
 * (`{a: 1}`), pencarian jatuh ke baris induk terdekat.
 */

export type PathSeg = string | number;

interface Frame {
  indent: number;
  path: PathSeg[];
  isSeq: boolean;
  count: number;
}

const KEY_RE = /^(?:"([^"]*)"|'([^']*)'|([^\s"'#:\-?][^:]*?|-[^\s:][^:]*?))\s*:(?:\s|$)/;

export function pathKey(path: PathSeg[]): string {
  return path.join("\u0000");
}

export function buildLineIndex(text: string): Map<string, number> {
  const index = new Map<string, number>();
  const lines = text.split(/\r?\n/);
  const stack: Frame[] = [{ indent: -1, path: [], isSeq: false, count: 0 }];
  let pending: PathSeg[] = [];

  const top = () => stack[stack.length - 1]!;

  const handleKey = (content: string, indent: number, lineNo: number) => {
    const m = KEY_RE.exec(content);
    if (!m) return;
    const key = m[1] ?? m[2] ?? m[3] ?? "";
    while (top().indent > indent || (top().isSeq && top().indent === indent)) stack.pop();
    if (top().isSeq || top().indent < indent) {
      stack.push({ indent, path: pending, isSeq: false, count: 0 });
    }
    const path = [...top().path, key];
    if (!index.has(pathKey(path))) index.set(pathKey(path), lineNo);
    const rest = content.slice(m[0].length).replace(/\s+#.*$/, "").trim();
    if (rest === "") pending = path;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed === "---") continue;

    const lineNo = i + 1;
    let indent = raw.length - raw.trimStart().length;
    let content = trimmed;

    while (content === "-" || content.startsWith("- ")) {
      while (top().indent > indent) stack.pop();
      let seq = top();
      if (!(seq.isSeq && seq.indent === indent)) {
        seq = { indent, path: pending, isSeq: true, count: 0 };
        stack.push(seq);
      }
      const itemPath = [...seq.path, seq.count++];
      index.set(pathKey(itemPath), lineNo);
      const after = content.slice(1);
      const lead = after.length - after.trimStart().length;
      content = after.trimStart();
      indent = indent + 1 + lead;
      if (content === "") {
        pending = itemPath;
        break;
      }
      if (KEY_RE.test(content)) {
        stack.push({ indent, path: itemPath, isSeq: false, count: 0 });
      } else if (!content.startsWith("- ")) {
        break;
      }
    }

    if (content !== "" && KEY_RE.test(content)) handleKey(content, indent, lineNo);
  }
  return index;
}

/** Cari baris untuk sebuah jalur; jika tidak ada, coba induknya. */
export function lookupLine(index: Map<string, number>, path: PathSeg[]): number | null {
  for (let n = path.length; n >= 0; n--) {
    const hit = index.get(pathKey(path.slice(0, n)));
    if (hit !== undefined) return hit;
  }
  return null;
}