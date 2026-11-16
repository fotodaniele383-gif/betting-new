// ============================================================================
// AI BETTING QUANT PRO - FOOTBALL PAPER TRADING ENGINE
// File: backend/paperTrading.js
// Versione: 6.1 + STEP59 CALCIO SETTLEMENT GUARD
// ============================================================================
//
// FIX 6.1
// - Risolto ReferenceError: calculateEvPct is not defined.
// - Rimosse duplicazioni di processPaperTrading e generatePortfolioReport.
// - Rimosso module.exports intermedio.
// - Aggiunti export realmente definiti:
//      calculateEvPct
//      calculateEdgePp
//      impliedProbabilityPct
//      parseDbDateTime
//      isTennisBet
//      isFootballBet
//      isCleanCurrentRow
// - Integrato con server.js v14+.
// - Integrato con value_evaluator.js v8+.
// - Integrato con app.js v14+.
// - Storico nuovo pulito / bootstrap.
// - Settlement Calcio versionato.
// - Esclusione Tennis.
// - Esclusione legacy dirty.
// - Supporto campi:
//      sport_type
//      edge_pp
//      ev_pct
//      data_quality
//      model_version
//      metric_version
//      engine_version
//      settlement_source
//      settlement_note
//      settled_at
//      winner_side
//      total_goals
//      home_goals
//      away_goals
//      market_implied_prob
// - Nessun uso dello storico sporco per calibrazione.
// ============================================================================


// ============================================================================
// 1. IMPORTAZIONI
// ============================================================================

const valueEvaluator = require('./value_evaluator');
const apiUsageTracker = require('./apiUsageTracker');
const calcioScope = require('./calcioOperationalScope');
const auditTrail = require('./auditTrail');
const audit13OutcomeSearch = require('./certifiedTradingOutcomeSearchAudit13');
const audit14OutcomeCoverage = require('./certifiedTradingOutcomeCoverageAudit14');
const audit15SourceFusion = require('./certifiedOutcomeSourceFusionAudit15');


// ============================================================================
// 2. COSTANTI GLOBALI
// ============================================================================

const PAPER_TRADING_ENGINE_VERSION = '6.1';

const FOOTBALL_MODEL_VERSION = 'FOOTBALL_XG_DIXON_COLES_BOOTSTRAP_2026_V1';
const FOOTBALL_METRIC_VERSION = 'FOOTBALL_EDGE_EV_V2';

const DATA_QUALITY_CURRENT = 'CURRENT_BOOTSTRAP';
const DATA_QUALITY_LEGACY_DIRTY = 'LEGACY_DIRTY';

const DEFAULT_BANKROLL = 10000;

const SCORE_LOOKBACK_DAYS = 3;
const TEMPORAL_MATCH_TOLERANCE_HOURS = 48;
const STEP59_CALCIO_SETTLEMENT_GUARD_VERSION = 'STEP59D_CALCIO_SETTLEMENT_GUARD';

// STEP64_SETTLEMENT_API_BUDGET_GUARD
const STEP64_SETTLEMENT_API_BUDGET_MODE = 'STEP64_SETTLEMENT_API_BUDGET_GUARD';
const STEP64_SETTLEMENT_MAX_SCORE_API_CALLS_PER_RUN = Math.max(0, Number(process.env.SETTLEMENT_MAX_SCORE_API_CALLS_PER_RUN || 3));
const STEP64_SETTLEMENT_MIN_RESIDUAL_CREDITS = Math.max(0, Number(process.env.SETTLEMENT_MIN_RESIDUAL_CREDITS || 500));


// ============================================================================
// 3. HELPERS BASE
// ============================================================================

function clamp(value, min, max) {
    const n = Number(value);

    if (!Number.isFinite(n)) return min;

    return Math.max(min, Math.min(max, n));
}

function safeNumber(value, fallback = 0) {
    const n = Number(value);

    return Number.isFinite(n) ? n : fallback;
}

function round(value, decimals = 2) {
    const n = Number(value);

    if (!Number.isFinite(n)) return 0;

    return Number(Math.round(n + 'e' + decimals) + 'e-' + decimals);
}

function safeUpper(value) {
    return String(value || '').toUpperCase();
}

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s.'-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeCompact(value) {
    return normalizeText(value)
        .replace(/[^a-z0-9]/g, '')
        .trim();
}


// ============================================================================
// 4. VALUE METRICS HELPERS
// ============================================================================

function impliedProbabilityPct(odd) {
    const o = safeNumber(odd, 0);

    if (o <= 1) return 0;

    return 100 / o;
}

function calculateEvPct(probabilityPct, odd) {
    const p = safeNumber(probabilityPct, 0);
    const o = safeNumber(odd, 0);

    if (o <= 1) return 0;

    return ((p / 100) * o - 1) * 100;
}

function calculateEdgePp(probabilityPct, odd) {
    const p = safeNumber(probabilityPct, 0);
    const o = safeNumber(odd, 0);

    if (o <= 1) return 0;

    return p - impliedProbabilityPct(o);
}

function getBetEdgePp(row = {}) {
    return safeNumber(
        row.edge_pp ??
        row.adjusted_edge_pp ??
        row.edge,
        0
    );
}

function getBetEvPct(row = {}) {
    return safeNumber(
        row.ev_pct ??
        row.adjusted_ev_pct ??
        row.expectedValue ??
        row.ev,
        0
    );
}


// ============================================================================
// 5. SPORT / DATA QUALITY FILTERS
// ============================================================================

function isCleanCurrentRow(row = {}) {
    const quality = safeUpper(row.data_quality);

    if (!quality) return true;

    return quality !== DATA_QUALITY_LEGACY_DIRTY &&
        quality !== 'DIRTY' &&
        quality !== 'OLD_METRICS';
}

function isTennisBet(row = {}) {
    const sportType = safeUpper(row.sport_type);
    const betType = safeUpper(row.bet_type);
    const strategyTag = safeUpper(row.strategy_tag);
    const league = safeUpper(row.league);

    return sportType === 'TENNIS' ||
        betType.includes('TENNIS') ||
        strategyTag.includes('TENNIS') ||
        league.includes('ATP') ||
        league.includes('WTA') ||
        league.includes('CHALLENGER') ||
        league.includes('GRAND SLAM');
}

function isFootballBet(row = {}) {
    if (isTennisBet(row)) return false;

    const sportType = safeUpper(row.sport_type);

    if (!sportType) return true;

    return sportType === 'CALCIO' ||
        sportType === 'FOOTBALL' ||
        sportType === 'SOCCER';
}

function isMultiBet(row = {}) {
    return safeUpper(row.bet_type).startsWith('MULTI');
}

function isSingleBet(row = {}) {
    return !isMultiBet(row);
}

function isPending(row = {}) {
    return safeUpper(row.status) === 'PENDING';
}

function isResolvedForStats(row = {}) {
    const status = safeUpper(row.status);

    return status === 'WON' || status === 'LOST';
}

function isSettled(row = {}) {
    const status = safeUpper(row.status);

    return status === 'WON' ||
        status === 'LOST' ||
        status === 'PUSH' ||
        status === 'VOID';
}


// ============================================================================
// 6. DB SCHEMA HELPERS
// ============================================================================

function columnExists(db, tableName, columnName) {
    try {
        const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();

        return rows.some(row => row.name === columnName);
    } catch (error) {
        return false;
    }
}

