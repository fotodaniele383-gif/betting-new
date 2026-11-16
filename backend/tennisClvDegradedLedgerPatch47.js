'use strict';

const crypto = require('crypto');

const TENNIS_CLV_DEGRADED_LEDGER_VERSION = 'TENNIS_CLV_DEGRADED_LEDGER_V1_PATCH47';
const POST_MATCH_RECOVERY_HOURS = 168;
const STATES = Object.freeze({
  MISSING: 'MISSING',
  RETRY_ELIGIBLE: 'RETRY_ELIGIBLE',
  AVAILABLE_UNVERIFIED: 'AVAILABLE_UNVERIFIED',
  VERIFIED: 'VERIFIED',
  IRRECOVERABLE_TEMPORAL: 'IRRECOVERABLE_TEMPORAL',
  IRRECOVERABLE_MARKET: 'IRRECOVERABLE_MARKET',
  MAX_ATTEMPTS_EXHAUSTED: 'MAX_ATTEMPTS_EXHAUSTED',
  MANUAL_REVIEW: 'MANUAL_REVIEW'
});
const TERMINAL_STATES = Object.freeze([
  STATES.VERIFIED,
  STATES.IRRECOVERABLE_TEMPORAL,
  STATES.IRRECOVERABLE_MARKET,
  STATES.MAX_ATTEMPTS_EXHAUSTED,
  STATES.MANUAL_REVIEW
]);
const TEMPORAL_REASONS = Object.freeze([
  'CLOSING_NOT_AFTER_OPENING',
  'CLOSING_AFTER_MATCH_START'
]);
const MARKET_REASONS = Object.freeze([
  'TOTALS_LINE_MISMATCH',
  'MISSING_SELECTION_SIDE',
  'MISSING_EVENT_FINGERPRINT',
  'MISSING_MARKET_FINGERPRINT',
  'MISSING_BOOKMAKER',
  'MISSING_SOURCE_EVENT_ID',
  'CLV_VAULT_NO_CLOSING_ODD_FOR_PICK',
  'CLV_VAULT_NO_SNAPSHOT'
]);
const SEMANTIC_COLUMNS = Object.freeze([
  'clv_degraded_ledger_version',
  'clv_degraded_state',
  'clv_evidence_key',
  'clv_evidence_first_seen_at',
  'clv_evidence_last_changed_at',
  'clv_evidence_seen_count',
  'clv_terminal_reason',
  'clv_terminal_at',
  'clv_retry_eligible'
]);

