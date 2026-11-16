'use strict';

const crypto = require('crypto');
const path = require('path');
const readinessGate = require('./statisticalProductionReadinessGatePatch55');

const VERSION = 'UNIFIED_CROSS_SPORT_PORTFOLIO_RISK_AUTHORITY_V1_PATCH56';
const POLICY_VERSION = 'UNIFIED_CROSS_SPORT_PORTFOLIO_RISK_POLICY_V1_PATCH56';
const MODE = 'REAL_MONEY_FAIL_CLOSED_SHADOW_PAPER_PRESERVED';
const DECISION_TABLE = 'cross_sport_portfolio_risk_decisions_patch56';
const MINIMUM_REAL_EXECUTABLE_STAKE_EUR = 2;
const CACHE_TTL_MS = 60 * 1000;

const LIMITS = Object.freeze({
  totalExposurePct: 5,
  sportExposurePct: 3,
  eventExposurePct: 1,
  singleBetExposurePct: 1,
  maxRealSingleBetEur: 10,
  minimumRealExecutableStakeEur: MINIMUM_REAL_EXECUTABLE_STAKE_EUR
});

let readinessCache = null;

function text(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return text(value).toUpperCase(); }
function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function round(value, digits = 2) { const m = 10 ** digits; return Math.round((finite(value, 0) + Number.EPSILON) * m) / m; }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex'); }
function normalizeSport(value) {
  const s = upper(value);
  if (s.includes('TENNIS') || s.includes('ATP') || s.includes('WTA')) return 'TENNIS';
  if (s.includes('CALCIO') || s.includes('SOCCER') || s.includes('FOOTBALL')) return 'CALCIO';
  return 'UNKNOWN';
}
function eventKey(input = {}) {
  return text(input.eventKey || input.matchExposureKey || input.match_exposure_key || input.calcio_event_key)
    || [text(input.home || input.home_team), text(input.away || input.away_team), text(input.matchDate || input.match_date || input.date)].join('|');
}
function tableExists(db, name) {
  try { return Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name)); } catch (_) { return false; }
}
function columnNames(db, table = 'ai_forward_test') {
  try { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name)); } catch (_) { return new Set(); }
}
function ensureColumn(db, name, definition) {
  const cols = columnNames(db);
  if (!cols.has(name)) db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${name} ${definition}`);
}
function ensureSchema(db) {
  if (!db || typeof db.prepare !== 'function') throw new Error('PATCH56_DB_ADAPTER_REQUIRED');
  const before = columnNames(db);
  const defs = [
    ['cross_sport_portfolio_risk_version', 'TEXT'],
    ['cross_sport_portfolio_risk_policy_version', 'TEXT'],
    ['cross_sport_portfolio_risk_status', 'TEXT'],
    ['cross_sport_portfolio_readiness_status', 'TEXT'],
    ['cross_sport_portfolio_candidate_stake', 'REAL'],
    ['cross_sport_portfolio_shadow_capped_stake', 'REAL'],
    ['cross_sport_portfolio_real_executable_stake', 'REAL DEFAULT 0'],
    ['cross_sport_portfolio_total_exposure_before', 'REAL DEFAULT 0'],
    ['cross_sport_portfolio_sport_exposure_before', 'REAL DEFAULT 0'],
    ['cross_sport_portfolio_event_exposure_before', 'REAL DEFAULT 0'],
    ['cross_sport_portfolio_bankroll_snapshot', 'REAL'],
    ['cross_sport_portfolio_evidence_hash', 'TEXT'],
    ['cross_sport_portfolio_reason', 'TEXT'],
    ['cross_sport_portfolio_downstream_state', 'TEXT'],
    ['cross_sport_portfolio_decided_at', 'TEXT']
  ];
  for (const [name, definition] of defs) ensureColumn(db, name, definition);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${DECISION_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      decision_hash TEXT NOT NULL UNIQUE,
      bet_id INTEGER,
      sport TEXT NOT NULL,
      event_key TEXT,
      decided_at TEXT NOT NULL,
      authority_version TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      readiness_status TEXT NOT NULL,
      status TEXT NOT NULL,
      candidate_stake REAL NOT NULL,
      shadow_capped_stake REAL NOT NULL,
      real_executable_stake REAL NOT NULL,
      bankroll_snapshot REAL,
      total_exposure_before REAL NOT NULL,
      sport_exposure_before REAL NOT NULL,
      event_exposure_before REAL NOT NULL,
      evidence_hash TEXT,
      downstream_state_json TEXT,
      reason TEXT NOT NULL,
      decision_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_patch56_portfolio_risk_bet ON ${DECISION_TABLE}(bet_id, decided_at);
    CREATE INDEX IF NOT EXISTS idx_patch56_portfolio_risk_sport ON ${DECISION_TABLE}(sport, decided_at);
  `);
  const after = columnNames(db);
  return { version: VERSION, table: DECISION_TABLE, addedColumns: [...after].filter(x => !before.has(x)).sort(), schemaReady: defs.every(([n]) => after.has(n)) && tableExists(db, DECISION_TABLE) };
}
function currentReadiness(db, options = {}) {
  if (options.readinessReport) return options.readinessReport;
  const now = Date.now();
  if (!options.forceReadinessRefresh && readinessCache && now - readinessCache.at < CACHE_TTL_MS) return readinessCache.report;
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '..'));
  const report = readinessGate.buildStatisticalProductionReadinessReport(db, { projectRoot });
  readinessCache = { at: now, report };
  return report;
}
function readExistingRealExposure(db, input = {}) {
  const out = { total: 0, bySport: { TENNIS: 0, CALCIO: 0 }, event: 0, rows: 0 };
  if (!db || typeof db.prepare !== 'function') return out;
  const cols = columnNames(db);
  if (!cols.has('cross_sport_portfolio_real_executable_stake')) return out;
  const excludeBetId = Number.isFinite(Number(input.excludeBetId ?? input.betId)) ? Number(input.excludeBetId ?? input.betId) : -1;
  const rows = db.prepare(`SELECT id,sport_type,bet_type,league,home_team,away_team,match_date,match_exposure_key,calcio_event_key,cross_sport_portfolio_real_executable_stake real_stake
    FROM ai_forward_test
    WHERE UPPER(COALESCE(status,'PENDING'))='PENDING'
      AND COALESCE(paper_result_active,1)=1
      AND COALESCE(paper_result_conflict,0)=0
      AND COALESCE(cross_sport_portfolio_real_executable_stake,0)>0
      AND id<>?`).all(excludeBetId);
  const targetEvent = eventKey(input);
  for (const row of rows) {
    const stake = Math.max(0, finite(row.real_stake, 0));
    const sport = normalizeSport(`${row.sport_type || ''} ${row.bet_type || ''} ${row.league || ''}`);
    out.total += stake;
    if (sport === 'TENNIS' || sport === 'CALCIO') out.bySport[sport] += stake;
    if (targetEvent && eventKey(row) === targetEvent) out.event += stake;
    out.rows++;
  }
  out.total = round(out.total, 2);
  out.bySport.TENNIS = round(out.bySport.TENNIS, 2);
  out.bySport.CALCIO = round(out.bySport.CALCIO, 2);
  out.event = round(out.event, 2);
  return out;
}
function downstreamState(options = {}) {
  const raw = options.downstreamState || {};
  let securityReady = raw.securityReady === true;
  // PATCH57 handoff: if no explicit override is supplied, consume the installed
  // production-security runtime gate. This can only satisfy the security leg;
  // Patch58 and Patch59 remain independently mandatory.
  if (!securityReady && raw.securityReady !== false) {
    try {
      const patch57 = require('./productionSecuritySafeReleasePatch57');
      securityReady = patch57.portfolioSecurityReady({ projectRoot: options.projectRoot || path.join(__dirname, '..') }) === true;
    } catch (_) { securityReady = false; }
  }
  let schedulerStateMachineReady = raw.schedulerStateMachineReady === true;
  if (!schedulerStateMachineReady && raw.schedulerStateMachineReady !== false) {
    try {
      const patch58 = require('./operationalSchedulerStateMachinePatch58');
      schedulerStateMachineReady = patch58.portfolioSchedulerReady({ projectRoot: options.projectRoot || path.join(__dirname, '..'), sport: options.sport || raw.sport || 'ALL' }) === true;
    } catch (_) { schedulerStateMachineReady = false; }
  }
  let controlledCanaryAuthorized = raw.controlledCanaryAuthorized === true;
  let canaryAuthority = text(raw.canaryAuthority);
  if (!controlledCanaryAuthorized && raw.controlledCanaryAuthorized !== false) {
    try {
      const patch59 = require('./controlledCanaryActivationPatch59');
      const sport = options.sport || raw.sport || 'ALL';
      if (sport !== 'ALL' && patch59.portfolioCanaryAuthorized({ projectRoot: options.projectRoot || path.join(__dirname, '..'), sport }) === true) {
        controlledCanaryAuthorized = true;
        canaryAuthority = patch59.portfolioCanaryAuthority({ projectRoot: options.projectRoot || path.join(__dirname, '..'), sport }) || patch59.VERSION;
      }
    } catch (_) { controlledCanaryAuthorized = false; canaryAuthority = ''; }
  }
  const canaryProof = controlledCanaryAuthorized && /^CONTROLLED_CANARY_ACTIVATION_.*PATCH59/i.test(canaryAuthority);
  return {
    patch57SecurityReady: securityReady,
    patch58SchedulerStateMachineReady: schedulerStateMachineReady,
    patch59ControlledCanaryAuthorized: canaryProof,
    canaryAuthority: canaryProof ? canaryAuthority : null,
    allRequired: securityReady && schedulerStateMachineReady && canaryProof
  };
}
function calculateCaps(proposedStake, bankroll, sport, exposure) {
  const proposed = Math.max(0, round(proposedStake, 2));
  const bank = Math.max(0, finite(bankroll, 0));
  const caps = {
    proposedStake: proposed,
    singleBetCap: round(bank * LIMITS.singleBetExposurePct / 100, 2),
    remainingTotalCap: round(Math.max(0, bank * LIMITS.totalExposurePct / 100 - finite(exposure.total, 0)), 2),
    remainingSportCap: round(Math.max(0, bank * LIMITS.sportExposurePct / 100 - finite(exposure.bySport?.[sport], 0)), 2),
    remainingEventCap: round(Math.max(0, bank * LIMITS.eventExposurePct / 100 - finite(exposure.event, 0)), 2)
  };
  caps.shadowCappedStake = bank > 0 ? round(Math.min(proposed, caps.singleBetCap, caps.remainingTotalCap, caps.remainingSportCap, caps.remainingEventCap), 2) : 0;
  if (caps.shadowCappedStake > 0 && caps.shadowCappedStake < MINIMUM_REAL_EXECUTABLE_STAKE_EUR) caps.shadowCappedStake = 0;
  return caps;
}
function decide(input = {}, options = {}) {
  const sport = normalizeSport(input.sport || `${input.sport_type || ''} ${input.bet_type || ''} ${input.league || ''}`);
  if (!['TENNIS', 'CALCIO'].includes(sport)) throw new Error('PATCH56_SUPPORTED_SPORT_REQUIRED');
  const db = options.db || input.db;
  if (!db || typeof db.prepare !== 'function') throw new Error('PATCH56_DB_ADAPTER_REQUIRED');
  const readiness = currentReadiness(db, options);
  const sportReadiness = sport === 'TENNIS' ? readiness.tennis : readiness.calcio;
  const readinessStatus = sportReadiness?.gateStatus || 'BLOCKED_STATISTICAL_READINESS';
  const proposedPaperStake = Math.max(0, round(input.proposedStake ?? input.paperStake ?? input.operationalStake ?? input.stake, 2));
  const bankroll = Math.max(0, finite(input.bankrollSnapshot ?? input.bankroll, 0));
  const exposure = options.exposureSnapshot || readExistingRealExposure(db, { ...input, betId: input.betId });
  const caps = calculateCaps(proposedPaperStake, bankroll, sport, exposure);
  const downstream = downstreamState({ ...options, sport, readinessReport: readiness });
  let status = 'REAL_MONEY_BLOCKED';
  let realExecutableStake = 0;
  let reason;
  if (readinessStatus !== 'MANUAL_CANARY_REVIEW_ELIGIBLE' || sportReadiness?.statisticalGatePass !== true) {
    status = 'BLOCKED_STATISTICAL_READINESS';
    reason = `Patch55 ${sport}=${readinessStatus}: esposizione reale bloccata. ${Array.isArray(sportReadiness?.blockingFailures) && sportReadiness.blockingFailures.length ? `Blocker: ${sportReadiness.blockingFailures.join(', ')}.` : ''}`.trim();
  } else if (!downstream.allRequired) {
    status = 'BLOCKED_DOWNSTREAM_PRODUCTION_GATES';
    reason = 'Gate statistico superato, ma Patch57 sicurezza, Patch58 state machine e Patch59 controlled canary non risultano tutte certificate.';
  } else if (!(bankroll > 0)) {
    status = 'BLOCKED_INVALID_BANKROLL';
    reason = 'Bankroll reale non valido: nessuna esposizione autorizzata.';
  } else if (caps.shadowCappedStake < MINIMUM_REAL_EXECUTABLE_STAKE_EUR) {
    status = 'BLOCKED_PORTFOLIO_CAP_OR_MINIMUM';
    reason = 'Il cap prudenziale residuo è inferiore allo stake reale minimo eseguibile.';
  } else {
    status = 'AUTHORIZED_CONTROLLED_CANARY_CAP';
    realExecutableStake = Math.min(caps.shadowCappedStake, LIMITS.maxRealSingleBetEur);
    reason = `Controlled canary autorizzato a €${realExecutableStake.toFixed(2)} dopo cap cross-sport; nessun incremento rispetto allo stake paper candidato.`;
  }
  realExecutableStake = round(Math.min(LIMITS.maxRealSingleBetEur, proposedPaperStake, Math.max(0, realExecutableStake)), 2);
  const core = {
    version: VERSION,
    policyVersion: POLICY_VERSION,
    mode: MODE,
    sport,
    eventKey: eventKey(input),
    betId: Number.isFinite(Number(input.betId)) ? Number(input.betId) : null,
    readinessStatus,
    statisticalGatePass: sportReadiness?.statisticalGatePass === true,
    blockingFailures: Array.isArray(sportReadiness?.blockingFailures) ? [...sportReadiness.blockingFailures] : [],
    candidatePaperStake: proposedPaperStake,
    shadowCappedStake: caps.shadowCappedStake,
    realExecutableStake,
    bankrollSnapshot: round(bankroll, 2),
    existingRealExposure: exposure,
    limits: LIMITS,
    caps,
    downstream,
    status,
    reason,
    readinessEvidenceHash: readiness.evidenceHash || null,
    paperStakePreserved: true,
    paperEvidenceCollectionPreserved: true,
    noStakeIncrease: realExecutableStake <= proposedPaperStake,
    automaticProductionActivation: false,
    probabilityAuthority: false,
    deepScanAuthority: false,
    qualityGateAuthority: false,
    settlementAuthority: false
  };
  return { ...core, decisionHash: sha256(core), decidedAt: options.decidedAt || new Date().toISOString() };
}
function toPersistenceFields(d = {}) {
  return {
    cross_sport_portfolio_risk_version: d.version || VERSION,
    cross_sport_portfolio_risk_policy_version: d.policyVersion || POLICY_VERSION,
    cross_sport_portfolio_risk_status: d.status || 'REAL_MONEY_BLOCKED',
    cross_sport_portfolio_readiness_status: d.readinessStatus || 'BLOCKED_STATISTICAL_READINESS',
    cross_sport_portfolio_candidate_stake: finite(d.candidatePaperStake, 0),
    cross_sport_portfolio_shadow_capped_stake: finite(d.shadowCappedStake, 0),
    cross_sport_portfolio_real_executable_stake: finite(d.realExecutableStake, 0),
    cross_sport_portfolio_total_exposure_before: finite(d.existingRealExposure?.total, 0),
    cross_sport_portfolio_sport_exposure_before: finite(d.existingRealExposure?.bySport?.[d.sport], 0),
    cross_sport_portfolio_event_exposure_before: finite(d.existingRealExposure?.event, 0),
    cross_sport_portfolio_bankroll_snapshot: finite(d.bankrollSnapshot, 0),
    cross_sport_portfolio_evidence_hash: d.readinessEvidenceHash || null,
    cross_sport_portfolio_reason: d.reason || '',
    cross_sport_portfolio_downstream_state: JSON.stringify(d.downstream || {}),
    cross_sport_portfolio_decided_at: d.decidedAt || new Date().toISOString()
  };
}
function persistDecision(db, decision = {}) {
  ensureSchema(db);
  if (!decision.decisionHash) throw new Error('PATCH56_DECISION_HASH_REQUIRED');
  const existing = db.prepare(`SELECT decision_hash FROM ${DECISION_TABLE} WHERE decision_hash=? LIMIT 1`).get(decision.decisionHash);
  if (existing) return { inserted: false, idempotent: true, decisionHash: decision.decisionHash };
  db.prepare(`INSERT INTO ${DECISION_TABLE}
    (decision_hash,bet_id,sport,event_key,decided_at,authority_version,policy_version,readiness_status,status,candidate_stake,shadow_capped_stake,real_executable_stake,bankroll_snapshot,total_exposure_before,sport_exposure_before,event_exposure_before,evidence_hash,downstream_state_json,reason,decision_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      decision.decisionHash, decision.betId, decision.sport, decision.eventKey, decision.decidedAt,
      decision.version, decision.policyVersion, decision.readinessStatus, decision.status,
      finite(decision.candidatePaperStake,0), finite(decision.shadowCappedStake,0), finite(decision.realExecutableStake,0),
      finite(decision.bankrollSnapshot,0), finite(decision.existingRealExposure?.total,0),
      finite(decision.existingRealExposure?.bySport?.[decision.sport],0), finite(decision.existingRealExposure?.event,0),
      decision.readinessEvidenceHash || null, JSON.stringify(decision.downstream || {}), decision.reason || '', JSON.stringify(decision)
    );
  return { inserted: true, idempotent: false, decisionHash: decision.decisionHash };
}
function buildAuthorityReport(db, options = {}) {
  const readiness = currentReadiness(db, options);
  const exposure = readExistingRealExposure(db, {});
  const downstream = downstreamState({ ...options, readinessReport: readiness });
  const tennis = decide({ sport:'TENNIS', proposedStake:0, bankrollSnapshot:finite(options.bankroll?.TENNIS ?? options.bankroll,0) }, { ...options, db, readinessReport:readiness, exposureSnapshot:exposure });
  const calcio = decide({ sport:'CALCIO', proposedStake:0, bankrollSnapshot:finite(options.bankroll?.CALCIO ?? options.bankroll,0) }, { ...options, db, readinessReport:readiness, exposureSnapshot:exposure });
  return {
    success: true,
    readOnly: true,
    version: VERSION,
    policyVersion: POLICY_VERSION,
    mode: MODE,
    status: readiness.gateStatus === 'BLOCKED_STATISTICAL_READINESS' ? 'REAL_MONEY_EXPOSURE_BLOCKED' : (downstream.allRequired ? 'CONTROLLED_CANARY_CAPABLE' : 'AWAITING_DOWNSTREAM_PRODUCTION_GATES'),
    readiness: { gateStatus:readiness.gateStatus, evidenceHash:readiness.evidenceHash, tennis:readiness.tennis?.gateStatus, calcio:readiness.calcio?.gateStatus },
    exposure,
    limits: LIMITS,
    downstream,
    sportAuthority: { TENNIS:{ status:tennis.status, realExecutableStake:tennis.realExecutableStake }, CALCIO:{ status:calcio.status, realExecutableStake:calcio.realExecutableStake } },
    authority: {
      finalRealMoneyExposureAuthority: true,
      paperStakeAuthority: false,
      paperStakePreserved: true,
      canIncreaseStake: false,
      canBypassPatch55: false,
      canSelfActivateProduction: false,
      probabilityMutation: false,
      deepScanDecisionMutation: false,
      qualityGateMutation: false,
      settlementMutation: false,
      schedulerMutation: false
    }
  };
}
function health(db, options = {}) {
  const report = buildAuthorityReport(db, options);
  let decisionRows = null;
  try { if (tableExists(db, DECISION_TABLE)) decisionRows = finite(db.prepare(`SELECT COUNT(*) n FROM ${DECISION_TABLE}`).get().n, 0); } catch (_) {}
  return { ...report, healthy:true, decisionTable:DECISION_TABLE, decisionRows, schemaReady:columnNames(db).has('cross_sport_portfolio_real_executable_stake') };
}

module.exports = {
  VERSION, POLICY_VERSION, MODE, DECISION_TABLE, LIMITS, MINIMUM_REAL_EXECUTABLE_STAKE_EUR,
  normalizeSport, eventKey, ensureSchema, currentReadiness, readExistingRealExposure, downstreamState,
  calculateCaps, decide, toPersistenceFields, persistDecision, buildAuthorityReport, health, sha256
};