function safeAlterTableAddColumn(db, tableName, columnDefinition) {
    const columnName = String(columnDefinition).split(/\s+/)[0];

    if (columnExists(db, tableName, columnName)) return;

    try {
        db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`).run();
    } catch (error) {
        console.warn(`⚠️ Colonna ${columnName} non aggiunta a ${tableName}: ${error.message}`);
    }
}

function ensurePaperTradingColumns(db) {
    safeAlterTableAddColumn(db, 'ai_forward_test', 'sport_type TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'edge_pp REAL');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'ev_pct REAL');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'model_version TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'metric_version TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'engine_version TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'data_quality TEXT');

    safeAlterTableAddColumn(db, 'ai_forward_test', 'settlement_source TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'settlement_note TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'settled_at TEXT');

    safeAlterTableAddColumn(db, 'ai_forward_test', 'winner_side INTEGER');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'total_goals INTEGER');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'home_goals INTEGER');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'away_goals INTEGER');

    safeAlterTableAddColumn(db, 'ai_forward_test', 'market_implied_prob REAL');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'fair_odd_model REAL');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'fair_odd_calibrated REAL');

    // STEP59C/D_CALCIO_EXPOSURE_SETTLEMENT_COLUMNS
    safeAlterTableAddColumn(db, 'ai_forward_test', 'calcio_gate_status TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'calcio_gate_allow_bet INTEGER');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'calcio_gate_reasons TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'calcio_gate_max_stake REAL');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'calcio_operational_status TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'calcio_operational_action TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'calcio_operational_summary TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'exposure_role TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'exposure_key TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'match_exposure_key TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'exposure_group_status TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'exposure_reason TEXT');

    // STEP67A/D - separazione portfolio audit-grade + audit trail immutabile.
    safeAlterTableAddColumn(db, 'ai_forward_test', 'trading_scope TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'paper_trading_scope TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'portfolio_scope TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'audit_scope_reason TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'audit_trail_id TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'audit_frozen_at TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'audit_snapshot_json TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'deepscan_gate_mode TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'deepscan_gate_status TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'deepscan_gate_multiplier REAL');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'deepscan_gate_reason TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_learning_signal TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_learning_multiplier REAL');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'calibration_probability_adjustment REAL');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'calibration_bucket TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'calibration_grade TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'calibration_version TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_learning_action TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'audit_trail_event_id TEXT');

    try { auditTrail.ensureAuditTrailTable(db); } catch (error) { console.warn('⚠️ Audit trail non inizializzato:', error.message); }
}

function safeUpdateRow(db, id, fields = {}) {
    const entries = Object.entries(fields)
        .filter(([key]) => columnExists(db, 'ai_forward_test', key));

    if (!entries.length) return false;

    const setClause = entries.map(([key]) => `${key} = ?`).join(', ');
    const values = entries.map(([, value]) => value);

    values.push(id);

    db.prepare(`
        UPDATE ai_forward_test
        SET ${setClause}
        WHERE id = ?
    `).run(...values);

    return true;
}

function normalizeFootballRowMetadata(db, row = {}) {
    const estimatedProb = safeNumber(row.estimated_prob ?? row.estimatedProb, 0);
    const odd = safeNumber(row.odd, 0);

    const fields = {
        sport_type: 'CALCIO',
        model_version: row.model_version || FOOTBALL_MODEL_VERSION,
        metric_version: row.metric_version || FOOTBALL_METRIC_VERSION,
        engine_version: row.engine_version || PAPER_TRADING_ENGINE_VERSION,
        data_quality: row.data_quality || DATA_QUALITY_CURRENT
    };

    if (row.edge_pp === undefined || row.edge_pp === null) {
        fields.edge_pp = getBetEdgePp(row);
    }

    if (row.ev_pct === undefined || row.ev_pct === null) {
        fields.ev_pct = estimatedProb > 0 && odd > 1
            ? calculateEvPct(estimatedProb, odd)
            : getBetEvPct(row);
    }

    if (row.market_implied_prob === undefined || row.market_implied_prob === null) {
        fields.market_implied_prob = odd > 1
            ? impliedProbabilityPct(odd)
            : null;
    }

    safeUpdateRow(db, row.id, fields);
}


// ============================================================================
// 7. DATE / TEMPORAL MATCHING
// ============================================================================

function parseDbDateTime(dbDateStr) {
    if (!dbDateStr) return null;

    try {
        const raw = String(dbDateStr).trim();

        const parts = raw.split(',').map(part => part.trim());

        if (parts.length < 1) return null;

        const dateParts = parts[0].split('/').map(Number);
        const timeParts = parts[1] ? parts[1].split(':').map(Number) : [0, 0];

        const now = new Date();

        const day = dateParts[0];
        const month = dateParts[1];

        let year = dateParts[2] || now.getFullYear();

        if (year < 100) year = 2000 + year;

        const hour = timeParts[0] || 0;
        const minute = timeParts[1] || 0;

        if (!day || !month || !year) return null;

        return new Date(year, month - 1, day, hour, minute);
    } catch (error) {
        return null;
    }
}

function isSameEventTemporal(dbDateStr, apiDateStr, toleranceHours = TEMPORAL_MATCH_TOLERANCE_HOURS) {
    if (!dbDateStr || !apiDateStr) return false;

    try {
        const dbDate = parseDbDateTime(dbDateStr);
        const apiDate = new Date(apiDateStr);

        if (!dbDate || isNaN(apiDate.getTime())) return false;

        const diffHours = Math.abs(dbDate.getTime() - apiDate.getTime()) / (1000 * 60 * 60);

        return diffHours <= toleranceHours;
    } catch (error) {
        return false;
    }
}


// ============================================================================
// 8. FUZZY MATCHING NOMI
// ============================================================================

function fallbackLevenshtein(a, b) {
    const aa = normalizeText(a);
    const bb = normalizeText(b);

    if (!aa || !bb) return 999;

    const matrix = [];

    for (let i = 0; i <= bb.length; i++) matrix[i] = [i];
    for (let j = 0; j <= aa.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= bb.length; i++) {
        for (let j = 1; j <= aa.length; j++) {
            if (bb.charAt(i - 1) === aa.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[bb.length][aa.length];
}

function normalizeTeamNameSafe(name, normalizeNameFunc) {
    try {
        if (typeof normalizeNameFunc === 'function') {
            return normalizeText(normalizeNameFunc(name));
        }
    } catch (error) {
        // fallback sotto
    }

    return normalizeText(name);
}

function teamsMatch(dbTeam, apiTeam, normalizeNameFunc, levenshteinFunc) {
    const dbNorm = normalizeTeamNameSafe(dbTeam, normalizeNameFunc);
    const apiNorm = normalizeTeamNameSafe(apiTeam, normalizeNameFunc);

    if (!dbNorm || !apiNorm) return false;

    if (dbNorm === apiNorm) return true;
    if (apiNorm.includes(dbNorm) || dbNorm.includes(apiNorm)) return true;

    const compactDb = normalizeCompact(dbNorm);
    const compactApi = normalizeCompact(apiNorm);

    if (
        compactDb &&
        compactApi &&
        (
            compactDb === compactApi ||
            compactApi.includes(compactDb) ||
            compactDb.includes(compactApi)
        )
    ) {
        return true;
    }

    const lev = typeof levenshteinFunc === 'function'
        ? levenshteinFunc
        : fallbackLevenshtein;

    try {
        return lev(dbNorm, apiNorm) <= 3;
    } catch (error) {
        return fallbackLevenshtein(dbNorm, apiNorm) <= 3;
    }
}

function findApiMatchForBet(bet, scoresData, normalizeNameFunc, levenshteinFunc) {
    if (!Array.isArray(scoresData)) return null;

    // AUDIT13: provider event id e' l'identita piu forte e viene provata prima del fuzzy matching.
    const exactByProviderId = scoresData.find(match => match && match.completed === true && audit13OutcomeSearch.exactProviderIdMatch(bet, match, 'CALCIO'));
    if (exactByProviderId) return exactByProviderId;

    return scoresData.find(match => {
        if (!match || match.completed !== true) return false;

        const hMatch = teamsMatch(
            bet.home_team,
            match.home_team,
            normalizeNameFunc,
            levenshteinFunc
        );

        const aMatch = teamsMatch(
            bet.away_team,
            match.away_team,
            normalizeNameFunc,
            levenshteinFunc
        );

        const temporalMatch = isSameEventTemporal(
            bet.match_date,
            match.commence_time
        );

        return hMatch && aMatch && temporalMatch;
    }) || null;
}


// ============================================================================
// 9. FOOTBALL RESULT EVALUATION
// ============================================================================

function checkWin(prediction, homeGoals, awayGoals) {
    const p = safeUpper(prediction);

    const hg = parseInt(homeGoals, 10);
    const ag = parseInt(awayGoals, 10);

    if (!Number.isFinite(hg) || !Number.isFinite(ag)) return null;

    if (p === '1') return hg > ag;
    if (p === 'X') return hg === ag;
    if (p === '2') return hg < ag;

    if (p === '1X') return hg >= ag;
    if (p === 'X2') return hg <= ag;
    if (p === '12') return hg !== ag;

    if (p === 'U2.5' || p === 'UNDER' || p === 'UNDER 2.5') return (hg + ag) <= 2;
    if (p === 'O2.5' || p === 'OVER' || p === 'OVER 2.5') return (hg + ag) > 2;

    if (p === 'GG' || p === 'BTTS') return hg > 0 && ag > 0;
    if (p === 'NG') return hg === 0 || ag === 0;

    return null;
}

function extractFootballScore(apiMatch) {
    if (!apiMatch || !Array.isArray(apiMatch.scores) || apiMatch.scores.length < 2) {
        return null;
    }

    const homeScoreObj = apiMatch.scores.find(score => {
        return normalizeText(score.name) === normalizeText(apiMatch.home_team);
    }) || apiMatch.scores[0];

    const awayScoreObj = apiMatch.scores.find(score => {
        return normalizeText(score.name) === normalizeText(apiMatch.away_team);
    }) || apiMatch.scores[1];

    if (!homeScoreObj || !awayScoreObj) return null;

    const homeGoals = parseInt(homeScoreObj.score, 10);
    const awayGoals = parseInt(awayScoreObj.score, 10);

    if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) {
        return null;
    }

    let winnerSide = 0;

    if (homeGoals > awayGoals) winnerSide = 1;
    else if (homeGoals < awayGoals) winnerSide = 2;

    return {
        homeGoals,
        awayGoals,
        totalGoals: homeGoals + awayGoals,
        winnerSide
    };
}

function evaluationToStatus(evaluationResult) {
    if (evaluationResult === true) return 'WON';
    if (evaluationResult === false) return 'LOST';
    if (evaluationResult === 'VOID') return 'VOID';
    if (evaluationResult === 'PUSH') return 'PUSH';

    return null;
}

function calculateBetProfit(bet, evaluationResult) {
    const stake = safeNumber(bet.stake, 0);
    const odd = safeNumber(bet.odd, 0);

    if (evaluationResult === 'VOID' || evaluationResult === 'PUSH') return 0;

    if (evaluationResult === true) {
        return round(stake * (odd - 1), 2);
    }

    if (evaluationResult === false) {
        return round(-stake, 2);
    }

    return null;
}


// ============================================================================
// 10. SETTLEMENT UPDATE
// ============================================================================

function updateFootballBetSettlement(db, bet, resolution, evaluationResult) {
    const status = evaluationToStatus(evaluationResult);

    if (!status) return false;

    const profit = calculateBetProfit(bet, evaluationResult);

    if (profit === null) return false;

    const estimatedProb = safeNumber(bet.estimated_prob, 0);
    const odd = safeNumber(bet.odd, 0);

    const audit13Proof = audit13OutcomeSearch.buildSettlementProof(bet, resolution, 'CALCIO', resolution.operationId || null);

    const settlementFields = {
        status,
        profit,

        sport_type: 'CALCIO',
        model_version: bet.model_version || FOOTBALL_MODEL_VERSION,
        metric_version: bet.metric_version || FOOTBALL_METRIC_VERSION,
        engine_version: PAPER_TRADING_ENGINE_VERSION,
        data_quality: bet.data_quality || DATA_QUALITY_CURRENT,

        settlement_source: resolution.source || 'ODDS_API_SCORES',
        settlement_note: resolution.note || '',
        settled_at: new Date().toISOString(),
        ...audit13Proof,

        winner_side: resolution.winnerSide ?? null,
        total_goals: resolution.totalGoals ?? null,
        home_goals: resolution.homeGoals ?? null,
        away_goals: resolution.awayGoals ?? null,

        edge_pp: bet.edge_pp !== undefined && bet.edge_pp !== null
            ? safeNumber(bet.edge_pp, 0)
            : getBetEdgePp(bet),

        ev_pct: bet.ev_pct !== undefined && bet.ev_pct !== null
            ? safeNumber(bet.ev_pct, 0)
            : (
                estimatedProb > 0 && odd > 1
                    ? calculateEvPct(estimatedProb, odd)
                    : getBetEvPct(bet)
            ),

        market_implied_prob: bet.market_implied_prob !== undefined && bet.market_implied_prob !== null
            ? safeNumber(bet.market_implied_prob, null)
            : (
                odd > 1
                    ? impliedProbabilityPct(odd)
                    : null
            )
    };

    const updated = safeUpdateRow(db, bet.id, settlementFields);

    if (updated) {
        console.log(
            `✅ [RISOLTA CALCIO] ${bet.home_team} vs ${bet.away_team} -> ${status} | Pred: ${bet.prediction} | Score: ${resolution.homeGoals}-${resolution.awayGoals} | Profit: ${profit > 0 ? '+' : ''}${profit.toFixed(2)}`
        );
    }

    return updated;
}


// ============================================================================
// 11. QUERY DB
// ============================================================================

function getPendingFootballSingles(db, leagueFilter = 'all') {
    let query = `
        SELECT *
        FROM ai_forward_test
        WHERE status = 'PENDING'
          AND (
                UPPER(COALESCE(sport_type, 'CALCIO')) = 'CALCIO'
                OR UPPER(COALESCE(sport_type, '')) = 'FOOTBALL'
                OR UPPER(COALESCE(sport_type, '')) = 'SOCCER'
                OR COALESCE(sport_type, '') = ''
              )
          AND UPPER(COALESCE(bet_type, '')) NOT LIKE '%TENNIS%'
          AND UPPER(COALESCE(strategy_tag, '')) NOT LIKE '%TENNIS%'
          AND UPPER(COALESCE(bet_type, '')) NOT LIKE 'MULTI%'
          AND COALESCE(data_quality, ?) != ?
    `;

    const params = [
        DATA_QUALITY_CURRENT,
        DATA_QUALITY_LEGACY_DIRTY
    ];

    if (leagueFilter && leagueFilter !== 'all') {
        query += ` AND league = ?`;
        params.push(leagueFilter);
    }

    query += ` ORDER BY id ASC`;

    return db.prepare(query).all(...params);
}

function getPendingFootballMultiples(db, leagueFilter = 'all') {
    let query = `
        SELECT *
        FROM ai_forward_test
        WHERE status = 'PENDING'
          AND COALESCE(paper_result_active, 1) = 1
          AND UPPER(COALESCE(bet_type, '')) LIKE 'MULTI%'
          AND UPPER(COALESCE(bet_type, '')) NOT LIKE '%TENNIS%'
          AND UPPER(COALESCE(strategy_tag, '')) NOT LIKE '%TENNIS%'
          AND COALESCE(data_quality, ?) != ?
    `;

    const params = [
        DATA_QUALITY_CURRENT,
        DATA_QUALITY_LEGACY_DIRTY
    ];

    if (leagueFilter && leagueFilter !== 'all') {
        query += ` AND league = ?`;
        params.push(leagueFilter);
    }

    query += ` ORDER BY id ASC`;

    return db.prepare(query).all(...params);
}

function getFootballHistory(db, leagueFilter = 'all', limit = 500) {
    let query = `
        SELECT *
        FROM ai_forward_test
        WHERE COALESCE(paper_result_active, 1) = 1
          AND (
                UPPER(COALESCE(sport_type, 'CALCIO')) = 'CALCIO'
                OR UPPER(COALESCE(sport_type, '')) = 'FOOTBALL'
                OR UPPER(COALESCE(sport_type, '')) = 'SOCCER'
                OR COALESCE(sport_type, '') = ''
              )
          AND UPPER(COALESCE(bet_type, '')) NOT LIKE '%TENNIS%'
          AND UPPER(COALESCE(strategy_tag, '')) NOT LIKE '%TENNIS%'
          AND COALESCE(data_quality, ?) != ?
    `;

    const params = [
        DATA_QUALITY_CURRENT,
        DATA_QUALITY_LEGACY_DIRTY
    ];

    if (leagueFilter && leagueFilter !== 'all') {
        query += ` AND league = ?`;
        params.push(leagueFilter);
    }

    query += ` ORDER BY id DESC LIMIT ?`;
    params.push(limit);

    return db.prepare(query).all(...params);
}

function getResolvedFootballBetsForStats(db, leagueFilter = 'all') {
    let query = `
        SELECT *
        FROM ai_forward_test
        WHERE status IN ('WON', 'LOST', 'PUSH', 'VOID')
          AND COALESCE(paper_result_active, 1) = 1
          AND COALESCE(paper_result_conflict, 0) = 0
          AND (
                UPPER(COALESCE(sport_type, 'CALCIO')) = 'CALCIO'
                OR UPPER(COALESCE(sport_type, '')) = 'FOOTBALL'
                OR UPPER(COALESCE(sport_type, '')) = 'SOCCER'
                OR COALESCE(sport_type, '') = ''
              )
          AND UPPER(COALESCE(bet_type, '')) NOT LIKE '%TENNIS%'
          AND UPPER(COALESCE(strategy_tag, '')) NOT LIKE '%TENNIS%'
          AND COALESCE(data_quality, ?) != ?
    `;

    const params = [
        DATA_QUALITY_CURRENT,
        DATA_QUALITY_LEGACY_DIRTY
    ];

    if (leagueFilter && leagueFilter !== 'all') {
        query += ` AND league = ?`;
        params.push(leagueFilter);
    }

    query += ` ORDER BY id DESC`;

    return db.prepare(query).all(...params);
}


// ============================================================================
// 12. LEAGUE HELPERS
// ============================================================================

function findLeagueApiForBet(bet, LEAGUES_CONFIG = {}) {
    const leagueName = String(bet.league || '');

    const leagueKey = Object.keys(LEAGUES_CONFIG).find(key => {
        return LEAGUES_CONFIG[key].name === leagueName;
    });

    if (!leagueKey) return null;

    return LEAGUES_CONFIG[leagueKey].api || null;
}

function groupPendingBetsByApiLeague(pendingBets = [], LEAGUES_CONFIG = {}) {
    const grouped = {};

    for (const bet of pendingBets) {
        const apiLeague = findLeagueApiForBet(bet, LEAGUES_CONFIG);

        if (!apiLeague) continue;

        if (!grouped[apiLeague]) grouped[apiLeague] = [];

        grouped[apiLeague].push(bet);
    }

    return grouped;
}


// ============================================================================
// 13. RISOLUZIONE SINGOLE CALCIO
// ============================================================================


function buildFootballSettlementKey(row = {}) {
    return [
        normalizeCompact(row.league || ''),
        normalizeCompact(row.home_team || ''),
        normalizeCompact(row.away_team || '')
    ].join('|');
}

function setFootballPendingReason(db, bet, code, note) {
    // STEP59D_CALCIO_PENDING_REASON_UI
    return safeUpdateRow(db, bet.id, {
        settlement_source: code,
        settlement_note: note || code,
        sport_type: 'CALCIO',
        data_quality: bet.data_quality || DATA_QUALITY_CURRENT
    });
}

function findLocalResolvedFootballScoreForBet(db, bet) {
    // STEP59D + AUDIT13: DB/vault prima della API; provider id esatto prima del nome squadra.
    const providerEventId = String(bet.calcio_provider_event_id || bet.provider_event_id || '').trim();
    if (providerEventId) {
        const exact = db.prepare(`
            SELECT *
            FROM ai_forward_test
            WHERE calcio_provider_event_id = ?
              AND status IN ('WON', 'LOST', 'PUSH', 'VOID')
              AND home_goals IS NOT NULL
              AND away_goals IS NOT NULL
              AND UPPER(COALESCE(bet_type, '')) NOT LIKE '%TENNIS%'
              AND UPPER(COALESCE(strategy_tag, '')) NOT LIKE '%TENNIS%'
              AND COALESCE(data_quality, ?) != ?
            ORDER BY settled_at DESC, id DESC
            LIMIT 1
        `).get(providerEventId, DATA_QUALITY_CURRENT, DATA_QUALITY_LEGACY_DIRTY);
        if (exact) return exact;
    }

    return db.prepare(`
        SELECT *
        FROM ai_forward_test
        WHERE home_team = ?
          AND away_team = ?
          AND status IN ('WON', 'LOST', 'PUSH', 'VOID')
          AND home_goals IS NOT NULL
          AND away_goals IS NOT NULL
          AND UPPER(COALESCE(bet_type, '')) NOT LIKE '%TENNIS%'
          AND UPPER(COALESCE(strategy_tag, '')) NOT LIKE '%TENNIS%'
          AND COALESCE(data_quality, ?) != ?
        ORDER BY settled_at DESC, id DESC
        LIMIT 1
    `).get(bet.home_team, bet.away_team, DATA_QUALITY_CURRENT, DATA_QUALITY_LEGACY_DIRTY) || null;
}

function resolveFootballBetFromKnownScore(db, bet, score, source, note) {
    const evaluation = checkWin(bet.prediction, score.homeGoals, score.awayGoals);
    if (evaluation === null) {
        setFootballPendingReason(db, bet, 'PENDING_STEP59_NO_EVALUATION', `Step59D: risultato noto ${score.homeGoals}-${score.awayGoals}, ma mercato ${bet.prediction} non valutabile.`);
        return false;
    }
    return updateFootballBetSettlement(db, bet, {
        ...score,
        source,
        note
    }, evaluation);
}

function getApiCreditSnapshot() {
    try {
        const summary = apiUsageTracker.getApiUsageSummary();
        return {
            creditsUsed: safeNumber(summary.creditsUsed, 0),
            cacheHits: safeNumber(summary.cache?.hits, 0),
            cacheMisses: safeNumber(summary.cache?.misses, 0)
        };
    } catch (error) {
        return { creditsUsed: 0, cacheHits: 0, cacheMisses: 0 };
    }
}

async function resolvePendingFootballSingles({
    db,
    pendingBets,
    LEAGUES_CONFIG,
    fetchOddsApiFunc,
    normalizeName,
    levenshtein
}) {
    // STEP59D_CALCIO_SETTLEMENT_GUARD
    // Ordine: DB/vault -> cache Step53 via fetchOddsApi -> API scores solo se necessario.
    let resolvedCount = 0;
    let unresolvedCount = 0;
    let skippedNoLeague = 0;
    const settlementGuard = {
        mode: STEP59_CALCIO_SETTLEMENT_GUARD_VERSION,
        uniqueMatches: new Set(),
        localVaultResolved: 0,
        apiLeagueCalls: 0,
        settlementApiBudgetMode: STEP64_SETTLEMENT_API_BUDGET_MODE,
        settlementApiMaxCallsPerRun: STEP64_SETTLEMENT_MAX_SCORE_API_CALLS_PER_RUN,
        settlementApiMinResidualCredits: STEP64_SETTLEMENT_MIN_RESIDUAL_CREDITS,
        settlementApiCreditsRemainingBefore: null,
        settlementApiBudgetBlocked: false,
        apiSkippedByStep64Budget: false,
        apiLeagueEligibleBeforeBudget: 0,
        apiLeagueSkippedByBudget: 0,
        apiCreditsUsed: 0,
        apiCacheHits: 0,
        apiCacheMisses: 0,
        audit13Version: audit13OutcomeSearch.VERSION,
        archiveEligible: 0,
        archiveResolved: 0,
        archiveUnresolved: 0,
        apiSkippedOutsideProviderWindow: 0,
        providerIdExactMatches: 0,
        pendingReasons: {}
    };

    const unresolvedAfterLocal = [];

    for (const bet of pendingBets) {
        normalizeFootballRowMetadata(db, bet);
        settlementGuard.uniqueMatches.add(buildFootballSettlementKey(bet));

        const local = findLocalResolvedFootballScoreForBet(db, bet);
        if (local) {
            const score = {
                homeGoals: safeNumber(local.home_goals, null),
                awayGoals: safeNumber(local.away_goals, null),
                totalGoals: safeNumber(local.total_goals, null),
                winnerSide: safeNumber(local.winner_side, 0),
                sourceTier: 'CERTIFIED_VAULT',
                sourceEventId: local.settlement_source_event_id || local.calcio_provider_event_id || bet.calcio_provider_event_id || null,
                observedAt: local.settlement_observed_at || local.settled_at || new Date().toISOString(),
                evidenceHash: local.settlement_evidence_hash || null,
                rawEvidence: {
                    reusedBetId: local.id,
                    settlementSource: local.settlement_source || null,
                    homeGoals: local.home_goals,
                    awayGoals: local.away_goals,
                    settledAt: local.settled_at || null
                },
                providerCompleted: true
            };
            if (Number.isFinite(score.homeGoals) && Number.isFinite(score.awayGoals)) {
                score.totalGoals = Number.isFinite(score.totalGoals) ? score.totalGoals : score.homeGoals + score.awayGoals;
                if (resolveFootballBetFromKnownScore(db, bet, score, 'LOCAL_DB_SCORE_VAULT', 'Step59D: score riusato da DB/vault locale; nessun credito API.')) {
                    resolvedCount++;
                    settlementGuard.localVaultResolved++;
                    continue;
                }
            }
        }

        unresolvedAfterLocal.push(bet);
    }

    // AUDIT13: gli endpoint scores di The Odds API coprono solo gli ultimi 1-3 giorni.
    // Per gli eventi piu vecchi tentiamo il provider strutturato football-data gia presente nel progetto,
    // con snapshot SHA-256 e match conservativo data/home/away; se non trovato non consumiamo crediti API inutili.
    const unresolvedForRecentApi = [];
    for (const bet of unresolvedAfterLocal) {
        const plan = audit13OutcomeSearch.buildSearchPlan(bet, 'CALCIO');
        if (plan.archiveRecoveryRequired) {
            settlementGuard.archiveEligible++;
            const audit14 = await audit14OutcomeCoverage.resolveFootballCertified(bet, { allowNetworkRefresh: true });
            const archiveResolution = audit14.resolution;
            if (archiveResolution) {
                const evaluation = checkWin(bet.prediction, archiveResolution.homeGoals, archiveResolution.awayGoals);
                if (evaluation !== null && updateFootballBetSettlement(db, bet, archiveResolution, evaluation)) {
                    resolvedCount++;
                    settlementGuard.archiveResolved++;
                    continue;
                }
            }
            // AUDIT15: seconda sorgente strutturata indipendente (ESPN), zero-key.
            // Viene accettata solo con stessa data/lega, identita home-away canonica, stato finale e score numerico.
            const audit15 = await audit15SourceFusion.resolveFootballStructured(bet, { allowNetwork: true });
            if (audit15.resolution) {
                const evaluation15 = checkWin(bet.prediction, audit15.resolution.homeGoals, audit15.resolution.awayGoals);
                if (evaluation15 !== null && updateFootballBetSettlement(db, bet, audit15.resolution, evaluation15)) {
                    resolvedCount++;
                    settlementGuard.archiveResolved++;
                    continue;
                }
            }
            settlementGuard.archiveUnresolved++;
            settlementGuard.apiSkippedOutsideProviderWindow++;
            // Legacy audit marker retained for AUDIT13 regression compatibility: PENDING_AUDIT13_ARCHIVE_RESULT_NOT_FOUND
            const audit14Reason = String(audit14.trace?.status || 'ARCHIVE_RESULT_NOT_FOUND');
            const pendingCode = `PENDING_AUDIT14_${audit14Reason}`;
            settlementGuard.pendingReasons[pendingCode] = (settlementGuard.pendingReasons[pendingCode] || 0) + 1;
            setFootballPendingReason(db, bet, pendingCode, `AUDIT14: evento storico non certificabile automaticamente (${audit14Reason}); nessun fuzzy generico e nessun esito forzato.`);
            continue;
        }
        unresolvedForRecentApi.push(bet);
    }

    const groupedByApiLeague = groupPendingBetsByApiLeague(
        unresolvedForRecentApi,
        LEAGUES_CONFIG
    );

    for (const bet of unresolvedForRecentApi) {
        const apiLeague = findLeagueApiForBet(bet, LEAGUES_CONFIG);
        if (!apiLeague) {
            skippedNoLeague++;
            unresolvedCount++;
            setFootballPendingReason(db, bet, 'PENDING_STEP59_NO_LEAGUE', 'Step59D: lega/API non mappata, impossibile recuperare score automatico.');
        }
    }

    const apiLeagueKeysAll = Object.keys(groupedByApiLeague);
    const usageSummary = apiUsageTracker.getApiUsageSummary?.() || {};
    const creditsRemaining = safeNumber(usageSummary.creditsRemaining, 0);
    settlementGuard.settlementApiCreditsRemainingBefore = creditsRemaining;
    settlementGuard.apiLeagueEligibleBeforeBudget = apiLeagueKeysAll.length;

    let apiLeagueKeys = apiLeagueKeysAll;
    if (creditsRemaining <= STEP64_SETTLEMENT_MIN_RESIDUAL_CREDITS || STEP64_SETTLEMENT_MAX_SCORE_API_CALLS_PER_RUN <= 0) {
        settlementGuard.settlementApiBudgetBlocked = true;
        settlementGuard.apiSkippedByStep64Budget = true;
        settlementGuard.apiLeagueSkippedByBudget = apiLeagueKeysAll.length;
        apiLeagueKeys = [];
    } else {
        apiLeagueKeys = apiLeagueKeysAll.slice(0, STEP64_SETTLEMENT_MAX_SCORE_API_CALLS_PER_RUN);
        settlementGuard.apiLeagueSkippedByBudget = Math.max(0, apiLeagueKeysAll.length - apiLeagueKeys.length);
    }

    for (const skippedLeague of apiLeagueKeysAll.filter(k => !apiLeagueKeys.includes(k))) {
        for (const bet of groupedByApiLeague[skippedLeague] || []) {
            unresolvedCount++;
            settlementGuard.pendingReasons.PENDING_STEP64_API_BUDGET_GUARD = (settlementGuard.pendingReasons.PENDING_STEP64_API_BUDGET_GUARD || 0) + 1;
            setFootballPendingReason(db, bet, 'PENDING_STEP64_API_BUDGET_GUARD', 'Step64: budget settlement scores esaurito o residuo crediti sotto soglia; resta pending senza chiamare API.');
        }
    }

    for (const apiLeague of apiLeagueKeys) {
        const betsInLeague = groupedByApiLeague[apiLeague] || [];
        if (!betsInLeague.length) continue;

        let scoresData = [];
        const before = getApiCreditSnapshot();

        try {
            scoresData = await fetchOddsApiFunc(
                `https://api.the-odds-api.com/v4/sports/${apiLeague}/scores/?apiKey=API_KEY_PLACEHOLDER&daysFrom=${SCORE_LOOKBACK_DAYS}`,
                { route: 'football_settlement_step59' }
            );
            settlementGuard.apiLeagueCalls++;

            if (!Array.isArray(scoresData)) {
                scoresData = [];
            }
        } catch (error) {
            console.error(`⚠️ Errore fetch scores per ${apiLeague}: ${error.message}`);
            for (const bet of betsInLeague) {
                unresolvedCount++;
                settlementGuard.pendingReasons.PENDING_STEP59_API_EXHAUSTED = (settlementGuard.pendingReasons.PENDING_STEP59_API_EXHAUSTED || 0) + 1;
                setFootballPendingReason(db, bet, 'PENDING_STEP59_API_EXHAUSTED', `Step59D: score non disponibile; API scores fallita/esaurita (${error.message}).`);
            }
            continue;
        } finally {
            const after = getApiCreditSnapshot();
            settlementGuard.apiCreditsUsed += Math.max(0, after.creditsUsed - before.creditsUsed);
            settlementGuard.apiCacheHits += Math.max(0, after.cacheHits - before.cacheHits);
            settlementGuard.apiCacheMisses += Math.max(0, after.cacheMisses - before.cacheMisses);
        }

        for (const bet of betsInLeague) {
            const apiMatch = findApiMatchForBet(
                bet,
                scoresData,
                normalizeName,
                levenshtein
            );

            if (!apiMatch) {
                unresolvedCount++;
                settlementGuard.pendingReasons.PENDING_STEP59_SCORE_NOT_AVAILABLE = (settlementGuard.pendingReasons.PENDING_STEP59_SCORE_NOT_AVAILABLE || 0) + 1;
                setFootballPendingReason(db, bet, 'PENDING_STEP59_SCORE_NOT_AVAILABLE', 'Step59D: score non trovato in DB/cache/API; resta pending senza forzatura.');
                continue;
            }

            if (audit13OutcomeSearch.exactProviderIdMatch(bet, apiMatch, 'CALCIO')) {
                settlementGuard.providerIdExactMatches++;
            }

            const score = extractFootballScore(apiMatch);

            if (!score) {
                unresolvedCount++;
                settlementGuard.pendingReasons.PENDING_STEP59_NO_SCORE_PAYLOAD = (settlementGuard.pendingReasons.PENDING_STEP59_NO_SCORE_PAYLOAD || 0) + 1;
                setFootballPendingReason(db, bet, 'PENDING_STEP59_NO_SCORE_PAYLOAD', 'Step59D: match trovato ma payload score non valido.');
                continue;
            }

            const apiSourceEventId = audit13OutcomeSearch.candidateProviderEventId(apiMatch);
            const apiResolution = {
                ...score,
                source: 'ODDS_API_SCORES_STEP59_CACHE_AWARE',
                sourceTier: 'PROVIDER',
                sourceEventId: apiSourceEventId || bet.calcio_provider_event_id || null,
                observedAt: new Date().toISOString(),
                providerCompleted: apiMatch.completed === true,
                rawEvidence: apiMatch,
                evidenceHash: audit13OutcomeSearch.sha256(apiMatch),
                note: `Score API/cache ${score.homeGoals}-${score.awayGoals}; ${apiSourceEventId && String(apiSourceEventId) === String(bet.calcio_provider_event_id || '') ? 'provider event id esatto' : `temporal match <= ${TEMPORAL_MATCH_TOLERANCE_HOURS}h`}`
            };
            const apiEvaluation = checkWin(bet.prediction, score.homeGoals, score.awayGoals);
            if (apiEvaluation !== null && updateFootballBetSettlement(db, bet, apiResolution, apiEvaluation)) {
                resolvedCount++;
            } else {
                unresolvedCount++;
            }
        }
    }

    settlementGuard.uniqueMatches = settlementGuard.uniqueMatches.size;
    console.log(`📊 [SETTLEMENT CALCIO STEP59] risolte ${resolvedCount} · non risolte ${unresolvedCount} · match unici ${settlementGuard.uniqueMatches} · crediti API ${settlementGuard.apiCreditsUsed} · cache hit ${settlementGuard.apiCacheHits} · cache miss ${settlementGuard.apiCacheMisses}`);

    return {
        resolvedCount,
        unresolvedCount,
        skippedNoLeague,
        settlementGuard
    };
}


