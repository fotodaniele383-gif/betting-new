'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const evidence = require(path.join(root, 'backend', 'calcioHistoricalCombinationEvidence'));
const registry = require(path.join(root, 'backend', 'calcioPatchRegistry'));

function row(id, status, overrides = {}) {
    return {
        id,
        status,
        sport_type: 'CALCIO',
        bet_type: 'SINGLE',
        data_quality: 'CURRENT_BOOTSTRAP',
        ds_action: 'EDGE TECNICO',
        calcio_gate_status: 'CALCIO_APPROVED_WITH_CAP',
        stake: 10,
        profit: status === 'WON' ? 10 : -10,
        settled_at: `2026-06-${String(Math.min(28, id)).padStart(2, '0')}T12:00:00.000Z`,
        ...overrides
    };
}

const valid = [];
for (let id = 1; id <= 10; id += 1) valid.push(row(id, id <= 7 ? 'WON' : 'LOST'));
for (let id = 11; id <= 20; id += 1) {
    valid.push(row(id, id <= 12 ? 'WON' : 'LOST', {
        ds_action: 'RISCHIO MODELLO',
        calcio_gate_status: 'CALCIO_BLOCKED_SOFT'
    }));
}

const contaminated = [
    row(21, 'WON', { sport_type: '' }),
    row(22, 'WON', { sport_type: 'TENNIS' }),
    row(23, 'WON', { data_quality: 'LEGACY_DIRTY' }),
    row(24, 'WON', { bet_type: 'MULTI_3' }),
    row(25, 'PENDING'),
    row(26, 'WON', { ds_action: '' }),
    row(27, 'WON', { calcio_gate_status: '' }),
    row(99, 'WON')
];

const rows = [...valid, ...contaminated];
const exact = evidence.buildCombinationEvidenceFromRows(rows, {
    ds_action: 'EDGE TECNICO',
    calcio_gate_status: 'CALCIO_APPROVED_WITH_CAP',
    odd: 2
}, {
    cutoffId: 98,
    excludeBetId: 100,
    calculatedAt: '2026-07-21T10:00:00.000Z',
    odd: 2
});

const noSample = evidence.buildCombinationEvidenceFromRows(rows, {
    ds_action: 'ALTO RISCHIO',
    calcio_gate_status: 'CALCIO_BLOCKED_HARD',
    odd: 1.8
}, {
    cutoffId: 98,
    calculatedAt: '2026-07-21T10:00:00.000Z',
    odd: 1.8
});

