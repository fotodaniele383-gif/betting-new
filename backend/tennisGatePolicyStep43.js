'use strict';

/**
 * STEP43_TENNIS_GATE_POLICY
 *
 * Obiettivo:
 * - BLOCCATA deve indicare solo hard block reale.
 * - La prudenza da calibrazione UNKNOWN, cap sotto minimo o stake non giocabile
 *   non deve più contaminare la performance delle vere bloccate.
 * - DeepScan è operational-gate: questa policy classifica e normalizza il Gate,
 *   non modifica il verdetto DeepScan e non forza stake.
 */

const MIN_PLAYABLE_STAKE_EUR = 2;

const GATE_CATEGORY = Object.freeze({
  HARD_BLOCK: 'TRUE_HARD_BLOCK',
  PAPER_ONLY: 'PAPER_ONLY_STAKE_BELOW_MIN',
  WATCHLIST_MICRO: 'WATCHLIST_MICRO',
  APPROVED_CAPPED: 'APPROVED_CAPPED',
  VALUE_CONFIRMED: 'VALUE_CONFIRMED',
  UNKNOWN: 'UNKNOWN'
});

function s(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function n(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function collectText(input, depth = 0, seen = new WeakSet()) {
  if (input === null || input === undefined) return '';
  if (typeof input !== 'object') return s(input);

  if (seen.has(input) || depth > 3) return '';
  seen.add(input);

  const chunks = [];
  Object.entries(input).forEach(([key, value]) => {
    if (value === null || value === undefined) return;

    const keyUpper = String(key).toUpperCase();
    const interesting =
      keyUpper.includes('STATUS') ||
      keyUpper.includes('ACTION') ||
      keyUpper.includes('SUMMARY') ||
      keyUpper.includes('REASON') ||
      keyUpper.includes('WARNING') ||
      keyUpper.includes('GATE') ||
      keyUpper.includes('QUALITY') ||
      keyUpper.includes('DEEPSCAN') ||
      keyUpper.includes('DS_') ||
      keyUpper.includes('MARKOV') ||
      keyUpper.includes('CLV') ||
      keyUpper.includes('MARKET') ||
      keyUpper.includes('STAKE') ||
      keyUpper.includes('CALIBRATION') ||
      keyUpper.includes('CALIBRAZIONE') ||
      keyUpper.includes('RISK');

    if (typeof value === 'object') {
      chunks.push(collectText(value, depth + 1, seen));
      return;
    }

    if (interesting) chunks.push(s(value));
  });

  return chunks.join(' ');
}

function hasAny(text, needles) {
  return needles.some(needle => text.includes(needle));
}

function hasHardBlockText(text) {
  const t = s(text).toUpperCase();

  if (hasAny(t, [
    'BLOCKED_HARD',
    'HARD_BLOCK',
    'NO_BET_HARD',
    'BLOCCATA VERA',
    'BLOCCATA HARD',
    'TRUE_HARD_BLOCK'
  ])) {
    return true;
  }

  if (hasAny(t, [
    'ALTO_RISCHIO',
    'ALTO RISCHIO',
    '🔴',
    'HIGH_RISK'
  ])) {
    return true;
  }

  if (hasAny(t, [
    'DISACCORDO MODELLO/MERCATO TROPPO ALTO',
    'DISACCORDO MODELLO MERCATO TROPPO ALTO',
    'DISACCORDO MERCATO TROPPO ALTO',
    'MARKET DISAGREEMENT TOO HIGH',
    'MERCATO INCOERENTE',
    'MARKET INCOHERENT',
    'MERCATO / CLV (95',
    'MERCATO / CLV 95',
    'MARKET TRAPS / SHARP REFERENCE: FAIL',
    'ACCORDO MODELLO/MERCATO FAIL'
  ])) {
    return true;
  }

  if (
    t.includes('OVERCONFIDENCE') &&
    hasAny(t, ['FAIL', '90/100', '95/100', '100/100', 'GRAVE'])
  ) {
    return true;
  }

  if (hasAny(t, [
    'RISCHIO FISICO GRAVE',
    'MEDICAL FAIL',
    'FITNESS FAIL',
    'RETIREMENT FAIL',
    'RITIRO',
    'MTO GRAVE',
    'NEWS NEGATIVA GRAVE'
  ])) {
    return true;
  }

  if (
    hasAny(t, ['DATI INSUFFICIENTI VERI', 'PLAYER DATA FAIL', 'DATA SUFFICIENCY FAIL']) &&
    !hasAny(t, ['CALIBRAZIONE', 'CALIBRATION UNKNOWN'])
  ) {
    return true;
  }

  if (
    t.includes('MARKOV') &&
    hasAny(t, ['FAIL', 'NON VALIDATO', 'NOT VALIDATED']) &&
    hasAny(t, ['OVER', 'UNDER', 'TOTALS'])
  ) {
    return true;
  }

  return false;
}

function isWatchlistText(text) {
  const t = s(text).toUpperCase();
  return hasAny(t, [
    'WATCHLIST MICRO',
    'WATCHLIST_MICRO',
    'PAPER_OR_MICRO_STAKE',
    'MICRO STAKE',
    'MICRO_STAKE'
  ]);
}

function isApprovedCapText(text) {
  const t = s(text).toUpperCase();
  return hasAny(t, [
    'APPROVATA CON CAP',
    'APPROVED_CAPPED',
    'APPROVED_STANDARD',
    'BET_ALLOWED_WITH_CAP'
  ]);
}

function isValueConfirmedText(text) {
  const t = s(text).toUpperCase();
  return hasAny(t, [
    'VALUE CONFERMATO',
    'VALUE_CONFIRMED',
    'APPROVED_PROFESSIONAL',
    'PROFESSIONAL READY',
    'FULL_STAKE',
    'FULL STAKE'
  ]);
}

function isPaperOnlyText(text, input = {}) {
  const t = s(text).toUpperCase();

  if (hasHardBlockText(t) || isWatchlistText(t) || isApprovedCapText(t) || isValueConfirmedText(t)) {
    return false;
  }

  const stake =
    input.stake ??
    input.requestedStake ??
    input.requested_stake ??
    input.operationalStake ??
    input.operational_stake ??
    input.stake_requested ??
    input.savedStake ??
    input.saved_stake;

  const cap =
    input.maxStake ??
    input.max_stake ??
    input.recommendedMaxStake ??
    input.recommended_max_stake ??
    input.capStake ??
    input.cap_stake ??
    input.stake_cap;

  const stakeN = n(stake, NaN);
  const capN = n(cap, NaN);

  const noBetLike = hasAny(t, ['NO_BET', 'NO BET', 'BLOCCATA', 'BLOCKED']);
  const minLike = hasAny(t, [
    'SOTTO MINIMO',
    'MINIMO GIOCABILE',
    'MIN PLAYABLE',
    'BELOW MIN',
    'INFERIORE AL MINIMO',
    'CAP STAKE'
  ]);

  const calibrationOnly = hasAny(t, [
    'CALIBRAZIONE PREDITTIVA UNKNOWN',
    'CALIBRATION UNKNOWN',
    'CALIBRAZIONE UNKNOWN',
    'LOW SAMPLE',
    'SAMPLE INSUFFICIENTE',
    'PRUDENZIALE'
  ]);

  const capBelowMin =
    (Number.isFinite(capN) && capN > 0 && capN < MIN_PLAYABLE_STAKE_EUR) ||
    (Number.isFinite(stakeN) && stakeN === 0 && noBetLike);

  return Boolean(noBetLike && (minLike || calibrationOnly || capBelowMin || !hasHardBlockText(t)));
}

function classifyTennisGate(input = {}) {
  const text = collectText(input).toUpperCase();

  if (hasHardBlockText(text)) {
    return {
      category: GATE_CATEGORY.HARD_BLOCK,
      label: '🔴 BLOCCATA VERA',
      status: 'BLOCKED_HARD',
      action: 'NO_BET_HARD',
      severity: 'ERROR',
      allowBet: false,
      reason: 'Hard block reale: rischio alto, mercato incoerente, overconfidence grave, dati/fisico/news o Markov critici.'
    };
  }

  if (isValueConfirmedText(text)) {
    return {
      category: GATE_CATEGORY.VALUE_CONFIRMED,
      label: '🟢 VALUE CONFERMATO',
      status: 'VALUE_CONFIRMED',
      action: 'BET_ALLOWED',
      severity: 'OK',
      allowBet: true,
      reason: 'Segnale value confermato dal Gate operativo.'
    };
  }

  if (isApprovedCapText(text)) {
    return {
      category: GATE_CATEGORY.APPROVED_CAPPED,
      label: '✅ APPROVATA CON CAP',
      status: 'APPROVED_CAPPED',
      action: 'BET_ALLOWED_WITH_CAP',
      severity: 'OK',
      allowBet: true,
      reason: 'Segnale ammesso con cap stake operativo.'
    };
  }

  if (isWatchlistText(text)) {
    return {
      category: GATE_CATEGORY.WATCHLIST_MICRO,
      label: '🎾 WATCHLIST MICRO STAKE',
      status: 'WATCHLIST_MICRO_STAKE',
      action: 'PAPER_OR_MICRO_STAKE',
      severity: 'WARN',
      allowBet: true,
      reason: 'Segnale da paper trading o micro stake.'
    };
  }

  if (isPaperOnlyText(text, input)) {
    return {
      category: GATE_CATEGORY.PAPER_ONLY,
      label: '📄 PAPER ONLY / SOTTO MINIMO',
      status: 'PAPER_ONLY_STAKE_BELOW_MIN',
      action: 'PAPER_ONLY_NO_REAL_STAKE',
      severity: 'WARN',
      allowBet: false,
      reason: 'Non è hard block: stake sotto minimo, cap prudenziale o calibrazione insufficiente. Separato da BLOCCATA VERA.'
    };
  }

  return {
    category: GATE_CATEGORY.UNKNOWN,
    label: 'ALTRO / NON CLASSIFICATO',
    status: 'UNKNOWN',
    action: 'NO_ACTION',
    severity: 'WARN',
    allowBet: false,
    reason: 'Classificazione Gate non determinata.'
  };
}

function normalizeReport(report = {}) {
  if (!report || typeof report !== 'object') return report;

  const classification = classifyTennisGate(report);

  report.step43_gate_category = classification.category;
  report.step43_gate_label = classification.label;
  report.trueHardBlock = classification.category === GATE_CATEGORY.HARD_BLOCK;
  report.hardBlock = report.trueHardBlock;

  if (classification.category !== GATE_CATEGORY.UNKNOWN) {
    report.status = classification.status;
    report.action = classification.action;
    report.label = classification.label;
    report.severity = classification.severity;
    report.allowBet = classification.allowBet;
    report.summary = classification.reason;
  }

  if (!Array.isArray(report.reasons)) report.reasons = report.reasons ? [String(report.reasons)] : [];
  if (!Array.isArray(report.warnings)) report.warnings = report.warnings ? [String(report.warnings)] : [];

  if (classification.category === GATE_CATEGORY.PAPER_ONLY) {
    report.warnings.push('STEP43: classificazione prudenziale separata da BLOCCATA VERA.');
  }

  return report;
}

function isLikelyGateObject(obj = {}) {
  if (!obj || typeof obj !== 'object') return false;
  const keys = Object.keys(obj).join(' ').toUpperCase();
  const text = collectText(obj).toUpperCase();

  return (
    keys.includes('GATE') ||
    keys.includes('OPERATIONAL') ||
    keys.includes('TENNIS_OPERATIONAL') ||
    keys.includes('PROFESSIONAL') ||
    text.includes('BLOCCATA') ||
    text.includes('NO_BET') ||
    text.includes('WATCHLIST') ||
    text.includes('APPROVATA') ||
    text.includes('VALUE CONFERMATO')
  );
}

function normalizeAnyTennisOutput(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach(item => normalizeAnyTennisOutput(item, seen));
    return value;
  }

  if (isLikelyGateObject(value)) {
    normalizeReport(value);
  }

  Object.keys(value).forEach(key => {
    const child = value[key];
    if (child && typeof child === 'object') {
      normalizeAnyTennisOutput(child, seen);
    }
  });

  return value;
}

function normalizeDeepScanCategory(actionOrRow = {}) {
  const text = typeof actionOrRow === 'string'
    ? actionOrRow.toUpperCase()
    : collectText(actionOrRow).toUpperCase();

  if (hasAny(text, ['ALTO_RISCHIO', 'ALTO RISCHIO', '🔴', 'PERICOLO', 'VALUE TRAP'])) {
    return '🔴 ALTO RISCHIO';
  }

  if (hasAny(text, ['RISCHIO_MODELLO', 'RISCHIO MODELLO', '🟠', 'MODEL RISK', 'ALTERNATIVE_PRONOSTICO'])) {
    return '🟠 RISCHIO MODELLO';
  }

  if (hasAny(text, ['WATCHLIST', 'LOW EDGE', '🟡', 'WAIT_IN_PLAY'])) {
    return '🟡 WATCHLIST / LOW EDGE';
  }

  if (hasAny(text, ['EDGE_TECNICO', 'EDGE TECNICO', '📊', 'TECHNICAL EDGE'])) {
    return '📊 EDGE TECNICO';
  }

  if (hasAny(text, ['VALUE_CONFERMATO', 'VALUE CONFERMATO', 'VALUE CONFIRMED', '🟢', 'CONFIRM_PRONOSTICO'])) {
    return '🟢 VALUE CONFERMATO';
  }

  return '🟡 WATCHLIST / LOW EDGE';
}

function buildMarketMixAudit(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const audit = {
    total: list.length,
    moneyline: 0,
    totals: 0,
    over: 0,
    under: 0,
    warning: ''
  };

  list.forEach(row => {
    const text = collectText(row).toUpperCase();
    const prediction = s(row.prediction).toUpperCase();

    if (prediction === '1' || prediction === '2' || text.includes('MONEYLINE')) {
      audit.moneyline += 1;
    }

    if (prediction.includes('OVER') || text.includes('OVER ')) {
      audit.over += 1;
    }

    if (prediction.includes('UNDER') || text.includes('UNDER ')) {
      audit.under += 1;
    }
  });

  audit.totals = audit.over + audit.under;

  if (audit.total > 0 && audit.totals === 0) {
    audit.warning = 'Nessun Over/Under nel batch visualizzato: verificare generazione candidati totals, Markov e ranking finale Moneyline vs Totals.';
  }

  return audit;
}

module.exports = {
  MIN_PLAYABLE_STAKE_EUR,
  GATE_CATEGORY,
  collectText,
  hasHardBlockText,
  isPaperOnlyText,
  classifyTennisGate,
  normalizeReport,
  normalizeAnyTennisOutput,
  normalizeDeepScanCategory,
  buildMarketMixAudit
};