// ============================================================================
// 14. RISOLUZIONE MULTIPLE CALCIO
// ============================================================================

function getResolvedSingleForMultiLeg(db, leg) {
    return db.prepare(`
        SELECT *
        FROM ai_forward_test
        WHERE home_team = ?
          AND away_team = ?
          AND prediction = ?
          AND status != 'PENDING'
          AND UPPER(COALESCE(bet_type, '')) NOT LIKE 'MULTI%'
          AND UPPER(COALESCE(bet_type, '')) NOT LIKE '%TENNIS%'
          AND UPPER(COALESCE(strategy_tag, '')) NOT LIKE '%TENNIS%'
          AND COALESCE(data_quality, ?) != ?
        ORDER BY id DESC
        LIMIT 1
    `).get(
        leg.home_team,
        leg.away_team,
        leg.prediction,
        DATA_QUALITY_CURRENT,
        DATA_QUALITY_LEGACY_DIRTY
    );
}

function resolvePendingFootballMultiples(db, leagueFilter = 'all') {
    const pendingMultiples = getPendingFootballMultiples(db, leagueFilter);

    if (!pendingMultiples.length) {
        return {
            resolvedMultiples: 0,
            unresolvedMultiples: 0
        };
    }

    const groups = {};

    for (const leg of pendingMultiples) {
        if (!groups[leg.bet_type]) groups[leg.bet_type] = [];
        groups[leg.bet_type].push(leg);
    }

    let resolvedMultiples = 0;
    let unresolvedMultiples = 0;

    for (const [groupId, legs] of Object.entries(groups)) {
        let allResolved = true;
        let isMultiWon = true;
        let hasVoid = false;
        let hasPush = false;

        const resolvedLegs = [];

        for (const leg of legs) {
            normalizeFootballRowMetadata(db, leg);

            const resolvedLeg = getResolvedSingleForMultiLeg(db, leg);

            if (!resolvedLeg) {
                allResolved = false;
                break;
            }

            const status = safeUpper(resolvedLeg.status);

            if (status === 'LOST') {
                isMultiWon = false;
            }

            if (status === 'VOID') {
                hasVoid = true;
            }

            if (status === 'PUSH') {
                hasPush = true;
            }

            resolvedLegs.push(resolvedLeg);
        }

        if (!allResolved) {
            unresolvedMultiples++;
            continue;
        }

        let finalStatus = 'LOST';

        if (isMultiWon && !hasVoid && !hasPush) {
            finalStatus = 'WON';
        } else if (isMultiWon && (hasVoid || hasPush)) {
            finalStatus = 'PUSH';
        } else {
            finalStatus = 'LOST';
        }

        for (const leg of legs) {
            const profit = finalStatus === 'WON'
                ? round(safeNumber(leg.stake, 0) * (safeNumber(leg.odd, 0) - 1), 2)
                : (
                    finalStatus === 'LOST'
                        ? round(-safeNumber(leg.stake, 0), 2)
                        : 0
                );

            safeUpdateRow(db, leg.id, {
                status: finalStatus,
                profit,

                sport_type: 'CALCIO',
                model_version: leg.model_version || FOOTBALL_MODEL_VERSION,
                metric_version: leg.metric_version || FOOTBALL_METRIC_VERSION,
                engine_version: PAPER_TRADING_ENGINE_VERSION,
                data_quality: leg.data_quality || DATA_QUALITY_CURRENT,

                settlement_source: 'MULTI_LEGS_SETTLEMENT',
                settlement_note: `Multipla ${groupId} risolta usando esiti singole: ${resolvedLegs.map(row => row.status).join(', ')}`,
                settled_at: new Date().toISOString(),

                edge_pp: leg.edge_pp !== undefined && leg.edge_pp !== null
                    ? safeNumber(leg.edge_pp, 0)
                    : getBetEdgePp(leg),

                ev_pct: leg.ev_pct !== undefined && leg.ev_pct !== null
                    ? safeNumber(leg.ev_pct, 0)
                    : getBetEvPct(leg)
            });
        }

        resolvedMultiples++;

        console.log(`🔥 [MULTIPLA CALCIO RISOLTA] ${groupId} -> ${finalStatus}`);
    }

    return {
        resolvedMultiples,
        unresolvedMultiples
    };
}