const interval = evidence.wilsonInterval(7, 10);
const persistence = evidence.toPersistenceFields(exact);
const server = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const backendApp = fs.readFileSync(path.join(root, 'backend', 'public', 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const backendIndex = fs.readFileSync(path.join(root, 'backend', 'public', 'index.html'), 'utf8');

const checks = [];

function check(name, fn) {
    fn();
    checks.push({ name, ok: true });
}

check('Strict sport identity excludes blank, Tennis and aliases', () => {
    assert.strictEqual(evidence.isStrictCalcioRow({ sport_type: 'CALCIO' }), true);
    assert.strictEqual(evidence.isStrictCalcioRow({ sport_type: '' }), false);
    assert.strictEqual(evidence.isStrictCalcioRow({ sport_type: 'TENNIS' }), false);
    assert.strictEqual(evidence.isStrictCalcioRow({ sport_type: 'FOOTBALL' }), false);
});

check('Current-clean single WON/LOST scope excludes legacy and contamination', () => {
    const filtered = evidence.filterHistoricalRows(rows, { cutoffId: 98 });
    assert.strictEqual(filtered.length, 20);
    assert.ok(filtered.every(item => item.sport_type === 'CALCIO'));
    assert.ok(filtered.every(item => ['CURRENT', 'CURRENT_BOOTSTRAP'].includes(item.data_quality)));
});

check('As-of id cutoff prevents current/future leakage', () => {
    const filtered = evidence.filterHistoricalRows(rows, { cutoffId: 10, excludeBetId: 10 });
    assert.strictEqual(filtered.length, 9);
    assert.ok(filtered.every(item => item.id < 10));
});

check('Exact DS×Gate combination computes real Paper Trading win rate', () => {
    assert.strictEqual(exact.deepScan, 'EDGE TECNICO');
    assert.strictEqual(exact.quality, 'APPROVATA CON CAP');
    assert.strictEqual(exact.resolved, 10);
    assert.strictEqual(exact.wins, 7);
    assert.strictEqual(exact.losses, 3);
    assert.strictEqual(exact.winRatePct, 70);
    assert.strictEqual(exact.reliability, 'LOW');
    assert.strictEqual(exact.currentResultUsed, false);
});

check('Wilson interval and prudent estimate are finite', () => {
    assert.ok(interval.lowPct > 30 && interval.lowPct < 50);
    assert.ok(interval.highPct > 80 && interval.highPct < 95);
    assert.ok(Number.isFinite(exact.adjustedRatePct));
});

check('Break-even, empirical edge and ROI remain separate', () => {
    assert.strictEqual(exact.breakEvenPct, 50);
    assert.strictEqual(exact.empiricalEdgePp, 20);
    assert.strictEqual(exact.operationalRoiPct, 40);
    assert.strictEqual(exact.stakeAuthority, false);
    assert.strictEqual(exact.modelAuthority, false);
});

check('No exact sample returns N/D without inventing zero probability', () => {
    assert.strictEqual(noSample.resolved, 0);
    assert.strictEqual(noSample.winRatePct, null);
    assert.strictEqual(noSample.displayRatePct, null);
    assert.strictEqual(noSample.reliability, 'NO_SAMPLE');
});

check('Persistence reuses generic read-only evidence columns', () => {
    assert.strictEqual(persistence.historical_combo_resolved, 10);
    assert.strictEqual(persistence.historical_combo_win_rate_pct, 70);
    assert.strictEqual(persistence.historical_combo_version, evidence.CALCIO_HISTORICAL_COMBINATION_VERSION);
});

check('Server wires read-only endpoint and strict DeepScan identity', () => {
    assert.ok(server.includes("require('./calcioHistoricalCombinationEvidence')"));
    assert.ok(server.includes("app.get('/api/calcio/historical-combination-evidence'"));
    assert.ok(server.includes("historicalCombinationEvidence = calcioHistoricalCombinationEvidence.resolveHistoricalCombinationEvidence"));
    assert.ok(server.includes("UPPER(COALESCE(sport_type, '')) = 'CALCIO'"));
    assert.ok(!server.includes("UPPER(COALESCE(sport_type, 'CALCIO')) = 'CALCIO'\n                        OR UPPER(COALESCE(sport_type, '')) = 'FOOTBALL'"));
});

check('Calcio UI updates probability column after DeepScan', () => {
    assert.ok(app.includes("sport === SPORT.TENNIS || sport === SPORT.CALCIO"));
    assert.ok(app.includes('result.realProbabilityPaperTrading'));
    assert.ok(index.includes('Prob. reale PT DS×Gate'));
    assert.strictEqual(app, backendApp);
    assert.strictEqual(index, backendIndex);
});

check('Registry advances to Patch 4 without model or stake authority', () => {
    const status = registry.getCalcioPatchStatus();
    assert.ok(/^CALCIO_PATCH_REGISTRY_V\d+$/.test(status.registryVersion));
    assert.ok(Number(status.currentPatchVersion) >= 4);
    const patch = status.patches.find(item => item.version === '4');
    assert.ok(patch);
    assert.strictEqual(patch.databaseMutation, false);
    assert.strictEqual(patch.tennisAuthorityChanged, false);
    assert.strictEqual(patch.footballProbabilityContractChanged, false);
    assert.strictEqual(patch.stakeAuthorityChanged, false);
});

const report = {
    success: true,
    patch: 'CALCIO_PATCH_4',
    version: evidence.CALCIO_HISTORICAL_COMBINATION_VERSION,
    diagnostics: {
        exact: {
            resolved: exact.resolved,
            wins: exact.wins,
            losses: exact.losses,
            winRatePct: exact.winRatePct,
            adjustedRatePct: exact.adjustedRatePct,
            ci95LowPct: exact.ci95LowPct,
            ci95HighPct: exact.ci95HighPct,
            breakEvenPct: exact.breakEvenPct,
            empiricalEdgePp: exact.empiricalEdgePp,
            operationalRoiPct: exact.operationalRoiPct,
            reliability: exact.reliability
        },
        noSample: {
            resolved: noSample.resolved,
            winRatePct: noSample.winRatePct,
            reliability: noSample.reliability
        }
    },
    checks
};

console.log(JSON.stringify(report, null, 2));
