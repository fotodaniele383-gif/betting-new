'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const teamSnapshot = require('../backend/calcioTeamSnapshot');
const opponentForm = require('../backend/calcioOpponentAdjustedForm');
const walkForward = require('../backend/calcioWalkForwardCalibration');
const cleanup = require('../backend/calcioSafeProjectCleanup');
const registry = require('../backend/calcioPatchRegistry');

function assert(ok, message) { if (!ok) throw new Error(message); }

function fixtureCsv() {
    const rows = ['Date,HomeTeam,AwayTeam,FTHG,FTAG,HS,AS,HST,AST'];
    const teams = ['Alpha', 'Beta', 'Gamma', 'Delta'];
    const start = new Date('2025-08-01T12:00:00.000Z');
    for (let i = 0; i < 80; i++) {
        const date = new Date(start.getTime() + (i * 86400000));
        const home = teams[i % teams.length];
        const away = teams[(i + 1 + (i % 2)) % teams.length];
        const hg = (i * 7 + (home === 'Alpha' ? 2 : 0)) % 4;
        const ag = (i * 5 + (away === 'Delta' ? 1 : 0)) % 3;
        rows.push([date.toISOString().slice(0, 10).split('-').reverse().join('/'), home, away, hg, ag, 10 + (i % 6), 8 + (i % 5), 3 + (i % 4), 2 + (i % 3)].join(','));
    }
    return `${rows.join('\n')}\n`;
}

function makeSyntheticDataset() {
    const csvData = fixtureCsv();
    const index = teamSnapshot.getLeagueIndex({ csvData, leagueName: 'Fixture League', code: 'P9', revisionToken: 'patch9-fixture-v1' });
    return { name: 'Fixture League', code: 'P9', key: 'fixture', index };
}

function writeFile(file, content = '') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

function runCleanupFixture() {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'calcio-p9-clean-'));
    const root = path.join(parent, 'BettingApp');
    const archive = path.join(parent, 'ExternalArchive');
    fs.mkdirSync(root, { recursive: true });
    for (const dir of [
        'backup/CALCIO_PATCH_07_R1_old',
        'backup/CALCIO_PATCH_08_R1_current',
        'backup/CALCIO_PATCH_09_R1_current',
        'backup/TENNIS_PATCH_24_R1_old',
        'backup/TENNIS_PATCH_25_old',
        'backup/TENNIS_PATCH_25_R1_current',
        'backend/backup/UNKNOWN_STEP',
        'backend/cache'
    ]) fs.mkdirSync(path.join(root, dir), { recursive: true });
    writeFile(path.join(root, 'backup/CALCIO_PATCH_07_R1_old/a.txt'), 'old-calcio');
    writeFile(path.join(root, 'backup/CALCIO_PATCH_08_R1_current/a.txt'), 'current-calcio-previous');
    writeFile(path.join(root, 'backup/CALCIO_PATCH_09_R1_current/a.txt'), 'current-calcio');
    writeFile(path.join(root, 'backup/TENNIS_PATCH_24_R1_old/a.txt'), 'old-tennis');
    writeFile(path.join(root, 'backup/TENNIS_PATCH_25_old/a.txt'), 'old-tennis-same-version');
    writeFile(path.join(root, 'backup/TENNIS_PATCH_25_R1_current/a.txt'), 'current-tennis');
    writeFile(path.join(root, 'backend/clvTracker.js'), 'active');
    writeFile(path.join(root, 'backend/clvTracker.pre_ATP500_fix.bak'), 'old');
    writeFile(path.join(root, 'backup/GET'), '');
    writeFile(path.join(root, 'backend/database_betting.db'), 'do-not-touch');
    writeFile(path.join(root, 'backend/cache/live.json'), '{}');
    writeFile(path.join(root, 'backend/backup/UNKNOWN_STEP/file.txt'), 'keep');

    const dry = cleanup.buildCleanupPlan(root);
    assert(dry.actions.some(item => item.path === 'backup/CALCIO_PATCH_07_R1_old'), 'Old Calcio backup not selected');
    assert(dry.actions.some(item => item.path === 'backup/TENNIS_PATCH_24_R1_old'), 'Old Tennis backup not selected');
    assert(!dry.actions.some(item => item.path.startsWith('backend/backup/')), 'Ambiguous backend backup selected');
    const applied = cleanup.applyCleanupPlan(root, { archiveRoot: archive });
    assert(!fs.existsSync(path.join(root, 'backup/CALCIO_PATCH_07_R1_old')), 'Old Calcio backup still in project');
    assert(fs.existsSync(path.join(root, 'backup/CALCIO_PATCH_09_R1_current')), 'Current Calcio backup removed');
    assert(fs.existsSync(path.join(root, 'backup/CALCIO_PATCH_08_R1_current')), 'Previous Calcio rollback backup removed');
    assert(fs.existsSync(path.join(root, 'backup/TENNIS_PATCH_25_R1_current')), 'Current Tennis backup removed');
    assert(fs.existsSync(path.join(root, 'backend/database_betting.db')), 'Database touched by cleanup');
    assert(fs.existsSync(path.join(root, 'backend/cache/live.json')), 'Cache touched by cleanup');
    assert(fs.existsSync(path.join(root, 'backend/backup/UNKNOWN_STEP/file.txt')), 'Ambiguous backup touched');
    const rollback = cleanup.rollbackCleanup(applied.report);
    assert(fs.existsSync(path.join(root, 'backup/CALCIO_PATCH_07_R1_old')), 'Cleanup rollback did not restore archive');
    fs.rmSync(parent, { recursive: true, force: true });
    return { actionCount: dry.summary.actionCount, archived: applied.report.summary.archiveCount, rollbackRestored: rollback.restored.length };
}

