'use strict';

const unifiedPredictionIndex = require('./calcioUnifiedPredictionIndex');
const calcioAiFinalization = require('./calcioAiFinalization');
const probabilityFirst = require('./calcioProbabilityFirst'); // CALCIO_PROBABILITY_FIRST_PATCH_V1

const CALCIO_PROFESSIONAL_SELECTION_VERSION = 'BETTING_PATCH_25_RESILIENT_FINAL_MARKET_SELECTION_V1';

function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function text(v) { return String(v ?? '').trim(); }
function marketFamily(prediction = '') {
    const p = text(prediction).toUpperCase().replace(/\s+/g, '');
    if (['1', 'X', '2'].includes(p)) return '1X2';
    if (['O2.5', 'U2.5'].includes(p)) return 'TOTALS';
    if (['1X', 'X2', '12'].includes(p)) return 'DOUBLE_CHANCE';
    return 'OTHER';
}
function oddsBand(odd) {
    const o = num(odd, 0);
    if (o >= 1.45 && o <= 2.40) return 'CORE_LOW_ODDS';
    if (o > 2.40 && o <= 3.50) return 'CORE_STANDARD';
    if (o > 3.50 && o <= 5.00) return 'EXTENDED';
    return o > 5 ? 'LONGSHOT_ANALYSIS' : 'INVALID';
}
function predictionIndexFor(candidate = {}) {
    const existing = candidate.predictionIndex || candidate.prediction_index;
    if (existing && Number.isFinite(Number(existing.score))) return existing;
    if (Number.isFinite(Number(candidate.calcio_prediction_index_score))) {
        return {
            score: num(candidate.calcio_prediction_index_score),
            label: text(candidate.calcio_prediction_index_label) || unifiedPredictionIndex.predictionIndexLabel(candidate.calcio_prediction_index_score),
            rankValue: num(candidate.calcio_prediction_index_rank_value, num(candidate.calcio_prediction_index_score) * 1000),
            operationalStake: num(candidate.calcio_operational_stake ?? candidate.operationalStake ?? candidate.invested),
            theoreticalStake: num(candidate.calcio_theoretical_stake ?? candidate.theoreticalStake ?? candidate.stake_theoretical),
            prePortfolioCapStake: num(candidate.calcio_theoretical_stake ?? candidate.theoreticalStake ?? candidate.stake_theoretical),
            netExecutableOdd: num(candidate.calcio_net_executable_odd ?? candidate.odd),
            grossExecutableOdd: num(candidate.odd),
            exchangeCommissionPct: num(candidate.calcio_exchange_commission_pct),
            valueScore: num(candidate.calcio_prediction_value_score),
            eligible: Boolean(num(candidate.calcio_prediction_index_eligible, 0))
        };
    }
    return unifiedPredictionIndex.evaluatePrediction(candidate);
}
function stageRank(candidate = {}) {
    const index = predictionIndexFor(candidate);
    if (index.operationalStake > 0) return 4;
    if (index.score >= 60) return 3;
    if (index.score >= 45) return 2;
    return 1;
}
function scoreCandidate(candidate = {}) {
    const index = predictionIndexFor(candidate);
    return {
        version: CALCIO_PROFESSIONAL_SELECTION_VERSION,
        score: num(index.score),
        rankValue: num(index.rankValue, num(index.score) * 1000),
        band: oddsBand(candidate.odd),
        marketFamily: marketFamily(candidate.prediction),
        stageRank: stageRank(candidate),
        predictionIndex: index,
        components: {
            predictionIndexScore: num(index.score),
            predictionIndexLabel: text(index.label),
            valueScore: num(index.valueScore ?? index.components?.value?.score),
            edge: num(candidate.edge_pp ?? candidate.edge),
            ev: num(candidate.ev_pct),
            reliability: num(candidate.prediction_reliability_score ?? candidate.calcio_prediction_reliability_score)
        }
    };
}
function rankCandidates(candidates = []) {
    const config = probabilityFirst.readConfig();
    const v15Paper = process.env.SAFE13_MANUAL_PAPER === '1';
    const pfMode = !v15Paper && config.mode === 'PROBABILITY_FIRST' && (Array.isArray(candidates) ? candidates : []).some(row => probabilityFirst.assess(row, config).quoteCertified);
    return (Array.isArray(candidates) ? candidates : []).map((candidate, index) => {
        const selection = scoreCandidate(candidate);
        const probability_first = probabilityFirst.assess(candidate, config);
        return {
            ...candidate,
            predictionIndex: selection.predictionIndex,
            prediction_index: selection.predictionIndex,
            candidate_selection_version: pfMode ? probabilityFirst.VERSION : selection.version,
            candidate_selection_score: selection.score,
            candidate_selection_tier: selection.predictionIndex.label,
            candidate_selection_reason: pfMode
                ? 'Probability First: ordinamento su P(win) stimata, quote in fascia e affidabilita; EV/IPM soltanto diagnostici per questa scelta.'
                : 'Indice Predizione ' + selection.score.toFixed(1) + '/100 (' + selection.predictionIndex.label + '); mercato ' + selection.marketFamily + '; unico ordinamento operativo con Edge/EV al 25%.',
            probability_first,
            calcio_probability_first: probability_first,
            _selectionOriginalIndex: index,
            _selectionDiagnostics: selection
        };
    }).sort((a, b) => {
        if (v15Paper) {
            const rawEv = row => {
              const odd=num(row.odd,0), p=num(row.estimatedProb ?? row.estimated_prob,0);
              return odd>1 && p>0 ? Math.min(num(row.ev_pct,0), (odd*p/100-1)*100) : -999;
            };
            const evDiff=rawEv(b)-rawEv(a);
            if (Math.abs(evDiff)>0.0001) return evDiff;
        }
        if (pfMode) {
            const pfOrder = probabilityFirst.compare(a.probability_first, b.probability_first);
            if (pfOrder !== 0) return pfOrder;
        }
        return num(b.calcio_prediction_index_rank_value ?? b.predictionIndex?.rankValue ?? b.candidate_selection_score * 1000)
             - num(a.calcio_prediction_index_rank_value ?? a.predictionIndex?.rankValue ?? a.candidate_selection_score * 1000)
             || a._selectionOriginalIndex - b._selectionOriginalIndex;
    });
}
function selectionAudit(candidates = []) {
    const ranked = rankCandidates(candidates);
    const config = probabilityFirst.readConfig();
    const livePf = process.env.SAFE13_MANUAL_PAPER !== '1' && config.mode === 'PROBABILITY_FIRST' && ranked.some(row => row.probability_first?.quoteCertified === true);
    const selected = livePf
        ? (ranked.find(row => row.probability_first?.applicable) || null)
        : (ranked[0] || null);
    const families = ranked.reduce((acc, row) => {
        const family = marketFamily(row.prediction);
        acc[family] = (acc[family] || 0) + 1;
        return acc;
    }, {});
    return {
        version: CALCIO_PROFESSIONAL_SELECTION_VERSION,
        candidateCount: ranked.length,
        families,
        probabilityFirstConfig: config,
        selectionObjective: process.env.SAFE13_MANUAL_PAPER === '1' ? 'EDGE_FIRST_V15_PAPER' : livePf ? 'PROBABILITY_FIRST' : 'VALUE_OR_HISTORICAL_FALLBACK',
        selected: selected ? {
            prediction: selected.prediction,
            family: marketFamily(selected.prediction),
            score: num(selected.predictionIndex?.score),
            valueScore: num(selected.predictionIndex?.valueScore ?? selected.predictionIndex?.components?.value?.score),
            operationalStake: num(selected.predictionIndex?.operationalStake)
        } : null,
        ranking: ranked.map(row => ({
            prediction: row.prediction,
            family: marketFamily(row.prediction),
            score: num(row.predictionIndex?.score),
            valueScore: num(row.predictionIndex?.valueScore ?? row.predictionIndex?.components?.value?.score),
            stake: num(row.predictionIndex?.operationalStake),
            odd: num(row.odd),
            probabilityPct: row.probability_first?.probabilityPct ?? null,
            probabilityFirstQualified: row.probability_first?.qualified === true,
            finalized: false
        })),
        finalizationCandidates: calcioAiFinalization.buildFinalizationCandidates(ranked, 3),
        finalizationPolicy: {
            topN: 3,
            minimumFinalized: 2,
            rankingAuthority: 'FINAL_IPM_AFTER_UNIFIED_DEEPSCAN_AND_PT',
            provisionalRankingMayNotAuthorizeBestMarketLabel: true
        }
    };
}
function selectPrimary(candidates = []) {
    const ranked = rankCandidates(candidates);
    const config = probabilityFirst.readConfig();
    const livePf = process.env.SAFE13_MANUAL_PAPER !== '1' && config.mode === 'PROBABILITY_FIRST' && ranked.some(row => row.probability_first?.quoteCertified === true);
    const selected = livePf
        ? (ranked.find(row => row.probability_first?.applicable) || null)
        : (ranked[0] || null);
    return { selected, ranked, audit: selectionAudit(ranked), version: livePf ? probabilityFirst.VERSION : CALCIO_PROFESSIONAL_SELECTION_VERSION };
}

