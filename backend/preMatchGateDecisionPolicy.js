'use strict';

// STEP90_PREMATCH_GATE_ALIGNMENT
// Policy condivisa Tennis/Calcio: separa rigorosamente le feature disponibili pre-match
// dalle metriche post-match. Il CLV della giocata corrente NON viene mai usato per approvare
// una bet live/pre-match; il CLV entra solo come learning storico aggregato quando disponibile.

const STEP90_PREMATCH_GATE_ALIGNMENT_VERSION = 'STEP90_PREMATCH_GATE_ALIGNMENT_V1';

const DECISION = Object.freeze({
  BLOCKED_HARD: 'BLOCKED_HARD',
  BLOCKED_SOFT: 'BLOCKED_SOFT',
  WATCHLIST_MICRO: 'WATCHLIST_MICRO',
  APPROVED_WITH_CAP: 'APPROVED_WITH_CAP',
  APPROVED: 'APPROVED',
  APPROVED_FULL_STAKE: 'APPROVED_FULL_STAKE'
});

const LABEL = Object.freeze({
  [DECISION.BLOCKED_HARD]: 'BLOCCATA HARD',
  [DECISION.BLOCKED_SOFT]: 'BLOCCATA SOFT',
  [DECISION.WATCHLIST_MICRO]: 'WATCHLIST MICRO',
  [DECISION.APPROVED_WITH_CAP]: 'APPROVATA CON CAP',
  [DECISION.APPROVED]: 'APPROVATA',
  [DECISION.APPROVED_FULL_STAKE]: 'APPROVATA STAKE PIENO'
});