function text(v) { return String(v == null ? '' : v).trim(); }
function upper(v) { return text(v).toUpperCase(); }
function number(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function round(v, p = 4) { const n = number(v); return n == null ? null : Number(n.toFixed(p)); }
function parseTimestamp(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  const numeric = Number(v);
  if (Number.isFinite(numeric) && text(v)) return numeric < 1e12 ? numeric * 1000 : numeric;
  const raw = text(v);
  if (/^\d{2}\/\d{2}\/\d{4}/.test(raw)) {
    const [datePart, timePart = '00:00:00'] = raw.split(',').map(s => s.trim());
    const [day, month, year] = datePart.split('/').map(Number);
    const [hour = 0, minute = 0, second = 0] = timePart.split(':').map(Number);
    const d = new Date(year, month - 1, day, hour, minute, second);
    return Number.isFinite(d.getTime()) ? d.getTime() : null;
  }
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
}
function isTennisRow(row = {}) {
  return upper(row.sport_type) === 'TENNIS' || upper(row.bet_type).includes('TENNIS') || upper(row.strategy_tag).includes('TENNIS');
}
function isTerminalState(state) { return TERMINAL_STATES.includes(upper(state)); }
function normalizeBookmaker(v) {
  return [...new Set(text(v).split('|').map(s => s.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)).join('|');
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex'); }
function splitReasons(v) { return upper(v).split('|').map(s => s.trim()).filter(Boolean); }
function hasAny(reasons, values) { return values.some(v => reasons.includes(v) || reasons.some(r => r.includes(v))); }
function getMatchPhase(row = {}, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : parseTimestamp(now) || Date.now();
  const matchTs = parseTimestamp(row.canonical_match_datetime || row.match_date || row.commence_time);
  if (matchTs == null) return { valid: false, matchTs: null, nowMs, started: false, expired: false, withinRecovery: false };
  const started = nowMs >= matchTs;
  const recoveryEnd = matchTs + POST_MATCH_RECOVERY_HOURS * 3600000;
  return { valid: true, matchTs, nowMs, started, expired: nowMs > recoveryEnd, withinRecovery: nowMs <= recoveryEnd };
}
function evidencePayload(row = {}, candidate = {}) {
  const merged = { ...row, ...candidate };
  return {
    betId: Number(merged.id || merged.bet_id || 0),
    source: upper(merged.clv_source || merged.source || 'MISSING'),
    openingOdd: round(merged.opening_odd ?? merged.odd, 4),
    closingOdd: round(merged.closing_odd ?? merged.clv, 4),
    openingTs: parseTimestamp(merged.clv_opening_ts ?? merged.opening_ts),
    closingTs: parseTimestamp(merged.clv_closing_ts ?? merged.closing_ts ?? merged.acquired_at),
    bookmaker: normalizeBookmaker(merged.clv_bookmaker ?? merged.bookmaker),
    sourceEventId: text(merged.clv_source_event_id ?? merged.source_event_id ?? merged.provider_event_id),
    eventFingerprint: text(merged.clv_event_fingerprint ?? merged.tennis_event_fingerprint ?? merged.event_fingerprint),
    marketFingerprint: text(merged.clv_market_fingerprint ?? merged.tennis_market_fingerprint ?? merged.market_fingerprint),
    side: upper(merged.closing_odd_side ?? merged.prediction),
    pointLine: round(merged.clv_point_line ?? merged.point_line, 3),
    contractStatus: upper(merged.clv_contract_status || 'MISSING'),
    contractReason: upper(merged.clv_contract_reason || merged.clv_pending_reason || merged.clv_last_attempt_result || 'MISSING')
  };
}
function buildEvidenceKey(row = {}, candidate = {}) {
  return `PATCH47_EVIDENCE_${sha256(evidencePayload(row, candidate)).slice(0, 40)}`;
}
function classifyClvState(row = {}, candidate = {}, now = new Date()) {
  const merged = { ...row, ...candidate };
  const phase = getMatchPhase(merged, now);
  const closingOdd = number(merged.closing_odd ?? merged.clv);
  const verifiedSignal = Number(merged.clv_verified) === 1 || upper(merged.clv_contract_status) === 'VERIFIED';
  const closingTs = parseTimestamp(merged.clv_closing_ts ?? merged.closing_ts ?? merged.acquired_at);
  const openingTs = parseTimestamp(merged.clv_opening_ts ?? merged.opening_ts ?? merged.created_at);
  const reasons = splitReasons(merged.clv_contract_reason || merged.clv_pending_reason || merged.clv_last_attempt_result);
  const maxAttempts = upper(merged.clv_last_attempt_result).includes('MAX_ATTEMPTS') || upper(merged.clv_pending_reason).includes('MAX_ATTEMPTS');
  const contractStatus = upper(merged.clv_contract_status);
  const source = upper(merged.clv_source);

  // AUDIT16D_R3_T6_CLV_TEMPORAL_SCOPE_SEPARATION_V1
  // Il flag VERIFIED non è sufficiente senza un timestamp closing temporalmente
  // verificabile. I record legacy restano auditabili ma non possono diventare
  // CLV certificato per il forward.
  const verifiedTemporalIssues = [];
  if (verifiedSignal) {
    if (closingTs == null) verifiedTemporalIssues.push('MISSING_CLOSING_TIMESTAMP');
    if (closingTs != null && openingTs != null && closingTs <= openingTs) verifiedTemporalIssues.push('CLOSING_NOT_AFTER_OPENING');
    if (closingTs != null && phase.matchTs != null && closingTs > phase.matchTs) verifiedTemporalIssues.push('CLOSING_AFTER_MATCH_START');
  }
  if (verifiedSignal && verifiedTemporalIssues.length === 0) {
    return { state: STATES.VERIFIED, retryEligible: 0, terminal: true, reason: 'CLV_CONTRACT_VERIFIED', phase };
  }
  if (verifiedSignal && verifiedTemporalIssues.length > 0) {
    const missingOnly = verifiedTemporalIssues.length === 1 && verifiedTemporalIssues[0] === 'MISSING_CLOSING_TIMESTAMP';
    if (!phase.started && missingOnly) {
      return { state: STATES.AVAILABLE_UNVERIFIED, retryEligible: 1, terminal: false, reason: 'CLV_VERIFIED_FLAG_WITHOUT_CLOSING_TIMESTAMP_PREMATCH', phase };
    }
    return {
      state: STATES.IRRECOVERABLE_TEMPORAL,
      retryEligible: 0,
      terminal: true,
      reason: `CLV_VERIFIED_FLAG_TEMPORALLY_UNVERIFIED:${verifiedTemporalIssues.join('|')}`,
      phase
    };
  }
  if (maxAttempts) return { state: STATES.MAX_ATTEMPTS_EXHAUSTED, retryEligible: 0, terminal: true, reason: 'CLV_MAX_ATTEMPTS_PER_MATCH_REACHED', phase };
  if (!phase.valid) return { state: STATES.MANUAL_REVIEW, retryEligible: 0, terminal: true, reason: 'CLV_MATCH_TIME_UNRESOLVED', phase };

  const temporalConflict = hasAny(reasons, TEMPORAL_REASONS);
  const marketConflict = hasAny(reasons, MARKET_REASONS);
  const hasClosing = closingOdd != null && closingOdd > 1;

  if (temporalConflict && phase.started) {
    return { state: STATES.IRRECOVERABLE_TEMPORAL, retryEligible: 0, terminal: true, reason: reasons.filter(r => TEMPORAL_REASONS.some(v => r.includes(v))).join('|') || 'CLV_TEMPORAL_CONTRACT_FAILURE', phase };
  }
  if (hasClosing && (source === 'STALE_VAULT_SNAPSHOT' || source === 'POST_MATCH_VAULT') && phase.expired) {
    return { state: STATES.IRRECOVERABLE_TEMPORAL, retryEligible: 0, terminal: true, reason: 'CLV_HISTORICAL_EVIDENCE_OUTSIDE_RECOVERY_WINDOW', phase };
  }
  if (marketConflict && phase.expired) {
    return { state: STATES.IRRECOVERABLE_MARKET, retryEligible: 0, terminal: true, reason: reasons.filter(r => MARKET_REASONS.some(v => r.includes(v))).join('|') || 'CLV_MARKET_EVIDENCE_UNRECOVERABLE', phase };
  }
  if (!hasClosing && phase.expired) {
    return { state: STATES.IRRECOVERABLE_MARKET, retryEligible: 0, terminal: true, reason: 'CLV_NO_CLOSING_EVIDENCE_AFTER_RECOVERY_WINDOW', phase };
  }
  if (contractStatus === 'CONFLICT') {
    return { state: STATES.MANUAL_REVIEW, retryEligible: 0, terminal: true, reason: 'CLV_CONTRACT_CONFLICT', phase };
  }
  if (hasClosing) {
    return { state: STATES.AVAILABLE_UNVERIFIED, retryEligible: phase.withinRecovery ? 1 : 0, terminal: false, reason: reasons.join('|') || 'CLV_AVAILABLE_UNVERIFIED', phase };
  }
  return { state: STATES.RETRY_ELIGIBLE, retryEligible: 1, terminal: false, reason: reasons.join('|') || 'CLV_EVIDENCE_MISSING_RETRY_ALLOWED', phase };
}
function buildSemanticFields(row = {}, candidate = {}, now = new Date()) {
  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();
  const classification = classifyClvState(row, candidate, now);
  const key = buildEvidenceKey(row, candidate);
  const existingKey = text(row.clv_evidence_key);
  const existingState = upper(row.clv_degraded_state);
  const unchanged = existingKey === key && existingState === classification.state;
  return {
    classification,
    evidenceKey: key,
    unchanged,
    fields: {
      clv_degraded_ledger_version: TENNIS_CLV_DEGRADED_LEDGER_VERSION,
      clv_degraded_state: classification.state,
      clv_evidence_key: key,
      clv_evidence_first_seen_at: row.clv_evidence_first_seen_at || nowIso,
      clv_evidence_last_changed_at: unchanged ? (row.clv_evidence_last_changed_at || nowIso) : nowIso,
      clv_evidence_seen_count: unchanged ? Math.max(1, Number(row.clv_evidence_seen_count) || 1) : (existingKey ? Math.max(1, Number(row.clv_evidence_seen_count) || 0) + 1 : 1),
      clv_terminal_reason: classification.terminal ? classification.reason : null,
      clv_terminal_at: classification.terminal ? (row.clv_terminal_at || nowIso) : null,
      clv_retry_eligible: classification.retryEligible
    }
  };
}
function columnExists(db, table, column) { try { return db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === column); } catch (_) { return false; } }
function addColumn(db, definition) {
  const name = definition.split(/\s+/)[0];
  if (!columnExists(db, 'ai_forward_test', name)) db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${definition}`);
}
function createSchema(db) {
  addColumn(db, 'clv_degraded_ledger_version TEXT');
  addColumn(db, 'clv_degraded_state TEXT');
  addColumn(db, 'clv_evidence_key TEXT');
  addColumn(db, 'clv_evidence_first_seen_at TEXT');
  addColumn(db, 'clv_evidence_last_changed_at TEXT');
  addColumn(db, 'clv_evidence_seen_count INTEGER DEFAULT 0');
  addColumn(db, 'clv_terminal_reason TEXT');
  addColumn(db, 'clv_terminal_at TEXT');
  addColumn(db, 'clv_retry_eligible INTEGER DEFAULT 1');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tennis_clv_degraded_ledger_patch47 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bet_id INTEGER NOT NULL,
      evidence_key TEXT NOT NULL,
      ledger_version TEXT NOT NULL,
      degraded_state TEXT NOT NULL,
      retry_eligible INTEGER NOT NULL DEFAULT 0,
      terminal_reason TEXT,
      clv_source TEXT,
      contract_status TEXT,
      contract_reason TEXT,
      opening_odd REAL,
      closing_odd REAL,
      opening_ts INTEGER,
      closing_ts INTEGER,
      bookmaker TEXT,
      source_event_id TEXT,
      event_fingerprint TEXT,
      market_fingerprint TEXT,
      closing_side TEXT,
      point_line REAL,
      captured_at TEXT NOT NULL,
      UNIQUE(bet_id, evidence_key, degraded_state)
    );
    CREATE INDEX IF NOT EXISTS idx_tennis_clv_degraded_patch47_state ON tennis_clv_degraded_ledger_patch47(degraded_state, retry_eligible);
    CREATE INDEX IF NOT EXISTS idx_tennis_clv_degraded_patch47_bet ON tennis_clv_degraded_ledger_patch47(bet_id, id);
    CREATE TRIGGER IF NOT EXISTS trg_tennis_clv_degraded_patch47_no_update
      BEFORE UPDATE ON tennis_clv_degraded_ledger_patch47 BEGIN SELECT RAISE(ABORT, 'PATCH47_LEDGER_APPEND_ONLY_NO_UPDATE'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_clv_degraded_patch47_no_delete
      BEFORE DELETE ON tennis_clv_degraded_ledger_patch47 BEGIN SELECT RAISE(ABORT, 'PATCH47_LEDGER_APPEND_ONLY_NO_DELETE'); END;
  `);
  return { version: TENNIS_CLV_DEGRADED_LEDGER_VERSION, semanticColumns: [...SEMANTIC_COLUMNS], table: 'tennis_clv_degraded_ledger_patch47' };
}
function appendLedger(db, row = {}, candidate = {}, semantic = null, now = new Date()) {
  const decision = semantic || buildSemanticFields(row, candidate, now);
  if (decision.unchanged) {
    try {
      const existing = db.prepare(`SELECT 1 ok FROM tennis_clv_degraded_ledger_patch47 WHERE bet_id=? AND evidence_key=? AND degraded_state=? LIMIT 1`).get(
        Number(row.id || row.bet_id), decision.evidenceKey, decision.classification.state
      );
      if (existing) return { inserted: false, unchanged: true, evidenceKey: decision.evidenceKey, state: decision.classification.state };
    } catch (_) {
      // I mock legacy possono non esporre la tabella. L'INSERT sottostante conserva
      // la compatibilità già gestita dal catch della funzione.
    }
  }
  const payload = evidencePayload(row, candidate);
  try {
    const info = db.prepare(`
      INSERT OR IGNORE INTO tennis_clv_degraded_ledger_patch47 (
        bet_id,evidence_key,ledger_version,degraded_state,retry_eligible,terminal_reason,
        clv_source,contract_status,contract_reason,opening_odd,closing_odd,opening_ts,closing_ts,
        bookmaker,source_event_id,event_fingerprint,market_fingerprint,closing_side,point_line,captured_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      Number(row.id || row.bet_id), decision.evidenceKey, TENNIS_CLV_DEGRADED_LEDGER_VERSION,
      decision.classification.state, decision.classification.retryEligible, decision.classification.terminal ? decision.classification.reason : null,
      payload.source, payload.contractStatus, payload.contractReason, payload.openingOdd, payload.closingOdd,
      payload.openingTs, payload.closingTs, payload.bookmaker || null, payload.sourceEventId || null,
      payload.eventFingerprint || null, payload.marketFingerprint || null, payload.side || null, payload.pointLine,
      (now instanceof Date ? now : new Date(now)).toISOString()
    );
    return { inserted: Number(info.changes || 0) > 0, unchanged: Number(info.changes || 0) === 0, evidenceKey: decision.evidenceKey, state: decision.classification.state };
  } catch (error) {
    // I mock legacy Patch 45 non implementano sqlite_master/ledger. In produzione
    // createSchema viene eseguito prima del tracker e l'assenza della tabella resta
    // visibile negli audit Patch 47.
    if (/UNEXPECTED_SQL|no such table|does not exist/i.test(String(error.message || error))) {
      return { inserted: false, unchanged: false, skipped: true, evidenceKey: decision.evidenceKey, state: decision.classification.state, error: error.message };
    }
    throw error;
  }
}

function tableColumns(db, table = 'ai_forward_test') {
  try { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name)); }
  catch (_) { return new Set(); }
}
function buildOperationalWhere(db, alias = '') {
  const columns = tableColumns(db, 'ai_forward_test');
  const prefix = alias ? `${alias}.` : '';
  const tennis = [];
  if (columns.has('sport_type')) tennis.push(`UPPER(COALESCE(${prefix}sport_type,''))='TENNIS'`);
  if (columns.has('bet_type')) tennis.push(`UPPER(COALESCE(${prefix}bet_type,'')) LIKE '%TENNIS%'`);
  if (columns.has('strategy_tag')) tennis.push(`UPPER(COALESCE(${prefix}strategy_tag,'')) LIKE '%TENNIS%'`);
  if (!columns.has('id') || !columns.has('status') || tennis.length === 0) return null;
  const multiGuard = columns.has('bet_type') ? ` AND UPPER(COALESCE(${prefix}bet_type,'')) NOT LIKE 'MULTI%'` : '';
  return `(${tennis.join(' OR ')}) AND UPPER(COALESCE(${prefix}status,'')) IN ('PENDING','WON','LOST')${multiGuard}`;
}
function getOperationalCoverage(db) {
  createSchema(db);
  const where = buildOperationalWhere(db, 'a');
  if (!where) return {
    success: true, skipped: true, reason: 'AI_FORWARD_TEST_SCHEMA_INCOMPLETE',
    operationalRows: 0, semanticCovered: 0, fullyCovered: 0, invalidStates: 0, missingLedgerLinks: 0
  };
  const states = Object.values(STATES);
  const statePlaceholders = states.map(() => '?').join(',');
  const operationalRows = Number(db.prepare(`SELECT COUNT(*) count FROM ai_forward_test a WHERE ${where}`).get().count || 0);
  const semanticCovered = Number(db.prepare(`SELECT COUNT(*) count FROM ai_forward_test a WHERE ${where}
    AND COALESCE(a.clv_degraded_ledger_version,'')=?
    AND UPPER(COALESCE(a.clv_degraded_state,'')) IN (${statePlaceholders})
    AND COALESCE(a.clv_evidence_key,'')<>''`).get(TENNIS_CLV_DEGRADED_LEDGER_VERSION, ...states).count || 0);
  const invalidStates = Number(db.prepare(`SELECT COUNT(*) count FROM ai_forward_test a WHERE ${where}
    AND UPPER(COALESCE(a.clv_degraded_state,'')) NOT IN (${statePlaceholders})`).get(...states).count || 0);
  const missingLedgerLinks = Number(db.prepare(`SELECT COUNT(*) count FROM ai_forward_test a WHERE ${where}
    AND COALESCE(a.clv_degraded_ledger_version,'')=?
    AND UPPER(COALESCE(a.clv_degraded_state,'')) IN (${statePlaceholders})
    AND COALESCE(a.clv_evidence_key,'')<>''
    AND NOT EXISTS (
      SELECT 1 FROM tennis_clv_degraded_ledger_patch47 l
      WHERE l.bet_id=a.id AND l.evidence_key=a.clv_evidence_key
        AND UPPER(l.degraded_state)=UPPER(a.clv_degraded_state)
    )`).get(TENNIS_CLV_DEGRADED_LEDGER_VERSION, ...states).count || 0);
  const fullyCovered = semanticCovered - missingLedgerLinks;
  return {
    success: fullyCovered === operationalRows && invalidStates === 0 && missingLedgerLinks === 0,
    skipped: false,
    operationalRows,
    semanticCovered,
    fullyCovered,
    invalidStates,
    missingLedgerLinks,
    coverageGap: Math.max(0, operationalRows - fullyCovered)
  };
}
function withTransaction(db, fn) {
  if (typeof db.transaction === 'function') return db.transaction(fn)();
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function reconcileOperationalCoverage(db, options = {}) {
  createSchema(db);
  const strict = options.strict === true;
  const source = text(options.source) || 'PATCH48_R5_CONTINUOUS_LEDGER_ONBOARDING';
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const where = buildOperationalWhere(db, 'a');
  const before = getOperationalCoverage(db);
  if (!where || before.skipped) {
    const result = { success: !strict, skipped: true, source, before, after: before, repaired: 0, ledgerInserted: 0, ledgerReused: 0, repairedBetIds: [], failures: strict ? ['AI_FORWARD_TEST_SCHEMA_INCOMPLETE'] : [] };
    return result;
  }
  const states = Object.values(STATES);
  const statePlaceholders = states.map(() => '?').join(',');
  const candidates = db.prepare(`SELECT a.* FROM ai_forward_test a WHERE ${where} AND (
      COALESCE(a.clv_degraded_ledger_version,'')<>?
      OR UPPER(COALESCE(a.clv_degraded_state,'')) NOT IN (${statePlaceholders})
      OR COALESCE(a.clv_evidence_key,'')=''
      OR NOT EXISTS (
        SELECT 1 FROM tennis_clv_degraded_ledger_patch47 l
        WHERE l.bet_id=a.id AND l.evidence_key=a.clv_evidence_key
          AND UPPER(l.degraded_state)=UPPER(a.clv_degraded_state)
      )
      OR (
        UPPER(COALESCE(a.clv_contract_status,''))='VERIFIED'
        AND (a.clv_closing_ts IS NULL OR TRIM(CAST(a.clv_closing_ts AS TEXT))='')
        AND UPPER(COALESCE(a.clv_degraded_state,''))='VERIFIED'
      )
    ) ORDER BY a.id`).all(TENNIS_CLV_DEGRADED_LEDGER_VERSION, ...states);
  let repaired = 0;
  let ledgerInserted = 0;
  let ledgerReused = 0;
  const repairedBetIds = [];
  const errors = [];
  const update = db.prepare(`UPDATE ai_forward_test SET
    clv_degraded_ledger_version=?, clv_degraded_state=?, clv_evidence_key=?,
    clv_evidence_first_seen_at=?, clv_evidence_last_changed_at=?, clv_evidence_seen_count=?,
    clv_terminal_reason=?, clv_terminal_at=?, clv_retry_eligible=? WHERE id=?`);
  withTransaction(db, () => {
    for (const row of candidates) {
      try {
        const semantic = buildSemanticFields(row, {}, now);
        const fields = semantic.fields;
        const semanticInvalid = text(row.clv_degraded_ledger_version) !== TENNIS_CLV_DEGRADED_LEDGER_VERSION
          || !states.includes(upper(row.clv_degraded_state))
          || !text(row.clv_evidence_key)
          || upper(row.clv_degraded_state) !== upper(semantic.classification.state)
          || text(row.clv_evidence_key) !== text(semantic.evidenceKey);
        if (semanticInvalid) {
          update.run(
            fields.clv_degraded_ledger_version, fields.clv_degraded_state, fields.clv_evidence_key,
            fields.clv_evidence_first_seen_at, fields.clv_evidence_last_changed_at, fields.clv_evidence_seen_count,
            fields.clv_terminal_reason, fields.clv_terminal_at, fields.clv_retry_eligible, Number(row.id)
          );
          repaired += 1;
          repairedBetIds.push(Number(row.id));
        }
        const fresh = { ...row, ...fields };
        const entry = appendLedger(db, fresh, {}, { ...semantic, unchanged: semanticInvalid ? false : semantic.unchanged }, now);
        if (entry.inserted) ledgerInserted += 1;
        else ledgerReused += 1;
      } catch (error) {
        errors.push({ betId: Number(row.id), error: error.message });
      }
    }
  });
  const after = getOperationalCoverage(db);
  const failures = [];
  if (errors.length) failures.push('ROW_RECONCILE_ERRORS');
  if (!after.skipped && after.fullyCovered !== after.operationalRows) failures.push('OPERATIONAL_COVERAGE_GAP_REMAINS');
  if (after.invalidStates > 0) failures.push('INVALID_STATES_REMAIN');
  if (after.missingLedgerLinks > 0) failures.push('MISSING_LEDGER_LINKS_REMAIN');
  return {
    success: failures.length === 0,
    skipped: false,
    source,
    before,
    candidates: candidates.length,
    repaired,
    ledgerInserted,
    ledgerReused,
    repairedBetIds,
    errors,
    after,
    failures
  };
}

function getLedgerSummary(db) {
  createSchema(db);
  const where = buildOperationalWhere(db, 'a');
  const coverage = getOperationalCoverage(db);
  if (!where) return {
    version: TENNIS_CLV_DEGRADED_LEDGER_VERSION,
    operationalRows: 0, ledgerRows: 0, retryEligible: 0, terminal: 0,
    byState: {}, derivedMetrics: { missingClosingOdd: 0 }, mutuallyExclusiveStateTotal: 0,
    coverage
  };
  const byStateRows = db.prepare(`SELECT COALESCE(a.clv_degraded_state,'MISSING') state, COUNT(*) count FROM ai_forward_test a WHERE ${where} GROUP BY COALESCE(a.clv_degraded_state,'MISSING') ORDER BY count DESC`).all();
  const byState = Object.fromEntries(byStateRows.map(r => [r.state, Number(r.count)]));
  const operationalRows = Number(coverage.operationalRows || 0);
  const ledgerRows = Number(db.prepare('SELECT COUNT(*) count FROM tennis_clv_degraded_ledger_patch47').get().count || 0);
  const retryEligible = Number(db.prepare(`SELECT COUNT(*) count FROM ai_forward_test a WHERE ${where} AND COALESCE(a.clv_retry_eligible,0)=1`).get().count || 0);
  const terminal = Number(db.prepare(`SELECT COUNT(*) count FROM ai_forward_test a WHERE ${where} AND UPPER(COALESCE(a.clv_degraded_state,'')) IN (${TERMINAL_STATES.map(() => '?').join(',')})`).get(...TERMINAL_STATES).count || 0);
  const columns = tableColumns(db, 'ai_forward_test');
  const missingClosingOdd = columns.has('closing_odd') ? Number(db.prepare(`SELECT COUNT(*) count FROM ai_forward_test a WHERE ${where} AND a.closing_odd IS NULL`).get().count || 0) : 0;
  return { version: TENNIS_CLV_DEGRADED_LEDGER_VERSION, operationalRows, ledgerRows, retryEligible, terminal, byState, derivedMetrics: { missingClosingOdd }, mutuallyExclusiveStateTotal: operationalRows, coverage };
}

module.exports = {
  TENNIS_CLV_DEGRADED_LEDGER_VERSION,
  STATES,
  TERMINAL_STATES,
  SEMANTIC_COLUMNS,
  POST_MATCH_RECOVERY_HOURS,
  isTennisRow,
  isTerminalState,
  parseTimestamp,
  getMatchPhase,
  evidencePayload,
  buildEvidenceKey,
  classifyClvState,
  buildSemanticFields,
  createSchema,
  appendLedger,
  buildOperationalWhere,
  getOperationalCoverage,
  reconcileOperationalCoverage,
  getLedgerSummary
};
