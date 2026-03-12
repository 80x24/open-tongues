/**
 * tongues — invisible automatic translation
 * <script src="https://tongues.80x24.ai/t.js" defer></script>
 */
if (!(window as any).__tongues) {
(window as any).__tongues = true;

const SK = new Set("SCRIPT,STYLE,NOSCRIPT,SVG,TEMPLATE,CODE,PRE,KBD,SAMP,VAR,CANVAS,VIDEO,AUDIO,IFRAME,MATH".split(","));
const IL = new Set("STRONG,EM,B,I,U,S,CODE,A,SPAN,MARK,SUB,SUP,SMALL,ABBR,CITE,DFN,TIME,Q".split(","));
const VD = new Set("BR,IMG,WBR".split(","));
const AT = ["placeholder", "title", "alt", "aria-label"];
const RX = "x-text,x-html,v-text,v-html,:textContent,:innerHTML".split(",");
const NT = '.notranslate,[translate="no"]';
const $ = (s: string) => document.querySelectorAll(s);

type PM = [string, string]; // [open, close]
const LR = /^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/;
let api = "", host = "", loc = "", iloc = "", busy = false, done = false, manual = false, pprompt = "";
let phs = new Map<string, Map<number, PM>>();
let ob: MutationObserver | null = null, tm: any = null;

function cfg() {
  const s = (document.currentScript || document.querySelector("script[src*='t.js']")) as HTMLScriptElement | null;
  if (!s) return false;
  api = (s.src || "").replace(/\/t\.js.*$/, ""); host = location.hostname;
  iloc = loc = (navigator.language || "en").split("-")[0];
  manual = s.hasAttribute("data-manual");
  pprompt = (s.getAttribute("data-preprompt") || "").trim().slice(0, 30);
  const st = document.createElement("style"); st.textContent = ".t-ing{animation:t-p 1.5s ease-in-out infinite}@keyframes t-p{0%,100%{opacity:1}50%{opacity:.4}}";
  document.head.appendChild(st);
  return true;
}

// --- Placeholder: mixed-content (text + inline tags) ---

function toPh(el: Element) {
  const m = new Map<number, PM>(); let i = 0;
  function w(n: Node): string {
    if (n.nodeType === 3) return n.nodeValue || "";
    if (n.nodeType !== 1) return "";
    const e = n as Element, tg = e.tagName;
    if (VD.has(tg)) { m.set(i, [e.outerHTML, ""]); return `<${i++}/>`; }
    if (IL.has(tg)) {
      const j = i++, mt = e.outerHTML.match(/^<[^>]+>/);
      m.set(j, [mt ? mt[0] : `<${tg.toLowerCase()}>`, `</${tg.toLowerCase()}>`]);
      let s = ""; for (const c of e.childNodes) s += w(c); return `<${j}>${s}</${j}>`;
    }
    let s = ""; for (const c of e.childNodes) s += w(c); return s;
  }
  let t = ""; for (const c of el.childNodes) t += w(c);
  return { t: t.trim(), m, h: m.size > 0 };
}

function fromPh(t: string, m: Map<number, PM>): string {
  let r = t.replace(/<(\d+)\/>/g, (_, i) => m.get(+i)?.[0] || ""), ok = true;
  while (ok) { ok = false; r = r.replace(/<(\d+)>(.*?)<\/\1>/gs, (_, i, c) => {
    ok = true; const e = m.get(+i); return e ? e[0] + c + e[1] : c; }); }
  r = r.replace(/<\/?(\d+)\s*\/?>/g, "");
  return r;
}

// --- Collect ---

function collect(inc: boolean, root?: Element) {
  const txt = new Map<string, Element[]>(), atr = new Map<string, { e: Element; a: string }[]>();
  phs = new Map(); const hd = new WeakSet<Element>();
  const tw = document.createTreeWalker(root || document.body, NodeFilter.SHOW_ELEMENT, { acceptNode(n) {
    const el = n as Element;
    const nt = el.closest(NT);
    if (SK.has(el.tagName) || (nt && nt !== root)) return 2;
    if ((el as HTMLElement).isContentEditable) return 2;
    if (el.parentElement && hd.has(el.parentElement)) return 3;
    if (inc && el.hasAttribute("data-t")) {
      if (!el.hasAttribute("data-th")) return 2;
      if (el.innerHTML === el.getAttribute("data-th") || el.innerHTML === el.getAttribute("data-tt")) return 2;
    }
    const t = el.textContent?.trim();
    if (!t || t.length < 2) return 3;
    if (el.children.length > 0) {
      for (const c of el.children) {
        if (!IL.has(c.tagName) && !VD.has(c.tagName)) return 3;
        for (const a of RX) if (c.hasAttribute(a)) return 3;
      }
      hd.add(el); return 1;
    }
    return 1;
  }});
  let n: Node | null;
  while ((n = tw.nextNode())) {
    const el = n as Element; let t: string;
    if (hd.has(el)) { const r = toPh(el); t = r.t; if (r.h) phs.set(t, r.m); }
    else t = el.textContent!.trim();
    if (t && t.length >= 2) { const a = txt.get(t) || []; a.push(el); txt.set(t, a); }
  }
  const atRoot = root || document.body;
  for (const el of atRoot.querySelectorAll("[placeholder],[title],[alt],[aria-label]")) {
    const ant = el.closest(NT);
    if ((ant && ant !== root) || (el as HTMLElement).isContentEditable || SK.has(el.tagName)) continue;
    for (const a of AT) { const v = el.getAttribute(a)?.trim();
      if (!v || v.length < 2 || (inc && el.hasAttribute(`data-ta-${a}`))) continue;
      const arr = atr.get(v) || []; arr.push({ e: el, a }); atr.set(v, arr); }
  }
  return { txt, atr };
}

// --- Apply ---

function fi(el: Element) {
  el.classList.remove("t-ing");
  const s = (el as HTMLElement).style;
  s.transition = "none"; s.opacity = "0.3";
  void (el as HTMLElement).offsetHeight;
  s.transition = "opacity .4s ease-in"; s.opacity = "1";
  el.addEventListener("transitionend", () => { s.opacity = ""; s.transition = ""; }, { once: true });
}

function apply(tE: Map<string, Element[]>, aE: Map<string, { e: Element; a: string }[]>, tr: Map<string, string>) {
  ps(); try { for (const [o, t] of tr) {
    if (o === t) {
      for (const el of tE.get(o) || []) { if (!el.hasAttribute("data-t")) el.setAttribute("data-t", o); el.classList.remove("t-ing"); }
      for (const { e, a } of aE.get(o) || []) if (!e.hasAttribute(`data-ta-${a}`)) e.setAttribute(`data-ta-${a}`, o);
      continue;
    }
    const els = tE.get(o);
    if (els) { const pm = phs.get(o); for (const el of els) {
      if (!el.hasAttribute("data-t")) { el.setAttribute("data-t", o); if (pm?.size) el.setAttribute("data-th", el.innerHTML); }
      if (pm?.size) { const h = fromPh(t, pm); el.innerHTML = h; el.setAttribute("data-tt", h); }
      else { const f = document.createElement("font"); f.setAttribute("data-tf", "1"); f.textContent = t; el.replaceChildren(f); }
      fi(el);
    } }
    for (const { e, a } of aE.get(o) || []) { if (!e.hasAttribute(`data-ta-${a}`)) e.setAttribute(`data-ta-${a}`, o); e.setAttribute(a, t); }
  } } finally { rs(); }
}

function undo() {
  ps(); try {
    $(".t-ing").forEach(el => { el.classList.remove("t-ing"); const s = (el as HTMLElement).style; s.opacity = ""; s.transition = ""; });
    $("[data-th]").forEach(el => { el.innerHTML = el.getAttribute("data-th")!; el.removeAttribute("data-th"); el.removeAttribute("data-tt"); el.removeAttribute("data-t"); });
    $("[data-t]").forEach(el => { el.textContent = el.getAttribute("data-t"); el.removeAttribute("data-t"); });
    for (const a of AT) { const k = `data-ta-${a}`; $(`[${k}]`).forEach(el => { el.setAttribute(a, el.getAttribute(k)!); el.removeAttribute(k); }); }
  } finally { rs(); }
}

// --- Cache (localStorage) ---

function ck() { return `t:${host}:${loc}`; }
function lg(): Map<string, string> {
  try { const r = localStorage.getItem(ck()); return r ? new Map(JSON.parse(r)) : new Map(); } catch { return new Map(); }
}
function ls(tr: Map<string, string>) {
  try { const m = lg(); for (const [k, v] of tr) m.set(k, v); localStorage.setItem(ck(), JSON.stringify([...m])); } catch {}
}

// --- Translate ---

async function translate(inc = false, root?: Element) {
  if (busy) return; busy = true;
  if (!inc && !root) { undo(); done = false; }
  const { txt, atr } = collect(inc, root), all = [...new Set([...txt.keys(), ...atr.keys()])];
  if (!all.length) { busy = false; return; }
  for (const els of txt.values()) for (const el of els) el.classList.add("t-ing");
  const cached = lg(), hit = new Map<string, string>(), miss: string[] = [];
  for (const t of all) { const v = cached.get(t); if (v !== undefined) hit.set(t, v); else miss.push(t); }
  if (hit.size) apply(txt, atr, hit);
  if (miss.length) {
    const desc = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
    const go = async (ch: string[]) => { for (let r = 0; r < 3; r++) { try {
      const res = await fetch(`${api}/api/translate`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: ch, to: loc, domain: host, pageTitle: document.title, pageDescription: desc, ...(pprompt && { preprompt: pprompt }) }) });
      if (!res.ok) throw 0;
      const tr = new Map(Object.entries((await res.json()).translations)); apply(txt, atr, tr); ls(tr); return;
    } catch { if (r < 2) await new Promise(w => setTimeout(w, 300 * (r + 1))); } } };
    const chs: string[][] = [];
    for (let i = 0; i < miss.length; i += 17) chs.push(miss.slice(i, i + 17));
    for (let i = 0; i < chs.length; i += 10) await Promise.all(chs.slice(i, i + 10).map(go));
  }
  if (!root) done = true; busy = false; rs();
}

