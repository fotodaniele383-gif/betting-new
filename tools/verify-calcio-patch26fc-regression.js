'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const expected = {
  'backend/calcioQuantEngine.js': '925dc8e1020c3eae07a33fe02d6dfd802656e8c07addba419ad7ffd0a4d4af27',
  'backend/calcioUnifiedStakeAuthority.js': 'ec17b09a05df58a48a1c42467e003eeae590ba71739785f9189cc1a202f83529',
  'backend/calcioBatchPortfolioAllocator.js': 'd8447cd69d5e769d45d84ffbc65189a51fa1bef4659b1c11f17b4fd559a8b687',
  'backend/calcioFinalMarketDiagnosticContract.js': '8eea3517fc7ba05cc06b462622c1124de3a1aa5e40491eedd58be514667fee9a',
  'backend/server.tennis.js': '9d25211819be2d9ee7b0f427214b9a4f6a8ad5733da66dd21751ccf7436e8b11',
  'backend/calcioHistoricalCoverageEntityResolution.js': '8a11e7e48ed1f62bb5fe0e57b6c4b8209aafb82ec5f3178a9b96542e251272fa'
};
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
const results = Object.entries(expected).map(([file, digest]) => ({ file, ok: sha(path.join(root, file)) === digest, sha256: sha(path.join(root, file)) }));
for (const row of results) assert.strictEqual(row.ok, true, row.file);
const registry = require('../backend/calcioPatchRegistry');
assert.strictEqual(registry.CALCIO_CURRENT_PATCH_VERSION, '35');
assert.strictEqual(registry.PATCHES.at(-1).id, 'BETTING_PATCH_26F_C_CALCIO_DUAL_SCORE_ARCHITECTURE_SHADOW');
console.log(JSON.stringify({ success: true, protectedAuthorities: { productionProbability: true, unifiedStakeAuthority: true, portfolioCaps: true, finalMarketContractR2ReadOnlyFallback: true, historicalCoverage: true, tennis: true }, results: [...results, { file: 'backend/calcioPatchRegistry.js', ok: true, registry: '35' }] }, null, 2));
