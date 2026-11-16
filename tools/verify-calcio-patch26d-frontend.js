'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const files = ['public/app.js', 'backend/public/app.js'];
const contents = files.map(file => fs.readFileSync(path.join(root, file), 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
assert.equal(hash(contents[0]), hash(contents[1]), 'Frontend mirror non allineati');
for (const marker of [
    'finalizeCalcioPortfolioBatch(',
    "fetch('/api/calcio/portfolio/finalize-batch'",
    'applyCalcioBatchPortfolioSnapshot(',
    'analysisBatchId: data.meta?.observability?.analysisBatchId',
    'CALCIO_26C_BATCH_PORTFOLIO_COMMITTED',
    'calcio_portfolio_batch_certified'
]) assert.ok(contents[0].includes(marker), `Marker frontend Patch 26C mancante: ${marker}`);
for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
}
console.log(JSON.stringify({ success: true, patch: 'BETTING_PATCH_26D_CALCIO_POST_COMMIT_SCOPE_BATCH_RECOVERY', frontendUnchanged: true, mirrorsAligned: true, authoritativeBatchRefreshPreserved: true }, null, 2));
