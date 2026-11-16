'use strict';

const fs = require('fs');
const path = require('path');
const teamSnapshot = require('../backend/calcioTeamSnapshot');
const form = require('../backend/calcioOpponentAdjustedForm');
const registry = require('../backend/calcioPatchRegistry');

const ROOT = path.resolve(__dirname, '..');
function assert(ok, message) { if (!ok) throw new Error(message); }

function buildFixtureCsv(includeFuture = true) {
    const rows = ['Date,HomeTeam,AwayTeam,FTHG,FTAG,HS,AS,HST,AST'];
    const push = (d,h,a,hg,ag) => rows.push([d,h,a,hg,ag,10,8,4,3].join(','));
    push('01/08/2026','Strong','Weak',3,0);
    push('02/08/2026','Neutral','Strong',0,2);
    push('03/08/2026','Strong','Neutral',2,0);
    push('04/08/2026','Weak','Neutral',0,2);
    push('05/08/2026','Strong','Weak',2,0);
    push('06/08/2026','Neutral','Weak',3,1);
    push('07/08/2026','Alpha','Strong',1,0);
    push('08/08/2026','Beta','Weak',1,0);
    push('09/08/2026','Strong','Alpha',1,1);
    push('10/08/2026','Weak','Beta',2,1);
    push('11/08/2026','Alpha','Neutral',2,1);
    push('12/08/2026','Beta','Neutral',2,1);
    push('13/08/2026','Alpha','Strong',1,0);
    push('14/08/2026','Beta','Weak',1,0);
    if (includeFuture) {
        push('20/09/2026','Alpha','Weak',9,0);
        push('21/09/2026','Beta','Strong',0,7);
    }
    return rows.join('\n') + '\n';
}

function runPatch8Checks() {
    const cutoff = new Date('2026-08-20T12:00:00.000Z');
    const csv = buildFixtureCsv(true);
    const index = teamSnapshot.getLeagueIndex({ csvData: csv, leagueName: 'Fixture League', code: 'P8', revisionToken: 'patch8-fixture-v1' });
    const alpha = form.summarizeTeamForm(index, 'Alpha', cutoff, { window: 10, priorMatches: 6 });
    const beta = form.summarizeTeamForm(index, 'Beta', cutoff, { window: 10, priorMatches: 6 });
    assert(alpha.attackIndex > beta.attackIndex, `Opponent correction failed: Alpha ${alpha.attackIndex} <= Beta ${beta.attackIndex}`);
    assert(alpha.status === 'EARLY_SEASON' && beta.status === 'EARLY_SEASON', 'Early-season status missing');
    assert(Math.abs(alpha.attackIndex - 1) < Math.abs(alpha.rawAttackIndex - 1), 'Bayesian prior did not shrink Alpha toward neutral');

    const adjustment = form.buildMatchAdjustment(index, 'Alpha', 'Beta', cutoff, { window: 10, priorMatches: 6, adjustmentCap: 0.08, evidenceBlend: 0.65 });
    assert(adjustment.safeguards.asOfSafe && adjustment.safeguards.opponentRatingsUsePreMatchRowsOnly, 'As-of-safe safeguards missing');
    assert(Math.abs(adjustment.homeAdjustmentPct) <= 8.0001 && Math.abs(adjustment.awayAdjustmentPct) <= 8.0001, 'Adjustment cap exceeded');
    const applied = form.applyToExpectedGoals(1.5, 1.1, adjustment);
    assert(applied.expHomeGoals > 0 && applied.expAwayGoals > 0, 'Adjusted expected goals invalid');

    const noFutureIndex = teamSnapshot.getLeagueIndex({ csvData: buildFixtureCsv(false), leagueName: 'Fixture League', code: 'P8NF', revisionToken: 'patch8-fixture-no-future' });
    const noFuture = form.buildMatchAdjustment(noFutureIndex, 'Alpha', 'Beta', cutoff, { window: 10, priorMatches: 6, adjustmentCap: 0.08, evidenceBlend: 0.65 });
    assert(adjustment.homeFactor === noFuture.homeFactor && adjustment.awayFactor === noFuture.awayFactor, 'Future rows leaked into cutoff adjustment');

    const priorCutoff = new Date('2026-08-01T00:00:00.000Z');
    const priorOnly = form.buildMatchAdjustment(index, 'Alpha', 'Beta', priorCutoff, { priorMatches: 6 });
    assert(priorOnly.status === 'PRIOR_ONLY' && priorOnly.homeFactor === 1 && priorOnly.awayFactor === 1, 'Prior-only mode must stay neutral');

    const deterministic = form.buildMatchAdjustment(index, 'Alpha', 'Beta', cutoff, { window: 10, priorMatches: 6, adjustmentCap: 0.08, evidenceBlend: 0.65 });
    assert(JSON.stringify(deterministic) === JSON.stringify(adjustment), 'Adjustment is not deterministic');

    assert(Number(registry.CALCIO_CURRENT_PATCH_VERSION) >= 8 && registry.PATCHES.some(item => item.version === '8'), 'Registry does not contain active Patch 8');
    const patch = registry.PATCHES.find(item => item.version === '8');
    assert(patch && patch.databaseMutation === false && patch.tennisAuthorityChanged === false && patch.stakeAuthorityChanged === false && patch.footballProbabilityContractChanged === true, 'Patch 8 authority boundaries invalid');

    const server = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
    const deepScan = fs.readFileSync(path.join(ROOT, 'backend', 'deepScanCalcio.js'), 'utf8');
    assert(server.includes("require('./calcioOpponentAdjustedForm')"), 'Server module import missing');
    assert(server.includes('buildMatchAdjustment(') && server.includes('applyToExpectedGoals('), 'Production wiring missing');
    assert(server.includes('backtestSnapshotIndex'), 'Backtest parity wiring missing');
    assert(deepScan.includes('Forma corretta per forza avversari'), 'DeepScan diagnostic missing');

    const checks = [
        'Opponent strength changes recent-form interpretation',
        'Early-season samples are shrunk toward league prior',
        'Opponent ratings use only pre-match rows',
        'Future rows do not affect earlier cutoff',
        'Expected-goals adjustment is capped at eight percent',
        'Prior-only mode is neutral',
        'Production and backtest use the same form module',
        'DeepScan exposes status, confidence and adjustment',
        'Registry advances with no database, Tennis or stake mutation'
    ].map(name => ({ name, ok: true }));

    return {
        success: true,
        patch: 'CALCIO_PATCH_8',
        version: form.CALCIO_OPPONENT_ADJUSTED_FORM_VERSION,
        diagnostics: {
            alpha: { sample: alpha.sample, rawAttackIndex: alpha.rawAttackIndex, attackIndex: alpha.attackIndex, strengthOfSchedule: alpha.strengthOfSchedule },
            beta: { sample: beta.sample, rawAttackIndex: beta.rawAttackIndex, attackIndex: beta.attackIndex, strengthOfSchedule: beta.strengthOfSchedule },
            adjustment: { status: adjustment.status, confidence: adjustment.confidence, homePct: adjustment.homeAdjustmentPct, awayPct: adjustment.awayAdjustmentPct, capPct: adjustment.adjustmentCapPct },
            expectedGoals: applied,
            futureLeakage: { homeFactorWithFuture: adjustment.homeFactor, homeFactorWithoutFuture: noFuture.homeFactor }
        },
        checks
    };
}

module.exports = { runPatch8Checks, buildFixtureCsv };
