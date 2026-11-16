#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { resolveProjectRoot } = require('./patch52-cli');
const root = resolveProjectRoot();
const details = [];
const check = (name, ok, extra = null) => { details.push({ name, ok: Boolean(ok), details: extra }); if (!ok) throw new Error(name); };
try {
  const moduleText = fs.readFileSync(path.join(root, 'backend', 'tennisWtaInformationRecoveryPatch52.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'backend', 'server.tennis.js'), 'utf8');
  const registry = fs.readFileSync(path.join(root, 'backend', 'tennisPatchRegistry.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const mod = require(path.join(root, 'backend', 'tennisWtaInformationRecoveryPatch52.js'));
  check('Modulo R2 attivo', mod.VERSION === 'TENNIS_WTA_INFORMATION_RECOVERY_V2_PATCH52_R2', mod.VERSION);
  check('Policy R2 attiva', mod.POLICY_VERSION === 'TENNIS_WTA_INFORMATION_RECOVERY_POLICY_V2_PATCH52_R2', mod.POLICY_VERSION);
  check('Schema stato R2 attivo', mod.STATE_SCHEMA_VERSION === 'TENNIS_WTA_RECOVERY_STATE_SCHEMA_V2_PATCH52_R2', mod.STATE_SCHEMA_VERSION);
  check('Contratto selectedCandidate presente', moduleText.includes('selectedCandidate') && moduleText.includes("role: 'SELECTED_CANDIDATE'"));
  check('Contratto activeDataset presente', moduleText.includes('activeDataset') && moduleText.includes("role: 'ACTIVE_DATASET'"));
  check('Alias active solo compatibilità', moduleText.includes("legacyActiveAlias: 'activeDataset'") && moduleText.includes('active: activeDataset'));
  check('Skip recente espone semanticStatus', moduleText.includes("status: 'SKIPPED_RECENT_ATTEMPT'") && moduleText.includes('semanticStatus: state.lastSemanticStatus || state.lastStatus'));
  check('Server espone separazione', server.includes('selectedCandidate:recovery.selectedCandidate') && server.includes('activeDataset:recovery.activeDataset'));
  check('Server usa famiglia versione Patch52', server.includes('TENNIS_WTA_INFORMATION_RECOVERY_V\\d+_PATCH52'));
  check('Registry contiene revisione R2', registry.includes("revision: 'R2'") && registry.includes('truthful candidate/active dataset separation'));
  check('Script R2 registrati', Boolean(pkg.scripts?.['verify:tennis:patch52:r2'] && pkg.scripts?.['audit:tennis:patch52:r2'] && pkg.scripts?.['rollback:tennis:patch52:r2']));
  check('Alias Patch52 puntano alla R2', /verify-tennis-patch52-r2\.js/.test(pkg.scripts?.['verify:tennis:patch52'] || '') && /audit-tennis-patch52-r2\.js/.test(pkg.scripts?.['audit:tennis:patch52'] || ''));
  console.log(JSON.stringify({ success: true, checks: details.length, details }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ success: false, error: error.stack || error.message, details }, null, 2));
  process.exit(1);
}