function parseSelectionAudit(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try { return JSON.parse(String(value)); } catch (_) { return null; }
}
function finalizeSelectedMarket(prediction = '', finalDecision = {}, auditInput = null, margin = 0) {
    const audit = parseSelectionAudit(auditInput) || {};
    const finalRanking = Array.isArray(audit.finalRanking) ? audit.finalRanking : [];
    const winner = (process.env.SAFE13_MANUAL_PAPER === '1' || probabilityFirst.readConfig().mode === 'PROBABILITY_FIRST')
        ? (finalRanking[0] || null) // Gia' ordinato per P(win) dopo il DeepScan; non ricalcolare IPM/EV.
        : (finalRanking.slice().sort((a, b) => num(b.score) - num(a.score) || text(a.prediction).localeCompare(text(b.prediction)))[0] || null);
    const fullyFinalized = audit.fullyFinalized === true
        && finalRanking.length >= 2
        && finalRanking.every(row => row.finalized === true);
    const selectedPrediction = winner?.prediction || prediction;
    const stable = fullyFinalized && Boolean(winner);
    return {
        version: CALCIO_PROFESSIONAL_SELECTION_VERSION,
        status: stable ? 'BEST_MARKET_FULLY_CERTIFIED' : 'MARKET_FINALIZATION_INCOMPLETE',
        selectedPrediction,
        finalScore: num(winner?.score ?? finalDecision.score),
        winnerPrediction: winner?.prediction || null,
        winnerScore: winner ? num(winner.score) : null,
        finalizedCandidates: finalRanking.length,
        fullyFinalized,
        reselectionRequired: false,
        reason: stable
            ? (process.env.SAFE13_MANUAL_PAPER !== '1' && probabilityFirst.readConfig().mode === 'PROBABILITY_FIRST'
                ? `Mercato ${selectedPrediction} primo per probabilita stimata fra candidati nella fascia; DeepScan finalizzato, non equivale a stake autorizzato.`
                : `Miglior mercato ${selectedPrediction} certificato su ${finalRanking.length} candidati finalizzati con DeepScan canonico e PT.`)
            : 'Ranking mercati non completamente finalizzato: nessuna autorita operativa e nessuna dicitura MIGLIOR PRONOSTICO certificata.'
    };
}
function kickoffBucket(row = {}) {
    const raw = row.match_date || row.date || row.commence_time || '';
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return 'UNKNOWN';
    return dt.toISOString().slice(0, 13);
}
function applyPortfolioExposureCaps(candidates = [], bankroll = 0, existingRows = [], options = {}) {
    const bank = Math.max(0, num(bankroll));
    const totalCap = bank * num(options.totalExposurePct, 5) / 100;
    const longshotCap = bank * num(options.longshotExposurePct, 1) / 100;
    const kickoffCap = bank * num(options.kickoffExposurePct, 2) / 100;
    const candidateKeys = new Set((Array.isArray(candidates) ? candidates : []).map(row => row.event_key || row.eventKey || row.match_exposure_key).filter(Boolean));
    let existingTotal = 0;
    let existingLongshot = 0;
    const existingKickoff = new Map();
    for (const row of Array.isArray(existingRows) ? existingRows : []) {
        const key = row.match_exposure_key || row.calcio_event_key || row.event_key;
        if (key && candidateKeys.has(key)) continue;
        const stake = Math.max(0, num(row.calcio_operational_stake ?? row.stake));
        if (!stake) continue;
        existingTotal += stake;
        if (num(row.odd) > 3.5) existingLongshot += stake;
        const bucket = kickoffBucket(row);
        existingKickoff.set(bucket, num(existingKickoff.get(bucket)) + stake);
    }
    let allocatedTotal = existingTotal;
    let allocatedLongshot = existingLongshot;
    const allocatedKickoff = new Map(existingKickoff);
    const ranked = rankCandidates(candidates);
    const output = ranked.map(row => {
        const predictionIndex = row.predictionIndex || row.prediction_index || {};
        const finalStatus = text(row.calcio_ai_finalization_status || predictionIndex.finalizationStatus).toUpperCase();
        const rankingCertified = Number(row.calcio_market_ranking_certified || 0) === 1
            || finalStatus === 'BEST_MARKET_FULLY_CERTIFIED'
            || finalStatus === 'PATCH24_BEST_MARKET_FULLY_CERTIFIED';
        const indexEligible = predictionIndex.eligible === true || Number(row.calcio_prediction_index_eligible || 0) === 1;
        const requested = rankingCertified && indexEligible
            ? Math.max(0, num(predictionIndex.prePortfolioCapStake ?? predictionIndex.theoreticalStake ?? row.calcio_theoretical_stake ?? predictionIndex.operationalStake ?? row.operationalStake ?? row.invested))
            : 0;
        const bucket = kickoffBucket(row);
        const longshot = num(row.odd) > 3.5;
        const remainingTotal = Math.max(0, totalCap - allocatedTotal);
        const remainingKickoff = Math.max(0, kickoffCap - num(allocatedKickoff.get(bucket)));
        const remainingLongshot = longshot ? Math.max(0, longshotCap - allocatedLongshot) : Infinity;
        const r15Eligible=predictionIndex.stakeAuthority?.policy==='EDGE_KELLY_MANUAL_PAPER_V15' && predictionIndex.stakeAuthority?.paperOnly===true;
        // R19 policy: permit cent-level PAPER simulation only for verified V15 authority.
        const minOperationalStake=r15Eligible?0.01:2;
        let allowed = Math.min(requested, remainingTotal, remainingKickoff, remainingLongshot);
        if (allowed > 0 && allowed < minOperationalStake) allowed = 0;
        // Never round up and exceed the remaining portfolio budget.
        allowed = Math.floor(Math.max(0, allowed) * 100 + 1e-8) / 100;
        allocatedTotal += allowed;
        allocatedKickoff.set(bucket, num(allocatedKickoff.get(bucket)) + allowed);
        if (longshot) allocatedLongshot += allowed;
        const capped = allowed + 1e-9 < requested;
        const finalEligible = allowed >= minOperationalStake;
        const capReason = capped ? 'Cap aggregato applicato dopo DeepScan/PT/IPM finali.' : null;
        const finalReason = finalEligible
            ? [predictionIndex.reason, capReason].filter(Boolean).join(' ')
            : (requested > 0
                ? `Stake €0 dopo i cap aggregati finali: importo disponibile inferiore al minimo operativo €${minOperationalStake}. ${capReason || ''}`.trim()
                : (predictionIndex.reason || 'Stake €0: riga non eleggibile dopo la finalizzazione.'));
        const ptSample = num(predictionIndex.components?.paperTrading?.sample, 0);
        const updatedIndex = {
            ...predictionIndex,
            prePortfolioCapStake: requested,
            operationalStake: allowed,
            theoreticalStake: num(predictionIndex.theoreticalStake ?? row.theoreticalStake ?? row.stake_theoretical),
            eligible: finalEligible,
            allowBet: finalEligible,
            status: finalEligible ? 'UNIFIED_INDEX_STAKE_AUTHORIZED' : 'UNIFIED_INDEX_NO_STAKE',
            action: finalEligible ? 'BET_ALLOWED_UNIFIED_INDEX' : 'ANALYSIS_ONLY_UNIFIED_INDEX',
            gateStatus: finalEligible ? 'CALCIO_APPROVED_WITH_CAP' : 'CALCIO_WATCHLIST_MICRO',
            reason: finalReason,
            estimatedProfit: allowed * Math.max(0, num(predictionIndex.netExecutableOdd ?? row.odd) - 1),
            portfolioCapApplied: capped,
            portfolioCapReason: capReason,
            decisionCertification: {
                ...(predictionIndex.decisionCertification || {}),
                status: finalEligible
                    ? (ptSample > 0 ? 'STRUCTURALLY_CERTIFIED_PT_VALIDATED' : 'STRUCTURALLY_CERTIFIED_PT_ABSENT')
                    : 'DECISION_ANALYSIS_ONLY',
                reason: finalReason
            }
        };
        return {
            ...row,
            predictionIndex: updatedIndex,
            prediction_index: updatedIndex,
            invested: allowed.toFixed(2),
            operationalStake: allowed.toFixed(2),
            stake_operational: allowed.toFixed(2),
            estimatedProfit: updatedIndex.estimatedProfit.toFixed(2),
            calcio_portfolio_cap_applied: capped ? 1 : 0,
            calcio_portfolio_cap_reason: updatedIndex.portfolioCapReason
        };
    });
    return {
        version: 'BETTING_PATCH_25_POST_FINALIZATION_PORTFOLIO_CAP_STATE_NORMALIZED_V1',
        bankroll: bank,
        limits: { totalCap, longshotCap, kickoffCap },
        existing: { total: existingTotal, longshot: existingLongshot, kickoff: Object.fromEntries(existingKickoff) },
        allocated: { total: allocatedTotal, longshot: allocatedLongshot, kickoff: Object.fromEntries(allocatedKickoff) },
        candidates: output
    };
}

module.exports = {
    CALCIO_PROFESSIONAL_SELECTION_VERSION,
    oddsBand,
    marketFamily,
    stageRank,
    scoreCandidate,
    rankCandidates,
    selectionAudit,
    selectPrimary,
    predictionIndexFor,
    parseSelectionAudit,
    finalizeSelectedMarket,
    applyPortfolioExposureCaps
};