// ============================================================================
// 15. KELLY / STAKE ENGINE
// ============================================================================

function calculateKelly(prob, odd) {
    const p = clamp(safeNumber(prob, 0), 0, 100) / 100;
    const o = safeNumber(odd, 0);

    if (o <= 1) return 0;

    const edge = (p * o) - 1;

    if (edge <= 0) return 0;

    return (edge / (o - 1)) * 100;
}

function calculateAdaptiveKelly({
    probability,
    odd,
    confidence = 50,
    expectedCLV = 0,
    sport = 'CALCIO',
    market = '',
    reliabilityDecision = null
}) {
    const kelly = calculateKelly(probability, odd);

    let multiplier = 0.15;

    const conf = safeNumber(confidence, 50);

    if (conf < 40) multiplier *= 0.5;
    else if (conf > 75) multiplier *= 1.2;

    const clv = safeNumber(expectedCLV, 0);

    if (clv > 3) multiplier *= 1.2;
    else if (clv < 0) multiplier *= 0.8;

    if (reliabilityDecision) {
        const level = safeUpper(reliabilityDecision.level);

        if (level === 'SUSPEND') multiplier = 0;
        else if (level === 'NO_BET_OR_MICRO_STAKE') multiplier *= 0.25;
        else if (level === 'REDUCE') multiplier *= 0.5;
        else if (level === 'CAUTION') multiplier *= 0.75;
    }

    const sportUpper = safeUpper(sport);
    const marketUpper = safeUpper(market);

    let maxStake = sportUpper === 'CALCIO' ? 2.5 : 1.5;

    if (marketUpper.includes('X') || marketUpper.includes('DRAW')) {
        maxStake = Math.min(maxStake, 1.25);
    }

    const stakePct = kelly * multiplier;

    if (multiplier === 0) return 0;

    return clamp(stakePct, 0.5, maxStake);
}