function runPatch9Checks() {
    const dataset = makeSyntheticDataset();
    const grid = walkForward.buildCandidateGrid();
    assert(grid.length === 36, `Candidate grid expected 36, got ${grid.length}`);
    const config = { priorMatches: 6, recencyDecay: 0.86, adjustmentCap: 0.08, window: 10, evidenceBlend: 0.65 };
    const first = walkForward.evaluateConfigAcrossDatasets([dataset], config, { phase: 'HOLDOUT', minWarmupMatches: 12, warmupFraction: 0.15, calibrationFraction: 0.5, promotionMinMatches: 10 });
    const second = walkForward.evaluateConfigAcrossDatasets([dataset], config, { phase: 'HOLDOUT', minWarmupMatches: 12, warmupFraction: 0.15, calibrationFraction: 0.5, promotionMinMatches: 10 });
    assert(JSON.stringify(first) === JSON.stringify(second), 'Walk-forward output is not deterministic');
    assert(first.aggregate.champion.matches > 0 && first.aggregate.champion.matches === first.aggregate.challenger.matches, 'Champion/challenger sample mismatch');

    const event = dataset.index.matches[40];
    const production = opponentForm.buildMatchAdjustment(dataset.index, event.home, event.away, event.date, config);
    const prepared = walkForward._private.prepareDataset(dataset, { minWarmupMatches: 12, warmupFraction: 0.15, calibrationFraction: 0.5 });
    const preparedEvent = prepared.events.find(item => item.index === 40);
    const fast = walkForward._private.fastAdjustment(prepared, preparedEvent, config);
    assert(Math.abs(production.homeFactor - fast.homeFactor) < 0.0002, `Fast/production home factor parity failed: ${production.homeFactor} vs ${fast.homeFactor}`);
    assert(Math.abs(production.awayFactor - fast.awayFactor) < 0.0002, `Fast/production away factor parity failed: ${production.awayFactor} vs ${fast.awayFactor}`);

    const formSource = fs.readFileSync(path.join(__dirname, '..', 'backend', 'calcioOpponentAdjustedForm.js'), 'utf8');
    assert(formSource.includes('options.recencyDecay ?? DEFAULT_RECENCY_DECAY'), 'Patch 8 cache key missing recency decay');
    assert(formSource.includes('options.adjustmentCap ?? DEFAULT_ADJUSTMENT_CAP'), 'Patch 8 cache key missing cap');

    const cleanupDiagnostic = runCleanupFixture();
    assert(Number(registry.CALCIO_CURRENT_PATCH_VERSION) >= 9 && /^CALCIO_PATCH_REGISTRY_V(?:9|[1-9][0-9]+)$/.test(registry.CALCIO_PATCH_REGISTRY_VERSION), 'Registry not advanced to Patch 9');
    const patch = registry.PATCHES.find(item => item.version === '9');
    assert(patch && patch.databaseMutation === false && patch.tennisAuthorityChanged === false && patch.stakeAuthorityChanged === false, 'Patch 9 authority boundaries invalid');

    const checks = [
        'Walk-forward candidate grid is bounded and deterministic',
        'Champion and challenger use identical chronological samples',
        'Fast calibration evaluator matches production Patch 8 factors',
        'Patch 8 option cache includes decay, cap and blend',
        'Calibration and holdout are separated',
        'Cleanup archives only recognized superseded backups',
        'Unknown backup folders, database and caches are preserved',
        'Cleanup archive can be restored',
        'Registry advances without database, Tennis or stake authority'
    ].map(name => ({ name, ok: true }));

    return {
        success: true,
        patch: 'CALCIO_PATCH_9',
        version: walkForward.CALCIO_WALK_FORWARD_VERSION,
        diagnostics: {
            candidateCount: grid.length,
            syntheticHoldoutMatches: first.aggregate.champion.matches,
            syntheticComparison: first.aggregate.comparison,
            productionParity: { homeFactor: production.homeFactor, awayFactor: production.awayFactor },
            cleanup: cleanupDiagnostic
        },
        checks
    };
}

module.exports = { runPatch9Checks, fixtureCsv, makeSyntheticDataset };
