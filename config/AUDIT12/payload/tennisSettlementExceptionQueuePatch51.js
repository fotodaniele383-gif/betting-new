'use strict';

const crypto = require('crypto');
const settlementResolutionEvidenceGateAudit12 = require('./settlementResolutionEvidenceGateAudit12');

const VERSION = 'TENNIS_SETTLEMENT_EXCEPTION_QUEUE_V1_PATCH51';
const RECOVERY_VERSION = 'TENNIS_SETTLEMENT_TARGETED_RECOVERY_V1_PATCH51';
const TABLE = 'tennis_settlement_exception_queue_patch51';
const EVENTS_TABLE = 'tennis_settlement_exception_events_patch51';

const EXCEPTION_TYPES = Object.freeze({
  WEAK_SOURCE_RECOVERY: 'WEAK_SOURCE_RECOVERY',
  BOOKMAKER_RULE_REVIEW: 'BOOKMAKER_RULE_REVIEW',
  CONTRACT_CONFLICT: 'CONTRACT_CONFLICT',
  INVALID_CONTRACT: 'INVALID_CONTRACT',
  PENDING_EVIDENCE: 'PENDING_EVIDENCE'
});

const ACTIONS = Object.freeze({
  NEW_EXCEPTION: 'NEW_EXCEPTION',
  EVIDENCE_CHANGED: 'EVIDENCE_CHANGED',
  NOOP_UNCHANGED_EVIDENCE: 'NOOP_UNCHANGED_EVIDENCE',
  RESOLVED: 'RESOLVED',
  RESOLUTION_BLOCKED: 'RESOLUTION_BLOCKED',
  NO_OPEN_EXCEPTION: 'NO_OPEN_EXCEPTION'
});