// ============================================================================
// 16. REPORTING / RISK MANAGEMENT
// ============================================================================

function analyzeDrawdown(bets = []) {
    const cleanBets = Array.isArray(bets)
        ? bets
            .filter(isCleanCurrentRow)
            .filter(isResolvedForStats)
            .sort((a, b) => safeNumber(a.id, 0) - safeNumber(b.id, 0))
        : [];

    let peak = DEFAULT_BANKROLL;
    let runningBankroll = DEFAULT_BANKROLL;
    let currentDrawdown = 0;
    let maxDrawdown = 0;

    for (const bet of cleanBets) {
        runningBankroll += safeNumber(bet.profit, 0);

        if (runningBankroll > peak) {
            peak = runningBankroll;
        }

        currentDrawdown = peak > 0
            ? ((peak - runningBankroll) / peak) * 100
            : 0;

        if (currentDrawdown > maxDrawdown) {
            maxDrawdown = currentDrawdown;
        }
    }

    return {
        maxDrawdown: round(maxDrawdown, 2),
        currentDrawdown: round(currentDrawdown, 2),
        maxDrawdownAmount: round((maxDrawdown / 100) * DEFAULT_BANKROLL, 2),
        currentDrawdownAmount: round((currentDrawdown / 100) * DEFAULT_BANKROLL, 2),
        alert: maxDrawdown > 8,
        hardStop: maxDrawdown > 15
    };
}

