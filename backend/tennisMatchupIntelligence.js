'use strict';

const crypto = require('crypto');
const tennisPlayerEvidence = require('./tennisPlayerEvidence');
const tennisShadowFeatureEnrichment = require('./tennisShadowFeatureEnrichment');

const TENNIS_MATCHUP_INTELLIGENCE_VERSION = 'TENNIS_MATCHUP_INTELLIGENCE_V3_PATCH22';
const TENNIS_CHALLENGER_MODEL_VERSION = 'TENNIS_CHALLENGER_MATCHUP_V3_PATCH22';
const MODE = 'SHADOW_ONLY_NO_STAKE_AUTHORITY';
const AUDIT16D_R3_T3_REVISION = tennisShadowFeatureEnrichment.AUDIT16D_R3_T3_REVISION;

function finite(value, fallback = null) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function text(value) { return String(value ?? '').trim(); }
function upper(value) { return text(value).toUpperCase(); }
function sha256(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function tableExists(db, table) {
  return Number(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(table).n) === 1;
}
function triggerExists(db, trigger) {
  return Number(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger).n) === 1;
}
function ensureMatchupIntelligenceSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tennis_player_evidence_snapshots (
      evidence_id TEXT PRIMARY KEY,
      bet_id INTEGER NOT NULL,
      prediction_snapshot_id TEXT NOT NULL,
      player_side TEXT NOT NULL CHECK(player_side IN ('P1','P2')),
      player_name TEXT NOT NULL,
      normalized_name TEXT,
      opponent_name TEXT,
      as_of_at TEXT NOT NULL,
      surface TEXT,
      tour_type TEXT,
      evidence_status TEXT NOT NULL,
      evidence_reason TEXT,
      source_tier TEXT,
      source_files_json TEXT,
      observed_at TEXT,
      freshness_status TEXT,
      freshness_days REAL,
      source_target_id TEXT,
      source_provider_id TEXT,
      source_freshness_status TEXT,
      source_freshness_days REAL,
      activity_status TEXT,
      activity_days REAL,
      source_freshness_penalty REAL,
      activity_penalty REAL,
      sample_total INTEGER,
      sample_surface INTEGER,
      sample_recent INTEGER,
      coverage_score REAL,
      confidence_score REAL,
      overall_elo REAL,
      surface_elo REAL,
      current_rank REAL,
      recent_win_rate REAL,
      recent_quality_score REAL,
      surface_win_rate REAL,
      serve_points_won REAL,
      return_points_won REAL,
      first_serve_in REAL,
      first_serve_won REAL,
      second_serve_won REAL,
      ace_rate REAL,
      double_fault_rate REAL,
      hold_proxy REAL,
      break_proxy REAL,
      break_points_saved REAL,
      deciding_set_win_rate REAL,
      tiebreak_win_rate REAL,
      rest_days REAL,
      matches_7d INTEGER,
      matches_14d INTEGER,
      minutes_14d INTEGER,
      fatigue_score REAL,
      retirement_90d INTEGER,
      surface_transition_days REAL,
      evidence_hash TEXT NOT NULL,
      feature_version TEXT NOT NULL,
      operation_id TEXT,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      UNIQUE(prediction_snapshot_id, player_side)
    );
    CREATE INDEX IF NOT EXISTS idx_tennis_player_evidence_bet ON tennis_player_evidence_snapshots(bet_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_tennis_player_evidence_name ON tennis_player_evidence_snapshots(normalized_name, as_of_at);

    CREATE TABLE IF NOT EXISTS tennis_matchup_feature_snapshots (
      matchup_id TEXT PRIMARY KEY,
      bet_id INTEGER NOT NULL,
      prediction_snapshot_id TEXT NOT NULL UNIQUE,
      p1_evidence_id TEXT NOT NULL,
      p2_evidence_id TEXT NOT NULL,
      player1_name TEXT NOT NULL,
      player2_name TEXT NOT NULL,
      as_of_at TEXT NOT NULL,
      surface TEXT,
      matchup_status TEXT NOT NULL,
      matchup_label TEXT NOT NULL,
      coverage_score REAL,
      confidence_score REAL,
      source_target_id TEXT,
      source_provider_id TEXT,
      source_freshness_status TEXT,
      source_freshness_days REAL,
      activity_risk_status TEXT,
      feature_probability_p1 REAL,
      feature_probability_p2 REAL,
      p1_serve_matchup REAL,
      p2_serve_matchup REAL,
      h2h_p1_wins INTEGER,
      h2h_p2_wins INTEGER,
      components_json TEXT,
      problems_json TEXT,
      feature_hash TEXT NOT NULL,
      feature_version TEXT NOT NULL,
      operation_id TEXT,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(p1_evidence_id) REFERENCES tennis_player_evidence_snapshots(evidence_id),
      FOREIGN KEY(p2_evidence_id) REFERENCES tennis_player_evidence_snapshots(evidence_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tennis_matchup_features_bet ON tennis_matchup_feature_snapshots(bet_id, created_at);

    CREATE TABLE IF NOT EXISTS tennis_challenger_predictions (
      challenger_id TEXT PRIMARY KEY,
      bet_id INTEGER NOT NULL,
      prediction_snapshot_id TEXT NOT NULL UNIQUE,
      matchup_id TEXT NOT NULL,
      cohort_id TEXT,
      cohort_role TEXT,
      market_type TEXT,
      selected_side TEXT,
      challenger_status TEXT NOT NULL,
      challenger_mode TEXT NOT NULL,
      market_probability_p1 REAL,
      market_probability_p2 REAL,
      production_probability_p1 REAL,
      production_probability_p2 REAL,
      challenger_probability_p1 REAL,
      challenger_probability_p2 REAL,
      selected_production_probability REAL,
      selected_challenger_probability REAL,
      probability_delta_pp REAL,
      uncertainty_low_pct REAL,
      uncertainty_high_pct REAL,
      coverage_score REAL,
      confidence_score REAL,
      source_target_id TEXT,
      source_provider_id TEXT,
      source_freshness_status TEXT,
      source_freshness_days REAL,
      activity_risk_status TEXT,
      matchup_label TEXT,
      matchup_status TEXT,
      prediction_hash TEXT NOT NULL,
      model_version TEXT NOT NULL,
      operation_id TEXT,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(matchup_id) REFERENCES tennis_matchup_feature_snapshots(matchup_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tennis_challenger_bet ON tennis_challenger_predictions(bet_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_tennis_challenger_status ON tennis_challenger_predictions(challenger_status, cohort_role);

    CREATE TRIGGER IF NOT EXISTS trg_tennis_player_evidence_no_update BEFORE UPDATE ON tennis_player_evidence_snapshots
      BEGIN SELECT RAISE(ABORT, 'PATCH12_PLAYER_EVIDENCE_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_player_evidence_no_delete BEFORE DELETE ON tennis_player_evidence_snapshots
      BEGIN SELECT RAISE(ABORT, 'PATCH12_PLAYER_EVIDENCE_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_matchup_features_no_update BEFORE UPDATE ON tennis_matchup_feature_snapshots
      BEGIN SELECT RAISE(ABORT, 'PATCH12_MATCHUP_FEATURES_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_matchup_features_no_delete BEFORE DELETE ON tennis_matchup_feature_snapshots
      BEGIN SELECT RAISE(ABORT, 'PATCH12_MATCHUP_FEATURES_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_challenger_no_update BEFORE UPDATE ON tennis_challenger_predictions
      BEGIN SELECT RAISE(ABORT, 'PATCH12_CHALLENGER_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_challenger_no_delete BEFORE DELETE ON tennis_challenger_predictions
      BEGIN SELECT RAISE(ABORT, 'PATCH12_CHALLENGER_IMMUTABLE'); END;
  `);
  const patch22Columns = {
    tennis_player_evidence_snapshots: [
      ['source_target_id', 'TEXT'], ['source_provider_id', 'TEXT'], ['source_freshness_status', 'TEXT'],
      ['source_freshness_days', 'REAL'], ['activity_status', 'TEXT'], ['activity_days', 'REAL'],
      ['source_freshness_penalty', 'REAL'], ['activity_penalty', 'REAL']
    ],
    tennis_matchup_feature_snapshots: [
      ['source_target_id', 'TEXT'], ['source_provider_id', 'TEXT'], ['source_freshness_status', 'TEXT'],
      ['source_freshness_days', 'REAL'], ['activity_risk_status', 'TEXT']
    ],
    tennis_challenger_predictions: [
      ['source_target_id', 'TEXT'], ['source_provider_id', 'TEXT'], ['source_freshness_status', 'TEXT'],
      ['source_freshness_days', 'REAL'], ['activity_risk_status', 'TEXT']
    ]
  };
  for (const [table, columns] of Object.entries(patch22Columns)) {
    const present = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    for (const [column, type] of columns) {
      if (!present.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }
  return {
    version: TENNIS_MATCHUP_INTELLIGENCE_VERSION,
    tables: ['tennis_player_evidence_snapshots', 'tennis_matchup_feature_snapshots', 'tennis_challenger_predictions'],
    immutable: true
  };
}
function noVigProbability(odd1, odd2) {
  const o1 = finite(odd1, null); const o2 = finite(odd2, null);
  if (!(o1 > 1) || !(o2 > 1)) return null;
  const a = 1 / o1; const b = 1 / o2; const total = a + b;
  return { p1: a / total * 100, p2: b / total * 100 };
}
function probabilityContext(row = {}, bet = {}) {
  const prediction = text(bet.prediction || row.prediction);
  const selectedProduction = finite(bet.estimatedProb ?? row.estimated_prob, 50);
  const productionP1 = prediction === '2' ? 100 - selectedProduction : prediction === '1' ? selectedProduction : 50;
  const productionP2 = 100 - productionP1;
  const reference = noVigProbability(
    bet.referenceOdd1 ?? bet.odd1 ?? row.reference_odd1,
    bet.referenceOdd2 ?? bet.odd2 ?? row.reference_odd2
  );
  let marketP1 = reference?.p1 ?? null; let marketP2 = reference?.p2 ?? null;
  const selectedMarket = finite(bet.marketImpliedProbability ?? row.market_implied_prob, null);
  if (marketP1 === null && selectedMarket !== null) {
    marketP1 = prediction === '2' ? 100 - selectedMarket : selectedMarket;
    marketP2 = 100 - marketP1;
  }
  if (marketP1 === null) { marketP1 = productionP1; marketP2 = productionP2; }
  return { prediction, productionP1, productionP2, marketP1, marketP2 };
}
function attachT3ShadowSnapshot(row = {}, bet = {}, options = {}, matchup = {}, challenger = {}) {
  const shadowFeatureSnapshot = tennisShadowFeatureEnrichment.buildShadowFeatureSnapshot({ row, bet, options, matchup, challenger });
  const enrichedMatchup = { ...matchup, shadowFeatureSnapshot };
  const enrichedChallenger = { ...challenger, shadowFeatureSnapshot };
  return { matchup: enrichedMatchup, challenger: enrichedChallenger, shadowFeatureSnapshot };
}
function buildUnavailableIntelligence(row = {}, bet = {}, options = {}, error = null) {
  const player1 = text(bet.home || row.home_team || 'PLAYER_1_UNKNOWN');
  const player2 = text(bet.away || row.away_team || 'PLAYER_2_UNKNOWN');
  const surface = text(bet.surface || row.surface || 'Unknown');
  const asOfAt = text(bet.canonical_match_datetime || row.canonical_match_datetime || bet.date || row.match_date) || new Date().toISOString();
  const reason = `PLAYER_EVIDENCE_ENGINE_ERROR:${text(error?.message || error || 'UNKNOWN')}`;
  const makeEvidence = (playerName, opponentName, side) => {
    const core = {
      version: tennisPlayerEvidence.TENNIS_PLAYER_EVIDENCE_VERSION,
      status: 'UNAVAILABLE', reason, sourceTier: tennisPlayerEvidence.SOURCE_TIER,
      playerName, normalizedName: upper(playerName), identityStatus: 'UNAVAILABLE', opponentName,
      surface, asOfAt, observedAt: null, freshnessStatus: 'UNAVAILABLE', freshnessDays: null,
      sourceFiles: [], sampleTotal: 0, sampleSurface: 0, sampleRecent: 0,
      coverageScore: 0, confidenceScore: 0, side
    };
    return { ...core, evidenceHash: sha256(stableJson(core)) };
  };
  const p1 = makeEvidence(player1, player2, 'P1');
  const p2 = makeEvidence(player2, player1, 'P2');
  const matchupCore = {
    version: tennisPlayerEvidence.TENNIS_MATCHUP_FEATURE_VERSION,
    status: 'INSUFFICIENT_EVIDENCE', problems: [reason], player1, player2, surface, asOfAt,
    matchupLabel: 'INSUFFICIENT_EVIDENCE', coverageScore: 0, confidenceScore: 0,
    featureProbabilityP1: 0.5, featureProbabilityP2: 0.5, p1ServeMatchup: null, p2ServeMatchup: null,
    h2h: { p1Wins: 0, p2Wins: 0 }, components: [], p1EvidenceHash: p1.evidenceHash, p2EvidenceHash: p2.evidenceHash
  };
  const matchup = { ...matchupCore, featureHash: sha256(stableJson(matchupCore)), p1, p2 };
  const probabilities = probabilityContext(row, bet);
  const challengerCore = {
    version: TENNIS_CHALLENGER_MODEL_VERSION, mode: MODE, status: 'ENGINE_ERROR_AUDIT_ONLY',
    player1, player2, prediction: probabilities.prediction || null, marketType: bet.marketType || row.market_type || 'h2h',
    asOfAt, marketProbabilityP1: probabilities.marketP1, marketProbabilityP2: probabilities.marketP2,
    productionProbabilityP1: probabilities.productionP1, productionProbabilityP2: probabilities.productionP2,
    challengerProbabilityP1: probabilities.productionP1, challengerProbabilityP2: probabilities.productionP2,
    selectedSide: probabilities.prediction === '2' ? 'P2' : probabilities.prediction === '1' ? 'P1' : null,
    selectedProductionProbability: probabilities.prediction === '2' ? probabilities.productionP2 : probabilities.prediction === '1' ? probabilities.productionP1 : null,
    selectedChallengerProbability: probabilities.prediction === '2' ? probabilities.productionP2 : probabilities.prediction === '1' ? probabilities.productionP1 : null,
    probabilityDeltaPp: 0, uncertaintyLowPct: null, uncertaintyHighPct: null, confidenceScore: 0, coverageScore: 0,
    matchupLabel: matchup.matchupLabel, matchupStatus: matchup.status, matchupFeatureHash: matchup.featureHash, reason
  };
  const challenger = { ...challengerCore, predictionHash: sha256(stableJson(challengerCore)), matchup };
  const enriched = attachT3ShadowSnapshot(row, bet, options, matchup, challenger);
  return { version: TENNIS_MATCHUP_INTELLIGENCE_VERSION, audit16dRevision: AUDIT16D_R3_T3_REVISION, mode: MODE, ...enriched, engineError: reason };
}

function buildIntelligenceForBet(row = {}, bet = {}, options = {}) {
  try {
  const player1 = text(bet.home || row.home_team);
  const player2 = text(bet.away || row.away_team);
  const surface = text(bet.surface || row.surface || 'Hard');
  const tour = text(options.tour || bet.tour_type || row.tour_type || bet.league || row.league);
  const asOf = bet.canonical_match_datetime || row.canonical_match_datetime || bet.date || row.match_date;
  const precomputed = bet.playerMatchupIntelligence || bet.matchupIntelligence || null;
  const matchup = precomputed?.matchup && precomputed.matchup.featureHash
    ? precomputed.matchup
    : tennisPlayerEvidence.buildMatchupEvidence(player1, player2, surface, asOf, { dataDir: options.dataDir, tour, historicalDatasetPath: options.historicalDatasetPath });
  const probabilities = probabilityContext(row, bet);
  const challenger = precomputed?.challenger && precomputed.challenger.predictionHash
    ? precomputed.challenger
    : tennisPlayerEvidence.buildChallengerPrediction({
        player1, player2, surface, asOf,
        marketProbabilityP1: probabilities.marketP1,
        marketProbabilityP2: probabilities.marketP2,
        productionProbabilityP1: probabilities.productionP1,
        productionProbabilityP2: probabilities.productionP2,
        prediction: probabilities.prediction,
        marketType: bet.marketType || row.market_type || 'h2h',
        matchup
      }, { dataDir: options.dataDir, tour, historicalDatasetPath: options.historicalDatasetPath });
  let finalChallenger = challenger;
  if (upper(options.snapshotStatus) === 'POST_START_INVALID') {
    const temporal = { ...challenger, status: 'TEMPORAL_LEAKAGE_BLOCKED', mode: MODE, reason: 'PREDICTION_SNAPSHOT_POST_START_INVALID' };
    delete temporal.predictionHash;
    finalChallenger = { ...temporal, predictionHash: sha256(stableJson(temporal)) };
  }
  const enriched = attachT3ShadowSnapshot(row, bet, options, matchup, finalChallenger);
  return { version: TENNIS_MATCHUP_INTELLIGENCE_VERSION, audit16dRevision: AUDIT16D_R3_T3_REVISION, mode: MODE, ...enriched };
  } catch (error) {
    return buildUnavailableIntelligence(row, bet, options, error);
  }
}
function evidenceId(snapshotId, side, evidenceHash) { return `TPE12_${sha256(`${snapshotId}|${side}|${evidenceHash}`).slice(0, 24)}`; }
function matchupId(snapshotId, featureHash) { return `TMF12_${sha256(`${snapshotId}|${featureHash}`).slice(0, 24)}`; }
function challengerId(snapshotId, predictionHash) { return `TCP12_${sha256(`${snapshotId}|${predictionHash}`).slice(0, 24)}`; }
function existingBySnapshot(db, table, snapshotId) {
  return db.prepare(`SELECT * FROM ${table} WHERE prediction_snapshot_id=?`).get(snapshotId) || null;
}
function insertEvidence(db, values) {
  db.prepare(`INSERT INTO tennis_player_evidence_snapshots (
    evidence_id,bet_id,prediction_snapshot_id,player_side,player_name,normalized_name,opponent_name,as_of_at,surface,tour_type,
    evidence_status,evidence_reason,source_tier,source_files_json,observed_at,freshness_status,freshness_days,
    source_target_id,source_provider_id,source_freshness_status,source_freshness_days,activity_status,activity_days,source_freshness_penalty,activity_penalty,
    sample_total,sample_surface,sample_recent,coverage_score,confidence_score,overall_elo,surface_elo,current_rank,
    recent_win_rate,recent_quality_score,surface_win_rate,serve_points_won,return_points_won,first_serve_in,first_serve_won,
    second_serve_won,ace_rate,double_fault_rate,hold_proxy,break_proxy,break_points_saved,deciding_set_win_rate,tiebreak_win_rate,
    rest_days,matches_7d,matches_14d,minutes_14d,fatigue_score,retirement_90d,surface_transition_days,evidence_hash,
    feature_version,operation_id,created_at,payload_json
  ) VALUES (${Array(60).fill('?').join(',')})`).run(...values);
}
function persistMatchupIntelligenceForBet(db, row = {}, bet = {}, options = {}) {
  ensureMatchupIntelligenceSchema(db);
  const betId = Number(row.id || options.betId);
  const snapshotId = text(options.snapshotId);
  if (!(betId > 0)) throw new Error('PATCH12_BET_ID_REQUIRED');
  if (!snapshotId) throw new Error('PATCH12_PREDICTION_SNAPSHOT_ID_REQUIRED');
  const existing = existingBySnapshot(db, 'tennis_challenger_predictions', snapshotId);
  if (existing) return { persisted: false, duplicate: true, challenger: existing, snapshotId };
  const intelligence = buildIntelligenceForBet(row, bet, options);
  const matchup = intelligence.matchup; const challenger = intelligence.challenger;
  const now = new Date().toISOString(); const operationId = text(options.operationId) || null;
  const p1EvidenceId = evidenceId(snapshotId, 'P1', matchup.p1.evidenceHash || sha256(matchup.p1));
  const p2EvidenceId = evidenceId(snapshotId, 'P2', matchup.p2.evidenceHash || sha256(matchup.p2));
  const insertOne = (evidence, side, id) => {
    const found = db.prepare('SELECT evidence_hash FROM tennis_player_evidence_snapshots WHERE prediction_snapshot_id=? AND player_side=?').get(snapshotId, side);
    if (found) {
      if (found.evidence_hash !== evidence.evidenceHash) throw new Error(`PATCH12_EVIDENCE_CONFLICT:${snapshotId}:${side}`);
      return;
    }
    insertEvidence(db, [
      id, betId, snapshotId, side, evidence.playerName || (side === 'P1' ? row.home_team : row.away_team), evidence.normalizedName || null,
      evidence.opponentName || null, evidence.asOfAt || matchup.asOfAt || now, evidence.surface || matchup.surface || null, row.tour_type || bet.tour_type || null,
      evidence.status || 'UNAVAILABLE', evidence.reason || null, evidence.sourceTier || tennisPlayerEvidence.SOURCE_TIER,
      JSON.stringify(evidence.sourceFiles || []), evidence.observedAt || null, evidence.freshnessStatus || null, finite(evidence.freshnessDays, null),
      evidence.sourceTargetId || null, evidence.sourceProviderId || null, evidence.sourceFreshnessStatus || evidence.freshnessStatus || null,
      finite(evidence.sourceFreshnessDays ?? evidence.freshnessDays, null), evidence.activityStatus || null, finite(evidence.activityDays ?? evidence.restDays, null),
      finite(evidence.sourceFreshnessPenalty, 0), finite(evidence.activityPenalty, 0),
      finite(evidence.sampleTotal, 0), finite(evidence.sampleSurface, 0), finite(evidence.sampleRecent, 0), finite(evidence.coverageScore, 0), finite(evidence.confidenceScore, 0),
      finite(evidence.overallElo, null), finite(evidence.surfaceElo, null), finite(evidence.currentRank, null), finite(evidence.recentWinRate, null),
      finite(evidence.recentQualityScore, null), finite(evidence.surfaceWinRate, null), finite(evidence.servePointsWon, null), finite(evidence.returnPointsWon, null),
      finite(evidence.firstServeIn, null), finite(evidence.firstServeWon, null), finite(evidence.secondServeWon, null), finite(evidence.aceRate, null),
      finite(evidence.doubleFaultRate, null), finite(evidence.holdProxy, null), finite(evidence.breakProxy, null), finite(evidence.breakPointsSaved, null),
      finite(evidence.decidingSetWinRate, null), finite(evidence.tiebreakWinRate, null), finite(evidence.restDays, null), finite(evidence.matches7d, 0),
      finite(evidence.matches14d, 0), finite(evidence.minutes14d, 0), finite(evidence.fatigueScore, null), finite(evidence.retirement90d, 0),
      finite(evidence.surfaceTransitionDays, null), evidence.evidenceHash || sha256(stableJson(evidence)), tennisPlayerEvidence.TENNIS_PLAYER_EVIDENCE_VERSION,
      operationId, now, JSON.stringify(evidence)
    ]);
  };
  insertOne(matchup.p1, 'P1', p1EvidenceId); insertOne(matchup.p2, 'P2', p2EvidenceId);
  const matchId = matchupId(snapshotId, matchup.featureHash);
  db.prepare(`INSERT INTO tennis_matchup_feature_snapshots (
    matchup_id,bet_id,prediction_snapshot_id,p1_evidence_id,p2_evidence_id,player1_name,player2_name,as_of_at,surface,
    matchup_status,matchup_label,coverage_score,confidence_score,source_target_id,source_provider_id,source_freshness_status,source_freshness_days,activity_risk_status,
    feature_probability_p1,feature_probability_p2,p1_serve_matchup,p2_serve_matchup,h2h_p1_wins,h2h_p2_wins,components_json,problems_json,feature_hash,feature_version,
    operation_id,created_at,payload_json
  ) VALUES (${Array(31).fill('?').join(',')})`).run(
    matchId, betId, snapshotId, p1EvidenceId, p2EvidenceId, matchup.player1, matchup.player2, matchup.asOfAt || now, matchup.surface || null,
    matchup.status, matchup.matchupLabel, finite(matchup.coverageScore, 0), finite(matchup.confidenceScore, 0),
    matchup.sourceTargetId || null, matchup.sourceProviderId || null, matchup.sourceFreshnessStatus || null,
    finite(matchup.sourceFreshnessDays, null), matchup.activityRiskStatus || null,
    finite(matchup.featureProbabilityP1, 0.5) * 100, finite(matchup.featureProbabilityP2, 0.5) * 100,
    finite(matchup.p1ServeMatchup, null), finite(matchup.p2ServeMatchup, null), finite(matchup.h2h?.p1Wins, 0), finite(matchup.h2h?.p2Wins, 0),
    JSON.stringify(matchup.components || []), JSON.stringify(matchup.problems || []), matchup.featureHash, tennisPlayerEvidence.TENNIS_MATCHUP_FEATURE_VERSION,
    operationId, now, JSON.stringify(matchup)
  );
  const cohort = options.cohort || null;
  const challengeId = challengerId(snapshotId, challenger.predictionHash);
  db.prepare(`INSERT INTO tennis_challenger_predictions (
    challenger_id,bet_id,prediction_snapshot_id,matchup_id,cohort_id,cohort_role,market_type,selected_side,challenger_status,
    challenger_mode,market_probability_p1,market_probability_p2,production_probability_p1,production_probability_p2,
    challenger_probability_p1,challenger_probability_p2,selected_production_probability,selected_challenger_probability,
    probability_delta_pp,uncertainty_low_pct,uncertainty_high_pct,coverage_score,confidence_score,
    source_target_id,source_provider_id,source_freshness_status,source_freshness_days,activity_risk_status,matchup_label,matchup_status,
    prediction_hash,model_version,operation_id,created_at,payload_json
  ) VALUES (${Array(35).fill('?').join(',')})`).run(
    challengeId, betId, snapshotId, matchId, cohort?.cohort_id || null, cohort?.cohort_role || null,
    challenger.marketType || row.market_type || null, challenger.selectedSide || null, challenger.status, MODE,
    finite(challenger.marketProbabilityP1, null), finite(challenger.marketProbabilityP2, null),
    finite(challenger.productionProbabilityP1, null), finite(challenger.productionProbabilityP2, null),
    finite(challenger.challengerProbabilityP1, null), finite(challenger.challengerProbabilityP2, null),
    finite(challenger.selectedProductionProbability, null), finite(challenger.selectedChallengerProbability, null),
    finite(challenger.probabilityDeltaPp, null), finite(challenger.uncertaintyLowPct, null), finite(challenger.uncertaintyHighPct, null),
    finite(challenger.coverageScore, 0), finite(challenger.confidenceScore, 0),
    matchup.sourceTargetId || null, matchup.sourceProviderId || null, matchup.sourceFreshnessStatus || null,
    finite(matchup.sourceFreshnessDays, null), matchup.activityRiskStatus || null,
    challenger.matchupLabel || matchup.matchupLabel, challenger.matchupStatus || matchup.status,
    challenger.predictionHash, TENNIS_CHALLENGER_MODEL_VERSION, operationId, now, JSON.stringify(challenger)
  );
  return { persisted: true, duplicate: false, betId, snapshotId, p1EvidenceId, p2EvidenceId, matchupId: matchId, challengerId: challengeId, intelligence };
}
function getBetIntelligence(db, betId) {
  const required = ['tennis_player_evidence_snapshots','tennis_matchup_feature_snapshots','tennis_challenger_predictions'];
  if (!required.every(table => tableExists(db, table))) {
    return { success: false, healthy: false, status: 'SCHEMA_MISSING', version: TENNIS_MATCHUP_INTELLIGENCE_VERSION, mode: MODE, betId: Number(betId), readOnly: true };
  }
  const challengers = db.prepare(`SELECT challenger_id,bet_id,prediction_snapshot_id,cohort_id,cohort_role,market_type,selected_side,
    challenger_status,challenger_mode,market_probability_p1,market_probability_p2,production_probability_p1,production_probability_p2,
    challenger_probability_p1,challenger_probability_p2,selected_production_probability,selected_challenger_probability,
    probability_delta_pp,uncertainty_low_pct,uncertainty_high_pct,coverage_score,confidence_score,
    source_target_id,source_provider_id,source_freshness_status,source_freshness_days,activity_risk_status,matchup_label,matchup_status,
    model_version,operation_id,created_at FROM tennis_challenger_predictions WHERE bet_id=? ORDER BY created_at DESC`).all(Number(betId));
  const matchup = db.prepare(`SELECT matchup_id,bet_id,prediction_snapshot_id,player1_name,player2_name,as_of_at,surface,matchup_status,
    matchup_label,coverage_score,confidence_score,source_target_id,source_provider_id,source_freshness_status,source_freshness_days,activity_risk_status,
    feature_probability_p1,feature_probability_p2,p1_serve_matchup,p2_serve_matchup,h2h_p1_wins,h2h_p2_wins,feature_version,operation_id,created_at FROM tennis_matchup_feature_snapshots WHERE bet_id=? ORDER BY created_at DESC`).all(Number(betId));
  const players = db.prepare(`SELECT evidence_id,bet_id,prediction_snapshot_id,player_side,player_name,normalized_name,opponent_name,as_of_at,
    surface,evidence_status,evidence_reason,source_tier,observed_at,freshness_status,freshness_days,
    source_target_id,source_provider_id,source_freshness_status,source_freshness_days,activity_status,activity_days,source_freshness_penalty,activity_penalty,
    sample_total,sample_surface,sample_recent,coverage_score,confidence_score,overall_elo,surface_elo,current_rank,recent_win_rate,recent_quality_score,surface_win_rate,
    serve_points_won,return_points_won,hold_proxy,break_proxy,rest_days,matches_14d,fatigue_score,retirement_90d,feature_version,
    operation_id,created_at FROM tennis_player_evidence_snapshots WHERE bet_id=? ORDER BY created_at DESC, player_side`).all(Number(betId));
  return { success: true, version: TENNIS_MATCHUP_INTELLIGENCE_VERSION, mode: MODE, betId: Number(betId), challengers, matchup, players };
}
function getIntelligenceHealth(db, options = {}) {
  const required = ['tennis_player_evidence_snapshots','tennis_matchup_feature_snapshots','tennis_challenger_predictions'];
  const tablesPresent = required.every(table => tableExists(db, table));
  if (!tablesPresent) {
    return {
      success: false, healthy: false, status: 'SCHEMA_MISSING', version: TENNIS_MATCHUP_INTELLIGENCE_VERSION,
      playerEvidenceVersion: tennisPlayerEvidence.TENNIS_PLAYER_EVIDENCE_VERSION,
      matchupFeatureVersion: tennisPlayerEvidence.TENNIS_MATCHUP_FEATURE_VERSION,
      challengerModelVersion: TENNIS_CHALLENGER_MODEL_VERSION, mode: MODE,
      productionProbabilityChangedByChallenger: false, stakeAuthority: false, deepScanSeparate: true,
      counts: { evidenceRows: 0, matchupRows: 0, challengerRows: 0 },
      metrics: { avgCoverage: null, avgConfidence: null, avgAbsDeltaPp: null, strongDivergence: 0, evidenceWarnings: 0 },
      dataEngine: tennisPlayerEvidence.getStatus(), integrity: { tablesPresent: false, immutableTriggers: false, orphanMatchups: 0, orphanChallengers: 0 },
      recent: [], readOnly: true, note: 'Schema Patch 12 non installato. Eseguire la migrazione prima di usare il monitor.'
    };
  }
  const limit = Math.max(1, Math.min(100, Number(options.limit || 20)));
  const evidenceRows = Number(db.prepare('SELECT COUNT(*) n FROM tennis_player_evidence_snapshots').get().n);
  const matchupRows = Number(db.prepare('SELECT COUNT(*) n FROM tennis_matchup_feature_snapshots').get().n);
  const challengerRows = Number(db.prepare('SELECT COUNT(*) n FROM tennis_challenger_predictions').get().n);
  const statuses = db.prepare('SELECT challenger_status status, COUNT(*) n FROM tennis_challenger_predictions GROUP BY challenger_status').all();
  const statusCounts = Object.fromEntries(statuses.map(row => [row.status, Number(row.n)]));
  const metrics = db.prepare(`SELECT AVG(coverage_score) avgCoverage, AVG(confidence_score) avgConfidence,
    AVG(ABS(COALESCE(probability_delta_pp,0))) avgAbsDelta,
    SUM(CASE WHEN challenger_status='SHADOW_DIVERGENCE_STRONG' THEN 1 ELSE 0 END) strongDivergence,
    SUM(CASE WHEN challenger_status IN ('INSUFFICIENT_EVIDENCE','STALE_EVIDENCE') THEN 1 ELSE 0 END) evidenceWarnings
    FROM tennis_challenger_predictions`).get();
  const recent = db.prepare(`SELECT challenger_id,bet_id,prediction_snapshot_id,challenger_status,market_type,selected_side,
    selected_production_probability,selected_challenger_probability,probability_delta_pp,uncertainty_low_pct,uncertainty_high_pct,
    coverage_score,confidence_score,source_target_id,source_provider_id,source_freshness_status,source_freshness_days,activity_risk_status,
    matchup_label,cohort_role,operation_id,created_at FROM tennis_challenger_predictions ORDER BY created_at DESC LIMIT ?`).all(limit);
  const integrity = {
    tablesPresent,
    immutableTriggers: ['trg_tennis_player_evidence_no_update','trg_tennis_player_evidence_no_delete','trg_tennis_matchup_features_no_update','trg_tennis_matchup_features_no_delete','trg_tennis_challenger_no_update','trg_tennis_challenger_no_delete'].every(trigger => triggerExists(db, trigger)),
    orphanMatchups: Number(db.prepare(`SELECT COUNT(*) n FROM tennis_matchup_feature_snapshots m LEFT JOIN tennis_player_evidence_snapshots p1 ON p1.evidence_id=m.p1_evidence_id LEFT JOIN tennis_player_evidence_snapshots p2 ON p2.evidence_id=m.p2_evidence_id WHERE p1.evidence_id IS NULL OR p2.evidence_id IS NULL`).get().n),
    orphanChallengers: Number(db.prepare(`SELECT COUNT(*) n FROM tennis_challenger_predictions c LEFT JOIN tennis_matchup_feature_snapshots m ON m.matchup_id=c.matchup_id WHERE m.matchup_id IS NULL`).get().n)
  };
  const healthy = integrity.tablesPresent && integrity.immutableTriggers && integrity.orphanMatchups === 0 && integrity.orphanChallengers === 0;
  const t3ShadowForward = tennisShadowFeatureEnrichment.summarizeForwardShadowEvidence(db, options);
  return {
    success: healthy, healthy, status: challengerRows === 0 ? 'NO_FORWARD_DATA' : healthy ? (Number(metrics.evidenceWarnings || 0) ? 'SHADOW_WITH_WARNINGS' : 'SHADOW_HEALTHY') : 'INTEGRITY_ERROR',
    version: TENNIS_MATCHUP_INTELLIGENCE_VERSION, playerEvidenceVersion: tennisPlayerEvidence.TENNIS_PLAYER_EVIDENCE_VERSION,
    matchupFeatureVersion: tennisPlayerEvidence.TENNIS_MATCHUP_FEATURE_VERSION, challengerModelVersion: TENNIS_CHALLENGER_MODEL_VERSION,
    mode: MODE, audit16dRevision: AUDIT16D_R3_T3_REVISION,
    shadowFeatureVersion: tennisShadowFeatureEnrichment.TENNIS_SHADOW_FEATURE_SNAPSHOT_VERSION,
    productionProbabilityChangedByChallenger: false, stakeAuthority: false, deepScanSeparate: true,
    counts: { evidenceRows, matchupRows, challengerRows, ...statusCounts },
    metrics: { avgCoverage: finite(metrics.avgCoverage, null), avgConfidence: finite(metrics.avgConfidence, null), avgAbsDeltaPp: finite(metrics.avgAbsDelta, null), strongDivergence: Number(metrics.strongDivergence || 0), evidenceWarnings: Number(metrics.evidenceWarnings || 0) },
    dataEngine: tennisPlayerEvidence.getStatus(), integrity, recent, t3ShadowForward,
    note: challengerRows === 0 ? 'Motore Patch 12 installato. Il primo snapshot intelligence verrà creato con la prossima previsione Tennis.' : 'Challenger matchup attivo in shadow: nessuna autorità su stake o gate.'
  };
}

module.exports = {
  TENNIS_MATCHUP_INTELLIGENCE_VERSION,
  TENNIS_CHALLENGER_MODEL_VERSION,
  AUDIT16D_R3_T3_REVISION,
  MODE,
  ensureMatchupIntelligenceSchema,
  buildUnavailableIntelligence,
  buildIntelligenceForBet,
  persistMatchupIntelligenceForBet,
  getBetIntelligence,
  getIntelligenceHealth
};
