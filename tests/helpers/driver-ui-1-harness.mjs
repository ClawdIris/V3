/* DRIVER-UI-1 local test harness.
   LOCAL / SYNTHETIC ONLY. No network, no Supabase, no SMS/WhatsApp, no DB.
   Every external effect a test could reach is a recorded in-memory stub:
     window.open      -> pushed to opened[]
     _supabase.rpc    -> a scripted promise supplied by the test
     _db.upsert       -> a scripted promise supplied by the test
   The two real sources under test are read from disk and executed:
     route-optimizer.js  -> window.DriverRouteLite, driven through its own buttons
     index.html          -> the real saveOrder / changeStatus function bodies */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/* Reviewer re-verification hooks: point the suite at a different copy of either
   source to prove the tests actually fail on the pre-fix baseline.
     DRIVER_UI_1_RO=<file>    replaces route-optimizer.js
     DRIVER_UI_1_HOST=<file>  replaces index.html */
const RO_FILE = process.env.DRIVER_UI_1_RO || path.join(ROOT, "route-optimizer.js");
const HOST_FILE = process.env.DRIVER_UI_1_HOST || path.join(ROOT, "index.html");
export const SOURCES = { routeOptimizer: RO_FILE, host: HOST_FILE };

/* ───────────────────────── React shim ───────────────────────── */
function sameDeps(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function makeReact() {
  let hooks = [], idx = 0, current = null, tree = null, renders = 0;
  const effects = [];
  function render() {
    if (!current) return tree;
    renders++;
    idx = 0;
    tree = current.fn(current.props);
    while (effects.length) { const e = effects.shift(); try { e(); } catch (_) {} }
    return tree;
  }
  const React = {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat(Infinity).filter(c => c != null && c !== false) };
    },
    useState(init) {
      const i = idx++;
      if (!(i in hooks)) hooks[i] = { v: typeof init === "function" ? init() : init };
      const slot = hooks[i];
      return [slot.v, function set(next) {
        const val = typeof next === "function" ? next(slot.v) : next;
        if (val === slot.v) return;
        slot.v = val;
        render();
      }];
    },
    useRef(init) {
      const i = idx++;
      if (!(i in hooks)) hooks[i] = { current: init };
      return hooks[i];
    },
    useMemo(fn, deps) {
      const i = idx++;
      const prev = hooks[i];
      if (prev && sameDeps(prev.deps, deps)) return prev.v;
      const v = fn();
      hooks[i] = { v, deps };
      return v;
    },
    useEffect(fn, deps) {
      const i = idx++;
      const prev = hooks[i];
      if (!prev || !sameDeps(prev.deps, deps)) { hooks[i] = { deps }; effects.push(fn); }
    },
    useCallback(fn) { return fn; }
  };
  return {
    React,
    mount(fn, props) { hooks = []; current = { fn, props }; return render(); },
    /* New props, same mounted instance: hook state survives, as in React. */
    setProps(props) { if (!current) throw new Error("not mounted"); current.props = props; return render(); },
    rerender: render,
    get tree() { return tree; },
    get renders() { return renders; }
  };
}