function n(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function round(value, digits = 2) {
  const m = 10 ** digits;
  return Math.round(n(value, 0) * m) / m;
}

function textOf(...parts) {
  return parts.flat().map(v => {
    if (Array.isArray(v)) return v.join(' ');
    if (v && typeof v === 'object') return JSON.stringify(v);
    return String(v ?? '');
  }).join(' ').toUpperCase();
}

function hasAny(text, needles) {
  const t = String(text || '').toUpperCase();
  return needles.some(k => t.includes(k));
}

function normalizeDeepScanClass(input = {}) {
  const text = textOf(
    input.deepScanClass,
    input.ds_action,
    input.dsAction,
    input.ds_suggestion,
    input.dsSuggestion,
    input.deep_scan_risk_level,
    input.deepScanRiskLevel,
    input.action,
    input.suggestion,
    input.riskLevel,
    input.text
  );

  if (!text.trim()) return 'UNKNOWN';
  if (hasAny(text, ['VALUE CONFERMATO', 'VALUE_CONFIRMED', 'VALUE_CONFERMATO', 'SUPER VALUE', 'VIA LIBERA', 'CONFIRM_PRONOSTICO', '🟢'])) return 'VALUE_CONFIRMED_MICRO';
  if (hasAny(text, ['ALTO RISCHIO', 'HIGH_RISK', 'HIGH RISK', 'VALUE TRAP', 'PERICOLO', 'SCARTA', '🔴'])) return 'HIGH_RISK';
  if (hasAny(text, ['RISCHIO MODELLO', 'RISCHIO_MODELLO', 'MODEL_RISK', 'MODEL RISK', 'ATTENZIONE', '🟠'])) return 'MODEL_RISK';
  if (hasAny(text, ['EDGE TECNICO', 'TECHNICAL_EDGE', 'TECHNICAL EDGE', '📊'])) return 'TECHNICAL_EDGE';
  if (hasAny(text, ['WATCHLIST', 'LOW EDGE', 'LOW_EDGE', '🟡'])) return 'WATCHLIST_LOW_EDGE';
  if (hasAny(text, ['ATTENDI', 'WAIT_IN_PLAY', 'IN-PLAY', 'LIVE'])) return 'WAIT_IN_PLAY';
  return 'UNKNOWN';
}

function normalizeGateClass(input = {}) {
  const text = textOf(
    input.gateClass,
    input.gateStatus,
    input.operationalStatus,
    input.operationalAction,
    input.operationalSummary,
    input.gateReasons,
    input.deepscanGateStatus,
    input.deepscanGateReason,
    input.pre_match_gate_label,
    input.preMatchGateLabel,
    input.text
  );
  const allowRaw = input.allowBet ?? input.gateAllowBet ?? input.professional_gate_allow_bet;
  const allowFalse = allowRaw === false || allowRaw === 0 || String(allowRaw).toUpperCase() === 'FALSE';

  if (hasAny(text, ['APPROVATA STAKE PIENO', 'APPROVED_FULL_STAKE', 'FULL_STAKE'])) return 'APPROVED_FULL_STAKE';
  if (hasAny(text, ['APPROVATA', 'APPROVED_PREMATCH', 'APPROVED_STEP90']) && !hasAny(text, ['CON CAP', 'WITH_CAP', 'CAPPED'])) return 'APPROVED';
  if (hasAny(text, ['OPPOSITE_SIDE_CONFLICT', 'HARD_VETO', 'DATA_INSUFFICIENT_HARD', 'NO_BET_HARD', 'BLOCKED_HARD', 'BLOCCATA HARD', 'CALCIO_BLOCKED_HARD'])) return 'BLOCKED_HARD';
  if (hasAny(text, ['CONSENSUS_MICRO', 'WATCHLIST_MICRO', 'WATCHLIST MICRO', 'MICRO STAKE', 'MICRO-STAKE', 'PAPER_OR_MICRO_STAKE', 'CALCIO_WATCHLIST_MICRO'])) return 'WATCHLIST_MICRO';
  if (hasAny(text, ['BLOCKED_SOFT', 'BLOCCATA SOFT', 'SOFT_BLOCK', 'NO_BET_SOFT', 'REVIEW', 'CALCIO_BLOCKED_SOFT'])) return 'BLOCKED_SOFT';
  if (hasAny(text, ['APPROVATA CON CAP', 'APPROVED_WITH_CAP', 'APPROVED_STANDARD', 'BET_ALLOWED_WITH_CAP', 'CALCIO_APPROVED_WITH_CAP'])) return 'APPROVED_WITH_CAP';
  if (allowFalse || hasAny(text, ['NO_BET', 'NO BET', 'BLOCKED', 'BLOCCATA'])) return 'BLOCKED_SOFT';
  return 'UNKNOWN';
}

function hasHardVeto(input = {}) {
  const text = textOf(
    input.hardVetoReason,
    input.gateStatus,
    input.operationalStatus,
    input.operationalAction,
    input.gateReasons,
    input.deepscanGateReason,
    input.text
  );
  return hasAny(text, [
    'OPPOSITE_SIDE_CONFLICT',
    'HARD_VETO',
    'NO_REFERENCE_MARKET',
    'DATA_INSUFFICIENT_HARD',
    'MATCH_EXPOSURE_CONFLICT',
    'LINEUP_HARD',
    'TEAM_MATCH_HARD',
    'DUPLICATE_OPPOSITE_SIDE'
  ]);
}

function buildStatsKey(input = {}) {
  const ds = normalizeDeepScanClass(input);
  const gate = normalizeGateClass(input);
  const sport = String(input.sport || input.sport_type || 'GENERIC').toUpperCase();
  return `${sport}::${gate}::${ds}`;
}

function emptyStats() {
  return {
    resolved: 0,
    operational: 0,
    wins: 0,
    losses: 0,
    stake: 0,
    profit: 0,
    roiPct: null,
    winRatePct: null,
    brier: null,
    clvSample: 0,
    clvAvgPct: null,
    clvBeatRatePct: null
  };
}

function calculateHistoricalStats(rows = [], keyGetter = buildStatsKey) {
  const groups = new Map();

  for (const row of rows || []) {
    const status = String(row.status || '').toUpperCase();
    if (status !== 'WON' && status !== 'LOST') continue;
    const key = keyGetter(row);
    if (!groups.has(key)) groups.set(key, { ...emptyStats(), key });
    const g = groups.get(key);
    const stake = n(row.stake ?? row.invested, 0);
    const profit = n(row.profit, 0);
    const prob = n(row.estimated_prob ?? row.estimatedProb ?? row.probability ?? row.prob, NaN);
    const outcome = status === 'WON' ? 1 : 0;

    g.resolved += 1;
    if (status === 'WON') g.wins += 1;
    if (status === 'LOST') g.losses += 1;
    if (Number.isFinite(prob) && prob > 0) {
      g._brierSum = (g._brierSum || 0) + ((prob / 100) - outcome) ** 2;
      g._brierN = (g._brierN || 0) + 1;
    }

    if (stake > 0) {
      g.operational += 1;
      g.stake += stake;
      g.profit += profit;
    }

    const clvAvailable = row.closing_line_available === 1 || row.clv_verified === 1 || Number.isFinite(Number(row.closing_odd));
    const clvPct = Number(row.clv_pct ?? row.clv_edge ?? row.clv);
    if (clvAvailable && Number.isFinite(clvPct)) {
      g.clvSample += 1;
      g._clvSum = (g._clvSum || 0) + clvPct;
      if (clvPct > 0) g._clvBeat += 1;
    }
  }

  for (const g of groups.values()) {
    g.roiPct = g.stake > 0 ? round((g.profit / g.stake) * 100, 2) : null;
    g.winRatePct = g.resolved > 0 ? round((g.wins / g.resolved) * 100, 2) : null;
    g.brier = g._brierN > 0 ? round(g._brierSum / g._brierN, 4) : null;
    g.clvAvgPct = g.clvSample > 0 ? round(g._clvSum / g.clvSample, 2) : null;
    g.clvBeatRatePct = g.clvSample > 0 ? round((g._clvBeat / g.clvSample) * 100, 2) : null;
    delete g._brierSum; delete g._brierN; delete g._clvSum; delete g._clvBeat;
  }

  return groups;
}

function evaluatePreMatchGateDecision(input = {}) {
  const sport = String(input.sport || input.sport_type || 'GENERIC').toUpperCase();
  const deepScanClass = normalizeDeepScanClass(input);
  const gateClass = normalizeGateClass(input);
  const stats = { ...emptyStats(), ...(input.historicalStats || {}) };
  const sample = n(stats.operational ?? stats.sample ?? stats.resolved, 0);
  const roi = stats.roiPct === null || stats.roiPct === undefined ? null : n(stats.roiPct, null);
  const brier = stats.brier === null || stats.brier === undefined ? null : n(stats.brier, null);
  const clvSample = n(stats.clvSample, 0);
  const clvAvg = stats.clvAvgPct === null || stats.clvAvgPct === undefined ? null : n(stats.clvAvgPct, null);
  const edge = n(input.edge_pp ?? input.edgePp ?? input.edge, 0);
  const ev = n(input.ev_pct ?? input.evPct ?? input.ev, 0);
  const prob = n(input.estimated_prob ?? input.estimatedProb ?? input.probability ?? input.prob, 0);
  const anomaly = Boolean(input.anomaly || input.surfaceAnomaly || input.quoteAnomaly || input.tournamentAnomaly || input.marketAnomaly);
  const hardVeto = hasHardVeto(input);
  const valueConfirmed = deepScanClass === 'VALUE_CONFIRMED_MICRO';
  const watchlist = deepScanClass === 'WATCHLIST_LOW_EDGE' || gateClass === 'WATCHLIST_MICRO';
  const modelRisk = deepScanClass === 'MODEL_RISK';
  const highRisk = deepScanClass === 'HIGH_RISK';
  const technicalEdge = deepScanClass === 'TECHNICAL_EDGE';

  const reasons = [];
  reasons.push('CLV corrente escluso: metrica post-match usata solo per learning storico aggregato.');

  if (hardVeto) {
    return makeDecision(DECISION.BLOCKED_HARD, sport, deepScanClass, gateClass, stats, reasons.concat('Hard veto reale: conflitto/dati insufficienti/reference market assente.'));
  }

  const canFullStake =
    sample >= n(input.fullStakeMinSample, 50) &&
    roi !== null && roi >= n(input.fullStakeMinRoiPct, 5) &&
    brier !== null && brier <= n(input.fullStakeMaxBrier, 0.24) &&
    clvSample >= n(input.fullStakeMinClvSample, 30) &&
    clvAvg !== null && clvAvg > 0 &&
    !anomaly && !modelRisk && !highRisk && gateClass !== 'BLOCKED_SOFT' && gateClass !== 'BLOCKED_HARD';

  if (canFullStake) {
    return makeDecision(DECISION.APPROVED_FULL_STAKE, sport, deepScanClass, gateClass, stats, reasons.concat('Sample/ROI/Brier/CLV storico sufficienti: stake pieno abilitabile.'));
  }

  const positiveHistoricalSignal =
    sample >= n(input.approvedMinSample, 8) &&
    roi !== null && roi >= n(input.approvedMinRoiPct, 8) &&
    (brier === null || brier <= n(input.approvedMaxBrier, 0.35)) &&
    !anomaly;

  if (valueConfirmed && positiveHistoricalSignal) {
    return makeDecision(DECISION.APPROVED, sport, deepScanClass, gateClass, stats, reasons.concat('Miglior incrocio storico operativo: promosso ad APPROVATA, ma senza stake pieno finché manca CLV storico sufficiente.'));
  }

  if ((gateClass === 'BLOCKED_HARD' || gateClass === 'BLOCKED_SOFT') && !valueConfirmed) {
    const code = gateClass === 'BLOCKED_HARD' || highRisk ? DECISION.BLOCKED_HARD : DECISION.BLOCKED_SOFT;
    return makeDecision(code, sport, deepScanClass, gateClass, stats, reasons.concat('Gate BLOCCATA senza VALUE CONFERMATO MICRO: stake pre-match a zero.'));
  }

  if (highRisk && !valueConfirmed) {
    return makeDecision(DECISION.BLOCKED_HARD, sport, deepScanClass, gateClass, stats, reasons.concat('DeepScan ALTO RISCHIO senza conferma value: stake a zero.'));
  }

  if ((modelRisk || technicalEdge) && !watchlist && !valueConfirmed) {
    return makeDecision(DECISION.BLOCKED_SOFT, sport, deepScanClass, gateClass, stats, reasons.concat('Rischio modello/edge tecnico senza watchlist micro: stake a zero.'));
  }

  if (valueConfirmed || watchlist || gateClass === 'WATCHLIST_MICRO') {
    return makeDecision(DECISION.WATCHLIST_MICRO, sport, deepScanClass, gateClass, stats, reasons.concat('Micro-stake consentito: watchlist/value attivo ma senza requisiti per stake pieno.'));
  }

  if (gateClass === 'APPROVED' && positiveHistoricalSignal) {
    return makeDecision(DECISION.APPROVED, sport, deepScanClass, gateClass, stats, reasons.concat('Gate approvato e storico positivo: approvata con controllo cap.'));
  }

  if (gateClass === 'APPROVED_WITH_CAP' || gateClass === 'APPROVED') {
    return makeDecision(DECISION.APPROVED_WITH_CAP, sport, deepScanClass, gateClass, stats, reasons.concat('Gate approvato ma requisiti pieni non sufficienti: cap operativo.'));
  }

  return makeDecision(DECISION.WATCHLIST_MICRO, sport, deepScanClass, gateClass, stats, reasons.concat('Default prudenziale: monitoraggio/micro fino a campione operativo sufficiente.'));
}

function makeDecision(code, sport, deepScanClass, gateClass, stats, reasons) {
  return {
    version: STEP90_PREMATCH_GATE_ALIGNMENT_VERSION,
    code,
    label: LABEL[code] || code,
    sport,
    deepScanClass,
    gateClass,
    allowStake: [DECISION.WATCHLIST_MICRO, DECISION.APPROVED_WITH_CAP, DECISION.APPROVED, DECISION.APPROVED_FULL_STAKE].includes(code),
    allowFullStake: code === DECISION.APPROVED_FULL_STAKE,
    clvUsedForCurrentPick: false,
    historicalSample: n(stats.operational ?? stats.sample ?? stats.resolved, 0),
    historicalRoiPct: stats.roiPct ?? null,
    historicalBrier: stats.brier ?? null,
    historicalClvSample: n(stats.clvSample, 0),
    historicalClvAvgPct: stats.clvAvgPct ?? null,
    reason: reasons.filter(Boolean).join(' ')
  };
}

module.exports = {
  STEP90_PREMATCH_GATE_ALIGNMENT_VERSION,
  DECISION,
  LABEL,
  normalizeDeepScanClass,
  normalizeGateClass,
  hasHardVeto,
  buildStatsKey,
  calculateHistoricalStats,
  evaluatePreMatchGateDecision
};
