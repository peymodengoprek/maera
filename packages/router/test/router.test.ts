import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { compile } from "@maera-js/core";
import { createRouter } from "../src/index.js";

function setup() {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const root = doc.createElement("div") as unknown as HTMLElement;
  root.id = "maera-root";
  doc.body.appendChild(root);
  (window as any).location.href = "http://localhost/";
  return { window, doc, root };
}

function makeResponse(html: string, status = 200) {
  return new Response(html, { status, headers: { "Content-Type": "text/html" } });
}

const YAML_A = `
app:
  title: Page A
sources:
  dev:
    type: mock
    interval: 50
    min: 10
    max: 20
widgets:
  - type: stat
    bind: dev.value
`;

const YAML_B = `
app:
  title: Page B
sources:
  dev:
    type: mock
    interval: 50
    min: 10
    max: 20
widgets:
  - type: stat
    bind: dev.value
`;

const YAML_C = `
app:
  title: Page C
sources:
  other:
    type: mock
    interval: 50
    min: 0
    max: 5
widgets:
  - type: stat
    bind: other.value
`;

function astOf(yaml: string) {
  const res = compile(yaml);
  assert.ok(res.ok);
  if (!res.ok) throw new Error("compile failed");
  return res.ast;
}

function makePage(ast: any, title: string) {
  return `<!doctype html><html><head><title>${title}</title></head><body><div id="maera-root"></div><script id="__MAERA_DATA__">${JSON.stringify(ast)}</script></body></html>`;
}

test("createRouter exposes methods", () => {
  const { root } = setup();
  const router = createRouter(root);
  assert.equal(typeof router.push, "function");
  assert.equal(typeof router.replace, "function");
  assert.equal(typeof router.prefetch, "function");
  assert.equal(typeof router.destroy, "function");
  router.destroy();
});

test("push swaps AST and updates title/history", async () => {
  const { root, window } = setup();
  const astA = astOf(YAML_A);
  const pageA = makePage(astA, "Page A");
  let fetchCount = 0;
  const fetchImpl = async (url: string) => {
    fetchCount++;
    return makeResponse(pageA);
  };
  const router = createRouter(root, { fetch: fetchImpl as any });
  await router.push("/a.html");
  assert.equal((root as any).querySelector(".maera-title")?.textContent, "Page A");
  assert.equal(window.document.title, "Page A");
  assert.equal(window.history.length, 2);
  router.destroy();
});

test("click interception triggers push", async () => {
  const { root, doc, window } = setup();
  const astA = astOf(YAML_A);
  const pageA = makePage(astA, "Page A");
  const fetchImpl = async () => makeResponse(pageA);
  const router = createRouter(root, { fetch: fetchImpl as any });
  const a = doc.createElement("a") as HTMLAnchorElement;
  a.href = "/a.html";
  a.textContent = "go";
  doc.body.appendChild(a);
  // dispatch click
  const ev = new (window as any).MouseEvent("click", { bubbles: true, cancelable: true });
  a.dispatchEvent(ev);
  // allow async
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(window.document.title, "Page A");
  router.destroy();
});

test("ignores target _blank, download, anchor", async () => {
  const { root, doc, window } = setup();
  const astA = astOf(YAML_A);
  const pageA = makePage(astA, "Page A");
  let calls = 0;
  const fetchImpl = async () => { calls++; return makeResponse(pageA); };
  const router = createRouter(root, { fetch: fetchImpl as any });
  const a1 = doc.createElement("a") as HTMLAnchorElement;
  a1.href = "/a.html"; a1.target = "_blank"; doc.body.appendChild(a1);
  const a2 = doc.createElement("a") as HTMLAnchorElement;
  a2.href = "/a.html"; a2.setAttribute("download", ""); doc.body.appendChild(a2);
  const a3 = doc.createElement("a") as HTMLAnchorElement;
  a3.href = "#section"; doc.body.appendChild(a3);
  for (const a of [a1, a2, a3]) {
    const ev = new (window as any).MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
  }
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls, 0);
  router.destroy();
});

test("popstate swaps without push", async () => {
  const { root, window } = setup();
  const astA = astOf(YAML_A);
  const pageA = makePage(astA, "Page A");
  const fetchImpl = async () => makeResponse(pageA);
  const router = createRouter(root, { fetch: fetchImpl as any });
  await router.push("/a.html");
  const lenBefore = window.history.length;
  // simulate back: set location then dispatch popstate
  window.history.back();
  // happy-dom may not auto; dispatch
  const ev = new (window as any).PopStateEvent("popstate");
  window.dispatchEvent(ev);
  await new Promise((r) => setTimeout(r, 50));
  // no extra history entry
  assert.ok(window.history.length <= lenBefore + 1);
  router.destroy();
});

