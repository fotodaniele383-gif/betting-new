#!/usr/bin/env node
'use strict';
const path = require('path');
const { resolveProjectRoot } = require('./patch52-cli');
try {
  const root = resolveProjectRoot();
  const mod = require(path.join(root, 'backend', 'tennisWtaInformationRecoveryPatch52.js'));
  const result = mod.migrateStateTruth({
    dataDir: path.join(root, 'backend', 'sackmann_data'),
    projectRoot: root,
    persist: true
  });
  console.log(JSON.stringify({ success: true, patch: 'TENNIS_PATCH_52_R2', ...result }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ success: false, patch: 'TENNIS_PATCH_52_R2', error: error.stack || error.message }, null, 2));
  process.exit(1);
}
