#!/usr/bin/env node
/**
 * test-parser-gate.js  — Permanent inline-script parser gate
 *
 * MUST pass before any browser-smoke claim is accepted.
 *
 * What it does:
 *   1. Reads index.html
 *   2. Extracts the FULL concatenated content of ALL <script> blocks
 *      (excluding src= externals and type=module externals)
 *   3. Runs a Function() parse — catches syntax errors the static smoke
 *      tests miss because they only do string-search assertions.
 *   4. Fails hard (exit 1) on any SyntaxError so CI / sub-agents cannot
 *      continue to browser smoke with a broken build.
 *
 * History:
 *   Introduced after cecd5a1 — the mobile UX sprint's static tests all
 *   passed (28/28, 29/29, 16/16) but a pre-existing SyntaxError at line
 *   ~8862 prevented React from mounting in Chrome. This gate catches that
 *   class of bug permanently.
 *
 * Usage:
 *   node tests/test-parser-gate.js
 *   node tests/test-parser-gate.js /path/to/index.html
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const filePath = process.argv[2]
  || path.join(__dirname, '..', 'index.html');

let src;
try {
  src = fs.readFileSync(filePath, 'utf8');
} catch (e) {
  console.error('FAIL: cannot read file:', filePath);
  console.error(e.message);
  process.exit(1);
}

// ── Extract inline <script> blocks ──────────────────────────────────────────
// Skip: <script src="...">, <script type="module" src="...">,
//       <script type="application/json">, and any non-JS type attribute.
// Capture: bare <script>, <script type="text/javascript">, no-type scripts
const scriptRe = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
const blocks   = [];
let match;
while ((match = scriptRe.exec(src)) !== null) {
  const attrs   = match[1] || '';
  const content = match[2] || '';

  // Skip external scripts
  if (/\bsrc\s*=/i.test(attrs)) continue;

  // Skip non-JS type attributes
  const typeMatch = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i);
  if (typeMatch) {
    const t = typeMatch[1].toLowerCase();
    if (!t.includes('javascript') && t !== 'text/ecmascript') continue;
  }

  if (content.trim()) blocks.push(content);
}

if (blocks.length === 0) {
  console.error('FAIL: no inline <script> blocks found — HTML structure changed?');
  process.exit(1);
}

const combined = blocks.join('\n;\n/* ── next script block ── */\n;\n');
console.log(`Parser gate: found ${blocks.length} inline script block(s), ${combined.length.toLocaleString()} chars total`);

// ── Parse ────────────────────────────────────────────────────────────────────
let parseError = null;
try {
  // new Function() parses in non-strict mode (matching browser behaviour).
  // We do NOT invoke it — just parse.
  new Function(combined); // eslint-disable-line no-new-func
} catch (e) {
  parseError = e;
}

if (parseError) {
  console.error('');
  console.error('╔══════════════════════════════════════════════════════════════╗');
  console.error('║  PARSER GATE ❌  SYNTAX ERROR — browser smoke BLOCKED        ║');
  console.error('╚══════════════════════════════════════════════════════════════╝');
  console.error('');
  console.error('Error:', parseError.message);
  console.error('');
  console.error('This error prevents React from mounting in Chrome.');
  console.error('Fix the syntax error before running any browser smoke tests.');
  process.exit(1);
}

console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  PARSER GATE ✅  PASS — inline scripts parse clean           ║');
console.log('║  Browser smoke may proceed.                                  ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');
process.exit(0);