function generatePortfolioReport(bets = []) {
    const input = Array.isArray(bets) ? bets : [];

    const cleanFootballBets = input
        .filter(isCleanCurrentRow)
        .filter(isFootballBet);

    const resolvedFootballBets = cleanFootballBets
        .filter(isResolvedForStats)
        .filter(row => calcioScope.classifyCalcioTradingScope(row).paperOperational);

    if (resolvedFootballBets.length === 0) {
        return {
            bankroll: {
                roi: {
                    totalStake: 0,
                    totalProfit: 0,
                    roi: 0,
                    yield: 0,
                    yieldPerBet: 0,
                    bets: 0,
                    won: 0,
                    lost: 0,
                    push: 0,
                    void: 0,
                    hitRate: 0
                },
                drawdown: {
                    maxDrawdown: 0,
                    currentDrawdown: 0,
                    maxDrawdownAmount: 0,
                    currentDrawdownAmount: 0,
                    alert: false,
                    hardStop: false
                }
            },
            topStrategies: [],
            analytics: {
                clv: {
                    sampleSize: 0,
                    avgCLV: 0,
                    positiveRate: 0,
                    volatility: 0,
                    marketPerformance: 'NONE'
                },
                brier: {
                    sampleSize: 0,
                    avgBrier: 0,
                    brierSkillScore: 0,
                    baselineBrier: 0,
                    quality: 'NO_DATA'
                }
            },
            meta: {
                engineVersion: PAPER_TRADING_ENGINE_VERSION,
                dataMode: 'CURRENT_CLEAN_OPERATIONAL_ONLY',
                sampleSize: 0
            }
        };
    }

    const roiData = valueEvaluator.calculatePortfolioROI(resolvedFootballBets, {
        cleanOnly: true,
        sportFilter: 'football'
    });

    const clvData = valueEvaluator.calculateCLVAnalytics(resolvedFootballBets, {
        cleanOnly: true,
        sportFilter: 'football'
    });

    const brierData = valueEvaluator.calculateBrierAnalytics(resolvedFootballBets, {
        cleanOnly: true,
        sportFilter: 'football'
    });

    const stratData = valueEvaluator.calculateStrategyAnalytics(resolvedFootballBets, {
        cleanOnly: true,
        sportFilter: 'football'
    });

    const ddData = analyzeDrawdown(resolvedFootballBets);

    roiData.roi = roiData.roi || 0;
    roiData.yield = roiData.yield || 0;

    return {
        bankroll: {
            roi: roiData,
            drawdown: ddData
        },
        analytics: {
            clv: clvData,
            brier: brierData
        },
        topStrategies: Array.isArray(stratData) ? stratData.slice(0, 5) : [],
        meta: {
            engineVersion: PAPER_TRADING_ENGINE_VERSION,
            dataMode: 'CURRENT_CLEAN_OPERATIONAL_ONLY',
            sampleSize: resolvedFootballBets.length,
            auditBreakdown: calcioScope.buildCalcioPortfolioAuditBreakdown(cleanFootballBets)
        }
    };
}