// --- Observer ---

function ps() { ob?.disconnect(); }
function rs() { ob?.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: AT }); }

function observe() {
  ob = new MutationObserver(muts => {
    if (manual) return;
    for (const m of muts) { const el = m.target instanceof Element ? m.target : m.target.parentElement;
      if (!el || (el as HTMLElement).isContentEditable) continue;
      if (el.closest(NT)) continue;
      if (!el.hasAttribute("data-t")) { if (tm) clearTimeout(tm);
        tm = setTimeout(() => { if (!busy) translate(done); }, 300); return; } }
  }); rs();
}

// --- Init ---

async function init() {
  if (!cfg()) return; observe();
  (window as any).t = { version: "1.2.0", get locale() { return loc; }, // x-release-please-version
    async setLocale(l: string) { if (l === loc || !l || l.length > 35 || !LR.test(l)) return; loc = l; await translate(); },
    restore() { if (tm) { clearTimeout(tm); tm = null; } undo(); done = false; loc = iloc; },
    async translateEl(target: string | Element | Element[]) {
      const els = typeof target === "string" ? [...document.querySelectorAll(target)] : Array.isArray(target) ? target : [target];
      for (const el of els) { if (el instanceof Element) await translate(true, el); }
    } };
  if (!manual) await translate();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
} // end singleton guard
