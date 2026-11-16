'use strict';
const assert = require('assert');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const root = path.join(__dirname, '..');
const publicFile = path.join(root, 'public', 'app.js');
const backendFile = path.join(root, 'backend', 'public', 'app.js');
const publicText = fs.readFileSync(publicFile, 'utf8');
const backendText = fs.readFileSync(backendFile, 'utf8');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const checks = [
  ['frontend copies byte-identical', hash(publicFile) === hash(backendFile)],
  ['dual score resolver available', publicText.includes('function calcioDualScoreShadowFromBet')],
  ['dual score panel available', publicText.includes('function renderCalcioDualScoreShadowPanel')],
  ['Forecast Confidence rendered', publicText.includes('Forecast Confidence')],
  ['Value Score rendered', publicText.includes('Value Score')],
  ['Context Risk Penalty rendered', publicText.includes('Context Risk Penalty')],
  ['Decision Readiness rendered', publicText.includes('Decision Readiness')],
  ['shadow authority warning rendered', publicText.includes('nessuna autorità stake')],
  ['PT n=0 zero weight rendered', publicText.includes("'n=0 · peso 0%'")]
].map(([name, ok]) => ({ name, ok: Boolean(ok) }));
for (const row of checks) assert.strictEqual(row.ok, true, row.name);
console.log(JSON.stringify({ success: true, checks }, null, 2));
