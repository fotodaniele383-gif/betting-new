'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const backend = path.join(root, 'backend');

function walk(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const absolute = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(absolute) : [absolute];
    });
}

const footballPattern = /(calcio|football|soccer|paperTrading|clvTracker|simulation)/i;
const modules = walk(backend)
    .filter(file => file.endsWith('.js') && footballPattern.test(path.basename(file)))
    .map(file => path.relative(root, file).replaceAll('\\', '/'))
    .sort();
const tests = walk(path.join(backend, 'tests'))
    .filter(file => file.endsWith('.test.js') && footballPattern.test(path.basename(file)))
    .map(file => path.relative(root, file).replaceAll('\\', '/'))
    .sort();

const report = {
    generatedAt: new Date().toISOString(),
    scope: 'CALCIO',
    modules,
    tests,
    database: {
        inspected: false,
        reason: 'better-sqlite3 not available',
        counts: null
    },
    resolvedControls: [
        'Patch 1: Monte Carlo receives explicit expected goals and uses a null-safe fallback.',
        'Patch 2: analysis cache identity includes league, bankroll, relevant settings, target odds and data/model versions.',
        'Patch 2: live odds use complete-market best prices with Pinnacle/median no-vig reference instead of bookmakers[0].',
        'Patch 3: football-data seasons are resolved dynamically with validated local cache, freshness diagnostics and Last Known Good protection.',
        'Patch 4: DS×Gate Paper Trading evidence uses strict CALCIO identity, current-clean WON/LOST singles, as-of-safe cutoffs, Wilson 95% and shadow-only UI output.',
        'Patch 5: missing xG uses presence-aware proxy/prior logic; Monte Carlo is seed-per-match and audited against analytic Poisson.',
        'Patch 5: final probabilities combine calibrated model, Monte Carlo and no-vig market reference with disagreement and standard-error diagnostics.',
        'Patch 5: insufficient data no longer hides the match; best-available forecast remains visible with stake 0 and explicit reliability.',
        'Patch 6: news evidence records provider, publisher, URL, publication time, freshness, relevance and source trust.',
        'Patch 6: source silence is explicit NO_RELEVANT_EVIDENCE and never interpreted as no injuries or full availability.',
        'Patch 6: real Understat xG is separated from GOAL_SHOT_PROXY/prior evidence and contradictions are visible.',
        'Patch 6: DeepScan exposes source coverage and corrects value_evaluator.validation instead of UNKNOWN.',
        'Patch 7: Women/U21/academy evidence is excluded from men first-team authority and duplicate retrievals are clustered.',
        'Patch 7: source coverage and match-impact confidence are separated; Understat requires two reconciled teams.',
        'Patch 7: football-data team snapshots are indexed once per revision and evaluated with an as-of-safe cutoff.'
    ],
    structuralRisks: [
        'Collect a sufficient forward current-clean Calcio DS×Gate sample before any production calibration.',
        'Collect forward outcomes by probability reliability/coverage before changing stake authority.',
        'Evaluate calibration and ROI by reliability bucket after a sufficient current-clean sample.',
        'Measure source-provider uptime, official confirmation rate and contradiction rate before adding source authority.'
    ]
};

try {
    const Database = require('better-sqlite3');
    const candidates = [
        path.join(backend, 'database_betting.db'),
        path.join(root, 'database_betting.db')
    ];
    const dbPath = candidates.find(file => fs.existsSync(file));
    if (dbPath) {
        const db = new Database(dbPath, { readonly: true, fileMustExist: true });
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
        report.database.inspected = true;
        report.database.reason = null;
        report.database.path = path.relative(root, dbPath).replaceAll('\\', '/');
        report.database.tables = tables;
        if (tables.includes('ai_forward_test')) {
            const columns = db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name);
            const sportExpr = columns.includes('sport_type') ? "UPPER(COALESCE(sport_type,''))" : "''";
            const qualityExpr = columns.includes('data_quality') ? "UPPER(COALESCE(data_quality,''))" : "''";
            report.database.counts = db.prepare(`
                SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN ${sportExpr}='CALCIO' THEN 1 ELSE 0 END) AS explicitCalcio,
                    SUM(CASE WHEN ${sportExpr}='TENNIS' THEN 1 ELSE 0 END) AS explicitTennis,
                    SUM(CASE WHEN ${qualityExpr}='LEGACY_DIRTY' THEN 1 ELSE 0 END) AS legacyDirty,
                    SUM(CASE WHEN
                        UPPER(COALESCE(status,'')) IN ('WON','LOST')
                        AND ${sportExpr}='CALCIO'
                        AND ${qualityExpr} IN ('CURRENT','CURRENT_BOOTSTRAP')
                        AND UPPER(COALESCE(bet_type,'')) IN ('SINGLE','SINGLE_CR')
                        AND TRIM(COALESCE(ds_action,'')) <> ''
                        AND TRIM(COALESCE(calcio_gate_status, calcio_operational_status, '')) <> ''
                    THEN 1 ELSE 0 END) AS strictCalcioDsGateResolved
                FROM ai_forward_test
            `).get();
        }
        db.close();
    }
} catch (error) {
    report.database.reason = error.message;
}

const outDir = path.join(root, 'audit_calcio_project_state');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'calcio_project_state.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nReport: ${path.relative(root, outPath)}`);
