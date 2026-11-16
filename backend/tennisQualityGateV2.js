'use strict';

/**
 * PATCH 10 - Tennis Quality Gate V2
 *
 * Two deliberately separate stages:
 *   1) BASE QUALITY: quantitative/pre-match inputs only. DeepScan is ignored.
 *   2) FINAL QUALITY: explicit fusion of the frozen base decision with DeepScan.
 *
 * Current-match result and current-match CLV are never inputs. Historical outcome
 * aggregates are audit evidence only and cannot directly approve a live match.
 */

const r25TennisMarket = require('./tennisMarketContractR25.cjs');
const TENNIS_QUALITY_GATE_VERSION = 'TENNIS_QUALITY_GATE_V2_PATCH10';
const TENNIS_QUALITY_BASE_VERSION = 'TENNIS_QUALITY_BASE_V1_PATCH10';
const TENNIS_QUALITY_STAKE_VERSION = 'TENNIS_QUALITY_STAKE_V1_PATCH10';

const QUALITY_CODE = Object.freeze({
  HARD_BLOCK: 'BLOCKED_HARD',
  SOFT_BLOCK: 'BLOCKED_SOFT',
  WATCHLIST_MICRO: 'WATCHLIST_MICRO',
  APPROVED_WITH_CAP: 'APPROVED_WITH_CAP',
  APPROVED: 'APPROVED',
  WAITING_DEEPSCAN: 'WAITING_DEEPSCAN'
});

const QUALITY_LABEL = Object.freeze({
  [QUALITY_CODE.HARD_BLOCK]: 'BLOCCATA HARD',
  [QUALITY_CODE.SOFT_BLOCK]: 'BLOCCATA SOFT',
  [QUALITY_CODE.WATCHLIST_MICRO]: 'WATCHLIST MICRO',
  [QUALITY_CODE.APPROVED_WITH_CAP]: 'APPROVATA CON CAP',
  [QUALITY_CODE.APPROVED]: 'APPROVATA',
  [QUALITY_CODE.WAITING_DEEPSCAN]: 'IN ATTESA DEEPSCAN'
});

const STAKE_MODE = Object.freeze({
  ZERO: 'ZERO',
  FIXED_MICRO_2_EUR: 'FIXED_MICRO_2_EUR',
  BANKROLL_PERCENT_CAP: 'BANKROLL_PERCENT_CAP',
  CERTIFIED_PERCENT: 'CERTIFIED_PERCENT'
});

const DEEPSCAN_CLASS = Object.freeze({
  VALUE_CONFIRMED: 'VALUE_CONFIRMED',
  MODEL_RISK: 'MODEL_RISK',
  TECHNICAL_EDGE: 'TECHNICAL_EDGE',
  HIGH_RISK: 'HIGH_RISK',
  WATCHLIST: 'WATCHLIST',
  WAIT_IN_PLAY: 'WAIT_IN_PLAY',
  UNKNOWN: 'UNKNOWN'
});

