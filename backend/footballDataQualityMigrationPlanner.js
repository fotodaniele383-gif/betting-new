// ============================================================================
// AI BETTING QUANT PRO - FOOTBALL DATA QUALITY MIGRATION PLANNER
// File: backend/footballDataQualityMigrationPlanner.js
// Versione: 1.0
// ============================================================================
//
// SCOPO
// - Genera un piano di migrazione SICURO e READ-ONLY per lo storico Calcio.
// - NON esegue UPDATE.
// - NON modifica il database.
// - NON tocca Tennis.
// - Produce SQL consigliato da revisionare manualmente.
//
// CONTESTO
// Audit C8 rilevato:
// - Football WON/LOST: 167
// - Valid optimizable: 0
// - Missing data_quality: 167
// - Missing ev_pct: 167
// - Missing probability: 0
// - Missing odd: 0
// - Missing edge_pp: 0
//
// Interpretazione:
// le righe Calcio sono vecchie/legacy: probabilità, quota ed edge esistono,
// ma mancano data_quality/model_version/metric_version ed ev_pct.
// Non devono essere usate per auto-ottimizzazione.
// La migrazione consigliata è marcarle LEGACY_DIRTY, non CURRENT_BOOTSTRAP.
//
// USO CLI READ-ONLY
// node backend/footballDataQualityMigrationPlanner.js --db=backend/database_betting.db
// node backend/footballDataQualityMigrationPlanner.js --db=backend/database_betting.db --json
// node backend/footballDataQualityMigrationPlanner.js --db=backend/database_betting.db --sql
//
// ============================================================================

'use strict';

const fs = require('fs');
const path = require('path');
const audit = require('./footballDataQualityAudit');

const FOOTBALL_DQ_MIGRATION_PLANNER_VERSION = '1.0';

const DATA_QUALITY_CURRENT = audit.DATA_QUALITY_CURRENT || 'CURRENT_BOOTSTRAP';
const DATA_QUALITY_LEGACY_DIRTY = audit.DATA_QUALITY_LEGACY_DIRTY || 'LEGACY_DIRTY';
const FOOTBALL_MODEL_VERSION = audit.FOOTBALL_MODEL_VERSION || 'FOOTBALL_XG_DIXON_COLES_BOOTSTRAP_2026_V1';
const FOOTBALL_METRIC_VERSION = audit.FOOTBALL_METRIC_VERSION || 'FOOTBALL_EDGE_EV_V2';

function safeString(value, fallback = '') {
    if (value === undefined || value === null) return fallback;
    return String(value);
}

