'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const a = fs.readFileSync(path.join(root, 'public/app.js'));
const b = fs.readFileSync(path.join(root, 'backend/public/app.js'));
assert(a.equals(b), 'Mirror frontend non allineati');
const text = a.toString('utf8');
const markers = [
  'Indice Predizione Match',
  'IPM · Edge/EV 25%',
  'STAKE ✓ · DECISIONE CERTIFICATA',
  'l’Indice Predizione Match è l’unica autorità quantitativa dello stake',
  'Edge/EV: ${formatNumber(c.value?.score,1)} × 25%'
];
for (const marker of markers) assert(text.includes(marker), `Marker frontend mancante: ${marker}`);
assert(!text.includes('Valore economico separato'), 'UI Patch 20 ancora presente');
console.log(JSON.stringify({
  success: true,
  patch: 'BETTING_PATCH_21_UNIFIED_IPM_STAKE_MARKET_SELECTION_RESTORE',
  mirrorsAligned: true,
  bytes: a.length,
  sha256: crypto.createHash('sha256').update(a).digest('hex'),
  markers
}, null, 2));