function calculateFootballStats(rows = []) {
    const cleanRows = Array.isArray(rows)
        ? rows
            .filter(isCleanCurrentRow)
            .filter(isFootballBet)
        : [];

    const singles = {
        placed: 0,
        won: 0,
        lost: 0,
        push: 0,
        void: 0,
        invested: 0,
        profit: 0,
        avg_edge_pp: 0,
        avg_ev_pct: 0
    };

    const multis = {
        placed: 0,
        won: 0,
        lost: 0,
        push: 0,
        void: 0,
        invested: 0,
        profit: 0
    };

    const edgeValues = [];
    const evValues = [];

    for (const row of cleanRows) {
        const target = isMultiBet(row) ? multis : singles;
        const status = safeUpper(row.status);
        const stake = safeNumber(row.stake, 0);
        const profit = safeNumber(row.profit, 0);

        if (status === 'WON') {
            target.won++;
            target.placed++;
            target.invested += stake;
            target.profit += profit;
        } else if (status === 'LOST') {
            target.lost++;
            target.placed++;
            target.invested += stake;
            target.profit += profit;
        } else if (status === 'PUSH') {
            target.push++;
        } else if (status === 'VOID') {
            target.void++;
        }

        if (!isMultiBet(row) && (status === 'WON' || status === 'LOST')) {
            edgeValues.push(getBetEdgePp(row));
            evValues.push(getBetEvPct(row));
        }
    }

    if (edgeValues.length > 0) {
        singles.avg_edge_pp = round(edgeValues.reduce((a, b) => a + b, 0) / edgeValues.length, 2);
    }

    if (evValues.length > 0) {
        singles.avg_ev_pct = round(evValues.reduce((a, b) => a + b, 0) / evValues.length, 2);
    }

    return {
        singles: {
            ...singles,
            invested: round(singles.invested, 2),
            profit: round(singles.profit, 2),
            roi: singles.invested > 0
                ? ((singles.profit / singles.invested) * 100).toFixed(2)
                : '0.00',
            hit_rate: singles.placed > 0
                ? ((singles.won / singles.placed) * 100).toFixed(2)
                : '0.00'
        },
        multis: {
            ...multis,
            invested: round(multis.invested, 2),
            profit: round(multis.profit, 2),
            roi: multis.invested > 0
                ? ((multis.profit / multis.invested) * 100).toFixed(2)
                : '0.00',
            hit_rate: multis.placed > 0
                ? ((multis.won / multis.placed) * 100).toFixed(2)
                : '0.00'
        }
    };
}