function safeNumber(value, fallback = 0) {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function hasValue(value) {
    return value !== undefined && value !== null && String(value).trim() !== '';
}

function hasCurrentVersionMarkers(row = {}) {
    return (
        safeString(row.data_quality).trim() === DATA_QUALITY_CURRENT &&
        safeString(row.model_version).trim() === FOOTBALL_MODEL_VERSION &&
        safeString(row.metric_version).trim() === FOOTBALL_METRIC_VERSION
    );
}

function isMissingVersionMarkers(row = {}) {
    return (
        !hasValue(row.data_quality) &&
        !hasValue(row.model_version) &&
        !hasValue(row.metric_version)
    );
}

function classifyMigrationCandidate(row = {}) {
    const classified = audit.classifyFootballRow(row);

    if (classified.isTennis || classified.sport !== 'CALCIO') {
        return {
            id: row.id ?? null,
            action: 'IGNORE_NOT_FOOTBALL',
            reason: 'Riga non Calcio o Tennis: non toccare.',
            classified
        };
    }

    if (classified.optimizable && hasCurrentVersionMarkers(row)) {
        return {
            id: row.id ?? null,
            action: 'KEEP_CURRENT_BOOTSTRAP',
            reason: 'Riga Calcio completa e versionata current.',
            classified
        };
    }

    const missingVersionMarkers = isMissingVersionMarkers(row);
    const missingEv = classified.reasons.includes('MISSING_EV_PCT');
    const hasCoreOldMetrics = (
        classified.isWonLost &&
        classified.probability > 0 &&
        classified.odd > 1 &&
        classified.edge_pp !== 0
    );

    if (classified.isWonLost && missingVersionMarkers && missingEv && hasCoreOldMetrics) {
        return {
            id: row.id ?? null,
            action: 'MARK_LEGACY_DIRTY_CANDIDATE',
            reason: 'Riga Calcio WON/LOST vecchia: mancano data_quality/model_version/metric_version ed ev_pct. Non usare per ottimizzazione automatica.',
            classified
        };
    }

    if (classified.isWonLost && !classified.optimizable && classified.reasons.includes('MISSING_DATA_QUALITY')) {
        return {
            id: row.id ?? null,
            action: 'REVIEW_MANUALLY',
            reason: 'Riga Calcio risolta con data_quality mancante, ma non rientra nella regola legacy sicura.',
            classified
        };
    }

    if (!classified.isWonLost) {
        return {
            id: row.id ?? null,
            action: 'KEEP_OUT_OF_OPTIMIZATION',
            reason: 'Riga non WON/LOST: non entra in auto-ottimizzazione.',
            classified
        };
    }

    return {
        id: row.id ?? null,
        action: 'REVIEW_MANUALLY',
        reason: 'Caso non classificato come migrazione sicura.',
        classified
    };
}

function buildPlan(rows = [], options = {}) {
    const maxExamples = safeNumber(options.maxExamples, 20);
    const classified = [];
    const counts = {
        totalRows: 0,
        ignoreNotFootball: 0,
        keepCurrentBootstrap: 0,
        markLegacyDirtyCandidates: 0,
        reviewManually: 0,
        keepOutOfOptimization: 0
    };

    const examples = {
        markLegacyDirtyCandidates: [],
        reviewManually: [],
        keepCurrentBootstrap: []
    };

    for (const row of Array.isArray(rows) ? rows : []) {
        counts.totalRows += 1;

        const item = classifyMigrationCandidate(row);
        classified.push(item);

        if (item.action === 'IGNORE_NOT_FOOTBALL') counts.ignoreNotFootball += 1;
        if (item.action === 'KEEP_CURRENT_BOOTSTRAP') counts.keepCurrentBootstrap += 1;
        if (item.action === 'MARK_LEGACY_DIRTY_CANDIDATE') {
            counts.markLegacyDirtyCandidates += 1;
            if (examples.markLegacyDirtyCandidates.length < maxExamples) examples.markLegacyDirtyCandidates.push(item);
        }
        if (item.action === 'REVIEW_MANUALLY') {
            counts.reviewManually += 1;
            if (examples.reviewManually.length < maxExamples) examples.reviewManually.push(item);
        }
        if (item.action === 'KEEP_OUT_OF_OPTIMIZATION') counts.keepOutOfOptimization += 1;
        if (item.action === 'KEEP_CURRENT_BOOTSTRAP' && examples.keepCurrentBootstrap.length < maxExamples) {
            examples.keepCurrentBootstrap.push(item);
        }
    }

    const idsToMarkLegacyDirty = classified
        .filter(item => item.action === 'MARK_LEGACY_DIRTY_CANDIDATE')
        .map(item => item.id)
        .filter(id => id !== null && id !== undefined);

    return {
        success: true,
        readOnly: true,
        version: FOOTBALL_DQ_MIGRATION_PLANNER_VERSION,
        sport: 'CALCIO',
        summary: idsToMarkLegacyDirty.length > 0
            ? `Trovate ${idsToMarkLegacyDirty.length} righe Calcio candidate a LEGACY_DIRTY. Nessuna modifica eseguita.`
            : 'Nessuna riga candidata a migrazione automatica sicura.',
        counts,
        idsToMarkLegacyDirty,
        examples,
        policy: {
            doNotInventMetrics: true,
            doNotRecalculateEvForLegacy: true,
            doNotSetCurrentBootstrapWithoutRealVersions: true,
            doNotTouchTennis: true,
            noAutomaticDbMutation: true
        },
        recommendedAction: idsToMarkLegacyDirty.length > 0
            ? 'Generare SQL e revisionarlo prima di eseguirlo manualmente.'
            : 'Nessuna azione automatica consigliata.'
    };
}

function chunkArray(values = [], size = 50) {
    const chunks = [];
    for (let i = 0; i < values.length; i += size) {
        chunks.push(values.slice(i, i + size));
    }
    return chunks;
}

function generateLegacyDirtySql(plan = {}, options = {}) {
    const ids = Array.isArray(plan.idsToMarkLegacyDirty) ? plan.idsToMarkLegacyDirty : [];
    const chunkSize = safeNumber(options.chunkSize, 50);

    if (ids.length === 0) {
        return [
            '-- Nessuna riga candidata a LEGACY_DIRTY.',
            '-- Nessun UPDATE generato.'
        ].join('\n');
    }

    const chunks = chunkArray(ids, chunkSize);

    const lines = [
        '-- ============================================================================',
        '-- AI BETTING QUANT PRO - FOOTBALL DATA QUALITY MIGRATION SQL',
        '-- GENERATED BY footballDataQualityMigrationPlanner.js v1.0',
        '-- ============================================================================',
        '-- ATTENZIONE:',
        '-- - SQL generato per revisione manuale.',
        '-- - Non viene eseguito automaticamente.',
        '-- - Eseguire backup del database prima di applicarlo.',
        '-- - Non tocca Tennis: limita gli UPDATE agli ID Calcio candidati.',
        '-- ============================================================================',
        'BEGIN TRANSACTION;'
    ];

    chunks.forEach((chunk, index) => {
        lines.push('');
        lines.push(`-- Batch ${index + 1}/${chunks.length} - ${chunk.length} righe`);
        lines.push(`UPDATE ai_forward_test`);
        lines.push(`SET`);
        lines.push(`    data_quality = 'LEGACY_DIRTY',`);
        lines.push(`    model_version = COALESCE(NULLIF(model_version, ''), 'LEGACY_FOOTBALL_UNKNOWN'),`);
        lines.push(`    metric_version = COALESCE(NULLIF(metric_version, ''), 'LEGACY_EDGE_ONLY_NO_EV'),`);
        lines.push(`    engine_version = COALESCE(NULLIF(engine_version, ''), 'LEGACY_IMPORTED_BEFORE_V14')`);
        lines.push(`WHERE id IN (${chunk.join(', ')})`);
        lines.push(`  AND (sport_type IS NULL OR UPPER(COALESCE(sport_type, 'CALCIO')) IN ('CALCIO', 'FOOTBALL', 'SOCCER', ''))`);
        lines.push(`  AND UPPER(COALESCE(bet_type, '')) NOT LIKE '%TENNIS%'`);
        lines.push(`  AND UPPER(COALESCE(strategy_tag, '')) NOT LIKE '%TENNIS%'`);
        lines.push(`  AND COALESCE(data_quality, '') = '';`);
    });

    lines.push('');
    lines.push('-- Verifica prima del COMMIT:');
    lines.push('-- SELECT data_quality, COUNT(*) FROM ai_forward_test GROUP BY data_quality;');
    lines.push('-- Se il risultato è corretto, lasciare COMMIT. Altrimenti sostituire con ROLLBACK.');
    lines.push('COMMIT;');

    return lines.join('\n');
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

function planFootballDataQualityMigration(db, options = {}) {
    const rows = getDbRows(db, options);
    const plan = buildPlan(rows, options);

    plan.db = {
        table: 'ai_forward_test',
        rowCountLoaded: rows.length
    };

    plan.sqlPreview = generateLegacyDirtySql(plan, { chunkSize: safeNumber(options.chunkSize, 50) });

    return plan;
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
        sql: false,
        limit: 0,
        maxExamples: 10,
        out: null
    };

    argv.forEach(arg => {
        if (arg.startsWith('--db=')) args.db = arg.slice('--db='.length);
        else if (arg === '--json') args.json = true;
        else if (arg === '--sql') args.sql = true;
        else if (arg.startsWith('--limit=')) args.limit = safeNumber(arg.slice('--limit='.length), 0);
        else if (arg.startsWith('--maxExamples=')) args.maxExamples = safeNumber(arg.slice('--maxExamples='.length), 10);
        else if (arg.startsWith('--out=')) args.out = arg.slice('--out='.length);
    });

    return args;
}

function formatPlanText(plan) {
    return [
        '',
        '============================================================',
        ` FOOTBALL DATA QUALITY MIGRATION PLANNER v${plan.version}`,
        '============================================================',
        `Read only: ${plan.readOnly}`,
        `Summary: ${plan.summary}`,
        '',
        'COUNTS',
        `- totalRows: ${plan.counts.totalRows}`,
        `- ignoreNotFootball: ${plan.counts.ignoreNotFootball}`,
        `- keepCurrentBootstrap: ${plan.counts.keepCurrentBootstrap}`,
        `- markLegacyDirtyCandidates: ${plan.counts.markLegacyDirtyCandidates}`,
        `- reviewManually: ${plan.counts.reviewManually}`,
        `- keepOutOfOptimization: ${plan.counts.keepOutOfOptimization}`,
        '',
        'POLICY',
        `- doNotInventMetrics: ${plan.policy.doNotInventMetrics}`,
        `- doNotRecalculateEvForLegacy: ${plan.policy.doNotRecalculateEvForLegacy}`,
        `- doNotSetCurrentBootstrapWithoutRealVersions: ${plan.policy.doNotSetCurrentBootstrapWithoutRealVersions}`,
        `- doNotTouchTennis: ${plan.policy.doNotTouchTennis}`,
        `- noAutomaticDbMutation: ${plan.policy.noAutomaticDbMutation}`,
        '',
        'RECOMMENDED ACTION',
        `- ${plan.recommendedAction}`,
        '',
        'SQL',
        '- Usa --sql per stampare il piano SQL revisionabile.',
        ''
    ].join('\n');
}

function runCli() {
    const args = parseCliArgs();

    if (!args.db) {
        console.error('Uso: node backend/footballDataQualityMigrationPlanner.js --db=backend/database_betting.db [--json] [--sql] [--out=plan.sql]');
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
        const plan = planFootballDataQualityMigration(db, {
            limit: args.limit,
            maxExamples: args.maxExamples
        });

        let output;
        if (args.sql) output = plan.sqlPreview;
        else if (args.json) output = JSON.stringify(plan, null, 2);
        else output = formatPlanText(plan);

        if (args.out) {
            const outPath = path.resolve(process.cwd(), args.out);
            fs.writeFileSync(outPath, output, 'utf8');
            console.log(`Piano scritto in: ${outPath}`);
        } else {
            console.log(output);
        }
    } finally {
        try { db.close(); } catch (_) {}
    }
}

if (require.main === module) {
    runCli();
}

module.exports = {
    FOOTBALL_DQ_MIGRATION_PLANNER_VERSION,
    DATA_QUALITY_CURRENT,
    DATA_QUALITY_LEGACY_DIRTY,

    classifyMigrationCandidate,
    buildPlan,
    generateLegacyDirtySql,
    planFootballDataQualityMigration,
    parseCliArgs,
    formatPlanText
};
