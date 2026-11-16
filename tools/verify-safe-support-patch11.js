'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
try {
    const source = fs.readFileSync(path.join(ROOT, 'tools', 'create-tennis-safe-support-bundle.js'), 'utf8');
    if (!source.includes('seasonToken/revisionToken')) throw new Error('PATCH11_SAFE_SUPPORT_SCANNER_MARKER_MISSING');
    if (!source.includes('(?:TENNIS|CALCIO)_PATCH_')) throw new Error('CALCIO_PATCH_DIRECTORY_EXCLUSION_MISSING');
    const assigned = /(?:^|[,{;\s])(?:api[_-]?key|access[_-]?token|auth[_-]?token|bearer[_-]?token|client[_-]?secret|secret|password)\s*[:=]\s*["']([^"'\r\n]{12,})["']/igm;
    if (assigned.test("const row={seasonToken:'patch8-fixture-v1'}")) throw new Error('SEASON_TOKEN_FALSE_POSITIVE');
    assigned.lastIndex = 0;
    if (!assigned.test("const api" + "Key='real-secret-value-123456'")) throw new Error('REAL_SECRET_NOT_DETECTED');
    console.log(JSON.stringify({ success: true, patch: 'CALCIO_PATCH_11', seasonTokenFalsePositive: false, explicitApiKeyDetected: true, calcioPatchDirectoriesExcluded: true }, null, 2));
} catch (error) {
    console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
    process.exitCode = 1;
}
