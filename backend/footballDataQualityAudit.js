// ============================================================================
// AI BETTING QUANT PRO - FOOTBALL DATA QUALITY AUDIT
// File: backend/footballDataQualityAudit.js
// Versione: 1.0
// ============================================================================
//
// SCOPO
// - Audit read-only dello storico Calcio.
// - NON modifica il database.
// - NON aggiorna soglie.
// - NON tocca Tennis.
// - Serve a spiegare perché le righe risolte non sono ottimizzabili.
//
// USO CONSIGLIATO
// const audit = require('./footballDataQualityAudit');
// const report = audit.auditFootballDataQuality(db);
//
// CLI read-only:
// node backend/footballDataQualityAudit.js --db=backend/database_betting.db
// node backend/footballDataQualityAudit.js --db=backend/database_betting.db --json
//
// ============================================================================

'use strict';

const fs = require('fs');
const path = require('path');

const FOOTBALL_DQA_VERSION = '1.0';

const FOOTBALL_MODEL_VERSION = 'FOOTBALL_XG_DIXON_COLES_BOOTSTRAP_2026_V1';
const FOOTBALL_METRIC_VERSION = 'FOOTBALL_EDGE_EV_V2';

const DATA_QUALITY_CURRENT = 'CURRENT_BOOTSTRAP';
const DATA_QUALITY_LEGACY_DIRTY = 'LEGACY_DIRTY';

const OPTIMIZATION_REQUIRED_SAMPLE_DEFAULT = 50;

function safeString(value, fallback = '') {
    if (value === undefined || value === null) return fallback;
    return String(value);
}

