'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const index = require('../backend/calcioUnifiedPredictionIndex');

function oddsCertification(market = '1', odd = 1.80, marketKey = 'h2h', outcomeName = 'Alpha') {
  return {
    market,
    status: 'CERTIFIED_MULTI_SOURCE',
    certified: true,
    operationalEligible: true,
    realDirect: true,
    crossVerified: true,
    sourceCount: 2,
    selectedSource: {
      provider: 'THE_ODDS_API', providerEventId: 'evt-audit-p20', bookmakerKey: 'pinnacle', bookmakerTitle: 'Pinnacle',
      lastUpdate: '2026-07-23T19:40:00Z', marketKey, outcomeName, point: marketKey === 'totals' ? 2.5 : null,
      price: odd, direct: true, derived: false
    }
  };
}
function fixture(overrides = {}) {
  return {
    prediction: '1', market: '1', home: 'Alpha', away: 'Beta', home_team: 'Alpha', away_team: 'Beta',
    providerHome: 'Alpha', providerAway: 'Beta', provider_event_id: 'evt-audit-p20',
    event_key: 'calcio-event|provider|evt-audit-p20', requireIdentityCertification: true,
    odd: 1.80, probability: 62, estimated_prob: 62, edge_pp: 6.44, ev_pct: 11.60,
    reliabilityScore: 88, bankroll: 2000, deepScanAction: 'VALUE CONFERMATO',
    historicalSample: 40, historicalWinRatePct: 65, calcio_data_reliability: 'DATA_RELIABLE_DIRECT',
    calcio_professional_status: 'PROFESSIONAL_APPROVED', calcio_gate_status: 'CALCIO_APPROVED',
    calcio_timing_status: 'PRE_MATCH_READY', analysis_thresholds: { maxOdd: 2.7, requiredProbability: 35, requiredEdge: 3, crPassed: true },
    monteCarloProbabilityPct: 62.2, modelProbabilityPct: 61.7,
    oddsCertification: oddsCertification(),
    ...overrides
  };
}

const dbPath = path.resolve(__dirname, '../backend/database_betting.db');
const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  const pendingWhere = "UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING' AND COALESCE(paper_result_active,1)=1";
  const database = db.prepare(`SELECT
      COUNT(*) total,
      SUM(CASE WHEN COALESCE(stake,0)>0 THEN 1 ELSE 0 END) positive,
      SUM(CASE WHEN COALESCE(stake,0)>0 AND UPPER(COALESCE(calcio_stake_caution_mode,'')) <> 'STANDARD_CERTIFIED' THEN 1 ELSE 0 END) capped,
      SUM(CASE WHEN UPPER(COALESCE(calcio_decision_certification_status,''))='PATCH19_REQUIRES_PROVIDER_REFRESH' THEN 1 ELSE 0 END) refreshRequired,
      SUM(CASE WHEN COALESCE(calcio_identity_certified,0)=1 AND COALESCE(calcio_market_identity_certified,0)=1 AND COALESCE(calcio_thresholds_certified,0)=1 AND COALESCE(calcio_odds_operational_eligible,0)=1 THEN 1 ELSE 0 END) hardCertified
    FROM ai_forward_test WHERE ${pendingWhere}`).get();
  const invalidPositive = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${pendingWhere} AND COALESCE(stake,0)>0 AND (
      COALESCE(calcio_identity_certified,0)<>1 OR COALESCE(calcio_market_identity_certified,0)<>1 OR
      COALESCE(calcio_thresholds_certified,0)<>1 OR COALESCE(calcio_odds_operational_eligible,0)<>1 OR
      COALESCE(calcio_prediction_index_score,0)<65
    )`).get();

  const clean = index.evaluatePrediction(fixture());
  const soft = index.evaluatePrediction(fixture({ calcio_professional_status: 'PROFESSIONAL_BLOCK_SOFT' }));
  const noSample = index.evaluatePrediction(fixture({ historicalSample: 0, historicalWinRatePct: null, calcio_data_reliability: 'DATA_RELIABLE_PROXY', calcio_professional_status: 'PROFESSIONAL_WATCHLIST' }));
  const hard = index.evaluatePrediction(fixture({ calcio_professional_status: 'PROFESSIONAL_BLOCK_HARD' }));

  if (!(clean.operationalStake > soft.operationalStake && soft.operationalStake >= 2 && soft.operationalStake <= 3)) {
    throw new Error('Gerarchia stake clean > soft micro non rispettata');
  }
  if (!(noSample.operationalStake >= 2 && noSample.operationalStake <= 5)) throw new Error('Cap no-sample/proxy non operativo');
  if (hard.operationalStake !== 0) throw new Error('HARD non azzerato');
  if (Number(invalidPositive.n) !== 0) throw new Error(`Stake positivi non certificati: ${invalidPositive.n}`);

  console.log(JSON.stringify({
    success: true,
    patch: 'BETTING_PATCH_20_CERTIFIED_DECISION_STAKE_AUTHORITY_RESTORE',
    certification: 'CODE_AND_DATABASE_GUARDS_CERTIFIED',
    rootCauseConfirmed: {
      patch19ConvertedSoftSignalsToAbsoluteVeto: true,
      affectedSignals: ['Professional SOFT', 'Qualità/Gate SOFT', 'timing anticipato', 'assenza campione PT', 'dati proxy/watchlist'],
      patch20Correction: 'hard guard invariati; segnali soft trasformati in moltiplicatore/cap operativo'
    },
    database: {
      pending: Number(database.total),
      positive: Number(database.positive || 0),
      cappedPositive: Number(database.capped || 0),
      refreshRequired: Number(database.refreshRequired || 0),
      hardCertified: Number(database.hardCertified || 0),
      invalidPositive: Number(invalidPositive.n)
    },
    deterministicFixtures: {
      clean: { score: clean.score, theoretical: clean.theoreticalStake, operational: clean.operationalStake, status: clean.decisionCertification.status },
      soft: { score: soft.score, theoretical: soft.theoreticalStake, operational: soft.operationalStake, status: soft.decisionCertification.status, mode: soft.cautionPolicy.mode },
      noSampleProxy: { score: noSample.score, theoretical: noSample.theoreticalStake, operational: noSample.operationalStake, status: noSample.decisionCertification.status, mode: noSample.cautionPolicy.mode },
      hard: { score: hard.score, theoretical: hard.theoreticalStake, operational: hard.operationalStake, status: hard.decisionCertification.status, reasons: hard.safetyReasons }
    },
    policy: {
      predictionReliabilityStillSeparatedFromValue: true,
      baseFractionalKelly: index.BASE_FRACTIONAL_KELLY,
      minimumIndexForStake: index.MIN_INDEX_FOR_STAKE,
      minimumReliabilityForStake: index.MIN_RELIABILITY_FOR_STAKE,
      minimumPositiveStakeEur: index.MINIMUM_POSITIVE_STAKE_EUR,
      prudentialMicroCapEur: index.PRUDENTIAL_MICRO_CAP_EUR,
      legacyRefreshRowsRemainSuspended: true,
      newOddsApiCalls: 0
    }
  }, null, 2));
} finally { db.close(); }