function numberOr(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round(value, digits = 2) {
  const n = numberOr(value, 0);
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}
function upper(...parts) {
  return parts.flat().map(value => {
    if (Array.isArray(value)) return value.join(' ');
    if (value && typeof value === 'object') return JSON.stringify(value);
    return String(value ?? '');
  }).join(' ').toUpperCase();
}
function hasAny(text, values) { return values.some(value => String(text || '').includes(value)); }
function probabilityPct(value) {
  const n = numberOr(value, null);
  if (n === null) return null;
  return n <= 1 ? n * 100 : n;
}
function impliedProbabilityPct(odd) {
  const n = numberOr(odd, null);
  return n && n > 1 ? 100 / n : null;
}

function normalizeReferenceQuality(input = {}) {
  const text = upper(input.reference_market_quality, input.referenceMarketQuality, input.reference_market_source, input.referenceMarketSource);
  if (!text.trim()) return 'MISSING';
  // R20: negative provenance has precedence over optimistic provider labels.
  if (hasAny(text, ['LOW', 'WEAK', 'FALLBACK', 'SYNTHETIC', 'ESTIMATED', 'STALE', 'UNVERIFIED', 'PROXY'])) return 'WEAK';
  if (hasAny(text, ['CERTIFIED', 'SHARP', 'BOOKMAKER', 'ODDS_API', 'REAL', 'HIGH', 'PROVIDER'])) return 'STRONG';
  return 'STANDARD';
}

function normalizeDeepScanClass(input = {}) {
  const text = upper(
    input.deepScanClass, input.ds_action, input.dsAction, input.ds_suggestion, input.dsSuggestion,
    input.deep_scan_risk_level, input.deepScanRiskLevel, input.action, input.suggestion,
    input.riskAssessment?.level, input.quantData?.riskAssessment?.level, input.level
  );
  if (!text.trim()) return DEEPSCAN_CLASS.UNKNOWN;
  // A hard DeepScan risk marker always dominates positive wording elsewhere in the report.
  // This prevents an action label such as VALUE_CONFERMATO from hiding a HIGH_RISK assessment.
  if (hasAny(text, ['ALTO RISCHIO', 'HIGH_RISK', 'HIGH RISK', 'VALUE TRAP', 'SCARTA', 'PERICOLO', '🔴'])) return DEEPSCAN_CLASS.HIGH_RISK;
  if (hasAny(text, ['VALUE CONFERMATO', 'VALUE_CONFIRMED', 'VALUE CONFERMATO / MICRO', 'VIA LIBERA', 'CONFIRM_PRONOSTICO', '🟢'])) return DEEPSCAN_CLASS.VALUE_CONFIRMED;
  if (hasAny(text, ['RISCHIO MODELLO', 'RISCHIO_MODELLO', 'MODEL_RISK', 'MODEL RISK', '🟠'])) return DEEPSCAN_CLASS.MODEL_RISK;
  if (hasAny(text, ['EDGE TECNICO', 'TECHNICAL_EDGE', 'TECHNICAL EDGE', '📊'])) return DEEPSCAN_CLASS.TECHNICAL_EDGE;
  if (hasAny(text, ['WATCHLIST', 'LOW EDGE', 'LOW_EDGE', '🟡'])) return DEEPSCAN_CLASS.WATCHLIST;
  if (hasAny(text, ['ATTENDI', 'WAIT_IN_PLAY', 'IN-PLAY', 'LIVE'])) return DEEPSCAN_CLASS.WAIT_IN_PLAY;
  return DEEPSCAN_CLASS.UNKNOWN;
}

function detectHardVeto(input = {}) {
  const text = upper(
    input.hardVetoReason, input.professional_gate_status, input.professional_gate_reasons,
    input.tennis_operational_status, input.tennis_operational_action, input.tennis_operational_summary,
    input.gate_status_code, input.gate_status_label, input.audit_scope_reason,
    input.tennis_event_identity_status, input.analysis_drift_reason, input.text
  );
  const reasons = [];
  const hardMarkers = [
    ['OPPOSITE_SIDE_CONFLICT', 'CONFLITTO LATO'],
    ['DUPLICATE_OPPOSITE_SIDE', 'DUPLICATO LATO OPPOSTO'],
    ['MATCH_EXPOSURE_CONFLICT', 'CONFLITTO ESPOSIZIONE'],
    ['NO_REFERENCE_MARKET', 'MERCATO DI RIFERIMENTO ASSENTE'],
    ['DATA_INSUFFICIENT_HARD', 'DATI INSUFFICIENTI HARD'],
    ['IDENTITY_CONFLICT', 'IDENTITÀ EVENTO IN CONFLITTO'],
    ['AMBIGUOUS_DUPLICATE', 'IDENTITÀ AMBIGUA/DUPLICATA'],
    ['HARD_VETO', 'HARD VETO'],
    ['BLOCKED_HARD', 'BLOCCO HARD'],
    ['BLOCCATA HARD', 'BLOCCO HARD']
  ];
  for (const [marker, reason] of hardMarkers) if (text.includes(marker)) reasons.push(reason);
  const identity = upper(input.tennis_event_identity_status);
  if (identity && hasAny(identity, ['CONFLICT', 'AMBIGUOUS', 'COLLISION', 'REJECTED'])) reasons.push('IDENTITÀ CANONICA NON AFFIDABILE');
  return { hard: reasons.length > 0, reasons: [...new Set(reasons)] };
}

function evaluateBaseQualityGate(input = {}) {
  const estimatedProbability = probabilityPct(input.estimated_prob ?? input.estimatedProb ?? input.probability ?? input.prob);
  const odd = numberOr(input.odd ?? input.opening_odd ?? input.openingOdd, null);
  const edgePp = numberOr(input.edge_pp ?? input.edge, null);
  const evPct = numberOr(input.ev_pct ?? input.ev, null);
  const marketProbability = probabilityPct(input.market_implied_prob ?? input.marketImpliedProbability) ?? impliedProbabilityPct(odd);
  const disagreementPp = estimatedProbability !== null && marketProbability !== null ? estimatedProbability - marketProbability : null;
  const dataSufficiency = numberOr(input.data_sufficiency_score ?? input.dataSufficiencyScore, null);
  const referenceQuality = normalizeReferenceQuality(input);
  const r25Market = r25TennisMarket.evaluate(input);
  const marketType = r25Market.type;
  const markovValidated = input.markov_validated === 1 || input.markov_validated === true || input.markovValidated === true;
  const hardVeto = detectHardVeto(input);
  const reasons = [];
  let score = 50;

  if (r25Market.hardBlock || hardVeto.hard) {
    return {
      version: TENNIS_QUALITY_BASE_VERSION,
      code: QUALITY_CODE.HARD_BLOCK,
      label: QUALITY_LABEL[QUALITY_CODE.HARD_BLOCK],
      score: 0,
      reason: `Hard veto quantitativo/pre-match: ${[...(r25Market.hardBlock?[r25Market.reason]:[]),...hardVeto.reasons].join('; ')}.`,
      reasons: [...(r25Market.hardBlock?[r25Market.reason]:[]),...hardVeto.reasons],
      hardVeto: true,
      metrics: { estimatedProbability, marketProbability, disagreementPp, odd, edgePp, evPct, dataSufficiency, referenceQuality, marketType, markovValidated },
      deepScanUsed: false
    };
  }

  if (edgePp === null) { score -= 18; reasons.push('Edge non disponibile (-18)'); }
  else if (edgePp < 0) { score -= 30; reasons.push('Edge negativo (-30)'); }
  else if (edgePp < 2) { score -= 8; reasons.push('Edge inferiore a 2pp (-8)'); }
  else if (edgePp < 5) { score += 7; reasons.push('Edge 2-5pp (+7)'); }
  else if (edgePp <= 10) { score += 14; reasons.push('Edge coerente 5-10pp (+14)'); }
  else if (edgePp <= 15) { score += 8; reasons.push('Edge elevato con cautela (+8)'); }
  else { score -= 4; reasons.push('Edge estremo: rischio overconfidence (-4)'); }

  if (evPct === null) { score -= 16; reasons.push('EV non disponibile (-16)'); }
  else if (evPct < 0) { score -= 28; reasons.push('EV negativo (-28)'); }
  else if (evPct < 4) { score -= 4; reasons.push('EV debole <4% (-4)'); }
  else if (evPct < 8) { score += 7; reasons.push('EV 4-8% (+7)'); }
  else if (evPct <= 20) { score += 12; reasons.push('EV 8-20% (+12)'); }
  else { score += 5; reasons.push('EV molto elevato, premio ridotto (+5)'); }

  if (estimatedProbability === null) { score -= 12; reasons.push('Probabilità modello assente (-12)'); }
  else if (estimatedProbability < 52) { score -= 12; reasons.push('Probabilità modello <52% (-12)'); }
  else if (estimatedProbability < 58) { reasons.push('Probabilità modello 52-58% (+0)'); }
  else if (estimatedProbability <= 75) { score += 6; reasons.push('Probabilità modello 58-75% (+6)'); }
  else if (estimatedProbability <= 82) { score += 4; reasons.push('Probabilità modello 75-82% (+4)'); }
  else { score += 1; reasons.push('Probabilità >82% non premiata automaticamente (+1)'); }

  if (disagreementPp === null) { score -= 8; reasons.push('Confronto modello/mercato assente (-8)'); }
  else if (disagreementPp < 0) { score -= 20; reasons.push('Mercato più forte del modello (-20)'); }
  else if (disagreementPp <= 8) { score += 8; reasons.push('Accordo modello/mercato entro 8pp (+8)'); }
  else if (disagreementPp <= 15) { score += 3; reasons.push('Disaccordo moderato 8-15pp (+3)'); }
  else { score -= 10; reasons.push('Disaccordo >15pp: possibile overconfidence (-10)'); }

  if (dataSufficiency === null) { score -= 10; reasons.push('Data sufficiency assente (-10)'); }
  else if (dataSufficiency < 35) { score -= 28; reasons.push('Data sufficiency critica (-28)'); }
  else if (dataSufficiency < 55) { score -= 14; reasons.push('Data sufficiency debole (-14)'); }
  else if (dataSufficiency < 70) { reasons.push('Data sufficiency sufficiente (+0)'); }
  else { score += 8; reasons.push('Data sufficiency alta (+8)'); }

  if (referenceQuality === 'STRONG') { score += 8; reasons.push('Mercato di riferimento forte (+8)'); }
  else if (referenceQuality === 'STANDARD') { score += 2; reasons.push('Mercato di riferimento standard (+2)'); }
  else if (referenceQuality === 'WEAK') { score -= 8; reasons.push('Mercato di riferimento debole (-8)'); }
  else { score -= 12; reasons.push('Mercato di riferimento mancante (-12)'); }

  if (marketType === 'TOTALS' && !markovValidated) { score -= 18; reasons.push('Totals senza Markov validato (-18)'); }
  if (odd !== null && (odd < 1.2 || odd > 4.5)) { score -= 8; reasons.push('Quota fuori fascia prudenziale 1.20-4.50 (-8)'); }

  score = round(clamp(score, 0, 100), 1);
  let code;
  if (score >= 78 && edgePp !== null && edgePp >= 4 && evPct !== null && evPct >= 6 && (dataSufficiency === null || dataSufficiency >= 55)) {
    code = QUALITY_CODE.APPROVED_WITH_CAP;
  } else if (score >= 62 && edgePp !== null && edgePp >= 2 && evPct !== null && evPct >= 3) {
    code = QUALITY_CODE.WATCHLIST_MICRO;
  } else {
    code = QUALITY_CODE.SOFT_BLOCK;
  }

  return {
    version: TENNIS_QUALITY_BASE_VERSION,
    code,
    label: QUALITY_LABEL[code],
    score,
    reason: `Qualità base pre-DeepScan ${score}/100: ${reasons.join('; ')}.`,
    reasons,
    hardVeto: false,
    metrics: { estimatedProbability, marketProbability, disagreementPp: disagreementPp === null ? null : round(disagreementPp, 2), odd, edgePp, evPct, dataSufficiency, referenceQuality, marketType, markovValidated },
    deepScanUsed: false
  };
}

function resolveQualityStake(input = {}) {
  const code = input.code || QUALITY_CODE.SOFT_BLOCK;
  const bankroll = Math.max(0, numberOr(input.bankroll, 0));
  const currentStake = Math.max(0, numberOr(input.currentStake ?? input.stake, 0));
  const kellyRawStake = Math.max(0, numberOr(input.kellyRawStake ?? input.kelly_raw_stake, 0));
  const professionalCap = Math.max(0, numberOr(input.professionalCap ?? input.professional_gate_max_stake, 0));
  const calibrationReady = input.calibrationReady === true;
  const minStake = 2;
  // R20: a proposed paper stake must already exist upstream; missing or zero
  // caps may never be raised by the presentation/quality stage.
  const hasCurrent = currentStake > 0;
  const hasKelly = kellyRawStake > 0;
  const hasProfessionalCap = professionalCap > 0;
  const justified = hasCurrent && hasKelly && hasProfessionalCap && bankroll >= minStake;
  const upstreamBlockedReason = 'R20_UPSTREAM_PROPOSAL_OR_RISK_CAP_NOT_POSITIVE';

  if (code === QUALITY_CODE.HARD_BLOCK || code === QUALITY_CODE.SOFT_BLOCK || code === QUALITY_CODE.WAITING_DEEPSCAN) {
    return { version: TENNIS_QUALITY_STAKE_VERSION, mode: STAKE_MODE.ZERO, amount: 0, budgetPct: 0, reason: 'Gate finale bloccante o non ancora completato: stake 0.' };
  }
  if (code === QUALITY_CODE.WATCHLIST_MICRO) {
    const cap = Math.min(minStake, currentStake, kellyRawStake, professionalCap, bankroll);
    const amount = justified && cap >= minStake ? minStake : 0;
    return { version: TENNIS_QUALITY_STAKE_VERSION, mode: amount ? STAKE_MODE.FIXED_MICRO_2_EUR : STAKE_MODE.ZERO,
      amount, budgetPct: bankroll > 0 ? round((amount / bankroll) * 100, 3) : 0,
      reason: amount ? 'Watchlist: €2 soltanto entro proposta e cap certificati, senza aumento upstream.'
        : upstreamBlockedReason + ': nessun €2 inventato.' };
  }
  if (!justified) return { version: TENNIS_QUALITY_STAKE_VERSION, mode: STAKE_MODE.ZERO, amount: 0,
    budgetPct: 0, reason: upstreamBlockedReason };
  const capPct = code === QUALITY_CODE.APPROVED && calibrationReady ? 0.006 : 0.004;
  const budgetCap = bankroll * capPct;
  // Conservative: never raise current stake, Kelly, professional risk cap, or budget.
  let amount = Math.floor((Math.min(budgetCap, currentStake, kellyRawStake, professionalCap, bankroll) + 1e-9) * 100) / 100;
  // Real book minimum is not a paper stake subsidy; below €2 remains non-executable.
  if (amount < minStake) amount = 0;
  return {
    version: TENNIS_QUALITY_STAKE_VERSION,
    mode: code === QUALITY_CODE.APPROVED && calibrationReady ? STAKE_MODE.CERTIFIED_PERCENT : STAKE_MODE.BANKROLL_PERCENT_CAP,
    amount: round(amount, 2),
    budgetPct: bankroll > 0 ? round((amount / bankroll) * 100, 3) : 0,
    reason: code === QUALITY_CODE.APPROVED && calibrationReady
      ? 'Approvazione certificata: stake percentuale prudente, limitato da Kelly/cap professionale.'
      : 'Approvata con cap: massimo 0,40% del bankroll e mai oltre Kelly/cap/stake preesistente.'
  };
}

function fuseQualityGateWithDeepScan(input = {}) {
  const base = input.baseDecision || evaluateBaseQualityGate(input);
  const deepScanClass = normalizeDeepScanClass(input.deepScan || input.report || input);
  const calibrationReady = input.calibrationReady === true;
  const reasons = [`Base ${base.label} ${base.score}/100`, `DeepScan ${deepScanClass}`];
  let code = QUALITY_CODE.SOFT_BLOCK;

  if (base.hardVeto || base.code === QUALITY_CODE.HARD_BLOCK || deepScanClass === DEEPSCAN_CLASS.HIGH_RISK) {
    code = QUALITY_CODE.HARD_BLOCK;
    reasons.push('Hard veto o ALTO RISCHIO: nessuna promozione basata sul win rate storico.');
  } else if (deepScanClass === DEEPSCAN_CLASS.TECHNICAL_EDGE) {
    const exceptionalIndependentBase = base.code === QUALITY_CODE.APPROVED_WITH_CAP && base.score >= 84 &&
      numberOr(base.metrics?.dataSufficiency, 0) >= 70 && numberOr(base.metrics?.edgePp, 0) >= 4 &&
      numberOr(base.metrics?.edgePp, 99) <= 10 && numberOr(base.metrics?.evPct, 0) >= 7 &&
      base.metrics?.referenceQuality === 'STRONG';
    code = exceptionalIndependentBase ? QUALITY_CODE.WATCHLIST_MICRO : QUALITY_CODE.SOFT_BLOCK;
    reasons.push(exceptionalIndependentBase
      ? 'EDGE TECNICO sostenuto da base indipendente eccezionale: solo micro €2.'
      : 'EDGE TECNICO non è conferma: matrice storica negativa, stake 0 salvo base indipendente eccezionale.');
  } else if (deepScanClass === DEEPSCAN_CLASS.MODEL_RISK) {
    const strongBase = base.code === QUALITY_CODE.APPROVED_WITH_CAP || (base.code === QUALITY_CODE.WATCHLIST_MICRO && base.score >= 68);
    code = strongBase ? QUALITY_CODE.WATCHLIST_MICRO : QUALITY_CODE.SOFT_BLOCK;
    reasons.push(strongBase
      ? 'RISCHIO MODELLO con base quantitativa solida: riclassificato WATCHLIST MICRO, non APPROVATA.'
      : 'RISCHIO MODELLO senza base sufficiente: BLOCCATA SOFT.');
  } else if (deepScanClass === DEEPSCAN_CLASS.VALUE_CONFIRMED) {
    if (base.code === QUALITY_CODE.APPROVED_WITH_CAP) {
      code = calibrationReady ? QUALITY_CODE.APPROVED : QUALITY_CODE.APPROVED_WITH_CAP;
      reasons.push(calibrationReady
        ? 'Value confermato e calibrazione certificata: APPROVATA.'
        : 'Value confermato ma calibrazione non pronta: APPROVATA CON CAP.');
    } else if (base.code === QUALITY_CODE.WATCHLIST_MICRO) {
      code = QUALITY_CODE.WATCHLIST_MICRO;
      reasons.push('Value confermato con base intermedia: micro €2.');
    } else {
      code = QUALITY_CODE.SOFT_BLOCK;
      reasons.push('DeepScan positivo non può sanare una base quantitativa debole.');
    }
  } else if (deepScanClass === DEEPSCAN_CLASS.WATCHLIST) {
    code = base.code === QUALITY_CODE.APPROVED_WITH_CAP ? QUALITY_CODE.WATCHLIST_MICRO : QUALITY_CODE.SOFT_BLOCK;
    reasons.push(code === QUALITY_CODE.WATCHLIST_MICRO
      ? 'DeepScan WATCHLIST con base forte: solo micro €2.'
      : 'DeepScan WATCHLIST e base non forte: stake 0.');
  } else if (deepScanClass === DEEPSCAN_CLASS.WAIT_IN_PLAY || deepScanClass === DEEPSCAN_CLASS.UNKNOWN) {
    code = QUALITY_CODE.SOFT_BLOCK;
    reasons.push('DeepScan assente/non conclusivo: il processo a due stadi non è completo, stake 0.');
  }

  const stake = resolveQualityStake({
    code, bankroll: input.bankroll, currentStake: input.currentStake ?? input.stake,
    kellyRawStake: input.kellyRawStake ?? input.kelly_raw_stake,
    professionalCap: input.professionalCap ?? input.professional_gate_max_stake,
    calibrationReady
  });

  return {
    version: TENNIS_QUALITY_GATE_VERSION,
    code,
    label: QUALITY_LABEL[code],
    score: base.score,
    reason: reasons.join(' | '),
    reasons,
    base,
    deepScanClass,
    deepScanKeptSeparate: true,
    calibrationReady,
    stake,
    allowBet: stake.amount > 0,
    allowFullStake: code === QUALITY_CODE.APPROVED && calibrationReady
  };
}

function deriveHistoricalFinalQuality(row = {}) {
  const explicit = upper(row.quality_final_code, row.quality_final_label);
  if (explicit) {
    if (explicit.includes('HARD')) return QUALITY_LABEL[QUALITY_CODE.HARD_BLOCK];
    if (explicit.includes('SOFT')) return QUALITY_LABEL[QUALITY_CODE.SOFT_BLOCK];
    if (explicit.includes('WATCHLIST')) return QUALITY_LABEL[QUALITY_CODE.WATCHLIST_MICRO];
    if (explicit.includes('WITH_CAP') || explicit.includes('CON CAP')) return QUALITY_LABEL[QUALITY_CODE.APPROVED_WITH_CAP];
    if (explicit.includes('APPROV')) return QUALITY_LABEL[QUALITY_CODE.APPROVED];
  }
  const ds = normalizeDeepScanClass(row);
  const stake = Math.max(0, numberOr(row.stake, 0));
  const baseText = upper(row.pre_match_gate_code, row.pre_match_gate_label, row.professional_gate_status);
  if (ds === DEEPSCAN_CLASS.HIGH_RISK || baseText.includes('BLOCKED_HARD') || baseText.includes('BLOCCATA HARD')) return QUALITY_LABEL[QUALITY_CODE.HARD_BLOCK];
  if (ds === DEEPSCAN_CLASS.TECHNICAL_EDGE) return QUALITY_LABEL[QUALITY_CODE.SOFT_BLOCK];
  if (ds === DEEPSCAN_CLASS.MODEL_RISK) return stake > 0 ? QUALITY_LABEL[QUALITY_CODE.WATCHLIST_MICRO] : QUALITY_LABEL[QUALITY_CODE.SOFT_BLOCK];
  if (ds === DEEPSCAN_CLASS.VALUE_CONFIRMED) {
    if (baseText.includes('APPROVATA') || baseText.includes('APPROVED')) return QUALITY_LABEL[QUALITY_CODE.APPROVED_WITH_CAP];
    return QUALITY_LABEL[QUALITY_CODE.WATCHLIST_MICRO];
  }
  if (ds === DEEPSCAN_CLASS.WATCHLIST) return stake > 0 ? QUALITY_LABEL[QUALITY_CODE.WATCHLIST_MICRO] : QUALITY_LABEL[QUALITY_CODE.SOFT_BLOCK];
  if (ds === DEEPSCAN_CLASS.WAIT_IN_PLAY || ds === DEEPSCAN_CLASS.UNKNOWN) return QUALITY_LABEL[QUALITY_CODE.SOFT_BLOCK];
  if (baseText.includes('APPROVATA') || baseText.includes('APPROVED')) return stake > 0 ? QUALITY_LABEL[QUALITY_CODE.APPROVED_WITH_CAP] : QUALITY_LABEL[QUALITY_CODE.WATCHLIST_MICRO];
  if (baseText.includes('WATCHLIST')) return QUALITY_LABEL[QUALITY_CODE.WATCHLIST_MICRO];
  if (baseText.includes('HARD')) return QUALITY_LABEL[QUALITY_CODE.HARD_BLOCK];
  return QUALITY_LABEL[QUALITY_CODE.SOFT_BLOCK];
}

function wilsonInterval(wins, total, z = 1.96) {
  if (!(total > 0)) return { lowPct: null, highPct: null };
  const p = wins / total;
  const denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) / total) + (z * z) / (4 * total * total))) / denom;
  return { lowPct: round((center - margin) * 100, 1), highPct: round((center + margin) * 100, 1) };
}

