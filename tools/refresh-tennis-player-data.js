'use strict';
const path = require('path');
const legacy = require('../backend/tennisPlayerDataRefresh');
const multi = require('../backend/tennisMultiProviderData');
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'backend', 'sackmann_data');
const verifyOnly = process.argv.includes('--verify-only');
async function main() {
  const result = verifyOnly
    ? { ...legacy.getPlayerDataHealth({ dataDir, initialize: true }), multiProvider: multi.getHealth({ dataDir, projectRoot: root }), verifyOnly: true }
    : await multi.refreshMultiProvider({ dataDir, projectRoot: root, operationId: `PATCH21_CLI_${Date.now()}` });
  console.log(JSON.stringify(result, null, 2));
  if (verifyOnly && result.success === false) process.exitCode = 2;
}
main().catch(error => { console.error(JSON.stringify({ success: false, error: error.message, patch21: error.patch21 || null }, null, 2)); process.exit(2); });