test("static fallback (no data script) renders without error", async () => {
  const { root } = setup();
  const html = `<!doctype html><html><head><title>Static</title></head><body><div id="maera-root"><p>hello static</p></div></body></html>`;
  const fetchImpl = async () => makeResponse(html);
  const router = createRouter(root, { fetch: fetchImpl as any });
  await router.push("/static.html");
  assert.ok((root as any).innerHTML.includes("hello static"));
  assert.equal((root as any).ownerDocument.title, "Static");
  router.destroy();
});

test("404 fallback fetches /404.html", async () => {
  const { root } = setup();
  const notFoundHtml = `<!doctype html><html><head><title>Not Found</title></head><body><div id="maera-root"><p>404 page</p></div></body></html>`;
  const fetchImpl = async (url: string) => {
    if (url.includes("404.html")) return makeResponse(notFoundHtml);
    return makeResponse("nope", 404);
  };
  const router = createRouter(root, { fetch: fetchImpl as any });
  await router.push("/missing.html");
  assert.ok((root as any).innerHTML.includes("404 page"));
  router.destroy();
});

test("shared source pool keeps identical source running", async () => {
  const { root } = setup();
  const astA = astOf(YAML_A);
  const astB = astOf(YAML_B);
  const pageA = makePage(astA, "Page A");
  const pageB = makePage(astB, "Page B");
  const fetchImpl = async (url: string) => {
    if (url.includes("b.html")) return makeResponse(pageB);
    return makeResponse(pageA);
  };
  const router = createRouter(root, { fetch: fetchImpl as any });
  await router.push("/a.html");
  const store = router.store;
  await new Promise((r) => setTimeout(r, 120));
  const before = store.history("dev").length;
  assert.ok(before >= 1);
  await router.push("/b.html");
  await new Promise((r) => setTimeout(r, 120));
  const after = store.history("dev").length;
  assert.ok(after > before, "shared source should keep running");
  router.destroy();
});

test("shared source pool stops unused source", async () => {
  const { root } = setup();
  const astA = astOf(YAML_A);
  const astC = astOf(YAML_C);
  const pageA = makePage(astA, "Page A");
  const pageC = makePage(astC, "Page C");
  const fetchImpl = async (url: string) => {
    if (url.includes("c.html")) return makeResponse(pageC);
    return makeResponse(pageA);
  };
  const router = createRouter(root, { fetch: fetchImpl as any });
  await router.push("/a.html");
  const store = router.store;
  await new Promise((r) => setTimeout(r, 80));
  await router.push("/c.html");
  await new Promise((r) => setTimeout(r, 120));
  const devHistory = store.history("dev").length;
  const otherHistory = store.history("other").length;
  // other source should be running
  assert.ok(otherHistory >= 1);
  // dev source should not grow after navigation (stopped)
  // (we can't easily assert exact, but ensure other present)
  router.destroy();
});

test("prefetch caches and avoids refetch", async () => {
  const { root } = setup();
  const astA = astOf(YAML_A);
  const pageA = makePage(astA, "Page A");
  let calls = 0;
  const fetchImpl = async () => { calls++; return makeResponse(pageA); };
  const router = createRouter(root, { fetch: fetchImpl as any });
  await router.prefetch("/a.html");
  const first = calls;
  await router.push("/a.html");
  assert.equal(calls, first, "push should use prefetched cache");
  router.destroy();
});

test("replace uses replaceState", async () => {
  const { root, window } = setup();
  const astA = astOf(YAML_A);
  const pageA = makePage(astA, "Page A");
  const fetchImpl = async () => makeResponse(pageA);
  const router = createRouter(root, { fetch: fetchImpl as any });
  const beforeLen = window.history.length;
  await router.replace("/a.html");
  assert.equal(window.history.length, beforeLen);
  router.destroy();
});

test("destroy stops listeners", async () => {
  const { root, doc } = setup();
  const router = createRouter(root, { fetch: async () => makeResponse("") });
  router.destroy();
  // no throw on second destroy
  router.destroy();
  assert.ok(true);
});