function summarizeGroup(rows = []) {
  const resolved = rows.filter(row => ['WON', 'LOST'].includes(upper(row.status).trim()));
  const operational = resolved.filter(row => numberOr(row.stake, 0) > 0);
  const zeroStake = resolved.filter(row => numberOr(row.stake, 0) <= 0);
  const wins = resolved.filter(row => upper(row.status).trim() === 'WON').length;
  const opWins = operational.filter(row => upper(row.status).trim() === 'WON').length;
  const stake = operational.reduce((sum, row) => sum + Math.max(0, numberOr(row.stake, 0)), 0);
  const profit = operational.reduce((sum, row) => sum + numberOr(row.profit, 0), 0);
  return {
    signals: resolved.length,
    wins,
    losses: resolved.length - wins,
    signalWinRatePct: resolved.length ? round((wins / resolved.length) * 100, 1) : null,
    signalWinRate95: wilsonInterval(wins, resolved.length),
    operational: operational.length,
    operationalWins: opWins,
    operationalWinRatePct: operational.length ? round((opWins / operational.length) * 100, 1) : null,
    stake: round(stake, 2),
    profit: round(profit, 2),
    roiPct: stake > 0 ? round((profit / stake) * 100, 2) : null,
    zeroStake: zeroStake.length,
    zeroStakeWins: zeroStake.filter(row => upper(row.status).trim() === 'WON').length,
    zeroStakeWinRatePct: zeroStake.length ? round((zeroStake.filter(row => upper(row.status).trim() === 'WON').length / zeroStake.length) * 100, 1) : null
  };
}

