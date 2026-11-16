'use strict';

const crypto = require('crypto');

const VERSION = 'TENNIS_DEEPSCAN_CANONICAL_TRUTH_V1_PATCH48';
const SOURCE = 'PERSISTED_DEEPSCAN_SNAPSHOT';
const ONBOARDING_VERSION = 'TENNIS_DEEPSCAN_CANONICAL_ONBOARDING_V1_PATCH49';

function upper(value) {
  return String(value == null ? '' : value).trim().toUpperCase();
}

function normalizeDeepScan(value) {
  const text = upper(value);
  if (/VALUE.CONFERMATO|VALUE_CONFIRMED/.test(text)) return 'VALUE_CONFIRMED';
  if (/EDGE.TECNICO|TECHNICAL_EDGE/.test(text)) return 'TECHNICAL_EDGE';
  if (/RISCHIO.MODELLO|MODEL_RISK/.test(text)) return 'MODEL_RISK';
  if (/ALTO.RISCHIO|HIGH_RISK/.test(text)) return 'HIGH_RISK';
  if (/WATCHLIST|LOW_EDGE/.test(text)) return 'WATCHLIST';
  if (/ATTENDI|IN.PLAY|LIVE/.test(text)) return 'WAIT_IN_PLAY';
  return text || 'NO_DEEPSCAN';
}

function hashEvidence(id, action, source = SOURCE) {
  return crypto.createHash('sha256').update(JSON.stringify({ id: Number(id), action, source })).digest('hex');
}

function tableColumns(db, table = 'ai_forward_test') {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
}

function ensureSchema(db) {
  const columns = tableColumns(db);
  const definitions = [
    'tennis_deepscan_canonical_version TEXT',
    'tennis_deepscan_canonical_action TEXT',
    'tennis_deepscan_canonical_source TEXT',
    'tennis_deepscan_canonical_hash TEXT',
    'tennis_deepscan_canonical_at TEXT'
  ];
  for (const definition of definitions) {
    const name = definition.split(/\s+/)[0];
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${definition}`);
      columns.add(name);
    }
  }
  return { success: true, version: ONBOARDING_VERSION };
}

const TENNIS_WHERE = `(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%')`;

function getDeepScanExpression(db) {
  const columns = tableColumns(db);
  const candidates = ['ds_action', 'deep_scan_canonical_code', 'quality_deepscan_class'];
  const available = candidates.filter(name => columns.has(name));
  return available.length ? `COALESCE(${available.map(name => `NULLIF(${name},'')`).join(',')},'')` : `''`;
}

function getCoverage(db) {
  ensureSchema(db);
  const deepScanExpr = getDeepScanExpression(db);
  const rows = db.prepare(`SELECT id, ${deepScanExpr} AS deep_scan_source_value,
    tennis_deepscan_canonical_version, tennis_deepscan_canonical_action,
    tennis_deepscan_canonical_source, tennis_deepscan_canonical_hash
    FROM ai_forward_test WHERE ${TENNIS_WHERE} ORDER BY id`).all();
  let covered = 0;
  let missing = 0;
  let mismatched = 0;
  const candidateIds = [];
  for (const row of rows) {
    const action = normalizeDeepScan(row.deep_scan_source_value);
    const expectedHash = hashEvidence(row.id, action, SOURCE);
    const valid = row.tennis_deepscan_canonical_version === VERSION
      && row.tennis_deepscan_canonical_action === action
      && row.tennis_deepscan_canonical_source === SOURCE
      && row.tennis_deepscan_canonical_hash === expectedHash;
    if (valid) covered += 1;
    else {
      candidateIds.push(Number(row.id));
      const hasAny = Boolean(row.tennis_deepscan_canonical_version || row.tennis_deepscan_canonical_action
        || row.tennis_deepscan_canonical_source || row.tennis_deepscan_canonical_hash);
      if (hasAny) mismatched += 1; else missing += 1;
    }
  }
  return {
    success: candidateIds.length === 0,
    version: ONBOARDING_VERSION,
    canonicalVersion: VERSION,
    tennisRows: rows.length,
    covered,
    missing,
    mismatched,
    coverageGap: candidateIds.length,
    candidateIds
  };
}

function transaction(db, fn) {
  if (typeof db.transaction === 'function') return db.transaction(fn)();
  db.exec('BEGIN IMMEDIATE');
  try { const value = fn(); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

function reconcileCanonicalCoverage(db, options = {}) {
  ensureSchema(db);
  const source = String(options.source || 'PATCH49_RUNTIME_ONBOARDING');
  const now = options.now instanceof Date ? options.now.toISOString() : String(options.now || new Date().toISOString());
  const before = getCoverage(db);
  if (before.coverageGap === 0) {
    return { success: true, version: ONBOARDING_VERSION, source, before, repaired: 0, repairedIds: [], after: before };
  }
  const deepScanExpr = getDeepScanExpression(db);
  const rows = db.prepare(`SELECT id, ${deepScanExpr} AS deep_scan_source_value
    FROM ai_forward_test WHERE ${TENNIS_WHERE} ORDER BY id`).all();
  const candidateSet = new Set(before.candidateIds);
  const update = db.prepare(`UPDATE ai_forward_test SET
    tennis_deepscan_canonical_version=?, tennis_deepscan_canonical_action=?,
    tennis_deepscan_canonical_source=?, tennis_deepscan_canonical_hash=?, tennis_deepscan_canonical_at=?
    WHERE id=?`);
  const repairedIds = [];
  transaction(db, () => {
    for (const row of rows) {
      if (!candidateSet.has(Number(row.id))) continue;
      const action = normalizeDeepScan(row.deep_scan_source_value);
      update.run(VERSION, action, SOURCE, hashEvidence(row.id, action, SOURCE), now, row.id);
      repairedIds.push(Number(row.id));
    }
  });
  const after = getCoverage(db);
  return {
    success: after.coverageGap === 0,
    version: ONBOARDING_VERSION,
    source,
    before,
    repaired: repairedIds.length,
    repairedIds,
    after
  };
}

module.exports = {
  VERSION,
  SOURCE,
  ONBOARDING_VERSION,
  normalizeDeepScan,
  hashEvidence,
  ensureSchema,
  getDeepScanExpression,
  getCoverage,
  reconcileCanonicalCoverage
};