function safeNumber(value, fallback = 0) {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function upper(value) {
    return safeString(value).trim().toUpperCase();
}

function normalizeStatus(row = {}) {
    return upper(row.status || row.esito || row.result);
}

function normalizeSportType(row = {}) {
    const raw = [
        row.sport_type,
        row.sport,
        row.bet_type,
        row.strategy_tag,
        row.league,
        row.competition,
        row.market_type
    ].map(v => safeString(v).toLowerCase()).join(' ');

    if (raw.includes('tennis') || raw.includes('atp') || raw.includes('wta')) return 'TENNIS';
    if (raw.includes('calcio') || raw.includes('football') || raw.includes('soccer')) return 'CALCIO';

    // Nel progetto storico vecchio molte righe Calcio non avevano sport_type.
    // Default prudente: calcio se non ci sono segnali Tennis.
    return 'CALCIO';
}

function isFootballRow(row = {}) {
    return normalizeSportType(row) === 'CALCIO';
}

function isTennisRow(row = {}) {
    return normalizeSportType(row) === 'TENNIS';
}

function isResolvedWonLost(row = {}) {
    const status = normalizeStatus(row);
    return status === 'WON' || status === 'LOST';
}

function isSettled(row = {}) {
    const status = normalizeStatus(row);
    return ['WON', 'LOST', 'PUSH', 'VOID'].includes(status);
}

function isLegacyDirty(row = {}) {
    const dq = upper(row.data_quality);
    return dq === 'LEGACY_DIRTY' || dq === 'DIRTY' || dq === 'OLD_METRICS';
}

function getProbability(row = {}) {
    return safeNumber(
        row.calibrated_probability_pct ??
        row.estimated_prob ??
        row.estimatedProb ??
        row.probability ??
        row.model_probability ??
        row.prob,
        0
    );
}

function getOdd(row = {}) {
    return safeNumber(row.odd ?? row.quota ?? row.price ?? row.odds, 0);
}

function getEdgePp(row = {}) {
    return safeNumber(row.edge_pp ?? row.adjusted_edge_pp ?? row.edge, 0);
}

function getEvPct(row = {}) {
    return safeNumber(row.ev_pct ?? row.adjusted_ev_pct ?? row.expectedValue ?? row.expected_value ?? row.ev, 0);
}

function hasDataQuality(row = {}) {
    return safeString(row.data_quality).trim().length > 0;
}

function hasValidProbability(row = {}) {
    const p = getProbability(row);
    return Number.isFinite(p) && p > 0 && p <= 100;
}

function hasValidOdd(row = {}) {
    const odd = getOdd(row);
    return Number.isFinite(odd) && odd > 1;
}

function hasValidEdge(row = {}) {
    const edge = getEdgePp(row);
    return Number.isFinite(edge) && edge !== 0;
}

function hasValidEv(row = {}) {
    const ev = getEvPct(row);
    return Number.isFinite(ev) && ev !== 0;
}

function classifyFootballRow(row = {}) {
    const reasons = [];
    const warnings = [];

    const sport = normalizeSportType(row);
    const status = normalizeStatus(row);
    const dataQuality = safeString(row.data_quality).trim();

    if (sport !== 'CALCIO') reasons.push('NOT_FOOTBALL');
    if (!['WON', 'LOST'].includes(status)) reasons.push('NOT_WON_LOST');
    if (!hasDataQuality(row)) reasons.push('MISSING_DATA_QUALITY');
    if (isLegacyDirty(row)) reasons.push('LEGACY_DIRTY');
    if (!hasValidProbability(row)) reasons.push('MISSING_PROBABILITY');
    if (!hasValidOdd(row)) reasons.push('MISSING_ODD');
    if (!hasValidEdge(row)) reasons.push('MISSING_EDGE_PP');
    if (!hasValidEv(row)) reasons.push('MISSING_EV_PCT');

    if (dataQuality && dataQuality !== DATA_QUALITY_CURRENT && !isLegacyDirty(row)) {
        warnings.push('UNKNOWN_DATA_QUALITY');
    }

    const optimizable = (
        sport === 'CALCIO' &&
        ['WON', 'LOST'].includes(status) &&
        hasDataQuality(row) &&
        !isLegacyDirty(row) &&
        hasValidProbability(row) &&
        hasValidOdd(row) &&
        hasValidEdge(row) &&
        hasValidEv(row)
    );

    let recommendedAction = 'KEEP_CURRENT';

    if (sport !== 'CALCIO') {
        recommendedAction = 'IGNORE_NOT_FOOTBALL';
    } else if (isLegacyDirty(row)) {
        recommendedAction = 'KEEP_LEGACY_DIRTY';
    } else if (!hasDataQuality(row)) {
        recommendedAction = 'REVIEW_OR_MARK_LEGACY_DIRTY';
    } else if (!optimizable && ['WON', 'LOST'].includes(status)) {
        recommendedAction = 'KEEP_BUT_NOT_OPTIMIZABLE';
    } else if (!['WON', 'LOST'].includes(status)) {
        recommendedAction = 'KEEP_OUT_OF_OPTIMIZATION';
    }

    return {
        id: row.id ?? null,
        sport,
        status,
        data_quality: dataQuality || null,
        model_version: row.model_version || null,
        metric_version: row.metric_version || null,
        probability: getProbability(row),
        odd: getOdd(row),
        edge_pp: getEdgePp(row),
        ev_pct: getEvPct(row),
        isFootball: sport === 'CALCIO',
        isTennis: sport === 'TENNIS',
        isSettled: isSettled(row),
        isWonLost: ['WON', 'LOST'].includes(status),
        isLegacyDirty: isLegacyDirty(row),
        optimizable,
        reasons,
        warnings,
        recommendedAction
    };
}

function emptyCounters() {
    return {
        totalRows: 0,
        footballRows: 0,
        tennisRows: 0,
        settledFootball: 0,
        resolvedWonLostFootball: 0,
        pendingFootball: 0,
        legacyDirtyFootball: 0,
        missingDataQuality: 0,
        missingProbability: 0,
        missingOdd: 0,
        missingEdge: 0,
        missingEv: 0,
        validOptimizable: 0,
        notOptimizable: 0
    };
}

function buildActionCounters() {
    return {
        KEEP_CURRENT: 0,
        KEEP_BUT_NOT_OPTIMIZABLE: 0,
        KEEP_OUT_OF_OPTIMIZATION: 0,
        KEEP_LEGACY_DIRTY: 0,
        REVIEW_OR_MARK_LEGACY_DIRTY: 0,
        IGNORE_NOT_FOOTBALL: 0
    };
}

function auditFootballRows(rows = [], options = {}) {
    const requiredSample = safeNumber(options.requiredSample, OPTIMIZATION_REQUIRED_SAMPLE_DEFAULT);
    const maxExamples = safeNumber(options.maxExamples, 20);

    const counters = emptyCounters();
    const actions = buildActionCounters();
    const examples = {
        missingDataQuality: [],
        missingProbability: [],
        missingOdd: [],
        missingEdge: [],
        missingEv: [],
        validOptimizable: [],
        reviewOrMarkLegacyDirty: []
    };

    const classified = [];

    for (const row of Array.isArray(rows) ? rows : []) {
        counters.totalRows += 1;

        const item = classifyFootballRow(row);
        classified.push(item);

        actions[item.recommendedAction] = (actions[item.recommendedAction] || 0) + 1;

        if (item.isTennis) {
            counters.tennisRows += 1;
            continue;
        }

        if (!item.isFootball) continue;

        counters.footballRows += 1;

        if (item.isSettled) counters.settledFootball += 1;
        if (item.isWonLost) counters.resolvedWonLostFootball += 1;
        if (item.status === 'PENDING') counters.pendingFootball += 1;
        if (item.isLegacyDirty) counters.legacyDirtyFootball += 1;
        if (!hasDataQuality(row)) counters.missingDataQuality += 1;
        if (!hasValidProbability(row)) counters.missingProbability += 1;
        if (!hasValidOdd(row)) counters.missingOdd += 1;
        if (!hasValidEdge(row)) counters.missingEdge += 1;
        if (!hasValidEv(row)) counters.missingEv += 1;

        if (item.optimizable) {
            counters.validOptimizable += 1;
            if (examples.validOptimizable.length < maxExamples) examples.validOptimizable.push(item);
        } else {
            counters.notOptimizable += 1;
        }

        if (item.reasons.includes('MISSING_DATA_QUALITY') && examples.missingDataQuality.length < maxExamples) {
            examples.missingDataQuality.push(item);
        }
        if (item.reasons.includes('MISSING_PROBABILITY') && examples.missingProbability.length < maxExamples) {
            examples.missingProbability.push(item);
        }
        if (item.reasons.includes('MISSING_ODD') && examples.missingOdd.length < maxExamples) {
            examples.missingOdd.push(item);
        }
        if (item.reasons.includes('MISSING_EDGE_PP') && examples.missingEdge.length < maxExamples) {
            examples.missingEdge.push(item);
        }
        if (item.reasons.includes('MISSING_EV_PCT') && examples.missingEv.length < maxExamples) {
            examples.missingEv.push(item);
        }
        if (item.recommendedAction === 'REVIEW_OR_MARK_LEGACY_DIRTY' && examples.reviewOrMarkLegacyDirty.length < maxExamples) {
            examples.reviewOrMarkLegacyDirty.push(item);
        }
    }

    const canOptimize = counters.validOptimizable >= requiredSample;

    const severity = canOptimize
        ? 'OK'
        : counters.resolvedWonLostFootball >= requiredSample
            ? 'WARN'
            : 'WARN';

    const summary = canOptimize
        ? `Campione ottimizzabile sufficiente: ${counters.validOptimizable}/${requiredSample}.`
        : `Campione ottimizzabile insufficiente: ${counters.validOptimizable}/${requiredSample}. Righe WON/LOST Calcio: ${counters.resolvedWonLostFootball}.`;

    return {
        success: true,
        readOnly: true,
        version: FOOTBALL_DQA_VERSION,
        sport: 'CALCIO',
        severity,
        summary,
        requiredSample,
        canOptimize,
        counters,
        actions,
        examples,
        migrationPlan: {
            safeMode: true,
            dbMutations: false,
            recommendation: canOptimize
                ? 'Nessuna migrazione necessaria per ottimizzazione.'
                : 'Non applicare soglie automatiche. Revisionare esempi e marcare come LEGACY_DIRTY solo righe non recuperabili.',
            suggestedSteps: [
                'Esportare il report audit.',
                'Controllare esempi con MISSING_DATA_QUALITY.',
                'Non inventare edge_pp/ev_pct/probabilità mancanti.',
                'Impostare CURRENT_BOOTSTRAP solo su righe generate dal nuovo motore con metriche reali.',
                'Marcare come LEGACY_DIRTY le righe storiche non recuperabili.',
                'Ripetere audit dopo la migrazione.'
            ]
        },
        metadata: {
            modelVersion: FOOTBALL_MODEL_VERSION,
            metricVersion: FOOTBALL_METRIC_VERSION,
            dataQualityCurrent: DATA_QUALITY_CURRENT,
            dataQualityLegacyDirty: DATA_QUALITY_LEGACY_DIRTY
        }
    };
}

function getDbRows(db, options = {}) {
    if (!db || typeof db.prepare !== 'function') {
        throw new Error('DB non valido: serve istanza better-sqlite3 o compatibile.');
    }

    const limit = safeNumber(options.limit, 0);
    const sql = limit > 0
        ? `SELECT * FROM ai_forward_test ORDER BY id DESC LIMIT ?`
        : `SELECT * FROM ai_forward_test ORDER BY id DESC`;

    const stmt = db.prepare(sql);
    return limit > 0 ? stmt.all(limit) : stmt.all();
}

function auditFootballDataQuality(db, options = {}) {
    const rows = getDbRows(db, options);
    const report = auditFootballRows(rows, options);

    report.db = {
        rowCountLoaded: rows.length,
        table: 'ai_forward_test'
    };

    return report;
}

function tryLoadBetterSqlite3() {
    try {
        return require('better-sqlite3');
    } catch (error) {
        throw new Error('Modulo better-sqlite3 non disponibile. Eseguire dentro il progetto backend con dipendenze installate.');
    }
}

function parseCliArgs(argv = process.argv.slice(2)) {
    const args = {
        db: null,
        json: false,
        limit: 0,
        maxExamples: 10
    };

    argv.forEach(arg => {
        if (arg.startsWith('--db=')) args.db = arg.slice('--db='.length);
        else if (arg === '--json') args.json = true;
        else if (arg.startsWith('--limit=')) args.limit = safeNumber(arg.slice('--limit='.length), 0);
        else if (arg.startsWith('--maxExamples=')) args.maxExamples = safeNumber(arg.slice('--maxExamples='.length), 10);
    });

    return args;
}

function formatReportText(report) {
    const c = report.counters;

    return [
        '',
        '============================================================',
        ` FOOTBALL DATA QUALITY AUDIT v${report.version}`,
        '============================================================',
        `Read only: ${report.readOnly}`,
        `Severity: ${report.severity}`,
        `Summary: ${report.summary}`,
        '',
        'COUNTERS',
        `- totalRows: ${c.totalRows}`,
        `- footballRows: ${c.footballRows}`,
        `- tennisRows: ${c.tennisRows}`,
        `- settledFootball: ${c.settledFootball}`,
        `- resolvedWonLostFootball: ${c.resolvedWonLostFootball}`,
        `- pendingFootball: ${c.pendingFootball}`,
        `- legacyDirtyFootball: ${c.legacyDirtyFootball}`,
        `- validOptimizable: ${c.validOptimizable}/${report.requiredSample}`,
        `- missingDataQuality: ${c.missingDataQuality}`,
        `- missingProbability: ${c.missingProbability}`,
        `- missingOdd: ${c.missingOdd}`,
        `- missingEdge: ${c.missingEdge}`,
        `- missingEv: ${c.missingEv}`,
        '',
        'RECOMMENDATION',
        `- ${report.migrationPlan.recommendation}`,
        '',
        'NEXT STEPS',
        ...report.migrationPlan.suggestedSteps.map(step => `- ${step}`),
        ''
    ].join('\n');
}

function runCli() {
    const args = parseCliArgs();

    if (!args.db) {
        console.error('Uso: node backend/footballDataQualityAudit.js --db=backend/database_betting.db [--json] [--limit=1000]');
        process.exitCode = 1;
        return;
    }

    const dbPath = path.resolve(process.cwd(), args.db);

    if (!fs.existsSync(dbPath)) {
        console.error(`DB non trovato: ${dbPath}`);
        process.exitCode = 1;
        return;
    }

    const Database = tryLoadBetterSqlite3();
    const db = new Database(dbPath, { readonly: true });

    try {
        const report = auditFootballDataQuality(db, {
            limit: args.limit,
            maxExamples: args.maxExamples
        });

        if (args.json) {
            console.log(JSON.stringify(report, null, 2));
        } else {
            console.log(formatReportText(report));
        }
    } finally {
        try { db.close(); } catch (_) {}
    }
}

if (require.main === module) {
    runCli();
}

module.exports = {
    FOOTBALL_DQA_VERSION,
    FOOTBALL_MODEL_VERSION,
    FOOTBALL_METRIC_VERSION,
    DATA_QUALITY_CURRENT,
    DATA_QUALITY_LEGACY_DIRTY,
    OPTIMIZATION_REQUIRED_SAMPLE_DEFAULT,

    safeNumber,
    safeString,
    normalizeStatus,
    normalizeSportType,
    isFootballRow,
    isTennisRow,
    isSettled,
    isResolvedWonLost,
    isLegacyDirty,

    getProbability,
    getOdd,
    getEdgePp,
    getEvPct,
    classifyFootballRow,
    auditFootballRows,
    auditFootballDataQuality,
    formatReportText,
    parseCliArgs
};