function buildInputCoverage(rows = []) {
  const total = rows.length;
  const pct = count => total ? round((count / total) * 100, 1) : 0;
  const available = predicate => rows.filter(predicate).length;
  const metrics = {
    modelProbability: available(row => probabilityPct(row.estimated_prob ?? row.estimatedProb ?? row.probability) !== null),
    marketReference: available(row => probabilityPct(row.market_implied_prob ?? row.marketImpliedProbability) !== null || numberOr(row.odd ?? row.opening_odd, null) > 1),
    edge: available(row => numberOr(row.edge_pp ?? row.edge, null) !== null),
    ev: available(row => numberOr(row.ev_pct ?? row.ev, null) !== null),
    dataSufficiency: available(row => numberOr(row.data_sufficiency_score ?? row.dataSufficiencyScore, null) !== null),
    referenceMarket: available(row => upper(row.reference_market_quality, row.reference_market_source).trim().length > 0),
    deepScan: available(row => normalizeDeepScanClass(row) !== DEEPSCAN_CLASS.UNKNOWN),
    canonicalIdentity: available(row => upper(row.tennis_event_fingerprint, row.provider_event_id, row.tennis_event_identity_status).trim().length > 0)
  };
  const completeBase = available(row =>
    probabilityPct(row.estimated_prob ?? row.estimatedProb ?? row.probability) !== null &&
    (probabilityPct(row.market_implied_prob ?? row.marketImpliedProbability) !== null || numberOr(row.odd ?? row.opening_odd, null) > 1) &&
    numberOr(row.edge_pp ?? row.edge, null) !== null &&
    numberOr(row.ev_pct ?? row.ev, null) !== null &&
    numberOr(row.data_sufficiency_score ?? row.dataSufficiencyScore, null) !== null &&
    upper(row.reference_market_quality, row.reference_market_source).trim().length > 0
  );
  return {
    total, completeBase, completeBasePct: pct(completeBase),
    fields: Object.fromEntries(Object.entries(metrics).map(([key, count]) => [key, { count, pct: pct(count) }]))
  };
}

