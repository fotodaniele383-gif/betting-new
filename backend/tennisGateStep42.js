'use strict';

/**
 * STEP42 - Tennis Gate hard-only + DeepScan canonical labels + market mix audit
 *
 * Obiettivo:
 * - BLOCCATA deve rappresentare solo un NO_BET vero/hard.
 * - La sola calibrazione non sufficiente/UNKNOWN non deve bloccare lo stake:
 *   diventa prudenziale / watchlist micro stake.
 * - DeepScan è operational-gate: NON modifica direttamente stake/ROI.
 * - Le categorie DeepScan canoniche sono:
 *   🟢 VALUE CONFERMATO
 *   📊 EDGE TECNICO
 *   🟡 WATCHLIST / LOW EDGE
 *   🟠 RISCHIO MODELLO
 *   🔴 ALTO RISCHIO
 */

const STEP42_VERSION = 'TENNIS_GATE_HARD_ONLY_STEP42';

const DEEPSCAN_LABELS_STEP42 = Object.freeze({
  VALUE_CONFIRMED: '🟢 VALUE CONFERMATO',
  TECHNICAL_EDGE: '📊 EDGE TECNICO',
  WATCHLIST_LOW_EDGE: '🟡 WATCHLIST / LOW EDGE',
  MODEL_RISK: '🟠 RISCHIO MODELLO',
  HIGH_RISK: '🔴 ALTO RISCHIO'
});

const GATE_LABELS_STEP42 = Object.freeze({
  HARD_BLOCKED: '🎾 BLOCCATA',
  PRUDENTIAL_CALIBRATION: '🧪 PRUDENZIALE / CALIBRAZIONE',
  WATCHLIST_MICRO: 'WATCHLIST MICRO',
  APPROVED_CAPPED: 'APPROVATA CON CAP',
  VALUE_CONFIRMED: '🟢 VALUE CONFERMATO'
});

const DEFAULTS = Object.freeze({
  minPlayableStake: 2,
  microStakeCap: 2.15,
  cappedStakeCap: 13.65,
  hardRiskScore: 75,
  hardOverconfidenceScore: 70,
  hardMarketRiskScore: 70,
  hardDataSufficiencyFloor: 45,
  hardConflictScore: 70,
  valueEdgePpFloor: 3,
  valueEvPctFloor: 2,
  valueProbabilityFloor: 45
});