// ============================================================================
// 17. CORE ENGINE RISOLUZIONE CALCIO
// ============================================================================

async function processPaperTrading(
    db,
    leagueFilter = 'all',
    LEAGUES_CONFIG = {},
    fetchOddsApiFunc,
    normalizeName,
    levenshtein
) {
    console.log(`\n⚽ [PAPER TRADING CALCIO] Avvio Motore v${PAPER_TRADING_ENGINE_VERSION}. Filtro: ${leagueFilter}`);

    ensurePaperTradingColumns(db);

    const pendingSingles = getPendingFootballSingles(db, leagueFilter);

    console.log(`📡 Pending Calcio singole da risolvere: ${pendingSingles.length}`);

    let singleResult = {
        resolvedCount: 0,
        unresolvedCount: 0,
        skippedNoLeague: 0
    };

    if (pendingSingles.length > 0 && typeof fetchOddsApiFunc === 'function') {
        singleResult = await resolvePendingFootballSingles({
            db,
            pendingBets: pendingSingles,
            LEAGUES_CONFIG,
            fetchOddsApiFunc,
            normalizeName,
            levenshtein
        });
    }

    const multiResult = resolvePendingFootballMultiples(db, leagueFilter);

    const history = getFootballHistory(db, leagueFilter, 500);
    const resolvedRows = getResolvedFootballBetsForStats(db, leagueFilter);

    const stats = calculateFootballStats(resolvedRows);
    const portfolio = generatePortfolioReport(resolvedRows);

    return {
        success: true,

        resolvedCount: singleResult.resolvedCount,
        unresolvedCount: singleResult.unresolvedCount,
        skippedNoLeague: singleResult.skippedNoLeague,

        resolvedMultiples: multiResult.resolvedMultiples,
        unresolvedMultiples: multiResult.unresolvedMultiples,
        settlementGuard: singleResult.settlementGuard || null,

        stats,
        portfolio,
        history,

        meta: {
            engineVersion: PAPER_TRADING_ENGINE_VERSION,
            modelVersion: FOOTBALL_MODEL_VERSION,
            metricVersion: FOOTBALL_METRIC_VERSION,
            dataMode: 'CURRENT_BOOTSTRAP_NEW_HISTORY',
            note: 'Statistiche Calcio calcolate solo su nuovo storico pulito/current. Tennis escluso.'
        }
    };
}


// ============================================================================
// 18. EXPORTS
// ============================================================================

module.exports = {
    // Core engine
    processPaperTrading,

    // Reporting
    generatePortfolioReport,
    analyzeDrawdown,
    calculateFootballStats,

    // Kelly / staking
    calculateAdaptiveKelly,
    calculateKelly,

    // Value helpers
    calculateEvPct,
    calculateEdgePp,
    impliedProbabilityPct,
    getBetEdgePp,
    getBetEvPct,

    // Evaluation
    checkWin,
    evaluationToStatus,
    calculateBetProfit,
    extractFootballScore,
    findLocalResolvedFootballScoreForBet,
    resolveFootballBetFromKnownScore,

    // Date / matching
    isSameEventTemporal,
    parseDbDateTime,
    teamsMatch,
    findApiMatchForBet,
    resolveFootballFromCertifiedArchive: audit13OutcomeSearch.resolveFootballFromLocalArchive,
    resolveFootballFromCertifiedCoverageAudit14: audit14OutcomeCoverage.resolveFootballCertified,
    classifyFootballPendingAudit14: audit14OutcomeCoverage.classifyFootballPending,
    resolveFootballFromStructuredSourceAudit15: audit15SourceFusion.resolveFootballStructured,
    buildOutcomeSearchPlanAudit13: audit13OutcomeSearch.buildSearchPlan,

    // Filters
    isTennisBet,
    isFootballBet,
    isCleanCurrentRow,
    isPending,
    isSettled,
    isResolvedForStats,

    // DB helpers
    ensurePaperTradingColumns,
    normalizeFootballRowMetadata,

    // Metadata
    STEP59_CALCIO_SETTLEMENT_GUARD_VERSION,
    PAPER_TRADING_ENGINE_VERSION,
    FOOTBALL_MODEL_VERSION,
    FOOTBALL_METRIC_VERSION
};