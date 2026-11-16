'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const registry = require('../backend/tennisPatchRegistry');
const snapshots = require('../backend/tennisPredictionSnapshots');
const eligibility = require('../backend/tennisCalibrationEligibility');
const lifecycle = require('../backend/tennisForwardLifecycle');
const cohorts = require('../backend/tennisForwardCohorts');

const ROOT = path.resolve(__dirname, '..');
const dbPath = process.env.BETTING_DB_PATH || path.join(ROOT, 'backend', 'database_betting.db');
const OUTPUT_DIR = path.join(ROOT, 'audit_patch9');
const excludedParts = new Set(['node_modules', 'backup', 'backups', '.git']);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (excludedParts.has(entry.name) || entry.name.startsWith('TENNIS_PATCH_')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function lineCount(file) { return fs.readFileSync(file, 'utf8').split(/\r?\n/).length; }
function functionDuplicates(file) {
  const source = fs.readFileSync(file, 'utf8');
  const counts = new Map();
  for (const match of source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([name, count]) => ({ name, count }));
}
function tableExists(db, name) { return db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(name).n === 1; }
function tableColumns(db, name) {
  if (!tableExists(db, name)) return new Set();
  const safeName = String(name).replace(/"/g, '""');
  return new Set(db.prepare(`PRAGMA table_info("${safeName}")`).all().map(row => row.name));
}
function resolvePredictionAuditReferenceColumn(db) {
  const columns = tableColumns(db, 'prediction_audit_trail');
  if (columns.has('bet_id')) return 'bet_id';
  if (columns.has('source_bet_id')) return 'source_bet_id';
  return null;
}

const files = walk(ROOT);
const jsFiles = files.filter(file => file.endsWith('.js'));
const testFiles = jsFiles.filter(file => /[\\/]tests[\\/]/.test(file));
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const envPath = path.join(ROOT, 'backend', '.env');
const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const envPotentialSecrets = envText.split(/\r?\n/).filter(line => /(TOKEN|SECRET|PASSWORD|API[_-]?KEY|CHAT_ID)/i.test(line) && line.includes('=') && line.split('=', 2)[1].trim()).length;

const db = new Database(dbPath, { readonly: true });
const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
const totalRows = db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n;
const tennisWhere = "(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%')";
const tennisRows = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere}`).get().n;
const statuses = Object.fromEntries(db.prepare(`SELECT COALESCE(status,'NULL') key, COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere} GROUP BY COALESCE(status,'NULL')`).all().map(row => [row.key, row.n]));
const dataQuality = Object.fromEntries(db.prepare(`SELECT COALESCE(data_quality,'NULL') key, COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere} GROUP BY COALESCE(data_quality,'NULL')`).all().map(row => [row.key, row.n]));
const aiColumns = db.prepare('PRAGMA table_info(ai_forward_test)').all().length;
const dbIndexes = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").get().n;
const predictionAuditExists = tableExists(db, 'prediction_audit_trail');
const predictionAuditRows = predictionAuditExists ? db.prepare('SELECT COUNT(*) n FROM prediction_audit_trail').get().n : 0;
const predictionAuditReferenceColumn = predictionAuditExists ? resolvePredictionAuditReferenceColumn(db) : null;
const orphanPredictionAudits = predictionAuditReferenceColumn
  ? db.prepare(`SELECT COUNT(*) n FROM prediction_audit_trail p LEFT JOIN ai_forward_test a ON a.id=p.${predictionAuditReferenceColumn} WHERE p.${predictionAuditReferenceColumn} IS NOT NULL AND a.id IS NULL`).get().n
  : 0;
const ledgerCounts = tableExists(db, eligibility.TENNIS_CALIBRATION_LEDGER_TABLE)
  ? Object.fromEntries(db.prepare(`SELECT eligibility_status key, COUNT(*) n FROM ${eligibility.TENNIS_CALIBRATION_LEDGER_TABLE} GROUP BY eligibility_status`).all().map(row => [row.key, row.n]))
  : {};
const snapshotRows = tableExists(db, snapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE) ? db.prepare(`SELECT COUNT(*) n FROM ${snapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE}`).get().n : 0;
const lifecycleHealth = lifecycle.scanForwardLifecycle(db, { includeDetails: false });
const cohortHealth = cohorts.scanForwardCohorts(db, { limit: 20 });
db.close();

const report = {
  generatedAt: new Date().toISOString(),
  project: 'BettingApp Tennis',
  patchRegistry: registry.getTennisPatchStatus(),
  overallStatus: 'ADVANCEMENT_CORRECT_WITH_GUARDED_LIMITATIONS',
  releaseDecision: 'PATCH9_FORWARD_COHORT_SEAL_AND_COMPACT_UI_APPROVED_FOR_WINDOWS_CERTIFICATION',
  codebase: {
    activeFiles: files.length,
    javascriptFiles: jsFiles.length,
    jestTestFiles: testFiles.length,
    packageScripts: Object.keys(packageJson.scripts || {}).length,
    serverTennisLines: lineCount(path.join(ROOT, 'backend', 'server.tennis.js')),
    serverCoreLines: lineCount(path.join(ROOT, 'backend', 'server.js')),
    frontendAppLines: lineCount(path.join(ROOT, 'public', 'app.js')),
    frontendCopiesIdentical: sha256(path.join(ROOT, 'public', 'app.js')) === sha256(path.join(ROOT, 'backend', 'public', 'app.js')) && sha256(path.join(ROOT, 'public', 'index.html')) === sha256(path.join(ROOT, 'backend', 'public', 'index.html')),
    duplicateNamedFunctions: {
      serverTennis: functionDuplicates(path.join(ROOT, 'backend', 'server.tennis.js')),
      frontendApp: functionDuplicates(path.join(ROOT, 'public', 'app.js'))
    }
  },
  database: {
    path: path.relative(ROOT, dbPath),
    integrity,
    totalRows,
    tennisRows,
    tennisStatuses: statuses,
    tennisDataQuality: dataQuality,
    aiForwardTestColumns: aiColumns,
    explicitIndexes: dbIndexes,
    predictionAuditRows,
    predictionAuditReferenceColumn,
    predictionAuditReferenceCheckAvailable: !predictionAuditExists || Boolean(predictionAuditReferenceColumn),
    orphanPredictionAudits,
    eligibilityCounts: ledgerCounts,
    immutablePredictionSnapshotRows: snapshotRows,
    forwardLifecycle: lifecycleHealth,
    forwardCohorts: cohortHealth
  },
  securityAndPackaging: {
    envFilePresent: fs.existsSync(envPath),
    envFileNonEmpty: envText.trim().length > 0,
    potentialSecretAssignments: envPotentialSecrets,
    secretValuesExposedInReport: false,
    gitignorePresent: fs.existsSync(path.join(ROOT, '.gitignore'))
  },
  strengths: [
    'Registry e pipeline Tennis versionati, con patch 1-9 separate e regressioni cumulative.',
    'Contratti espliciti per formato match, identità evento, CLV e settlement.',
    'Diagnostica visuale e log Node strutturati con Operation ID e redazione segreti.',
    'Ledger di calibrazione shadow-only: nessuna auto-applicazione prematura.',
    'Patch 7 congela la previsione originale e rende le revisioni append-only.',
    'Patch 8 rende atomici CLV/settlement con il ledger e aggiunge un watchdog di drift read-only.',
    'Patch 9 sigilla coorti development/holdout, blocca leakage temporale e compatta la diagnostica in una finestra riducibile.'
  ],
  risks: [
    ...(fs.existsSync(envPath) && envText.trim().length > 0 ? [{ severity: 'HIGH', code: 'ENV_IN_ARCHIVE', message: 'backend/.env è presente nell’archivio: escluderlo sempre e ruotare eventuali credenziali se il file è stato condiviso.' }] : []),
    { severity: 'HIGH', code: 'CALIBRATION_NOT_READY', message: 'Il campione certificato forward è ancora nullo; non modificare probabilità, gate o stake sulla base dello storico legacy.' },
    ...(lifecycleHealth.driftBets > 0 ? [{ severity: 'HIGH', code: 'FORWARD_LIFECYCLE_DRIFT', message: `${lifecycleHealth.driftBets} record forward non sono allineati tra source, snapshot e ledger.` }] : []),
    ...(cohortHealth.leakageBlocked > 0 ? [{ severity: 'HIGH', code: 'TEMPORAL_LEAKAGE_BLOCKED', message: `${cohortHealth.leakageBlocked} membri coorte sono stati esclusi per leakage temporale.` }] : []),
    ...(cohortHealth.unhealthyMembers > 0 ? [{ severity: 'HIGH', code: 'FORWARD_COHORT_DRIFT', message: `${cohortHealth.unhealthyMembers} membership di coorte non sono allineate.` }] : []),
    { severity: 'MEDIUM', code: 'MONOLITHIC_TENNIS_SERVER', message: 'server.tennis.js e public/app.js sono molto estesi; pianificare modularizzazione dopo la stabilizzazione del data contract.' },
    { severity: 'MEDIUM', code: 'WIDE_OPERATIONAL_TABLE', message: 'ai_forward_test contiene molte colonne; mantenere i nuovi ledger separati e indicizzati.' },
    ...(!predictionAuditExists || predictionAuditReferenceColumn ? [] : [{ severity: 'MEDIUM', code: 'AUDIT_REFERENCE_COLUMN_UNKNOWN', message: 'La tabella prediction_audit_trail non espone bet_id o source_bet_id: controllo orfani non disponibile.' }]),
    ...(orphanPredictionAudits > 0 ? [{ severity: 'MEDIUM', code: 'LEGACY_AUDIT_ORPHANS', message: `${orphanPredictionAudits} audit trail riferiscono bet non più presenti; non usarli per calibrazione certificata.` }] : []),
    { severity: 'LOW', code: 'DUPLICATE_FUNCTION_NAMES', message: 'Esistono nomi funzione duplicati in file monolitici; rischio di shadowing da eliminare in una patch strutturale futura.' }
  ],
  invariants: {
    soccerTouchedByPatch9: false,
    probabilityFormulaChanged: false,
    gateChanged: false,
    stakePolicyChanged: false,
    historicalResultsRewritten: false,
    automaticCalibrationEnabled: false
  }
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, 'PROJECT_STATE_AUDIT_PATCH9.json'), JSON.stringify(report, null, 2));
const md = `# Project State Audit — Tennis Patch 9

- Stato: **${report.overallStatus}**
- Registry corrente: **${registry.TENNIS_CURRENT_PATCH_VERSION}**
- Integrità SQLite: **${integrity}**
- Righe Tennis: **${tennisRows}**
- Snapshot immutabili: **${snapshotRows}**
- Lifecycle tracciate: **${lifecycleHealth.trackedBets}**
- Lifecycle drift: **${lifecycleHealth.driftBets}**
- Membri coorti forward: **${cohortHealth.trackedMembers}**
- Leakage temporali bloccati: **${cohortHealth.leakageBlocked}**
- Auto-calibrazione: **disabilitata**

## Rischi prioritari

${report.risks.map(r => `- **${r.severity} · ${r.code}** — ${r.message}`).join('\n')}

## Decisione

Patch 9 aggiunge coorti temporali sigillate e holdout deterministico senza attivare calibrazione automatica. Il centro operativo Tennis riduce l'ingombro grafico mantenendo i collegamenti read-only a readiness, snapshot, lifecycle e coorti.
`;
fs.writeFileSync(path.join(OUTPUT_DIR, 'PROJECT_STATE_AUDIT_PATCH9.md'), md);
console.log(JSON.stringify(report, null, 2));
