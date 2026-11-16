'use strict';
const fs = require('fs');
const path = require('path');

function assertCondition(condition, name, details, checks) {
    const ok = Boolean(condition);
    checks.push({ name, ok, details: details ?? null });
    if (!ok) throw new Error(name);
}

function run(root = path.resolve(__dirname, '..')) {
    const reconciler = require(path.join(root, 'backend', 'calcioStakeReconciler'));
    const lifecycle = require(path.join(root, 'backend', 'calcioStakeLifecycle'));
    const guard = require(path.join(root, 'backend', 'calcioProfessionalGuard'));
    const coherence = require(path.join(root, 'backend', 'calcioProgramCoherence'));
    const macro = require(path.join(root, 'backend', 'bettingMacroCausal'));
    const registry = require(path.join(root, 'backend', 'calcioPatchRegistry'));
    const serverText = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
    const frontendText = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
    const checks = [];

    const base = {
        calcio_theoretical_stake: 6.88,
        calcio_prediction_reliability_score: 67,
        calcio_timing_status: 'EARLY_WATCHLIST',
        calcio_professional_status: 'PROFESSIONAL_WATCHLIST',
        calcio_gate_status: 'CALCIO_BLOCKED_SOFT',
        calcio_analysis_stage_reason: 'Soglie quantitative e gate operativi coerenti.',
        ds_action: '🟢 VIA LIBERA / VALUE',
        odd: 1.66
    };
    const soft = reconciler.reconcileStakeRow(base);
    assertCondition(soft.operationalStake === 2 && soft.status === 'SOFT_MICRO_AUTHORIZED', 'Soft Gate with reliable positive Kelly becomes real €2 micro-stake', soft, checks);

    const cap = reconciler.reconcileStakeRow({ ...base, calcio_theoretical_stake: 25, calcio_prediction_reliability_score: 78, ds_action: 'VALUE CONFERMATO / MICRO' });
    assertCondition(cap.operationalStake === 3, 'Early/soft operational stake is capped at €3', cap, checks);

    const lowEdge = reconciler.reconcileStakeRow({ ...base, calcio_theoretical_stake: 0, calcio_prediction_reliability_score: 79, ds_action: 'WATCHLIST LOW EDGE', calcio_analysis_stage_reason: 'edge sotto soglia 3.0 pp' });
    assertCondition(lowEdge.operationalStake === 0 && lowEdge.qualityOrigin === 'QUANT_THRESHOLD', 'Low-edge quantitative failure remains €0', lowEdge, checks);

    const unreliable = reconciler.reconcileStakeRow({ ...base, calcio_theoretical_stake: 25, calcio_prediction_reliability_score: 52.7, ds_action: 'EDGE TECNICO' });
    assertCondition(unreliable.operationalStake === 0 && unreliable.status === 'DATA_UNRELIABLE_NO_STAKE', 'Reliability below 55 remains €0 even with stale theoretical Kelly', unreliable, checks);

    const modelRisk = reconciler.reconcileStakeRow({ ...base, calcio_theoretical_stake: 12.5, calcio_prediction_reliability_score: 64, ds_action: 'RISCHIO MODELLO' });
    assertCondition(modelRisk.operationalStake === 0 && modelRisk.status.includes('MODEL_REVIEW'), 'Model-risk DeepScan veto remains €0', modelRisk, checks);

    const hard = reconciler.reconcileStakeRow({ ...base, calcio_theoretical_stake: 12.5, calcio_prediction_reliability_score: 80, calcio_gate_status: 'CALCIO_BLOCKED_HARD', ds_action: 'ALTO RISCHIO' });
    assertCondition(hard.operationalStake === 0 && hard.status === 'BLOCKED_HARD', 'Hard veto precedes forced stake reconciliation', hard, checks);

    const life = lifecycle.buildStakeLifecycle({
        theoreticalStake: 6.88,
        gate: { status: 'CALCIO_BLOCKED_SOFT', allowBet: false, maxStake: 0, deepScanClass: 'CONFIRMATIVE', reasons: ['soft'] },
        professionalAudit: { status: 'PROFESSIONAL_BLOCK_SOFT', timing: { status: 'EARLY_WATCHLIST' }, lineupNews: { status: 'LINEUP_NOT_CONFIRMED' } },
        dataAuthority: { dataClass: 'ATTENDIBILE' },
        odd: 1.66
    });
    assertCondition(life.operationalStake === 2 && life.action === 'BET_ALLOWED_MICRO_SOFT', 'Lifecycle treats BLOCCATA SOFT as cap rather than veto', life, checks);

    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const audit = guard.buildCalcioProfessionalAudit({
        home: 'Genoa', away: 'Lecce', prediction: 'X2',
        probabilities: { '1': 35, 'X': 29, '2': 36, 'X2': 65 },
        extData: {
            matchDate: future,
            homeCsvName: 'Genoa', awayCsvName: 'Lecce',
            homeMatches: 19, awayMatches: 19, footballDataLoaded: true,
            xgEvidenceMode: 'GOAL_SHOT_PROXY',
            clubEloEvidence: { available: true, authoritative: true, matchConfidence: 95 },
            newsConfidence: 45
        }
    });
    assertCondition(audit.timing.status === 'EARLY_WATCHLIST' && audit.status !== 'PROFESSIONAL_BLOCK_SOFT' && audit.riskOrigin === 'TIMING_ONLY', 'Early missing lineup is timing risk, not artificial data SOFT block', audit, checks);

    const merged = coherence.mergePersistedPredictionReliability({ score: 12, label: 'MOLTO_BASSA', factors: {} }, { calcio_prediction_reliability_score: 67, calcio_prediction_reliability_label: 'MEDIA' }, { evidenceComplete: false });
    assertCondition(merged.score === 67 && merged.contextMode === 'PERSISTED_CERTIFIED_ANALYSIS_EVIDENCE_REUSED', 'Incomplete DeepScan payload reuses certified persisted reliability', merged, checks);

    const q = macro.qualityMacro({ gateStatus: 'CALCIO_BLOCKED_SOFT', professionalStatus: 'PROFESSIONAL_WATCHLIST', theoreticalStake: 6.88, operationalStake: 2, maxStake: 2 });
    assertCondition(q === 'WATCHLIST MICRO', 'Operational soft-cap row is labelled WATCHLIST MICRO, not BLOCCATA SOFT', q, checks);

    assertCondition(serverText.includes('calcioStakeReconciler.reconcileStakeRow') && serverText.includes("/api/calcio/stakes/reconcile") && serverText.includes('mergePersistedPredictionReliability') && serverText.includes('runtimeClubEloEvidence'), 'Server wires reconciliation, persistent evidence reuse and ClubElo context', null, checks);
    assertCondition(frontendText.includes('applyCalcioDeepScanStakeResult') && frontendText.includes('matchExposureKey: bet.match_exposure_key') && frontendText.includes('stakeReconciliation'), 'Frontend binds DeepScan stake result and canonical event identity', null, checks);
    assertCondition(registry.CALCIO_CURRENT_PATCH_VERSION === '16' && registry.PATCHES.at(-1)?.id === 'BETTING_PATCH_16_FORCED_STAKE_AUTHORITY_RECONCILIATION', 'Registry advances to Patch 16', registry.PATCHES.at(-1), checks);

    return {
        success: true,
        patch: 'BETTING_PATCH_16_FORCED_STAKE_AUTHORITY_RECONCILIATION',
        version: reconciler.CALCIO_STAKE_RECONCILER_VERSION,
        checks,
        diagnostics: { soft, cap, lowEdge, unreliable, modelRisk, hard, lifecycle: life, professionalAudit: audit, mergedReliability: merged, qualityMacro: q },
        boundaries: { minimumPositiveStakeEur: 2, earlyMicroCapEur: 3, earlyMicroFraction: 0.25, unreliableThreshold: 55, newOddsApiCalls: 0 }
    };
}
module.exports = { run };
