// STEP96C_RUNTIME_MICRO_TEST_ACTIVATION
// Policy unica per valutare incroci DeepScan IA x Qualità/Gate.
// Regola senior audit: RISCHIO MODELLO + BLOCCATA SOFT può diventare MICRO TEST controllato
// se lo storico segnali è positivo, ma non può mai diventare stake pieno in automatico.

const STEP96_RISK_MODEL_SOFT_COMBINATION_RECALIBRATION = 'STEP96_RISK_MODEL_SOFT_COMBINATION_RECALIBRATION';
const STEP96C_RUNTIME_MICRO_TEST_ACTIVATION = 'STEP96C_RUNTIME_MICRO_TEST_ACTIVATION';

function normalizeText(value) {
  return String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

function normalizeStep96DeepScanCategory(value) {
  const t = normalizeText(value);
  if (!t) return 'UNKNOWN';
  if (t.includes('VALUE CONFERMATO') || t.includes('VALUE CONFIRMED') || t.includes('VALUE CONFERMATO MICRO')) return 'VALUE CONFERMATO / MICRO';
  if (t.includes('WATCHLIST') || t.includes('LOW EDGE')) return 'WATCHLIST LOW EDGE';
  if (t.includes('RISCHIO MODELLO') || t.includes('MODEL RISK')) return 'RISCHIO MODELLO';
  if (t.includes('EDGE TECNICO') || t.includes('TECHNICAL EDGE')) return 'EDGE TECNICO';
  if (t.includes('ALTO RISCHIO') || t.includes('HIGH RISK')) return 'ALTO RISCHIO';
  if (t.includes('ATTENDI') || t.includes('IN PLAY')) return 'ATTENDI IN-PLAY';
  return t;
}

function normalizeStep96GateCategory(value) {
  const t = normalizeText(value);
  if (!t) return 'UNKNOWN';
  if (t.includes('APPROVATA STAKE PIENO') || t.includes('APPROVED FULL')) return 'APPROVATA STAKE PIENO';
  if (t.includes('APPROVATA CON CAP') || t.includes('APPROVED WITH CAP')) return 'APPROVATA CON CAP';
  if (t === 'APPROVATA' || t.includes(' APPROVATA ') || t.includes('APPROVED STEP90') || t.includes('APPROVED PREMATCH')) return 'APPROVATA';
  if (t.includes('WATCHLIST') || t.includes('CONSENSUS MICRO') || t.includes('PAPER OR MICRO STAKE') || t.includes('MICRO STAKE')) return 'WATCHLIST MICRO';
  if (t.includes('BLOCCATA HARD') || t.includes('BLOCKED HARD') || t.includes('NO BET HARD') || t.includes('OPPOSITE SIDE CONFLICT')) return 'BLOCCATA HARD';
  if (t.includes('BLOCCATA SOFT') || t.includes('BLOCKED SOFT') || t.includes('SOFT BLOCK') || t.includes('MODEL RISK STEP64')) return 'BLOCCATA SOFT';
  if (t.includes('NO BET') || t.includes('NO_BET')) return 'BLOCCATA / NO BET';
  return t;
}

function normalizeStats(input = {}) {
  const resolved = toNumber(input.resolved ?? input.resolvedSignals ?? input.risolte ?? input.closedSignals, null);
  const wins = toNumber(input.wins ?? input.won ?? input.vinte ?? input.wonSignals, 0);
  const losses = toNumber(input.losses ?? input.lost ?? input.perse ?? input.lostSignals, 0);
  const pending = toNumber(input.pending ?? input.pendenti ?? input.pendingSignals, 0);
  const totalSignals = toNumber(input.totalSignals ?? input.total ?? input.sample ?? input.historicalSample ?? (wins + losses + pending), wins + losses + pending);
  const resolvedSignals = Number.isFinite(resolved) ? resolved : (wins + losses);
  const signalWinRatePct = resolvedSignals > 0 ? (wins / resolvedSignals) * 100 : toNumber(input.signalWinRatePct ?? input.winRatePct, 0);
  const operationalResolved = toNumber(input.operationalResolved ?? input.operativo ?? input.operational ?? input.realBets ?? input.operationalSample, 0);
  const operationalPending = toNumber(input.operationalPending ?? input.operativoPending ?? 0, 0);
  const stakeReal = toNumber(input.stakeReal ?? input.totalStake ?? input.stake ?? input.realStake, 0);
  const profitReal = toNumber(input.profitReal ?? input.totalProfit ?? input.profit ?? input.realProfit, 0);
  const roiPct = stakeReal > 0 ? (profitReal / stakeReal) * 100 : toNumber(input.roiPct ?? input.historicalRoiPct, 0);
  const pendingRatePct = totalSignals > 0 ? (pending / totalSignals) * 100 : 0;

  return {
    totalSignals,
    resolvedSignals,
    wins,
    losses,
    pending,
    signalWinRatePct: round(signalWinRatePct, 2),
    operationalResolved,
    operationalPending,
    stakeReal: round(stakeReal, 2),
    profitReal: round(profitReal, 2),
    roiPct: round(roiPct, 2),
    pendingRatePct: round(pendingRatePct, 2)
  };
}

function isStep96CStrongRiskModelSoftSignal(stats = {}) {
  const s = normalizeStats(stats);
  const seniorSampleSignal = s.resolvedSignals >= 25 &&
    s.signalWinRatePct >= 58 &&
    s.pendingRatePct <= 35 &&
    (s.operationalResolved < 5 || s.roiPct >= 0);

  // STEP96D_RUNTIME_MICRO_TEST_PERSISTENCE_FIX
  // Il DB bootstrap corrente può avere meno di 25 risolte per un incrocio,
  // ma un segnale molto pulito non deve restare a stake 0 solo per soglia rigida.
  // Esempio reale: RISCHIO MODELLO + BLOCCATA SOFT con 9W/3L/4P, WR 75%, pending 25%.
  // Questo abilita SOLO micro-test, mai stake pieno o promozione automatica.
  const bootstrapMicroSignal = s.totalSignals >= 12 &&
    s.resolvedSignals >= 10 &&
    s.signalWinRatePct >= 65 &&
    s.pendingRatePct <= 35 &&
    (s.operationalResolved < 5 || s.roiPct >= 0);

  return seniorSampleSignal || bootstrapMicroSignal;
}

function evaluateStep96DeepScanGateCombinationDecision(input = {}) {
  const deepScan = normalizeStep96DeepScanCategory(input.deepScan ?? input.deepScanCategory ?? input.ds_action ?? input.dsAction ?? input.deep_scan_risk_level);
  const gate = normalizeStep96GateCategory(input.gate ?? input.gateCategory ?? input.qualityGate ?? input.tennis_operational_status ?? input.professional_gate_status);
  const stats = normalizeStats(input.stats || input.historicalStats || input);

  const base = {
    version: STEP96C_RUNTIME_MICRO_TEST_ACTIVATION,
    legacyVersion: STEP96_RISK_MODEL_SOFT_COMBINATION_RECALIBRATION,
    deepScan,
    gate,
    stats,
    action: 'SOLO_AUDIT',
    label: 'SOLO AUDIT',
    allowMicroStake: false,
    recommendedStake: 0,
    allowFullStake: false,
    reason: 'Campione insufficiente o combinazione non promossa.'
  };

  if (gate === 'BLOCCATA HARD' || deepScan === 'ALTO RISCHIO') {
    return {
      ...base,
      action: 'BLOCCA',
      label: 'BLOCCA',
      allowMicroStake: false,
      recommendedStake: 0,
      allowFullStake: false,
      reason: 'Hard veto o alto rischio: nessuno stake automatico.'
    };
  }

  if (deepScan === 'RISCHIO MODELLO' && gate === 'BLOCCATA SOFT') {
    const strongSignal = isStep96CStrongRiskModelSoftSignal(stats);
    if (strongSignal) {
      return {
        ...base,
        action: stats.operationalResolved < 5 ? 'MICRO_TEST' : 'WATCHLIST_MICRO',
        label: stats.operationalResolved < 5 ? 'MANTIENI · MICRO TEST' : 'MANTIENI · WATCHLIST MICRO',
        allowMicroStake: true,
        recommendedStake: 2,
        allowFullStake: false,
        reason: stats.operationalResolved < 5
          ? 'Rischio modello + blocco soft ha segnale storico positivo ma campione operativo reale basso: non stake 0 fisso, solo micro-stake controllato.'
          : 'Rischio modello + blocco soft ha segnale storico positivo: micro-stake consentito, non stake pieno.'
      };
    }
    return {
      ...base,
      action: 'SOLO_AUDIT',
      label: 'SOLO AUDIT',
      reason: 'Rischio modello + blocco soft senza conferma statistica sufficiente.'
    };
  }

  if (deepScan === 'EDGE TECNICO' && gate === 'WATCHLIST MICRO') {
    if (stats.roiPct < 0 && stats.operationalResolved >= 5) {
      return {
        ...base,
        action: 'RIDUCI',
        label: 'RIDUCI',
        allowMicroStake: false,
        recommendedStake: 0,
        reason: 'Edge tecnico in watchlist negativo su campione operativo: riduzione.'
      };
    }
    return {
      ...base,
      action: 'MICRO_TEST',
      label: 'MANTIENI · MICRO',
      allowMicroStake: true,
      recommendedStake: 2,
      allowFullStake: false,
      reason: 'Edge tecnico in watchlist resta solo micro finché il ROI operativo non è stabile.'
    };
  }

  if ((deepScan === 'VALUE CONFERMATO / MICRO' || deepScan === 'WATCHLIST LOW EDGE') && (gate === 'WATCHLIST MICRO' || gate === 'APPROVATA CON CAP')) {
    return {
      ...base,
      action: stats.operationalResolved >= 10 && stats.roiPct > 0 ? 'PROMUOVI' : 'MANTIENI',
      label: stats.operationalResolved >= 10 && stats.roiPct > 0 ? 'PROMUOVI' : 'MANTIENI',
      allowMicroStake: true,
      recommendedStake: 2,
      allowFullStake: false,
      reason: 'Combinazione positiva ma stake pieno subordinato a campione operativo stabile.'
    };
  }

  return base;
}

module.exports = {
  STEP96_RISK_MODEL_SOFT_COMBINATION_RECALIBRATION,
  STEP96C_RUNTIME_MICRO_TEST_ACTIVATION,
  normalizeStep96DeepScanCategory,
  normalizeStep96GateCategory,
  normalizeStats,
  isStep96CStrongRiskModelSoftSignal,
  evaluateStep96DeepScanGateCombinationDecision
};
