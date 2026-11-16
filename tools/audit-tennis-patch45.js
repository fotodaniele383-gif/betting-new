#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const rootIndex = process.argv.indexOf('--root');
const root = path.resolve(rootIndex >= 0 && process.argv[rootIndex + 1] ? process.argv[rootIndex + 1] : '.');
const checks = [];
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function check(name, condition, details = null, severity = 'error') { checks.push({ name, ok: Boolean(condition), severity, details }); }

try {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const registryPath = path.join(root, 'backend', 'tennisPatchRegistry.js');
  delete require.cache[require.resolve(registryPath)];
  const registry = require(registryPath);
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'backend', 'tennis_patch_inventory.json'), 'utf8'));
  const trackerSource = fs.readFileSync(path.join(root, 'backend', 'clvTracker.js'), 'utf8');

  check('Package Patch45 compatibile', Number(String(pkg.version).split('.')[1]) >= 32, { actual: pkg.version });
  check('Registry Patch45 o successivo', Number(registry.TENNIS_CURRENT_PATCH_VERSION) >= 45 && registry.TENNIS_PATCH_REGISTRY_VERSION === `TENNIS_PATCH_REGISTRY_V${registry.TENNIS_CURRENT_PATCH_VERSION}`, {
    current: registry.TENNIS_CURRENT_PATCH_VERSION,
    registryVersion: registry.TENNIS_PATCH_REGISTRY_VERSION
  });
  check('Voce Patch45 registrata', registry.PATCHES.some(item => item.version === '45' && /CLV contract runtime binding/i.test(item.title)));
  check('Inventory Patch45 o successivo', Number(inventory.registry?.currentPatchVersion) >= 45 && inventory.registry?.registryVersion === `TENNIS_PATCH_REGISTRY_V${inventory.registry?.currentPatchVersion}`, inventory.registry);
  check('Import contratto esplicito', trackerSource.includes("} = require('./tennisClvContract');") && trackerSource.includes('buildClvContractFields') && trackerSource.includes('TENNIS_CLV_CONTRACT_VERSION'));
  check('Fail-fast binding attivo', trackerSource.includes('PATCH45_CLV_RUNTIME_BINDINGS_READY = assertPatch45ClvRuntimeBindings()'));
  check('Metadati Vault propagati', trackerSource.includes('closingTimestamp: vaultHit.record?.closing_ts') && trackerSource.includes('openingTimestamp: vaultHit.record?.opening_ts'));
  check('Metadati live propagati', trackerSource.includes('sourceEventId: liveMatch?.id || freshBet.provider_event_id') && trackerSource.includes('closingTimestamp: step103Now.toISOString()'));
  check('Semantica unverified esplicita', trackerSource.includes('CLV_CAPTURED_UNVERIFIED_') && trackerSource.includes('CLV_CONTRACT_${fields.clv_contract_reason'));
  check('Contratto Patch4 non modificato', sha(path.join(root, 'backend', 'tennisClvContract.js')) === '6f69d0dbf1f0107f0dc2167155507ed7c654c9fde668cf3f41f1d96840571e8e');
  const lifecyclePath=path.join(root,'backend','tennisForwardLifecycle.js'); const lifecycleSource=fs.readFileSync(lifecyclePath,'utf8'); check('Lifecycle Patch8 compatibile o Patch48 R4 bounded-UI/unbounded-reconcile', sha(lifecyclePath) === '0ad95234fd68b6ee2083ac9d125c4f22ab01d7fa92442f218a681c45e6337da3' || (Number(registry.TENNIS_CURRENT_PATCH_VERSION)>=48 && lifecycleSource.includes('internalUnboundedDetails')));
  check('Script npm Patch45 presenti', ['test:tennis:patch45','verify:tennis:patch45','audit:tennis:patch45','recover:tennis:clv:patch45','rollback:tennis:patch45'].every(key => Boolean(pkg.scripts?.[key])));

  const syntax = cp.spawnSync(process.execPath, ['--check', path.join(root, 'backend', 'clvTracker.js')], { encoding: 'utf8' });
  check('Sintassi clvTracker valida', syntax.status === 0, syntax.stderr || null);

  const publicApp = path.join(root, 'public', 'app.js');
  const backendApp = path.join(root, 'backend', 'public', 'app.js');
  check('Frontend mirror invariato', fs.existsSync(publicApp) && fs.existsSync(backendApp) && sha(publicApp) === sha(backendApp));

  const dbPath = path.join(root, 'backend', 'database_betting.db');
  const db = new DatabaseSync(dbPath, { readOnly: true, open: true });
  try {
    const integrity = Object.values(db.prepare('PRAGMA integrity_check').get())[0];
    const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
    const total = Number(db.prepare('SELECT COUNT(*) AS n FROM ai_forward_test').get().n);
    const tennis = Number(db.prepare("SELECT COUNT(*) AS n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get().n);
    check('Database integro', String(integrity).toLowerCase() === 'ok' && foreignKeys.length === 0, { integrity, foreignKeyViolations: foreignKeys.length });
    check('Dataset baseline presente', total >= 1187 && tennis >= 904, { total, tennis }, 'warn');
  } finally { db.close(); }

  const failed = checks.filter(item => !item.ok && item.severity === 'error');
  console.log(JSON.stringify({
    success: failed.length === 0,
    patch: 'TENNIS_PATCH_45_CLV_CONTRACT_RUNTIME_BINDING_ATOMIC_LOCK_RECOVERY',
    revision: 'R2_WINDOWS_NODE_CLV_BINDING_RUNTIME_DB_DRIFT_COMPAT',
    checks: checks.length,
    errors: failed.length,
    warnings: checks.filter(item => !item.ok && item.severity === 'warn').length,
    details: checks
  }, null, 2));
  if (failed.length) process.exit(1);
} catch (error) {
  console.log(JSON.stringify({ success: false, patch: 'TENNIS_PATCH_45_CLV_CONTRACT_RUNTIME_BINDING_ATOMIC_LOCK_RECOVERY', checks: checks.length, error: error.stack || error.message, details: checks }, null, 2));
  process.exit(1);
}