/* ───────────── load the real route-optimizer.js ───────────── */
export function loadRouteOptimizer(opts = {}) {
  /* dom is created eagerly so document.createElement/toasts have somewhere to go */
  const src = fs.readFileSync(RO_FILE, "utf8");
  const r = makeReact();
  const opened = [];
  const store = {};
  /* A real browser returns null from window.open when the popup is blocked —
     which is the normal outcome for a window opened after an await. Default to
     "allowed"; popupBlocked (or the returned setter) forces the blocked case. */
  const popup = { blocked: !!opts.popupBlocked };
  const windowStub = {
    open(url, target) {
      opened.push({ url, target, blocked: popup.blocked });
      return popup.blocked ? null : { closed: false, focus() {} };
    },
    setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent
  };
  const sandbox = {
    window: windowStub,
    React: r.React,
    console: { log() {}, info() {}, warn() {}, error() {} },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    document: {
      getElementById: () => null,
      createElement: () => stubEl("<created>"),
      head: { appendChild() {} },
      querySelector: () => null
    },
    setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent,
    navigator: {}, Math, Date, JSON, Object, Array, Number, String, Boolean, Promise, Error, RegExp, isNaN, parseFloat, parseInt, Infinity
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "route-optimizer.js" });
  if (typeof windowStub.DriverRouteLite !== "function") throw new Error("DriverRouteLite did not load");
  return {
    react: r, window: windowStub, opened,
    setPopupBlocked(v) { popup.blocked = !!v; },
    get popupBlocked() { return popup.blocked; },
    DriverRouteLite: windowStub.DriverRouteLite,
    RO: windowStub.RO,
    sandbox
  };
}

/* ─── permissive DOM stub, for the HQ RouteOptimizerPage (window.RO) ───
   RO renders with innerHTML strings and reads its form through $("#id"), so the
   test needs a document-shaped object rather than a React tree. Every selector
   resolves to a stable stub element, so a value the test sets is the value the
   real code reads back. No real DOM, no browser. */
function stubEl(sel) {
  const cls = new Set();
  const el = {
    sel, value: "", textContent: "", innerHTML: "", disabled: false,
    style: {}, dataset: {}, children: [],
    classList: {
      add: c => cls.add(c), remove: c => cls.delete(c),
      contains: c => cls.has(c),
      toggle: (c, on) => (on === undefined ? (cls.has(c) ? cls.delete(c) : cls.add(c)) : (on ? cls.add(c) : cls.delete(c)))
    },
    appendChild(c) { el.children.push(c); return c; },
    removeChild(c) { el.children = el.children.filter(x => x !== c); },
    remove() {},
    addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    focus() {}, scrollIntoView() {},
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; }
  };
  return el;
}
export function makeDom() {
  const els = new Map();
  const get = sel => {
    if (!els.has(sel)) els.set(sel, stubEl(sel));
    return els.get(sel);
  };
  const root = stubEl("#root");
  root.querySelector = get;
  root.querySelectorAll = () => [];
  return { root, el: get, all: els };
}

/* ─────────────── tree walking / button clicking ─────────────── */
export function walk(node, out = []) {
  if (!node || typeof node !== "object") return out;
  out.push(node);
  (node.children || []).forEach(c => walk(c, out));
  return out;
}
export function label(node) {
  return (node.children || []).filter(c => typeof c === "string").join("");
}
export function buttons(tree) {
  return walk(tree).filter(n => n.type === "button").map(n => ({ node: n, label: label(n), props: n.props }));
}
export function findButton(tree, text) {
  const hit = buttons(tree).filter(b => b.label.includes(text));
  if (hit.length !== 1) {
    throw new Error(`expected exactly 1 button matching "${text}", found ${hit.length}: ` +
      JSON.stringify(buttons(tree).map(b => b.label)));
  }
  return hit[0];
}
export function click(btn) {
  if (btn.props.disabled) throw new Error(`button "${btn.label}" is disabled`);
  return btn.props.onClick();
}

/* ─────────────── real host source extraction ─────────────── */
export function extractHostFunction(startAnchor, endAnchor) {
  const src = fs.readFileSync(HOST_FILE, "utf8");
  const a = src.indexOf(startAnchor);
  if (a < 0) throw new Error("host anchor not found: " + startAnchor);
  if (src.indexOf(startAnchor, a + 1) >= 0) throw new Error("host anchor not unique: " + startAnchor);
  const b = src.indexOf(endAnchor, a);
  if (b < 0) throw new Error("host end anchor not found: " + endAnchor);
  return src.slice(a, b + endAnchor.length);
}

export function _toConsumableArray(x) { return Array.prototype.slice.call(x); }