function text(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return text(value).toUpperCase(); }
function nowIso() { return new Date().toISOString(); }
function sha(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function run(db, sql, params = []) { return db.prepare(sql).run(...params); }
function get(db, sql, params = []) { return db.prepare(sql).get(...params) || null; }
function all(db, sql, params = []) { return db.prepare(sql).all(...params); }

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      bet_id INTEGER PRIMARY KEY,
      version TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('OPEN','RESOLVED')),
      exception_type TEXT NOT NULL,
      recovery_mode TEXT NOT NULL,
      manual_action_required INTEGER NOT NULL DEFAULT 0,
      contract_status TEXT,
      contract_reason TEXT,
      source TEXT,
      source_tier TEXT,
      source_event_id TEXT,
      winner_name TEXT,
      score TEXT,
      event_fingerprint TEXT,
      market_fingerprint TEXT,
      evidence_key TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_changed_at TEXT NOT NULL,
      resolved_at TEXT,
      last_operation_id TEXT,
      FOREIGN KEY(bet_id) REFERENCES ai_forward_test(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_${TABLE}_status_type ON ${TABLE}(status, exception_type);
    CREATE INDEX IF NOT EXISTS idx_${TABLE}_recovery ON ${TABLE}(status, recovery_mode);
    CREATE TABLE IF NOT EXISTS ${EVENTS_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL,
      bet_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      exception_type TEXT NOT NULL,
      evidence_key TEXT NOT NULL,
      operation_id TEXT,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      UNIQUE(bet_id, evidence_key, event_type),
      FOREIGN KEY(bet_id) REFERENCES ai_forward_test(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_${EVENTS_TABLE}_bet ON ${EVENTS_TABLE}(bet_id, id);
    CREATE TRIGGER IF NOT EXISTS trg_${EVENTS_TABLE}_no_update BEFORE UPDATE ON ${EVENTS_TABLE}
      BEGIN SELECT RAISE(ABORT, 'PATCH51_SETTLEMENT_EXCEPTION_EVENTS_APPEND_ONLY'); END;
    CREATE TRIGGER IF NOT EXISTS trg_${EVENTS_TABLE}_no_delete BEFORE DELETE ON ${EVENTS_TABLE}
      BEGIN SELECT RAISE(ABORT, 'PATCH51_SETTLEMENT_EXCEPTION_EVENTS_APPEND_ONLY'); END;
  `);
  return { success: true, version: VERSION, table: TABLE, eventsTable: EVENTS_TABLE };
}

function classifyException(contractStatus, reason) {
  const status = upper(contractStatus);
  const why = upper(reason);
  if (status === 'MANUAL_REVIEW' || why.includes('BOOKMAKER_RULE') || why.includes('RETIREMENT')) {
    return { exceptionType: EXCEPTION_TYPES.BOOKMAKER_RULE_REVIEW, recoveryMode: 'MANUAL_BOOKMAKER_RULE', manualActionRequired: true };
  }
  if (status === 'CONFLICT' || why.includes('CONFLICT')) {
    return { exceptionType: EXCEPTION_TYPES.CONTRACT_CONFLICT, recoveryMode: 'MANUAL_CONFLICT_REVIEW', manualActionRequired: true };
  }
  if (status === 'REJECTED' || why.includes('INVALID') || why.includes('MISMATCH')) {
    return { exceptionType: EXCEPTION_TYPES.INVALID_CONTRACT, recoveryMode: 'MANUAL_CONTRACT_REVIEW', manualActionRequired: true };
  }
  if (status === 'PROPOSED' || why.includes('WEAK') || why.includes('REQUIRES_REVIEW')) {
    return { exceptionType: EXCEPTION_TYPES.WEAK_SOURCE_RECOVERY, recoveryMode: 'TARGETED_OFFICIAL_RESULT', manualActionRequired: false };
  }
  return { exceptionType: EXCEPTION_TYPES.PENDING_EVIDENCE, recoveryMode: 'WAIT_FOR_CERTIFIED_EVIDENCE', manualActionRequired: false };
}

function buildCandidate({ match = {}, resolution = {}, contract = {}, operationId = null } = {}) {
  const contractStatus = upper(contract.status || match.settlement_contract_status || 'PENDING');
  const contractReason = text(contract.reason || match.settlement_contract_reason || 'PENDING_EVIDENCE');
  const source = text(resolution.source || match.settlement_source || 'UNKNOWN');
  const sourceTier = upper(contract.sourceTier || match.settlement_source_tier || 'UNKNOWN_SOURCE');
  const sourceEventId = text(contract.sourceEventId || resolution.sourceEventId || match.settlement_source_event_id || '');
  const winnerName = text(contract.winnerName || resolution.winnerName || match.settlement_winner_name || '');
  const score = text(contract.score || resolution.score || match.settlement_score || '');
  const eventFingerprint = text(contract.eventFingerprint || match.settlement_event_fingerprint || match.tennis_event_fingerprint || '');
  const marketFingerprint = text(contract.marketFingerprint || match.settlement_market_fingerprint || match.tennis_market_fingerprint || '');
  const classification = classifyException(contractStatus, contractReason);
  const material = {
    betId: Number(match.id || 0),
    exceptionType: classification.exceptionType,
    contractStatus,
    contractReason: upper(contractReason),
    source: upper(source),
    sourceTier,
    sourceEventId: upper(sourceEventId),
    winnerName: upper(winnerName),
    score: upper(score),
    eventFingerprint,
    marketFingerprint
  };
  return {
    version: VERSION,
    betId: material.betId,
    ...classification,
    contractStatus,
    contractReason,
    source,
    sourceTier,
    sourceEventId: sourceEventId || null,
    winnerName: winnerName || null,
    score: score || null,
    eventFingerprint: eventFingerprint || null,
    marketFingerprint: marketFingerprint || null,
    evidenceKey: sha(stableJson(material)),
    operationId: operationId || null
  };
}

function inspectException(db, input = {}) {
  ensureSchema(db);
  const candidate = buildCandidate(input);
  if (!(candidate.betId > 0)) throw new Error('PATCH51_EXCEPTION_BET_ID_REQUIRED');
  const current = get(db, `SELECT * FROM ${TABLE} WHERE bet_id=?`, [candidate.betId]);
  const unchanged = Boolean(current && current.status === 'OPEN' && current.evidence_key === candidate.evidenceKey);
  return {
    candidate,
    current,
    action: unchanged ? ACTIONS.NOOP_UNCHANGED_EVIDENCE : (current ? ACTIONS.EVIDENCE_CHANGED : ACTIONS.NEW_EXCEPTION),
    rowsChanged: unchanged ? 0 : 1,
    lifecycleAllowed: !unchanged,
    notificationAllowed: !unchanged
  };
}

function commitException(db, inspection, { migrated = false } = {}) {
  ensureSchema(db);
  const candidate = inspection?.candidate || inspection;
  if (!candidate || !(candidate.betId > 0)) throw new Error('PATCH51_EXCEPTION_CANDIDATE_REQUIRED');
  const current = get(db, `SELECT * FROM ${TABLE} WHERE bet_id=?`, [candidate.betId]);
  if (current && current.status === 'OPEN' && current.evidence_key === candidate.evidenceKey) {
    return { success: true, action: ACTIONS.NOOP_UNCHANGED_EVIDENCE, rowsChanged: 0, lifecycleAllowed: false, notificationAllowed: false, candidate, current };
  }
  const at = nowIso();
  const firstSeen = current?.first_seen_at || at;
  run(db, `INSERT INTO ${TABLE} (
      bet_id,version,status,exception_type,recovery_mode,manual_action_required,contract_status,contract_reason,
      source,source_tier,source_event_id,winner_name,score,event_fingerprint,market_fingerprint,evidence_key,
      first_seen_at,last_changed_at,resolved_at,last_operation_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)
    ON CONFLICT(bet_id) DO UPDATE SET
      version=excluded.version,status='OPEN',exception_type=excluded.exception_type,recovery_mode=excluded.recovery_mode,
      manual_action_required=excluded.manual_action_required,contract_status=excluded.contract_status,
      contract_reason=excluded.contract_reason,source=excluded.source,source_tier=excluded.source_tier,
      source_event_id=excluded.source_event_id,winner_name=excluded.winner_name,score=excluded.score,
      event_fingerprint=excluded.event_fingerprint,market_fingerprint=excluded.market_fingerprint,
      evidence_key=excluded.evidence_key,last_changed_at=excluded.last_changed_at,resolved_at=NULL,last_operation_id=excluded.last_operation_id`, [
      candidate.betId, VERSION, 'OPEN', candidate.exceptionType, candidate.recoveryMode, candidate.manualActionRequired ? 1 : 0,
      candidate.contractStatus, candidate.contractReason, candidate.source, candidate.sourceTier, candidate.sourceEventId,
      candidate.winnerName, candidate.score, candidate.eventFingerprint, candidate.marketFingerprint, candidate.evidenceKey,
      firstSeen, at, candidate.operationId
    ]);
  const action = current ? ACTIONS.EVIDENCE_CHANGED : ACTIONS.NEW_EXCEPTION;
  const eventType = migrated ? 'MIGRATED_OPEN' : action;
  const payload = { ...candidate, action, migrated: Boolean(migrated) };
  run(db, `INSERT OR IGNORE INTO ${EVENTS_TABLE}(version,bet_id,event_type,exception_type,evidence_key,operation_id,created_at,payload_json) VALUES(?,?,?,?,?,?,?,?)`, [
    VERSION, candidate.betId, eventType, candidate.exceptionType, candidate.evidenceKey, candidate.operationId, at, JSON.stringify(payload)
  ]);
  return { success: true, action, rowsChanged: 1, lifecycleAllowed: true, notificationAllowed: !migrated, candidate };
}

function inspectResolution(db, betId, { operationId = null, reason = 'SETTLEMENT_CERTIFIED', settlementRow = null } = {}) {
  ensureSchema(db);
  const id = Number(betId);
  const current = get(db, `SELECT * FROM ${TABLE} WHERE bet_id=? AND status='OPEN'`, [id]);
  if (!current) return { success: true, action: ACTIONS.NO_OPEN_EXCEPTION, rowsChanged: 0, current: null, resolutionGate: null };
  const row = settlementRow || get(db, `SELECT * FROM ai_forward_test WHERE id=?`, [id]);
  if (!row) {
    return {
      success: false,
      action: ACTIONS.RESOLUTION_BLOCKED,
      rowsChanged: 0,
      current,
      settlementRow: null,
      resolutionGate: {
        version: settlementResolutionEvidenceGateAudit12.VERSION,
        ready: false,
        failClosed: true,
        reason: 'SETTLEMENT_ROW_MISSING',
        reasons: ['SETTLEMENT_ROW_MISSING'],
        resolutionEvidenceHash: sha(stableJson({ betId:id, previousEvidenceKey:current.evidence_key, reason:'SETTLEMENT_ROW_MISSING' }))
      }
    };
  }
  const resolutionGate = settlementResolutionEvidenceGateAudit12.evaluateResolutionEvidence(row, current, { operationId, reason });
  return {
    success: resolutionGate.ready === true,
    action: resolutionGate.ready === true ? ACTIONS.RESOLVED : ACTIONS.RESOLUTION_BLOCKED,
    rowsChanged: 0,
    current,
    settlementRow: row,
    resolutionGate
  };
}

function recordResolutionBlocked(db, inspection, { operationId = null, reason = 'SETTLEMENT_CERTIFIED' } = {}) {
  const current = inspection?.current;
  const gate = inspection?.resolutionGate;
  if (!current || !gate) return { success:false, action:ACTIONS.RESOLUTION_BLOCKED, rowsChanged:0, resolutionGate:gate || null };
  const at = nowIso();
  const evidenceKey = gate.resolutionEvidenceHash || sha(stableJson({
    betId:Number(current.bet_id), previousEvidenceKey:current.evidence_key, reason:upper(reason), gateReason:gate.reason
  }));
  run(db, `INSERT OR IGNORE INTO ${EVENTS_TABLE}(version,bet_id,event_type,exception_type,evidence_key,operation_id,created_at,payload_json) VALUES(?,?,?,?,?,?,?,?)`, [
    VERSION, Number(current.bet_id), ACTIONS.RESOLUTION_BLOCKED, current.exception_type, evidenceKey, operationId, at,
    JSON.stringify({
      betId:Number(current.bet_id),
      reason,
      previousEvidenceKey:current.evidence_key,
      resolutionGate:gate,
      resolutionPolicyVersion:settlementResolutionEvidenceGateAudit12.POLICY_VERSION
    })
  ]);
  return { success:false, action:ACTIONS.RESOLUTION_BLOCKED, rowsChanged:0, previous:current, resolutionGate:gate };
}

function resolveException(db, betId, { operationId = null, reason = 'SETTLEMENT_CERTIFIED' } = {}) {
  ensureSchema(db);
  const inspection = inspectResolution(db, betId, { operationId, reason });
  if (inspection.action === ACTIONS.NO_OPEN_EXCEPTION) return inspection;
  if (inspection.action === ACTIONS.RESOLUTION_BLOCKED) return recordResolutionBlocked(db, inspection, { operationId, reason });

  const current = inspection.current;
  const row = inspection.settlementRow;
  const gate = inspection.resolutionGate;
  const at = nowIso();

  run(db, `UPDATE ${TABLE} SET
      version=?,status='RESOLVED',contract_status=?,contract_reason=?,source=?,source_tier=?,source_event_id=?,
      winner_name=?,score=?,event_fingerprint=?,market_fingerprint=?,evidence_key=?,
      resolved_at=?,last_changed_at=?,last_operation_id=?
      WHERE bet_id=? AND status='OPEN'`, [
      VERSION,
      row.settlement_contract_status || null,
      row.settlement_contract_reason || null,
      row.settlement_source || null,
      row.settlement_source_tier || null,
      row.settlement_source_event_id || null,
      row.settlement_winner_name || null,
      row.settlement_score || null,
      row.settlement_event_fingerprint || row.tennis_event_fingerprint || null,
      row.settlement_market_fingerprint || row.tennis_market_fingerprint || null,
      gate.resolutionEvidenceHash,
      at, at, operationId, Number(betId)
    ]);

  const payload = {
    betId:Number(betId),
    reason,
    previousEvidenceKey:current.evidence_key,
    resolutionEvidenceHash:gate.resolutionEvidenceHash,
    resolutionGate:gate,
    resolutionPolicyVersion:settlementResolutionEvidenceGateAudit12.POLICY_VERSION
  };
  run(db, `INSERT OR IGNORE INTO ${EVENTS_TABLE}(version,bet_id,event_type,exception_type,evidence_key,operation_id,created_at,payload_json) VALUES(?,?,?,?,?,?,?,?)`, [
    VERSION, Number(betId), ACTIONS.RESOLVED, current.exception_type, gate.resolutionEvidenceHash, operationId, at, JSON.stringify(payload)
  ]);
  return { success:true, action:ACTIONS.RESOLVED, rowsChanged:1, previous:current, resolutionGate:gate };
}

function seedCurrentExceptions(db, { operationId = 'PATCH51_INSTALL_MIGRATION' } = {}) {
  ensureSchema(db);
  const rows = all(db, `SELECT * FROM ai_forward_test WHERE UPPER(COALESCE(status,''))='PENDING' AND UPPER(COALESCE(sport_type,''))='TENNIS' AND UPPER(COALESCE(settlement_contract_status,'')) IN ('PROPOSED','MANUAL_REVIEW','CONFLICT','REJECTED') ORDER BY id`);
  const result = { success: true, version: VERSION, scanned: rows.length, inserted: 0, changed: 0, unchanged: 0, ids: [] };
  for (const match of rows) {
    const inspection = inspectException(db, { match, resolution: {}, contract: { status: match.settlement_contract_status, reason: match.settlement_contract_reason, sourceTier: match.settlement_source_tier }, operationId });
    const committed = commitException(db, inspection, { migrated: true });
    if (committed.action === ACTIONS.NEW_EXCEPTION) result.inserted++;
    else if (committed.action === ACTIONS.EVIDENCE_CHANGED) result.changed++;
    else result.unchanged++;
    if (committed.rowsChanged) result.ids.push(Number(match.id));
  }
  return result;
}

function getSummary(db) {
  ensureSchema(db);
  const rows = all(db, `SELECT status,exception_type,recovery_mode,manual_action_required,COUNT(*) count FROM ${TABLE} GROUP BY status,exception_type,recovery_mode,manual_action_required ORDER BY status,exception_type`);
  const blockedAttempts = Number(get(db, `SELECT COUNT(*) c FROM ${EVENTS_TABLE} WHERE event_type=?`, [ACTIONS.RESOLUTION_BLOCKED])?.c || 0);
  const summary = { version: VERSION, resolutionPolicyVersion: settlementResolutionEvidenceGateAudit12.POLICY_VERSION, open: 0, resolved: 0, weakSourceRecovery: 0, bookmakerRuleReview: 0, manualActionRequired: 0, automatedRecoveryEligible: 0, resolutionBlockedAttempts: blockedAttempts, byType: {}, rows };
  for (const row of rows) {
    const count = Number(row.count || 0);
    if (row.status === 'OPEN') summary.open += count; else summary.resolved += count;
    summary.byType[row.exception_type] = (summary.byType[row.exception_type] || 0) + count;
    if (row.status === 'OPEN' && row.exception_type === EXCEPTION_TYPES.WEAK_SOURCE_RECOVERY) summary.weakSourceRecovery += count;
    if (row.status === 'OPEN' && row.exception_type === EXCEPTION_TYPES.BOOKMAKER_RULE_REVIEW) summary.bookmakerRuleReview += count;
    if (row.status === 'OPEN' && Number(row.manual_action_required) === 1) summary.manualActionRequired += count;
    if (row.status === 'OPEN' && row.recovery_mode === 'TARGETED_OFFICIAL_RESULT') summary.automatedRecoveryEligible += count;
  }
  return summary;
}

function buildTargetedRecoveryPlan(db, { limit = 25 } = {}) {
  ensureSchema(db);
  const candidates = all(db, `SELECT q.bet_id,q.exception_type,q.recovery_mode,q.evidence_key,a.home_team,a.away_team,a.match_date,a.league
    FROM ${TABLE} q JOIN ai_forward_test a ON a.id=q.bet_id
    WHERE q.status='OPEN' AND q.recovery_mode='TARGETED_OFFICIAL_RESULT' AND q.manual_action_required=0
    ORDER BY a.match_date ASC,q.bet_id ASC LIMIT ?`, [Math.max(1, Number(limit) || 25)]);
  return {
    version: RECOVERY_VERSION,
    resolutionPolicyVersion: settlementResolutionEvidenceGateAudit12.POLICY_VERSION,
    requiresOfficialCertifiedEvidence: true,
    candidates,
    candidateIds: candidates.map(r => Number(r.bet_id)),
    manualExcluded: getSummary(db).manualActionRequired
  };
}

module.exports = {
  VERSION, RECOVERY_VERSION, TABLE, EVENTS_TABLE, EXCEPTION_TYPES, ACTIONS,
  ensureSchema, classifyException, buildCandidate, inspectException, commitException,
  inspectResolution, recordResolutionBlocked, resolveException, seedCurrentExceptions, getSummary, buildTargetedRecoveryPlan
};
