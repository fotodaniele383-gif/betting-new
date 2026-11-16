'use strict';

const fs = require('fs');
const path = require('path');

function assertCondition(condition, name, details = null, checks = []) {
    if (!condition) {
        const error = new Error(name);
        error.details = details;
        throw error;
    }
    checks.push({ name, ok: true, details });
}

async function run(root) {
    const checks = [];
    const lifecycle = require(path.join(root, 'backend', 'calcioStakeLifecycle'));
    const stakePolicy = require(path.join(root, 'backend', 'calcioKellyStakePolicy'));
    const audit = require(path.join(root, 'backend', 'calcioStakePortfolioAudit'));
    const registry = require(path.join(root, 'backend', 'calcioPatchRegistry'));

    const earlyMin = lifecycle.buildStakeLifecycle({
        theoreticalStake: 8,
        gate: { allowBet: true, status: 'CALCIO_WATCHLIST_MICRO', maxStake: 2 },
        professionalAudit: { status: 'PROFESSIONAL_WATCHLIST', timing: { status: 'EARLY_WATCHLIST' }, lineupNews: { status: 'LINEUP_NOT_CONFIRMED' } },
        dataAuthority: { dataClass: 'BUONA' }, odd: 1.9
    });
    assertCondition(earlyMin.operationalStake === 2 && earlyMin.status === 'EARLY_MICRO_AUTHORIZED', 'Early reliable Kelly authorizes real €2 micro-stake', earlyMin, checks);

    const earlyCap = lifecycle.buildStakeLifecycle({
        theoreticalStake: 20,
        gate: { allowBet: true, status: 'CALCIO_WATCHLIST_MICRO', maxStake: 3 },
        professionalAudit: { status: 'PROFESSIONAL_WATCHLIST', timing: { status: 'EARLY_WATCHLIST' }, lineupNews: { status: 'LINEUP_NOT_CONFIRMED' } },
        dataAuthority: { dataClass: 'ALTA' }, odd: 2
    });
    assertCondition(earlyCap.operationalStake === 3, 'Early micro-stake is capped at €3', earlyCap, checks);

    const earlyNoDs = lifecycle.buildStakeLifecycle({
        theoreticalStake: 8,
        gate: { allowBet: false, status: 'CALCIO_EARLY_WATCHLIST', maxStake: 0 },
        professionalAudit: { status: 'PROFESSIONAL_WATCHLIST', timing: { status: 'EARLY_WATCHLIST' } },
        dataAuthority: { dataClass: 'BUONA' }, odd: 2
    });
    assertCondition(earlyNoDs.operationalStake === 0 && earlyNoDs.status === 'THEORETICAL_ONLY_EARLY_WATCHLIST', 'Early stake stays zero until DeepScan/Gate confirms it', earlyNoDs, checks);

    const unreliable = lifecycle.buildStakeLifecycle({
        theoreticalStake: 25,
        gate: { allowBet: true, status: 'CALCIO_WATCHLIST_MICRO', maxStake: 3 },
        professionalAudit: { status: 'PROFESSIONAL_WATCHLIST', timing: { status: 'EARLY_WATCHLIST' } },
        dataAuthority: { dataClass: 'INATTENDIBILE' }, odd: 2.25
    });
    assertCondition(unreliable.operationalStake === 0 && unreliable.status === 'DATA_UNRELIABLE_NO_STAKE', 'INATTENDIBILE always remains €0 even with stale theoretical stake', unreliable, checks);

    const hard = lifecycle.buildStakeLifecycle({
        theoreticalStake: 12,
        gate: { allowBet: false, status: 'CALCIO_BLOCKED_HARD', maxStake: 0 },
        professionalAudit: { status: 'PROFESSIONAL_OK', timing: { status: 'EARLY_WATCHLIST' } },
        dataAuthority: { dataClass: 'BUONA' }, odd: 2
    });
    assertCondition(hard.operationalStake === 0 && hard.status === 'BLOCKED_HARD', 'DeepScan/Gate HARD veto precedes timing micro-stake', hard, checks);

    const integrity = { diagnostics: { '1X': { disagreementPp: 2, monteCarloStdErrorPp: 0.4 } }, maxDisagreementPp: 2, maxMonteCarloStdErrorPp: 0.4 };
    const recalcLow = stakePolicy.calculateTheoreticalStake({
        bankroll: 1000, kellyPct: 2.5, professionalMultiplier: 1,
        predictionReliability: { score: 52.7, evidenceAuthority: 'PROXY_OR_PARTIAL' },
        professionalAudit: { status: 'PROFESSIONAL_WATCHLIST', dataReliability: { score: 52.7, status: 'DATA_FRAGILE' }, teamMatching: { confidence: 100 } },
        multiProviderEvidence: { status: 'MULTI_PROVIDER_USABLE' }, probabilityIntegrity: integrity, market: '1X'
    });
    assertCondition(recalcLow.theoreticalStake === 0 && recalcLow.dataAuthority.dataClass === 'INATTENDIBILE', 'Final DeepScan reliability below 55 recalculates theoretical stake to €0', recalcLow, checks);

    const separatedValue = audit.classifyDeepScanGateSignal('VALUE CONFERMATO / MICRO', 'Attendi i primi 20 minuti prima di confermare.');
    const separatedEdge = audit.classifyDeepScanGateSignal('EDGE TECNICO', 'Attendi il live per conferma operativa.');
    const fallbackWait = audit.classifyDeepScanGateSignal('', 'Attendi i primi 20 minuti: verifica il ritmo.');
    assertCondition(separatedValue === 'CONFIRMATIVE' && separatedEdge === 'TECH_EDGE' && fallbackWait === 'WAIT_IN_PLAY', 'DeepScan macro is separated from timing suggestion', { separatedValue, separatedEdge, fallbackWait }, checks);

    const rows = [
        { sport_type:'CALCIO', status:'PENDING', ds_action:'VALUE CONFERMATO / MICRO', calcio_quality_final_label:'APPROVATA CON CAP', calcio_theoretical_stake:8, calcio_operational_stake:2, estimated_prob:62, edge_pp:5, ev_pct:8 },
        { sport_type:'CALCIO', status:'WON', ds_action:'VALUE CONFERMATO / MICRO', calcio_quality_final_label:'APPROVATA CON CAP', calcio_theoretical_stake:8, calcio_operational_stake:2, stake:2, profit:1.8, estimated_prob:61, edge_pp:4.5, ev_pct:7, historical_combo_adjusted_rate_pct:58, historical_combo_resolved:12 },
        { sport_type:'CALCIO', status:'LOST', ds_action:'VALUE CONFERMATO / MICRO', calcio_quality_final_label:'APPROVATA CON CAP', calcio_theoretical_stake:8, calcio_operational_stake:2, stake:2, profit:-2, estimated_prob:60, edge_pp:4, ev_pct:6, historical_combo_adjusted_rate_pct:58, historical_combo_resolved:12 },
        { sport_type:'CALCIO', status:'PENDING', ds_action:'WATCHLIST LOW EDGE', calcio_quality_final_label:'BLOCCATA SOFT', calcio_theoretical_stake:0, calcio_operational_stake:0, calcio_analysis_stage_reason:'edge sotto soglia 3.0 pp', estimated_prob:55, edge_pp:1.5, ev_pct:2.5 }
    ];
    const diagnostics = audit.buildStakeDiagnostics(rows);
    assertCondition(diagnostics.operationalPositive === 3 && diagnostics.byCause.QUANT_THRESHOLD === 1, 'Stake diagnostics separate operational rows from threshold-zero rows', diagnostics, checks);

    const matrix = audit.buildDsGateMetrics(rows);
    const valueRow = matrix.rows.find(row => row.deepScan === 'VALUE CONFERMATO / MICRO' && row.qualityGate === 'APPROVATA CON CAP');
    assertCondition(valueRow && valueRow.totalSignals === 3 && valueRow.resolved === 2 && valueRow.won === 1 && valueRow.lost === 1, 'DS×Gate matrix groups signals and W/L correctly', valueRow, checks);
    assertCondition(valueRow.roiPct === -5 && valueRow.avgRealPtPct === 58, 'DS×Gate matrix computes real ROI and PT probability without pending leakage', valueRow, checks);

    const serverText = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
    assertCondition(serverText.includes('BET_ALLOWED_MICRO_EARLY') && serverText.includes('calcio_theoretical_stake ?? bet.stake_theoretical'), 'Server Gate uses theoretical Kelly and exposes early micro authorization', null, checks);
    assertCondition(serverText.includes('classifyDeepScanGateSignal(action, suggestion)') && !serverText.includes("['CONFIRMATIVE', 'TECH_EDGE', 'WATCHLIST'].includes(dsClass)"), 'Server never lets timing suggestion override canonical macro or promote low-edge watchlist', null, checks);
    assertCondition(serverText.includes('DeepScan deve ricalcolare Kelly con l\'affidabilità finale') && serverText.includes('recalculatedKellyStakePolicy'), 'DeepScan recalculates Kelly after final reliability', null, checks);
    assertCondition(serverText.includes('stake_confidence_level') && serverText.includes('kelly_fraction_pct'), 'Kelly diagnostics are persisted for audit and later recalculation', null, checks);
    assertCondition(serverText.includes('dsGatePerformance') && serverText.includes('stakeDiagnostics'), 'Portfolio API exposes DS×Gate metrics and stake-zero causes', null, checks);

    const publicApp = fs.readFileSync(path.join(root, 'public', 'app.js'));
    const backendApp = fs.readFileSync(path.join(root, 'backend', 'public', 'app.js'));
    const appText = publicApp.toString('utf8');
    assertCondition(publicApp.equals(backendApp), 'Frontend mirrors remain byte-identical', null, checks);
    assertCondition(appText.includes('portfolioDsGateMeasurementPanel') && appText.includes('Stake e resa per Deep Scan IA × Qualità/Gate'), 'Portfolio contains the requested DS×Gate measurement table', null, checks);
    assertCondition(['Prob. reale PT','Stake teorico medio','Stake operativo totale','ROI'].every(label => appText.includes(label)), 'Portfolio table exposes prediction, stake and return measurements', null, checks);

    const status = registry.getCalcioPatchStatus();
    const patch15 = status.patches.find(row => row.version === '15');
    assertCondition(status.currentPatchVersion === '15' && patch15?.earlyMicroStakeChanged === true && patch15?.newOddsApiCalls === 0, 'Registry advances to Patch 15 without new Odds API calls', patch15, checks);

    return {
        success: true,
        patch: 'BETTING_PATCH_15_STAKE_EXECUTION_DS_GATE_PORTFOLIO_AUDIT',
        version: audit.CALCIO_STAKE_PORTFOLIO_AUDIT_VERSION,
        checks,
        diagnostics: { earlyMin, earlyCap, earlyNoDs, unreliable, hard, recalcLow, stakeDiagnostics: diagnostics, matrix: matrix.rows },
        boundaries: { databaseMutation: false, historicalTennisRowsChanged: false, tennisModelChanged: false, newOddsApiCalls: 0, minimumPositiveStakeEur: 2, earlyMicroCapEur: 3, unreliableThreshold: 55 }
    };
}

module.exports = { run };