function buildQualityPerformanceAudit(rows = []) {
  const tennis = rows.filter(row => {
    const text = upper(row.sport_type, row.sport, row.bet_type, row.strategy_tag, row.league);
    return text.includes('TENNIS') || text.includes('ATP') || text.includes('WTA');
  });
  const resolved = tennis.filter(row => ['WON', 'LOST'].includes(upper(row.status).trim()));
  const byFinal = {};
  const byDeepScan = {};
  const combinations = {};
  for (const row of resolved) {
    const quality = deriveHistoricalFinalQuality(row);
    const ds = normalizeDeepScanClass(row);
    (byFinal[quality] ||= []).push(row);
    (byDeepScan[ds] ||= []).push(row);
    (combinations[`${quality} × ${ds}`] ||= []).push(row);
  }
  const mapSummary = groups => Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, summarizeGroup(values)]));
  const zeroStakeHighRate = Object.entries(combinations)
    .map(([key, values]) => ({ key, ...summarizeGroup(values) }))
    .filter(item => item.zeroStake >= 5 && item.zeroStakeWinRatePct >= 60)
    .sort((a, b) => b.zeroStakeWinRatePct - a.zeroStakeWinRatePct || b.zeroStake - a.zeroStake);
  const inputCoverage = buildInputCoverage(tennis);
  return {
    success: true,
    version: TENNIS_QUALITY_GATE_VERSION,
    readOnly: true,
    rows: tennis.length,
    resolved: resolved.length,
    operational: resolved.filter(row => numberOr(row.stake, 0) > 0).length,
    zeroStake: resolved.filter(row => numberOr(row.stake, 0) <= 0).length,
    inputCoverage,
    byFinalQuality: mapSummary(byFinal),
    byDeepScan: mapSummary(byDeepScan),
    combinations: mapSummary(combinations),
    zeroStakeHighRate,
    warnings: [
      'La resa storica è un audit aggregato: non etichetta il singolo match usando il risultato futuro.',
      'Campioni piccoli e intervalli di confidenza ampi non autorizzano promozioni automatiche.',
      'Hard veto e ALTO RISCHIO non vengono promossi per il solo win rate osservato.'
    ]
  };
}

module.exports = {
  TENNIS_QUALITY_GATE_VERSION,
  TENNIS_QUALITY_BASE_VERSION,
  TENNIS_QUALITY_STAKE_VERSION,
  QUALITY_CODE,
  QUALITY_LABEL,
  STAKE_MODE,
  DEEPSCAN_CLASS,
  normalizeReferenceQuality,
  normalizeDeepScanClass,
  detectHardVeto,
  evaluateBaseQualityGate,
  resolveQualityStake,
  fuseQualityGateWithDeepScan,
  deriveHistoricalFinalQuality,
  summarizeGroup,
  buildQualityPerformanceAudit,
  buildInputCoverage,
  wilsonInterval
};
