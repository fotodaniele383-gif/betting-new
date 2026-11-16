#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { resolveProjectRoot } = require('./patch52-cli');
const root = resolveProjectRoot();
const mod = require(path.join(root, 'backend', 'tennisWtaInformationRecoveryPatch52.js'));
const patch43 = require(path.join(root, 'backend', 'tennisWtaSourceDiscoveryPatch43.js'));
const details = [];
function check(name, ok, extra = null) {
  details.push({ name, ok: Boolean(ok), details: extra });
  if (!ok) throw new Error(name);
}
function csv(lastDate) {
  const header = 'tourney_id,tourney_name,surface,draw_size,tourney_level,tourney_date,match_num,winner_id,winner_name,loser_id,loser_name,score,best_of,round';
  const rows = [];
  for (let n = 1; n <= 600; n += 1) {
    rows.push(`2026-${String(n).padStart(3, '0')},Fixture,Hard,32,A,${n === 600 ? lastDate : '20260101'},${n},${n},Player A ${n},${n + 1000},Player B ${n},6-4 6-4,3,F`);
  }
  return `${[header, ...rows].join('\n')}\n`;
}
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'patch52-r2-truth-'));
  const dataDir = path.join(tmp, 'backend', 'sackmann_data');
  fs.mkdirSync(dataDir, { recursive: true });
  const localFile = path.join(dataDir, 'wta_matches_2026.csv');
  fs.writeFileSync(localFile, csv('20260525'));
  const now = '2026-08-06T13:01:00.000Z';
  const inspection = patch43.inspect(fs.readFileSync(localFile, 'utf8'), 2026, 'LAST_KNOWN_GOOD', { now });
  const legacyState = {
    version: 'TENNIS_WTA_INFORMATION_RECOVERY_V1_PATCH52',
    policyVersion: 'TENNIS_WTA_INFORMATION_RECOVERY_POLICY_V1_PATCH52',
    updatedAt: '2026-08-06T10:47:56.678Z',
    providers: {
      JEFF_SACKMANN_GITHUB_DISCOVERY: {
        providerId: 'JEFF_SACKMANN_GITHUB_DISCOVERY', status: 'COOLDOWN', failureClass: 'PERMANENT_RESOURCE_MISSING',
        httpStatus: 404, retryable: false, lastError: 'PATCH43_WTA_HTTP_404',
        lastAttemptAt: '2026-08-06T10:47:56.678Z', cooldownUntil: '2026-08-07T10:47:56.678Z', consecutiveFailures: 1
      },
      HUGGINGFACE_SACKMANN_ARCHIVE: {
        providerId: 'HUGGINGFACE_SACKMANN_ARCHIVE', status: 'AVAILABLE', lastAttemptAt: '2026-08-06T10:47:56.678Z',
        lastSuccessAt: '2026-08-06T10:47:56.678Z', latestMatchAt: inspection.latestMatchAt,
        validRows: inspection.validRows, sha256: inspection.sha256, consecutiveFailures: 0
      }
    },
    lastAttemptAt: '2026-08-06T10:47:56.678Z',
    lastSuccessAt: null,
    lastStatus: 'FRESH_CANDIDATE_AVAILABLE',
    active: {
      providerId: 'HUGGINGFACE_SACKMANN_ARCHIVE', latestMatchAt: inspection.latestMatchAt,
      validRows: inspection.validRows, sha256: inspection.sha256,
      freshness: { status: 'STALE', dataAgeDays: 72.9 }
    }
  };
  fs.writeFileSync(path.join(dataDir, mod.STATE_FILE), `${JSON.stringify(legacyState, null, 2)}\n`);

  const migration = mod.migrateStateTruth({ dataDir, projectRoot: tmp, year: 2026, now, patch43, persist: true });
  check('Migrazione R1 rileva modifica semantica', migration.success && migration.changed === true, migration);
  check('Stato stale non resta FRESH_CANDIDATE_AVAILABLE', migration.after.lastStatus === 'STALE_CANDIDATE_REJECTED_FOR_AUTHORITY', migration.after);
  check('Mirror stale classificato selectedCandidate', migration.after.selectedCandidateProviderId === 'HUGGINGFACE_SACKMANN_ARCHIVE' && migration.after.selectedCandidateFreshness === 'STALE', migration.after);
  check('Dataset attivo resta Last Known Good', migration.after.activeDatasetProviderId === 'LAST_KNOWN_GOOD' && migration.after.activeDatasetFreshness === 'STALE', migration.after);
  check('Alias legacy active punta al dataset attivo', migration.state.active?.providerId === 'LAST_KNOWN_GOOD' && migration.state.active?.sha256 === inspection.sha256, migration.state);
  check('Schema stato R2 presente', migration.state.stateSchemaVersion === mod.STATE_SCHEMA_VERSION, migration.state);

  const skipped = await mod.refresh({ dataDir, projectRoot: tmp, year: 2026, now, patch43 });
  check('Refresh ravvicinato resta SKIPPED_RECENT_ATTEMPT', skipped.success && skipped.status === 'SKIPPED_RECENT_ATTEMPT' && skipped.dataChanged === false, skipped);
  check('Skip espone stato semantico stale', skipped.semanticStatus === 'STALE_CANDIDATE_REJECTED_FOR_AUTHORITY', skipped);
  check('Skip separa candidato e attivo', skipped.selectedCandidate?.providerId === 'HUGGINGFACE_SACKMANN_ARCHIVE' && skipped.activeDataset?.providerId === 'LAST_KNOWN_GOOD', skipped);
  check('Skip mantiene autorità false', skipped.authority?.probability === false && skipped.authority?.stake === false, skipped.authority);

  const health = mod.health({ dataDir, projectRoot: tmp, year: 2026, now, patch43 });
  check('Health espone candidateActiveSeparation', health.candidateActiveSeparation === true && health.legacyActiveAlias === 'activeDataset', health);
  check('Health stato operativo paper-only stale', health.status === 'PAPER_ONLY_STALE' && health.circuitBreakerActive === true, health);
  check('Health mostra selectedCandidate distinto', health.selectedCandidate?.providerId === 'HUGGINGFACE_SACKMANN_ARCHIVE', health.selectedCandidate);
  check('Health mostra activeDataset reale', health.activeDataset?.providerId === 'LAST_KNOWN_GOOD' && health.active?.providerId === 'LAST_KNOWN_GOOD', health.activeDataset);
  check('Nessuna autorità introdotta', health.probabilityAuthority === false && health.stakeAuthority === false && health.settlementAuthority === false, health);

  // Verify that successful activation statuses are not rewritten as candidate availability.
  const currentText = csv('20260805');
  fs.writeFileSync(localFile, currentText);
  const currentInspection = patch43.inspect(currentText, 2026, 'HUGGINGFACE_SACKMANN_ARCHIVE', { now });
  const activated = mod.saveState(dataDir, {
    ...migration.state,
    lastAttemptAt: now,
    lastSuccessAt: now,
    lastStatus: 'RECOVERED_CURRENT_SHADOW',
    lastSemanticStatus: 'RECOVERED_CURRENT_SHADOW',
    selectedCandidate: {
      providerId: 'HUGGINGFACE_SACKMANN_ARCHIVE', latestMatchAt: currentInspection.latestMatchAt,
      validRows: currentInspection.validRows, sha256: currentInspection.sha256
    },
    activeDataset: {
      providerId: 'HUGGINGFACE_SACKMANN_ARCHIVE', latestMatchAt: currentInspection.latestMatchAt,
      validRows: currentInspection.validRows, sha256: currentInspection.sha256
    },
    active: {
      providerId: 'HUGGINGFACE_SACKMANN_ARCHIVE', latestMatchAt: currentInspection.latestMatchAt,
      validRows: currentInspection.validRows, sha256: currentInspection.sha256
    }
  }, new Date(now), { year: 2026, patch43 });
  check('Stato RECOVERED_CURRENT_SHADOW preservato', activated.lastStatus === 'RECOVERED_CURRENT_SHADOW' && activated.lastSemanticStatus === 'RECOVERED_CURRENT_SHADOW', activated);
  check('Attivazione riuscita attribuisce activeDataset al provider', activated.activeDataset?.providerId === 'HUGGINGFACE_SACKMANN_ARCHIVE', activated.activeDataset);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(JSON.stringify({ success: true, checks: details.length, details }, null, 2));
})().catch(error => {
  console.log(JSON.stringify({ success: false, error: error.stack || error.message, details }, null, 2));
  process.exit(1);
});
