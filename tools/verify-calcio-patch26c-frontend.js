'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const files = ['public/app.js', 'backend/public/app.js'];
const contents = files.map(file => fs.readFileSync(path.join(root, file), 'utf8'));
assert.equal(crypto.createHash('sha256').update(contents[0]).digest('hex'), crypto.createHash('sha256').update(contents[1]).digest('hex'), 'Frontend mirror non allineati');
const markers = [
    'finalizeCalcioPortfolioBatch(',
    "fetch('/api/calcio/portfolio/finalize-batch'",
    'applyCalcioBatchPortfolioSnapshot(',
    'analysisBatchId: data.meta?.observability?.analysisBatchId',
    'CALCIO_26C_BATCH_PORTFOLIO_COMMITTED',
    'calcio_portfolio_batch_certified',
    "safeString(bet.calcio_portfolio_batch_status).toUpperCase() === 'COMMITTED_BATCH'"
];
for (const marker of markers) assert.ok(contents[0].includes(marker), `Marker frontend mancante: ${marker}`);
const loopIndex = contents[0].indexOf('window.processDeepScanQueue = async function');
const batchCallIndex = contents[0].indexOf('await finalizeCalcioPortfolioBatch(bets, options)', loopIndex);
assert.ok(batchCallIndex > loopIndex, 'Allocazione batch deve avvenire al termine della coda DeepScan');
for (const file of files) {
    const r = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${file}: ${r.stderr}`);
}
console.log(JSON.stringify({ success: true, patch: 'BETTING_PATCH_26C_CALCIO_BATCH_PORTFOLIO_AUTHORITATIVE_UI', mirrorsAligned: true, authoritativeBatchRefresh: true, stakeBadgeRequiresBatchCertification: true }, null, 2));