function safeString(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function safeUpper(value) {
  return safeString(value).toUpperCase();
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function firstNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function includesAny(text, tokens = []) {
  const haystack = safeUpper(text);
  return tokens.some(token => haystack.includes(safeUpper(token)));
}

function collectText(row = {}) {
  const texts = [
    row.tennis_operational_status,
    row.tennis_operational_action,
    row.tennis_operational_summary,
    row.professional_gate_status,
    row.professional_gate_action,
    row.professional_gate_reasons,
    row.gate_status,
    row.gate,
    row.quality,
    row.ds_action,
    row.ds_suggestion,
    row.deepScanAction,
    row.deepScanLabel,
    row.riskTaxonomy,
    row.risk_taxonomy,
    row.market_reference,
    row.marketReference,
    row.settlement_note,
    row.note
  ];
  if (row.professionalGate && typeof row.professionalGate === 'object') {
    texts.push(
      row.professionalGate.status,
      row.professionalGate.action,
      Array.isArray(row.professionalGate.reasons) ? row.professionalGate.reasons.join(' | ') : row.professionalGate.reasons,
      row.professionalGate.summary
    );
  }
  if (row.operationalReport && typeof row.operationalReport === 'object') {
    texts.push(
      row.operationalReport.status,
      row.operationalReport.action,
      row.operationalReport.label,
      row.operationalReport.summary,
      Array.isArray(row.operationalReport.reasons) ? row.operationalReport.reasons.join(' | ') : row.operationalReport.reasons,
      Array.isArray(row.operationalReport.warnings) ? row.operationalReport.warnings.join(' | ') : row.operationalReport.warnings
    );
  }
  return texts.filter(Boolean).join(' | ');
}

function getEdgePp(row = {}) {
  return firstNumber(row.edge_pp, row.adjusted_edge_pp, row.edge, row.value?.edge_pp, row.professionalGate?.value?.edge_pp);
}

function getEvPct(row = {}) {
  return firstNumber(row.ev_pct, row.adjusted_ev_pct, row.expectedValue, row.ev, row.value?.ev_pct, row.professionalGate?.value?.ev_pct);
}

function getProbabilityPct(row = {}) {
  return firstNumber(
    row.estimatedProb,
    row.estimated_prob,
    row.calibrated_probability_pct,
    row.calibratedProbability,
    row.probability,
    row.value?.probability_pct,
    row.professionalGate?.value?.probability_pct
  );
}

function getStake(row = {}) {
  return firstNumber(row.stake, row.invested, row.requestedStake, row.professionalGate?.stakePolicy?.requestedStake);
}

function isResolved(row = {}) {
  const status = safeUpper(row.status);
  return status === 'WON' || status === 'LOST' || status === 'VOID' || status === 'PUSH';
}

function isTennisLike(row = {}) {
  const text = [
    row.sport_type,
    row.sport,
    row.bet_type,
    row.strategy_tag,
    row.league,
    row.tour
  ].map(safeUpper).join(' ');
  return text.includes('TENNIS') || text.includes('ATP') || text.includes('WTA');
}

function normalizeTennisDeepScanLabel(input = {}) {
  const row = typeof input === 'string' ? { ds_action: input } : input;
  const text = collectText(row);
  const action = safeUpper(row.ds_action || row.deepScanAction || text);
  const suggestion = safeUpper(row.ds_suggestion || '');

  if (includesAny(action, ['ALTO RISCHIO', 'HIGH RISK', 'PERICOLO', 'VALUE TRAP', '🔴']) ||
      includesAny(suggestion, ['NO BET HARD', 'SCARTA'])) {
    return DEEPSCAN_LABELS_STEP42.HIGH_RISK;
  }

  if (includesAny(action, ['RISCHIO MODELLO', 'MODEL RISK', 'OVERCONFIDENCE', '🟠'])) {
    return DEEPSCAN_LABELS_STEP42.MODEL_RISK;
  }

  if (includesAny(action, ['WATCHLIST', 'LOW EDGE', 'WAIT_IN_PLAY', 'WAIT IN PLAY', 'ATTENDI', '🟡'])) {
    return DEEPSCAN_LABELS_STEP42.WATCHLIST_LOW_EDGE;
  }

  if (includesAny(action, ['EDGE TECNICO', 'TECHNICAL EDGE', '📊'])) {
    return DEEPSCAN_LABELS_STEP42.TECHNICAL_EDGE;
  }

  if (includesAny(action, ['VALUE CONFERMATO', 'VALUE CONFIRMED', 'VIA LIBERA', 'CONFERMATA', 'SUPER VALUE', '🟢'])) {
    return DEEPSCAN_LABELS_STEP42.VALUE_CONFIRMED;
  }

  const edge = getEdgePp(row);
  const ev = getEvPct(row);
  const prob = getProbabilityPct(row);
  if (edge >= 8 && ev >= 10 && prob >= 55) return DEEPSCAN_LABELS_STEP42.TECHNICAL_EDGE;
  if (edge >= 3 && ev >= 2 && prob >= 45) return DEEPSCAN_LABELS_STEP42.WATCHLIST_LOW_EDGE;

  return DEEPSCAN_LABELS_STEP42.WATCHLIST_LOW_EDGE;
}

function extractRiskScore(row = {}, keys = []) {
  for (const key of keys) {
    const parts = key.split('.');
    let value = row;
    for (const part of parts) {
      value = value && typeof value === 'object' ? value[part] : undefined;
    }
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function detectHardBlockReasons(row = {}, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const text = collectText(row);
  const dsLabel = normalizeTennisDeepScanLabel(row);
  const reasons = [];

  const riskScore = extractRiskScore(row, [
    'riskScore',
    'risk_score',
    'riskTaxonomyScore',
    'risk_taxonomy_score',
    'risk.taxonomyScore',
    'risk.totalScore',
    'deepScan.riskScore'
  ]);

  const overconfidenceScore = extractRiskScore(row, [
    'overconfidence_score',
    'overconfidenceScore',
    'risk.overconfidence',
    'deepScan.overconfidence',
    'model_overconfidence_score'
  ]);

  const marketRiskScore = extractRiskScore(row, [
    'market_risk_score',
    'marketRiskScore',
    'risk.market',
    'deepScan.marketRisk',
    'marketTrapScore'
  ]);

  const conflictScore = extractRiskScore(row, [
    'conflict_score',
    'conflictScore',
    'model_market_conflict_score',
    'rankingConflictScore',
    'risk.conflict'
  ]);

  const dataSufficiency = firstNumber(
    row.data_sufficiency_score,
    row.dataSufficiencyScore,
    row.operationalReport?.data?.sufficiencyScore,
    row.professionalGate?.data?.sufficiencyScore,
    100
  );

  const medicalSeverity = safeUpper(row.medical_severity || row.medicalStatus || row.news_severity || row.newsStatus);
  const retirementRisk = firstNumber(row.retirement_risk, row.retirementRisk, row.fitness?.retirementRisk, 0);

  if (dsLabel === DEEPSCAN_LABELS_STEP42.HIGH_RISK) {
    reasons.push('DEEPSCAN_HIGH_RISK');
  }

  if (riskScore >= cfg.hardRiskScore) {
    reasons.push(`RISK_SCORE_${riskScore}`);
  }

  if (
    overconfidenceScore >= cfg.hardOverconfidenceScore ||
    includesAny(text, ['OVERCONFIDENCE ESTREMA', 'OVERCONFIDENCE HARD', 'MODEL OVERCONFIDENCE HARD'])
  ) {
    reasons.push(`OVERCONFIDENCE_${overconfidenceScore || 'HARD'}`);
  }

  if (
    marketRiskScore >= cfg.hardMarketRiskScore ||
    includesAny(text, ['MERCATO INCOERENTE HARD', 'MARKET INCOHERENT HARD', 'SHARP CONFLICT HARD', 'LATE MONEY TRAP HARD'])
  ) {
    reasons.push(`MARKET_INCOHERENT_${marketRiskScore || 'HARD'}`);
  }

  if (
    dataSufficiency > 0 &&
    dataSufficiency < cfg.hardDataSufficiencyFloor &&
    !includesAny(text, ['CALIBRAZIONE UNKNOWN', 'CALIBRATION UNKNOWN', 'CALIBRATION INSUFFICIENT', 'SAMPLE INSUFFICIENT'])
  ) {
    reasons.push(`DATA_INSUFFICIENT_${dataSufficiency}`);
  }

  if (
    includesAny(medicalSeverity, ['NEGATIVE', 'RED', 'HIGH', 'OUT', 'INJURY']) ||
    retirementRisk >= 65 ||
    includesAny(text, ['RITIRO PROBABILE', 'INFORTUNIO GRAVE', 'MEDICAL RED', 'NEWS NEGATIVE HARD'])
  ) {
    reasons.push(`FITNESS_NEWS_${retirementRisk || medicalSeverity || 'HARD'}`);
  }

  if (
    conflictScore >= cfg.hardConflictScore ||
    includesAny(text, ['CONFLITTO HARD', 'CONFLICT HARD', 'DISACCORDO CRITICO', 'RANKING CONFLICT HARD'])
  ) {
    reasons.push(`CONFLICT_${conflictScore || 'HARD'}`);
  }

  return [...new Set(reasons)];
}

function detectPrudentialReasons(row = {}) {
  const text = collectText(row);
  const reasons = [];

  if (includesAny(text, ['CALIBRAZIONE UNKNOWN', 'CALIBRATION UNKNOWN', 'CALIBRAZIONE PREDITTIVA UNKNOWN', 'CALIBRATION FAIL UNKNOWN'])) {
    reasons.push('CALIBRATION_UNKNOWN');
  }

  if (includesAny(text, ['SAMPLE INSUFFICIENT', 'SAMPLE INSUFFICIENTE', 'LOW SAMPLE', 'BOOTSTRAP', 'CURRENT_BOOTSTRAP'])) {
    reasons.push('LOW_SAMPLE_OR_BOOTSTRAP');
  }

  if (includesAny(text, ['CLV NON ANCORA DISPONIBILE', 'CLV MISSING', 'CLOSING LINE WARN'])) {
    reasons.push('CLV_NOT_AVAILABLE_YET');
  }

  if (includesAny(text, ['TORNEO INSTABILE', 'GRAND SLAM QUALI', 'FALLBACK SUPERFICIE', 'SURFACE FALLBACK', 'UNKNOWN_NO_SURFACE'])) {
    reasons.push('TOURNAMENT_OR_SURFACE_PRUDENCE');
  }

  return [...new Set(reasons)];
}

function isValueEligible(row = {}, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  return (
    getEdgePp(row) >= cfg.valueEdgePpFloor &&
    getEvPct(row) >= cfg.valueEvPctFloor &&
    getProbabilityPct(row) >= cfg.valueProbabilityFloor
  );
}

function calculateStep42Stake(row = {}, classification = {}, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const existing = getStake(row);
  const status = safeUpper(row.status);

  if (classification.blocksStake === true) return 0;

  // Non riscrive importi storici già risolti: evita di sporcare ROI/profitto passato.
  if (isResolved(row) && existing > 0) return existing;

  const theoretical = firstNumber(
    row.kelly_stake,
    row.kellyStake,
    row.suggestedStake,
    row.suggested_stake,
    row.professional_gate_max_stake,
    row.professionalGate?.stakePolicy?.recommendedMaxStake,
    row.operationalReport?.stake?.recommendedStake,
    existing,
    cfg.minPlayableStake
  );

  let cap = cfg.cappedStakeCap;
  if (classification.label === GATE_LABELS_STEP42.WATCHLIST_MICRO ||
      classification.label === GATE_LABELS_STEP42.PRUDENTIAL_CALIBRATION) {
    cap = cfg.microStakeCap;
  }

  const raw = Math.min(Math.max(theoretical, cfg.minPlayableStake), cap);
  return Number(raw.toFixed(2));
}

function classifyTennisGateStep42(row = {}, options = {}) {
  const hardReasons = detectHardBlockReasons(row, options);
  const prudentialReasons = detectPrudentialReasons(row);
  const deepScanLabel = normalizeTennisDeepScanLabel(row);
  const valueEligible = isValueEligible(row, options);

  if (hardReasons.length > 0) {
    return {
      version: STEP42_VERSION,
      label: GATE_LABELS_STEP42.HARD_BLOCKED,
      status: 'BLOCKED_HARD',
      action: 'NO_BET',
      allowBet: false,
      blocksStake: true,
      hardBlock: true,
      prudentialOnly: false,
      deepScanLabel,
      reasons: hardReasons,
      warnings: prudentialReasons
    };
  }

  if (prudentialReasons.length > 0) {
    return {
      version: STEP42_VERSION,
      label: GATE_LABELS_STEP42.WATCHLIST_MICRO,
      status: 'WATCHLIST_MICRO_STAKE_PRUDENTIAL',
      action: 'PAPER_OR_MICRO_STAKE',
      allowBet: valueEligible,
      blocksStake: false,
      hardBlock: false,
      prudentialOnly: true,
      deepScanLabel,
      reasons: prudentialReasons,
      warnings: ['Prudenza: calibrazione/sample/CLV non bloccano lo stake; impongono micro/cap.']
    };
  }

  if (deepScanLabel === DEEPSCAN_LABELS_STEP42.VALUE_CONFIRMED && valueEligible) {
    return {
      version: STEP42_VERSION,
      label: GATE_LABELS_STEP42.VALUE_CONFIRMED,
      status: 'VALUE_CONFIRMED',
      action: 'BET_ALLOWED_WITH_CAP',
      allowBet: true,
      blocksStake: false,
      hardBlock: false,
      prudentialOnly: false,
      deepScanLabel,
      reasons: ['VALUE_CONFIRMED'],
      warnings: []
    };
  }

  if (deepScanLabel === DEEPSCAN_LABELS_STEP42.TECHNICAL_EDGE && valueEligible) {
    return {
      version: STEP42_VERSION,
      label: GATE_LABELS_STEP42.APPROVED_CAPPED,
      status: 'APPROVED_CAPPED',
      action: 'BET_ALLOWED_WITH_CAP',
      allowBet: true,
      blocksStake: false,
      hardBlock: false,
      prudentialOnly: false,
      deepScanLabel,
      reasons: ['TECHNICAL_EDGE_APPROVED_WITH_CAP'],
      warnings: []
    };
  }

  return {
    version: STEP42_VERSION,
    label: GATE_LABELS_STEP42.WATCHLIST_MICRO,
    status: 'WATCHLIST_MICRO_STAKE',
    action: valueEligible ? 'PAPER_OR_MICRO_STAKE' : 'WATCHLIST_ONLY',
    allowBet: valueEligible,
    blocksStake: false,
    hardBlock: false,
    prudentialOnly: false,
    deepScanLabel,
    reasons: valueEligible ? ['VALUE_PRESENT_MICRO_STAKE'] : ['LOW_VALUE_OR_LOW_CONFIDENCE'],
    warnings: []
  };
}

function applyTennisGatePolicyStep42(row = {}, options = {}) {
  if (!row || typeof row !== 'object') return row;
  if (!isTennisLike(row) && options.force !== true) return row;

  const classification = classifyTennisGateStep42(row, options);
  const next = { ...row };

  const newStake = calculateStep42Stake(next, classification, options);
  const pendingLike = !isResolved(next) || safeUpper(next.status) === 'PENDING' || !next.status;

  next.step42_gate_version = STEP42_VERSION;
  next.gate_policy_version = STEP42_VERSION;
  next.deep_scan_canonical = classification.deepScanLabel;
  next.gate_classification = classification.label;
  next.gate_hard_block = classification.hardBlock ? 1 : 0;
  next.gate_prudential_only = classification.prudentialOnly ? 1 : 0;

  next.professional_gate_status = classification.status;
  next.professional_gate_action = classification.action;
  next.professional_gate_allow_bet = classification.allowBet ? 1 : 0;
  next.professional_gate_blocks_stake = classification.blocksStake ? 1 : 0;
  next.professional_gate_reasons = classification.reasons.join(' | ');
  next.tennis_operational_status = classification.status;
  next.tennis_operational_action = classification.action;
  next.tennis_operational_summary = classification.hardBlock
    ? 'Pronostico Tennis bloccato: hard risk reale. Non usare a stake reale.'
    : (classification.prudentialOnly
      ? 'Classificazione prudenziale: calibrazione/sample/CLV non sufficienti. Non blocca lo stake, applica micro/cap.'
      : 'Pronostico Tennis ammesso secondo policy hard-only.');

  if (pendingLike) {
    next.stake = classification.blocksStake ? 0 : newStake;
    next.invested = next.stake;

    if (classification.blocksStake) {
      next.estimatedProfit = 0;
      if (safeUpper(next.status) === 'PENDING' || !next.status) next.profit = 0;
    } else if (safeNumber(next.odd, 0) > 1 && next.stake > 0) {
      next.estimatedProfit = Number((next.stake * (safeNumber(next.odd, 0) - 1)).toFixed(2));
    }
  }

  next.operationalReport = {
    ...(next.operationalReport && typeof next.operationalReport === 'object' ? next.operationalReport : {}),
    mode: 'TENNIS_OPERATIONAL_REPORT_V2_STEP42',
    status: classification.status,
    action: classification.action,
    label: classification.label,
    allowBet: classification.allowBet,
    blocksStake: classification.blocksStake,
    hardBlock: classification.hardBlock,
    prudentialOnly: classification.prudentialOnly,
    summary: next.tennis_operational_summary,
    reasons: classification.reasons,
    warnings: classification.warnings,
    deepScanLabel: classification.deepScanLabel,
    stake: {
      requestedStake: getStake(row),
      recommendedStake: next.stake,
      maxStake: next.stake,
      minPlayableStake: DEFAULTS.minPlayableStake
    }
  };

  return next;
}

function applyToArray(rows = [], options = {}) {
  if (!Array.isArray(rows)) return rows;
  return rows.map(row => applyTennisGatePolicyStep42(row, options));
}

function computeTennisMarketMixAudit(rows = [], settings = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const audit = {
    version: 'TENNIS_MARKET_MIX_AUDIT_STEP42',
    total: list.length,
    moneyline: 0,
    totals: 0,
    over: 0,
    under: 0,
    other: 0,
    tennisUseTotals: settings.tennisUseTotals === true,
    warning: null
  };

  list.forEach(row => {
    const text = [
      row.prediction,
      row.bet_type,
      row.market,
      row.strategy_tag
    ].map(safeUpper).join(' ');

    if (text.includes('OVER')) {
      audit.over += 1;
      audit.totals += 1;
    } else if (text.includes('UNDER')) {
      audit.under += 1;
      audit.totals += 1;
    } else if (text.includes('TOTAL')) {
      audit.totals += 1;
    } else if (text.includes('MONEYLINE') || text === '1' || text === '2' || text.includes('SINGLE')) {
      audit.moneyline += 1;
    } else {
      audit.other += 1;
    }
  });

  if (audit.total > 0 && audit.totals === 0) {
    audit.warning = audit.tennisUseTotals
      ? 'Totals attivi ma nel batch non risultano Over/Under: verificare feed quote totals, filtro Markov/totals e soglie mercato.'
      : 'Nessun Over/Under nel batch: totals disattivati o non disponibili dal feed quote.';
  }

  return audit;
}

function transformTennisPayloadStep42(payload = {}, options = {}) {
  if (!payload || typeof payload !== 'object') return payload;

  const out = Array.isArray(payload) ? [...payload] : { ...payload };

  if (Array.isArray(out.valueBets)) {
    out.valueBets = applyToArray(out.valueBets, { ...options, force: true });
    out.marketMixAudit = computeTennisMarketMixAudit(out.valueBets, options.settings || {});
    out.meta = { ...(out.meta || {}), marketMixAudit: out.marketMixAudit, gatePolicyVersion: STEP42_VERSION };
  }

  if (Array.isArray(out.history)) {
    out.history = applyToArray(out.history, { ...options, force: true });
    out.marketMixAudit = computeTennisMarketMixAudit(out.history, options.settings || {});
    out.meta = { ...(out.meta || {}), marketMixAudit: out.marketMixAudit, gatePolicyVersion: STEP42_VERSION };
  }

  if (Array.isArray(out.log)) {
    out.log = applyToArray(out.log, { ...options, force: true });
    out.marketMixAudit = computeTennisMarketMixAudit(out.log, options.settings || {});
    out.meta = { ...(out.meta || {}), marketMixAudit: out.marketMixAudit, gatePolicyVersion: STEP42_VERSION };
  }

  return out;
}

function installStep42TennisGateMiddleware(app, options = {}) {
  if (!app || typeof app.use !== 'function') return false;
  if (app.__step42TennisGateMiddlewareInstalled) return true;
  app.__step42TennisGateMiddlewareInstalled = true;

  app.use((req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = function step42JsonWrapper(body) {
      try {
        const path = safeString(req.originalUrl || req.url || '');
        if (path.includes('/api/tennis/')) {
          const transformed = transformTennisPayloadStep42(body, {
            ...options,
            force: true,
            settings: options.settings || {}
          });
          return originalJson(transformed);
        }
      } catch (error) {
        // Non bloccare mai il server per un wrapper di audit.
        console.warn('[STEP42] Errore trasformazione payload Tennis:', error.message);
      }

      return originalJson(body);
    };

    return next();
  });

  console.log('[STEP42] Tennis Gate hard-only middleware attivo. DeepScan operational-gate preservato.');
  return true;
}

module.exports = {
  STEP42_VERSION,
  DEEPSCAN_LABELS_STEP42,
  GATE_LABELS_STEP42,
  DEFAULTS,
  normalizeTennisDeepScanLabel,
  classifyTennisGateStep42,
  applyTennisGatePolicyStep42,
  transformTennisPayloadStep42,
  computeTennisMarketMixAudit,
  installStep42TennisGateMiddleware,
  detectHardBlockReasons,
  detectPrudentialReasons
};

if (require.main === module) {
  const sample = applyTennisGatePolicyStep42({
    sport_type: 'TENNIS',
    bet_type: 'SINGLE_TENNIS',
    ds_action: '📊 EDGE TECNICO',
    professional_gate_reasons: 'Calibrazione predittiva UNKNOWN',
    edge_pp: 8,
    ev_pct: 11,
    estimated_prob: 62,
    stake: 0,
    odd: 1.72,
    status: 'PENDING'
  }, { force: true });

  console.log(JSON.stringify(sample, null, 2));
}
