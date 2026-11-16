'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const bridge = require('../backend/tennisCanonicalPlayerEvidenceBridge');
const historical = require('../backend/tennisHistoricalPlayerStats');
const playerEvidence = require('../backend/tennisPlayerEvidence');
const registry = require('../backend/tennisPatchRegistry');

const checks = [];
function check(name, fn) {
  try { fn(); checks.push({ name, ok: true }); }
  catch (error) { checks.push({ name, ok: false, error: error.message }); }
}

const asOf = '2026-07-29T09:00:00.000Z';
playerEvidence.init(path.join(root, 'backend', 'sackmann_data'));

check('registry Tennis 26 attivo', () => {
  assert.equal(registry.TENNIS_CURRENT_PATCH_VERSION, '26');
  assert.equal(registry.TENNIS_PATCH_REGISTRY_VERSION, 'TENNIS_PATCH_REGISTRY_V26');
});
check('dataset storico caricato', () => {
  const status = historical.getStatus({ initialize: true });
  assert.equal(status.loaded, true);
  assert.equal(status.deepScanContextAuthority, true);
  assert.equal(status.modelProbabilityAuthority, false);
});
check('WTA current profile recovery Cocciaretto Navarro', () => {
  const result = bridge.buildMatchupBridge('Elisabetta Cocciaretto', 'Emma Navarro', 'WTA', asOf, {});
  assert.equal(result.status, 'READY_WITH_STALE_TECHNICAL');
  assert.equal(result.p1.currentRank, 68);
  assert.equal(result.p2.currentRank, 26);
  assert.equal(result.p1.overallElo, 1753);
  assert.equal(result.p2.overallElo, 1877);
  assert.equal(result.p1.status, 'CURRENT_PROFILE_STALE_TECHNICAL');
  assert.equal(result.authority.modelProbability, false);
  assert.equal(result.authority.stake, false);
});
check('alias generazionale sicuro Martin Damm Jr', () => {
  const result = bridge.buildPlayerBridge('Martin Damm Jr.', 'ATP', asOf, {});
  assert.equal(result.canonicalPlayerName, 'Martin Damm');
  assert.equal(result.identityResolution, 'SAFE_SUFFIX_ALIAS');
  assert.equal(result.sample, 16);
  assert.equal(result.dominanceRatio, 1.037);
});
check('Trevor Svajda non aliasato a Zachary', () => {
  const result = bridge.buildPlayerBridge('Trevor Svajda', 'ATP', asOf, {});
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.normalizedName, 'TREVOR SVAJDA');
  assert.ok(!String(result.canonicalPlayerName).includes('Zachary'));
});
check('ATP service return importato', () => {
  const result = bridge.buildPlayerBridge('Tommy Paul', 'ATP', asOf, {});
  assert.equal(result.servicePointsWon, 0.683);
  assert.equal(result.returnPointsWon, 0.392);
  assert.ok(result.dominanceRatio > 1);
});
check('legacy adapter espone bridge anche senza authority production', () => {
  const result = playerEvidence.getLegacyCompatibleMatchup('Elisabetta Cocciaretto', 'Emma Navarro', 'Hard', asOf, { tour: 'WTA' });
  assert.equal(result.hasData, false);
  assert.equal(result.canonicalDataAvailable, true);
  assert.equal(result.p1_rank, 68);
  assert.equal(result.p2_rank, 26);
  assert.equal(result.canonicalBridgeStakeChanged, false);
});
check('nessun Rank 500 per giocatore sconosciuto', () => {
  const result = playerEvidence.getLegacyCompatibleMatchup('Unknown Player Alpha', 'Unknown Player Beta', 'Hard', asOf, { tour: 'ATP' });
  assert.equal(result.p1_rank, null);
  assert.equal(result.p2_rank, null);
});
check('sorgente DeepScan priva del fallback p1_rank || 500', () => {
  const text = fs.readFileSync(path.join(root, 'backend', 'deepScanTennis.js'), 'utf8');
  assert.ok(!text.includes('sackmannData.p1_rank || 500'));
  assert.ok(text.includes("displayDr1 === null ? 'N/D'"));
  assert.ok(text.includes('renderCanonicalPlayerEvidenceHtml'));
});
check('server espone endpoint read-only Patch 26', () => {
  const text = fs.readFileSync(path.join(root, 'backend', 'server.tennis.js'), 'utf8');
  assert.ok(text.includes('/canonical-player-evidence-health'));
  assert.ok(text.includes('/canonical-player-evidence-matchup'));
  assert.ok(text.includes('canonicalPlayerEvidenceProbabilityChanged: false'));
});
check('persistenza bridge additiva presente', () => {
  const text = fs.readFileSync(path.join(root, 'backend', 'server.tennis.js'), 'utf8');
  assert.ok(text.includes('tennis_canonical_player_evidence_json'));
  assert.ok(text.includes('tennis_canonical_player_evidence_status'));
});
check('UI usa bridge quando data quality è N/D', () => {
  const text = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  assert.ok(text.includes('tennis_canonical_player_evidence_json'));
  assert.ok(text.includes('Canonical Player Evidence: solo identità/display/contesto DeepScan'));
});
check('frontend copie sincronizzate', () => {
  assert.deepEqual(fs.readFileSync(path.join(root, 'public', 'app.js')), fs.readFileSync(path.join(root, 'backend', 'public', 'app.js')));
});
check('progression guard accetta capture strutturalmente sana', () => {
  const text = fs.readFileSync(path.join(root, 'backend', 'tennisProgramProgressionAudit.js'), 'utf8');
  assert.ok(text.includes("['READY_FOR_NEXT_PREDICTION','CAPTURING_FORWARD_SAMPLE']"));
});
check('nessuna authority operativa nel bridge', () => {
  const result = bridge.buildMatchupBridge('Tommy Paul', 'Kamil Majchrzak', 'ATP', asOf, {});
  assert.deepEqual(result.authority, { identity: true, display: true, deepScanContext: true, modelProbability: false, qualityGate: false, stake: false, settlement: false });
});
check('schema migrazione contiene sei colonne additive', () => {
  const migration = require('../backend/migrateTennisPatch26');
  assert.equal(migration.COLUMNS.length, 6);
  assert.ok(migration.COLUMNS.every(([name]) => name.startsWith('tennis_canonical_player_evidence_')));
});
check('inventario Tennis allineato a 26', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'backend', 'tennis_patch_inventory.json'), 'utf8'));
  assert.equal(String(inventory.registry.currentPatchVersion), '26');
  assert.equal(Number(inventory.summary.unregisteredCount), 0);
});
check('package scripts Patch 26 presenti', () => {
  const pkg = require('../package.json');
  assert.ok(pkg.scripts['verify:tennis:patch26']);
  assert.ok(pkg.scripts['audit:tennis:patch26']);
});
check('nessuna chiamata API introdotta dal bridge', () => {
  const text = fs.readFileSync(path.join(root, 'backend', 'tennisCanonicalPlayerEvidenceBridge.js'), 'utf8');
  assert.ok(!/axios|fetch\(|https\.request|http\.request/.test(text));
});
check('XLSX canonico resta source locale', () => {
  const result = bridge.buildPlayerBridge('Martin Damm Jr.', 'ATP', asOf, {});
  assert.ok(result.sources.some(source => source.id === 'TENNISDB_CANONICAL_XLSX'));
});

const failed = checks.filter(item => !item.ok);
const output = { success: failed.length === 0, patch: 'TENNIS_PATCH_26_CANONICAL_PLAYER_EVIDENCE_BRIDGE_WTA_CURRENT_PROFILE_RECOVERY', checks: checks.length, passed: checks.length - failed.length, failed: failed.length, results: checks };
console.log(JSON.stringify(output, null, 2));
if (failed.length) process.exit(1);
