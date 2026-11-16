#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { resolveProjectRoot } = require('./patch52-cli');
const root = resolveProjectRoot();
const details = [];
const check = (name, ok, extra = null, severity = 'error') => details.push({ name, ok: Boolean(ok), severity, details: extra });
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const hash = rel => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
try {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const registry = require(path.join(root, 'backend', 'tennisPatchRegistry.js'));
  const mod = require(path.join(root, 'backend', 'tennisWtaInformationRecoveryPatch52.js'));
  const dataDir = path.join(root, 'backend', 'sackmann_data');
  const health = mod.health({ dataDir, projectRoot: root });
  const providerIds = mod.providerRegistry(new Date().getUTCFullYear()).map(row => row.id);
  check('Package Patch52 R2 invariato', pkg.version === '21.39.0', { actual: pkg.version });
  check('Package lock coerente', lock.version === pkg.version && lock.packages?.['']?.version === pkg.version);
  check('Registry corrente 52', registry.TENNIS_CURRENT_PATCH_VERSION === '52' && registry.TENNIS_PATCH_REGISTRY_VERSION === 'TENNIS_PATCH_REGISTRY_V52', registry.getTennisPatchStatus());
  const entry = registry.PATCHES.find(row => String(row.version) === '52');
  check('Registry Patch52 revisione R2', entry?.revision === 'R2' && /truthful candidate\/active/i.test(entry?.title || ''), entry);
  check('Modulo recovery R2', mod.VERSION === 'TENNIS_WTA_INFORMATION_RECOVERY_V2_PATCH52_R2', mod.VERSION);
  check('Policy recovery R2', mod.POLICY_VERSION === 'TENNIS_WTA_INFORMATION_RECOVERY_POLICY_V2_PATCH52_R2', mod.POLICY_VERSION);
  check('Schema stato R2', mod.STATE_SCHEMA_VERSION === 'TENNIS_WTA_RECOVERY_STATE_SCHEMA_V2_PATCH52_R2', mod.STATE_SCHEMA_VERSION);
  check('Health candidate-active separato', health.candidateActiveSeparation === true && Object.prototype.hasOwnProperty.call(health, 'selectedCandidate') && Object.prototype.hasOwnProperty.call(health, 'activeDataset'), health);
  check('Alias active rappresenta dataset attivo', JSON.stringify(health.active || null) === JSON.stringify(health.activeDataset || null), { active: health.active, activeDataset: health.activeDataset });
  check('Stato stale non dichiarato current', !(health.selectedCandidate?.freshness?.status === 'STALE' && health.semanticStatus === 'FRESH_CANDIDATE_AVAILABLE'), { selectedCandidate: health.selectedCandidate, semanticStatus: health.semanticStatus });
  check('Dataset WTA stale resta paper-only', health.activeDataset?.freshness?.status === 'STALE' ? health.status === 'PAPER_ONLY_STALE' && health.circuitBreakerActive === true : true, health, 'warning');
  check('Nessuna autorità stake/probabilità', health.probabilityAuthority === false && health.stakeAuthority === false && health.settlementAuthority === false, health);
  check('Provider chain invariata', providerIds.join('|') === 'TENNISDATA_APP_LOCAL_IMPORT|JEFF_SACKMANN_GITHUB_DISCOVERY|HUGGINGFACE_SACKMANN_ARCHIVE|ANEESHERS_GITHUB_ARCHIVE|LAST_KNOWN_GOOD', providerIds);
  check('Cooldown invariati', mod.failureClass(Object.assign(new Error('x'), { httpStatus: 404 })).cooldownMs === mod.PERMANENT_MISSING_COOLDOWN_MS && mod.MIN_REFRESH_INTERVAL_MS === 12 * 60 * 60 * 1000);
  const server = read('backend/server.tennis.js');
  check('Server espone selectedCandidate', server.includes('selectedCandidate:recovery.selectedCandidate'));
  check('Server espone activeDataset', server.includes('activeDataset:recovery.activeDataset'));
  check('Server active check future-compatible', server.includes('TENNIS_WTA_INFORMATION_RECOVERY_V\\d+_PATCH52'));
  check('Script npm R2', Boolean(pkg.scripts?.['verify:tennis:patch52:r2'] && pkg.scripts?.['audit:tennis:patch52:r2'] && pkg.scripts?.['rollback:tennis:patch52:r2']));
  check('Alias npm Patch52 aggiornati', /patch52-r2/.test(pkg.scripts?.['verify:tennis:patch52'] || '') && /patch52-r2/.test(pkg.scripts?.['audit:tennis:patch52'] || ''));
  const stateFile = path.join(dataDir, mod.STATE_FILE);
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
  check('Stato persistito normalizzato', !state || (state.stateSchemaVersion === mod.STATE_SCHEMA_VERSION && JSON.stringify(state.active || null) === JSON.stringify(state.activeDataset || null) && !(state.selectedCandidate?.freshness?.status === 'STALE' && state.lastStatus === 'FRESH_CANDIDATE_AVAILABLE')), state);
  check('Frontend mirror preservato', hash('public/app.js') === hash('backend/public/app.js') && hash('public/index.html') === hash('backend/public/index.html'));
  const db = new DatabaseSync(path.join(root, 'backend', 'database_betting.db'));
  const integrity = Object.values(db.prepare('pragma integrity_check').get())[0];
  const fk = db.prepare('pragma foreign_key_check').all();
  const counts = db.prepare("select count(*) total,sum(case when upper(coalesce(sport_type,''))='TENNIS' or upper(coalesce(bet_type,'')) like '%TENNIS%' then 1 else 0 end) tennis from ai_forward_test").get();
  db.close();
  check('Database integro', String(integrity).toLowerCase() === 'ok' && fk.length === 0, { integrity, foreignKeyViolations: fk.length, total: Number(counts.total), tennis: Number(counts.tennis || 0) });
  check('Patch51 settlement preservato', read('backend/tennisSettlementExceptionQueuePatch51.js').includes('TENNIS_SETTLEMENT_EXCEPTION_QUEUE_V1_PATCH51'));
  const errors = details.filter(row => !row.ok && row.severity === 'error').length;
  const warnings = details.filter(row => !row.ok && row.severity === 'warning').length;
  console.log(JSON.stringify({
    success: errors === 0,
    patch: 'TENNIS_PATCH_52_R2_WTA_RECOVERY_STATE_TRUTH_CANDIDATE_ACTIVE_SEPARATION',
    revision: 'R2_WINDOWS_NODE_WTA_STATE_TRUTH',
    checks: details.length,
    errors,
    warnings,
    details
  }, null, 2));
  if (errors) process.exit(1);
} catch (error) {
  console.log(JSON.stringify({ success: false, error: error.stack || error.message, details }, null, 2));
  process.exit(1);
}
