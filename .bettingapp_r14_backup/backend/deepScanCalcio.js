// ==========================================
//  AI BETTING QUANT PRO - DEEP SCAN CALCIO
//  Versione: 12.3 + STEP60 (Professional Guardrails)
// ==========================================
//
// Obiettivo v12.0:
// - Allineare il DeepScan Calcio alle lezioni apprese sul Tennis.
// - DeepScan = perizia qualitativa, non modifica stake.
// - Evitare "tutto verde" o "tutto rosso": valutazione a pilastri.
// - Evitare crash se NLP/value evaluator/quote reference sono incompleti.
// - Correggere bug di classificazione mercati: O2.5 non deve essere trattato come segno 2.
// - Non dichiarare VIA LIBERA su edge negativo o basso solo perché le rose sono integre.
//
// Obiettivo v12.2:
// - DeepScan produce una perizia operational-gate con tre esiti finali:
//   conferma pronostico, attendi in-play con timing, oppure alternativa motivata.
// - Il suggerimento non modifica stake, gate o ROI: valida/smentisce qualitativamente.
//
// Obiettivo v12.3 / STEP60:
// - Lineup/news pre-match, affidabilita xG/Understat/football-data, team matching professionale.
// - Timing operativo Calcio e correlazioni di mercato con alternative DeepScan.

const { getTeamNlpProfile } = require('./nlpEngine7');
const valueEvaluator = require('./value_evaluator');
const calcioProfessionalGuard = require('./calcioProfessionalGuard');
const calcioSourceIntelligence = require('./calcioSourceIntelligence');
const calcioTemporalAnalysisPolicyAudit16dR2 = require('./calcioTemporalAnalysisPolicyAudit16dR2');
const adaptiveR10 = require('./calcioAdaptiveDeepScanR10');
const independentR11 = require('./calcioIndependentAiR11');

const DEEP_SCAN_CALCIO_VERSION = 'BETTING_PATCH_13_R1_DEEPSCAN_RUNTIME_RESILIENCE';

// ============================================================================
// HELPERS
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

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function normalizeOdd(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 1 ? n : null;
}

// RECOVERY_R8: missing or malformed probability must never become a fictitious 50%.
function strictProbabilityPct(value) {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim()) || typeof value === 'boolean') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

function buildMissingModelProbabilityResult(prediction, odd) {
    const gate = {
        mode: 'OPERATIONAL_GATE', allowBet: false,
        status: 'CALCIO_DEEPSCAN_BLOCKED_MISSING_MODEL_PROBABILITY', action: 'BLOCK',
        stakeMultiplier: 0, level: 'DATA_MISSING', riskScore: 100,
        reason: 'Probabilita modello assente o invalida: nessun valore 50% sostitutivo.',
        auditImpact: 'AUDIT_ONLY_BLOCKED_BY_DEEPSCAN', version: DEEP_SCAN_CALCIO_VERSION
    };
    return {
        success: true, action: '🔴 NO BET · PROBABILITÀ MODELLO ASSENTE',
        signalAction: '🔴 NO BET · PROBABILITÀ MODELLO ASSENTE',
        operationalAction: '🔴 NO BET · PROBABILITÀ MODELLO ASSENTE',
        suggestionText: 'Nessuna selezione: probabilita modello non verificata',
        reason: '<div style="padding:15px;color:#f87171">DeepScan Calcio: probabilita modello mancante o non valida; nessun edge calcolato. STUDIO / NO BET.</div>',
        isHighRisk: true, riskLevel: 'DATA_MISSING', riskScore: 100,
        deepScanOperationalGate: gate, deepScanGateMode: 'OPERATIONAL_GATE',
        marketSummary: {prediction:String(prediction || ''),targetOdd:normalizeOdd(odd),modelProbabilityPct:null,bookmakerFairProbabilityPct:null,rawEvPct:null,finalEdgePp:null,referenceType:'UNVERIFIED'},
        sourceIntelligence: null, sourceCoverageStatus: 'UNVERIFIED', sourceCoveragePct: 0,
        version: DEEP_SCAN_CALCIO_VERSION
    };
}

function getContextText(extData = {}) {
    return [
        extData.league,
        extData.competition,
        extData.tournament,
        extData.country,
        extData.round,
        extData.stage
    ].filter(Boolean).join(' ').toLowerCase();
}

function detectMarketRegime(matchData = {}) {
    const avgGoals = safeNumber(matchData.avgGoals ?? matchData.expectedGoals ?? matchData.xgTotal, 2.5);
    const volatility = safeNumber(matchData.marketVolatility ?? matchData.volatility, 1);
    const oddsSpread = Math.abs(safeNumber(matchData.homeOdd, 2) - safeNumber(matchData.awayOdd, 2));

    let regime = '⚖️ BALANCED (Equilibrato)';

    if (avgGoals >= 3.0 && volatility > 1.08) {
        regime = '🔥 HIGH_SCORING_VOLATILE (Alta Varianza)';
    } else if (avgGoals <= 2.1) {
        regime = '🛡️ LOW_SCORING (Chiuso/Tattico)';
    } else if (oddsSpread >= 1.8) {
        regime = '👑 HEAVY_FAVORITE (Dominio Netto)';
    }

    return regime;
}

function normalizePredictionMarket(prediction) {
    const raw = String(prediction || '').trim().toUpperCase();
    const compact = raw.replace(/\s+/g, '').replace(',', '.');

    const isOver = /^O(VER)?2\.?5$/.test(compact) || compact.includes('OVER') || compact === 'O2.5' || compact === 'O25';
    const isUnder = /^U(NDER)?2\.?5$/.test(compact) || compact.includes('UNDER') || compact === 'U2.5' || compact === 'U25';
    const isBttsYes = compact === 'GG' || compact === 'GOAL' || compact === 'BTTSYES' || compact === 'BTTS';
    const isBttsNo = compact === 'NG' || compact === 'NOGOAL' || compact === 'BTTSNO';
    const isDraw = compact === 'X';
    const isHome = compact === '1';
    const isAway = compact === '2';
    const isHomeDc = compact === '1X';
    const isAwayDc = compact === 'X2';
    const isNoDraw = compact === '12';

    let family = 'OTHER';
    if (isHome || isDraw || isAway || isHomeDc || isAwayDc || isNoDraw) family = 'RESULT';
    if (isOver || isUnder) family = 'TOTALS';
    if (isBttsYes || isBttsNo) family = 'BTTS';

    return {
        raw,
        compact,
        family,
        isOver,
        isUnder,
        isBttsYes,
        isBttsNo,
        isDraw,
        isHome,
        isAway,
        isHomeDc,
        isAwayDc,
        isNoDraw,
        selectedSide: isHome || isHomeDc ? 'HOME' : isAway || isAwayDc ? 'AWAY' : isDraw ? 'DRAW' : isOver ? 'OVER' : isUnder ? 'UNDER' : isBttsYes ? 'BTTS_YES' : isBttsNo ? 'BTTS_NO' : 'OTHER'
    };
}

function buildDefaultTactics() {
    return {
        isEmergency: false,
        keyPlayerOut: false,
        defenseOut: false,
        attackOut: false,
        mentions: 0
    };
}

function normalizeTeamProfile(profile = {}, teamName = '') {
    const tactics = { ...buildDefaultTactics(), ...(profile.tactics || {}) };
    return {
        score: safeNumber(profile.score, 0),
        confidence: clamp(safeNumber(profile.confidence, 35), 0, 100),
        report: profile.report || 'Neutro ⚖️',
        color: profile.color || '#94a3b8',
        tactics,
        sourceError: profile.sourceError || null,
        sourceIntelligence: profile.sourceIntelligence || null,
        sourceVersion: profile.sourceVersion || null,
        teamName
    };
}

async function getSafeTeamProfile(teamName, options = {}) {
    try {
        const profile = await getTeamNlpProfile(teamName, options);
        return normalizeTeamProfile(profile, teamName);
    } catch (error) {
        return normalizeTeamProfile({
            confidence: 25,
            report: 'NLP non disponibile ⚠️',
            color: '#f59e0b',
            sourceError: error?.message || 'NLP unavailable'
        }, teamName);
    }
}

function safeValidateMarketEdge(modelProb, fairProb) {
    try {
        if (valueEvaluator && typeof valueEvaluator.validateMarketEdge === 'function') {
            const result = valueEvaluator.validateMarketEdge(modelProb, fairProb) || {};
            return {
                ...result,
                status: result.status || result.validation || result.label || 'UNKNOWN'
            };
        }
    } catch (error) {
        return { status: 'UNKNOWN', warning: error?.message || 'validateMarketEdge failed' };
    }
    return { status: 'UNKNOWN', warning: 'validateMarketEdge not available' };
}

// RECOVERY_R8: raw best prices from different bookmakers cannot prove a no-vig reference.
function coherentReferenceMatches(reference = {}, market, values) {
    if (!reference || reference.certified !== true || !String(reference.bookmakerKey || '').trim() || !Number.isFinite(Date.parse(String(reference.lastUpdate || '')))) return false;
    const family = market.family;
    if (String(reference.family || '').toUpperCase() !== family) return false;
    const odds = reference.odds || {};
    const equals = (a, b) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Number(a) > 1 && Math.abs(Number(a)-Number(b)) <= 1e-9;
    if (family === 'RESULT') return equals(odds['1'],values.o1) && equals(odds.X,values.oX) && equals(odds['2'],values.o2);
    if (family === 'TOTALS') return equals(odds['O2.5'],values.overOdd) && equals(odds['U2.5'],values.underOdd);
    return false;
}

function calculateBookmakerReference(market, targetOdd, odd1, oddX, odd2, extData = {}) {
    const target = normalizeOdd(targetOdd);
    const o1 = normalizeOdd(odd1 ?? extData.homeOdd);
    const oX = normalizeOdd(oddX ?? extData.drawOdd);
    const o2 = normalizeOdd(odd2 ?? extData.awayOdd);
    const overOdd = normalizeOdd(extData.overOdd ?? extData.oddOver ?? extData.over_2_5_odd);
    const underOdd = normalizeOdd(extData.underOdd ?? extData.oddUnder ?? extData.under_2_5_odd);
    const coherent = coherentReferenceMatches(extData.coherentMarketReference,market,{o1,oX,o2,overOdd,underOdd});
    let fairProb = 0;
    let margin = 0;
    let marketReferenceAvailable = false;
    let referenceType = 'played_odd_fallback';

    if (coherent && market.family === 'RESULT' && o1 && oX && o2 && target) {
        const sumImplied = (1 / o1) + (1 / oX) + (1 / o2);
        margin = (sumImplied - 1) * 100;
        const p1 = ((1 / o1) / sumImplied) * 100;
        const pX = ((1 / oX) / sumImplied) * 100;
        const p2 = ((1 / o2) / sumImplied) * 100;
        if (market.isHomeDc) fairProb = p1 + pX;
        else if (market.isAwayDc) fairProb = pX + p2;
        else if (market.isNoDraw) fairProb = p1 + p2;
        else if (market.isAway) fairProb = p2;
        else if (market.isDraw) fairProb = pX;
        else fairProb = p1;
        marketReferenceAvailable = true;
        referenceType = market.isHomeDc || market.isAwayDc || market.isNoDraw
            ? 'coherent_double_chance_no_vig_reference'
            : 'coherent_1x2_no_vig_reference';
    } else if (coherent && market.family === 'TOTALS' && overOdd && underOdd && target) {
        const sumImplied = (1 / overOdd) + (1 / underOdd);
        margin = (sumImplied - 1) * 100;
        fairProb = market.isUnder ? ((1 / underOdd) / sumImplied) * 100 : ((1 / overOdd) / sumImplied) * 100;
        marketReferenceAvailable = true;
        referenceType = 'coherent_totals_no_vig_reference';
    }
    if (!marketReferenceAvailable && target) {
        // Informational played-odd proxy, explicitly NOT certified as a no-vig market.
        margin = safeNumber(extData.defaultMarginPct, 5.0);
        fairProb = ((1 / target) / (1 + margin / 100)) * 100;
        referenceType = 'played_odd_fallback_unverified';
    }
    return {
        targetOdd: target || 0, fairProb: clamp(fairProb, 0, 100), margin,
        marketReferenceAvailable, referenceType, odds: {o1,oX,o2},
        coherentReferenceCertified: coherent
    };
}

function computeNlpBoost(market, homeData, awayData) {
    let nlpBoost = 1.0;

    if (market.selectedSide === 'HOME') {
        if (homeData.score > 0) nlpBoost += clamp(homeData.score * 0.02, 0, 0.08);
        if (homeData.score < 0) nlpBoost -= clamp(Math.abs(homeData.score) * 0.02, 0, 0.08);
        if (awayData.score < 0) nlpBoost += clamp(Math.abs(awayData.score) * 0.02, 0, 0.08);
    } else if (market.selectedSide === 'AWAY') {
        if (awayData.score > 0) nlpBoost += clamp(awayData.score * 0.02, 0, 0.08);
        if (awayData.score < 0) nlpBoost -= clamp(Math.abs(awayData.score) * 0.02, 0, 0.08);
        if (homeData.score < 0) nlpBoost += clamp(Math.abs(homeData.score) * 0.02, 0, 0.08);
    } else if (market.isOver || market.isBttsYes) {
        if (homeData.tactics.attackOut || awayData.tactics.attackOut) nlpBoost -= 0.08;
        if (homeData.tactics.defenseOut || awayData.tactics.defenseOut) nlpBoost += 0.05;
    } else if (market.isUnder || market.isBttsNo) {
        if (homeData.tactics.defenseOut || awayData.tactics.defenseOut) nlpBoost -= 0.08;
        if (homeData.tactics.attackOut || awayData.tactics.attackOut) nlpBoost += 0.05;
    }

    return clamp(nlpBoost, 0.86, 1.12);
}

function hasCriticalIssues(profile) {
    const t = profile.tactics || buildDefaultTactics();
    return Boolean(t.isEmergency || t.keyPlayerOut || (t.mentions >= 4) || (t.attackOut && t.defenseOut));
}

function selectedSideHasIssues(market, homeData, awayData) {
    if (market.selectedSide === 'HOME') return hasCriticalIssues(homeData);
    if (market.selectedSide === 'AWAY') return hasCriticalIssues(awayData);
    if (market.isOver) return homeData.tactics.attackOut || awayData.tactics.attackOut;
    if (market.isUnder) return homeData.tactics.defenseOut || awayData.tactics.defenseOut;
    return false;
}

function buildPillar(name, risk, weight, summary, evidence = []) {
    const r = clamp(safeNumber(risk, 0), 0, 100);
    let status = 'PASS';
    if (r >= 75) status = 'FAIL';
    else if (r >= 50) status = 'WARN_HIGH';
    else if (r >= 30) status = 'WARN';

    return {
        name,
        risk: round(r, 1),
        weight,
        status,
        summary,
        evidence: Array.isArray(evidence) ? evidence.filter(Boolean) : []
    };
}

function weightedRisk(pillars) {
    let w = 0;
    let total = 0;
    for (const p of pillars) {
        const weight = Math.max(0, safeNumber(p.weight, 0));
        total += safeNumber(p.risk, 0) * weight;
        w += weight;
    }
    return w <= 0 ? 0 : clamp(total / w, 0, 100);
}

function buildFootballSixPillarAssessment(input) {
    const {
        market,
        realEdge,
        rawEdge,
        modelProb,
        bookieFairProb,
        disagreement,
        marketReferenceAvailable,
        referenceType,
        targetOdd,
        marketRegime,
        homeData,
        awayData,
        extData,
        modelConviction
    } = input;

    const contextText = getContextText(extData);
    const isFriendly = /friendly|amichevole/.test(contextText);
    const isCup = /cup|coppa|fa cup|efl|carabao|copa/.test(contextText);
    const isMajor = /champions|europa|serie a|premier|liga|bundesliga|ligue 1|world cup|euro/.test(contextText);
    const avgGoals = safeNumber(extData.avgGoals ?? extData.expectedGoals ?? extData.xgTotal, 2.5);
    const homeXgValue = calcioSourceIntelligence.strictFinite(extData.homeXg ?? extData.home_xg ?? extData.xgHome);
    const awayXgValue = calcioSourceIntelligence.strictFinite(extData.awayXg ?? extData.away_xg ?? extData.xgAway);
    const xgEvidenceMode = String(extData.xgEvidenceMode || extData.xg_evidence_mode || extData.probabilityIntegrity?.xgEvidenceMode || '').toUpperCase();
    const xgAvailable = homeXgValue !== null && awayXgValue !== null && (extData.understatLoaded === true || xgEvidenceMode.includes('REAL_XG'));
    const xgProxyActive = xgEvidenceMode.includes('PROXY');
    const opponentAdjustedForm = extData.opponentAdjustedForm || null;
    const formStatus = String(opponentAdjustedForm?.status || 'UNAVAILABLE').toUpperCase();
    const formApplied = opponentAdjustedForm?.applied === true;
    const homeFormAdjustmentPct = safeNumber(opponentAdjustedForm?.homeAdjustmentPct, 0);
    const awayFormAdjustmentPct = safeNumber(opponentAdjustedForm?.awayAdjustmentPct, 0);
    const formConfidence = safeNumber(opponentAdjustedForm?.confidence, 0);
    const homeNewsStatus = homeData.sourceIntelligence?.status || 'UNAVAILABLE';
    const awayNewsStatus = awayData.sourceIntelligence?.status || 'UNAVAILABLE';
    const verifiedNews = [homeNewsStatus, awayNewsStatus].some(status => status === 'VERIFIED_MULTI_SOURCE');
    const usableNews = (homeData.sourceIntelligence?.counts?.usableArticles || 0) + (awayData.sourceIntelligence?.counts?.usableArticles || 0);
    const temporalAnalysis = extData.temporalAnalysis || calcioTemporalAnalysisPolicyAudit16dR2.evaluate(extData);
    const temporalNewsDeferred = temporalAnalysis.liveNewsMode === 'DEFERRED';

    let marketTrapRisk = 10;
    const marketEvidence = [];
    if (marketReferenceAvailable) {
        marketEvidence.push(`Reference ${referenceType}; disaccordo modello/mercato ${round(disagreement, 1)}pp.`);
        if (disagreement >= 22 && realEdge >= 8) marketTrapRisk = 92;
        else if (disagreement >= 16 && realEdge >= 6) marketTrapRisk = 74;
        else if (disagreement >= 12 && realEdge >= 4) marketTrapRisk = 55;
        else if (disagreement >= 8) marketTrapRisk = 34;
        else marketTrapRisk = 12;
    } else {
        marketEvidence.push('Quote reference complete assenti: l’edge non è validato da un mercato no-vig completo.');
        if (Math.abs(realEdge) >= 14 || Math.abs(rawEdge) >= 24) marketTrapRisk = 65;
        else if (Math.abs(realEdge) >= 8) marketTrapRisk = 45;
        else marketTrapRisk = 24;
    }
    marketEvidence.push(`Prob. modello ${round(modelProb, 1)}% vs fair book ${round(bookieFairProb, 1)}%.`);
    marketEvidence.push(`Quota ${round(targetOdd, 2)} · raw EV ${round(rawEdge, 1)}% · edge finale ${round(realEdge, 1)}%.`);

    let tacticalRisk = 16;
    const tacticalEvidence = [`Regime: ${marketRegime}.`];
    if (marketRegime.includes('VOLATILE')) {
        tacticalRisk += market.isOver || market.isBttsYes ? 12 : 22;
        tacticalEvidence.push('Alta varianza: penalizza mercati direzionali e Under.');
    }
    if (marketRegime.includes('LOW_SCORING')) {
        tacticalRisk += market.isOver ? 24 : 8;
        tacticalEvidence.push('Regime chiuso/tattico: Over più esposto a falso positivo.');
    }
    if (marketRegime.includes('HEAVY_FAVORITE') && market.selectedSide === 'DRAW') {
        tacticalRisk += 28;
        tacticalEvidence.push('Heavy favorite: pareggio più fragile.');
    }
    if (!xgAvailable && xgProxyActive) {
        tacticalRisk += 6;
        tacticalEvidence.push(`xG reale assente: attivo ${xgEvidenceMode}, con autorità inferiore e shrink prudenziale.`);
    } else if (!xgAvailable) {
        tacticalRisk += 12;
        tacticalEvidence.push('xG reale e proxy certificato non disponibili: valutazione tattica basata su prior/mercato.');
    } else {
        tacticalEvidence.push('xG reale presente per entrambe le squadre.');
    }
    if (formApplied) {
        tacticalEvidence.push(`Forma corretta per forza avversari: casa ${round(homeFormAdjustmentPct, 1)}%, trasferta ${round(awayFormAdjustmentPct, 1)}%, confidence ${round(formConfidence, 0)}/100.`);
        if (formStatus === 'EARLY_SEASON') {
            tacticalRisk += 4;
            tacticalEvidence.push('Campione iniziale: prior di lega a 6 partite limita l’autorità della forma recente.');
        }
    } else if (formStatus === 'PRIOR_ONLY') {
        tacticalRisk += 5;
        tacticalEvidence.push('Forma opponent-adjusted non osservabile: applicato solo prior neutro di lega.');
    } else if (formStatus === 'UNAVAILABLE') {
        tacticalRisk += 6;
        tacticalEvidence.push('Forma opponent-adjusted non disponibile per mancata riconciliazione squadra.');
    }
    if (avgGoals >= 3.2 && market.isUnder) tacticalRisk += 14;
    if (avgGoals <= 2.0 && market.isOver) tacticalRisk += 14;

    let teamNewsRisk = 8;
    const teamEvidence = [];
    const homeIssues = hasCriticalIssues(homeData);
    const awayIssues = hasCriticalIssues(awayData);
    const selectedIssues = selectedSideHasIssues(market, homeData, awayData);
    if (temporalNewsDeferred) {
        // AUDIT16D_R2: lontano dal match l'assenza di news/lineup non e una prova negativa.
        // La variabile resta UNKNOWN e viene rivalutata automaticamente nelle finestre MID/FULL.
        teamNewsRisk = 24;
        teamEvidence.push('News/medical live intenzionalmente differite oltre 7 giorni: variabile UNKNOWN, nessuna inferenza positiva o negativa.');
    } else if (selectedIssues) {
        teamNewsRisk = 88;
        teamEvidence.push('Criticità sulla selezione scelta: emergenza/assenze/attacco-difesa incompatibili col mercato.');
    } else if (homeIssues || awayIssues) {
        teamNewsRisk = 45;
        teamEvidence.push('Criticità di formazione presenti ma non direttamente contro la selezione.');
    } else if (verifiedNews) {
        teamEvidence.push('Nessuna criticità forte rilevata nelle fonti fresche, con almeno una conferma official-first/multi-source.');
    } else if (usableNews > 0) {
        teamNewsRisk = Math.max(teamNewsRisk, 28);
        teamEvidence.push('Notizie fresche presenti, ma senza conferma ufficiale completa: nessuna criticità verificata non equivale a rosa completa.');
    } else {
        teamNewsRisk = Math.max(teamNewsRisk, 42);
        teamEvidence.push('Nessuna evidenza news fresca e rilevante: stato UNKNOWN, non “assenze zero”.');
    }
    if (!temporalNewsDeferred && (homeData.sourceError || awayData.sourceError || homeNewsStatus === 'UNAVAILABLE' || awayNewsStatus === 'UNAVAILABLE')) {
        teamNewsRisk += 12;
        teamEvidence.push('Una o più fonti news non disponibili: fallback neutro con confidence ridotta.');
    }

    let motivationRisk = 22;
    const motivationEvidence = [];
    if (isFriendly) {
        motivationRisk = 65;
        motivationEvidence.push('Amichevole: motivazione e rotazioni molto variabili.');
    } else if (isCup && !isMajor) {
        motivationRisk = 42;
        motivationEvidence.push('Coppa/minor competition: possibili rotazioni.');
    } else if (isMajor) {
        motivationRisk = 14;
        motivationEvidence.push('Competizione maggiore: motivazione media più stabile.');
    } else {
        motivationEvidence.push('Motivazione torneo non pienamente classificata.');
    }
    if (extData.fixtureCongestion || extData.daysRestHome <= 3 || extData.daysRestAway <= 3) {
        motivationRisk += 14;
        motivationEvidence.push('Congestione calendario/riposo corto: rischio rotazioni.');
    }

    let overconfidenceRisk = 10;
    const overEvidence = [];
    if (modelProb >= 82) overconfidenceRisk += 34;
    else if (modelProb >= 75) overconfidenceRisk += 22;
    else if (modelProb >= 68) overconfidenceRisk += 12;
    if (realEdge >= 12 || rawEdge >= 25) overconfidenceRisk += 20;
    else if (realEdge >= 8 || rawEdge >= 16) overconfidenceRisk += 10;
    if (!marketReferenceAvailable) overconfidenceRisk += 10;
    if (modelConviction < 45) overconfidenceRisk += 16;
    else if (modelConviction >= 70) overconfidenceRisk -= 6;
    overEvidence.push(`Probabilità ${round(modelProb, 1)}%, edge ${round(realEdge, 1)}%, conviction ${round(modelConviction, 1)}/100.`);
    if (!marketReferenceAvailable) overEvidence.push('Senza reference completo non elevare a value professionale pieno.');

    let dataRisk = 12;
    const dataEvidence = [];
    if (!marketReferenceAvailable) {
        dataRisk += 18;
        dataEvidence.push('Quote no-vig complete non disponibili.');
    }
    if (!xgAvailable && xgProxyActive) {
        dataRisk += 6;
        dataEvidence.push(`xG reale assente; ${xgEvidenceMode} attivo e tracciato.`);
    } else if (!xgAvailable) {
        dataRisk += 14;
        dataEvidence.push('xG reale/metriche tattiche certificate non disponibili.');
    }
    if (formStatus === 'UNAVAILABLE') {
        dataRisk += 5;
        dataEvidence.push('Opponent-adjusted form non disponibile; nessuna correzione quantitativa applicata.');
    } else if (formStatus === 'PRIOR_ONLY') {
        dataRisk += 3;
        dataEvidence.push('Opponent-adjusted form in prior-only: correzione quantitativa neutra.');
    } else {
        dataEvidence.push(`Opponent-adjusted form ${formStatus}, confidence ${round(formConfidence, 0)}/100.`);
    }
    if (!Number.isFinite(Number(extData.mcGlobal))) {
        dataRisk += 8;
        dataEvidence.push('Monte Carlo trust score non fornito.');
    }
    if (!temporalNewsDeferred && (homeData.sourceError || awayData.sourceError)) dataRisk += 12;
    if (temporalNewsDeferred) {
        dataEvidence.push('News live differite per maturita temporale: non penalizzano la qualita strutturale early-preview e non forniscono conferme operative.');
    } else if (!verifiedNews) {
        dataRisk += usableNews > 0 ? 5 : 10;
        dataEvidence.push(usableNews > 0 ? 'News presenti ma non official-first.' : 'Copertura news rilevante assente.');
    }
    if (dataEvidence.length === 0) dataEvidence.push('Dati principali presenti.');

    const pillars = [
        buildPillar('Market traps / no-vig reference', marketTrapRisk, 0.28, marketReferenceAvailable ? 'Mercato reference disponibile.' : 'Reference incompleta: edge da validare.', marketEvidence),
        buildPillar('Tattica, xG e market regime', tacticalRisk, 0.20, 'Coerenza del pronostico con regime gara e xG.', tacticalEvidence),
        buildPillar('Team news / medical / assenze', teamNewsRisk, 0.20, selectedIssues ? 'Criticità sulla selezione.' : 'Team-news non bloccante.', teamEvidence),
        buildPillar('Motivazione / calendario / rotazioni', motivationRisk, 0.12, 'Rischio motivazionale e rotazioni.', motivationEvidence),
        buildPillar('Overconfidence modello', overconfidenceRisk, 0.12, 'Controllo eccesso di fiducia del modello.', overEvidence),
        buildPillar('Data quality / copertura fonti', dataRisk, 0.08, 'Copertura quote, xG, MC e NLP.', dataEvidence)
    ];

    const score = round(weightedRisk(pillars), 1);
    const failCount = pillars.filter(p => p.status === 'FAIL').length;
    const highWarnCount = pillars.filter(p => p.status === 'WARN_HIGH').length;
    const warnCount = pillars.filter(p => p.status === 'WARN' || p.status === 'WARN_HIGH').length;

    return { pillars, score, failCount, highWarnCount, warnCount };
}

function classifyFootballDeepScan({ sixPillar, realEdge, modelConviction, selectedIssues, market, rating }) {
    const marketPillar = sixPillar.pillars.find(p => p.name.startsWith('Market'));
    const teamPillar = sixPillar.pillars.find(p => p.name.startsWith('Team'));
    const overPillar = sixPillar.pillars.find(p => p.name.startsWith('Overconfidence'));

    if (
        selectedIssues ||
        teamPillar?.risk >= 88 ||
        sixPillar.score >= 76 ||
        (marketPillar?.risk >= 88 && overPillar?.risk >= 65) ||
        realEdge <= -2.5
    ) {
        return {
            level: 'ALTO_RISCHIO',
            action: '🔴 ALTO RISCHIO',
            isHighRisk: true,
            summary: realEdge <= -2.5
                ? 'Edge negativo: quota non giocabile.'
                : 'Uno o più pilastri critici rendono il pronostico non operativo.'
        };
    }

    if (
        sixPillar.score >= 54 ||
        sixPillar.highWarnCount >= 2 ||
        marketPillar?.risk >= 70 ||
        overPillar?.risk >= 72 ||
        modelConviction < 38
    ) {
        return {
            level: 'RISCHIO_MODELLO',
            action: '🟠 RISCHIO MODELLO',
            isHighRisk: false,
            summary: 'Segnale matematico presente ma rischio qualitativo/modello elevato.'
        };
    }

    if (
        realEdge < 2.0 ||
        sixPillar.score >= 32 ||
        sixPillar.warnCount >= 1 ||
        rating === 'NO_BET'
    ) {
        return {
            level: 'WATCHLIST_LOW_EDGE',
            action: '🟡 WATCHLIST / LOW EDGE',
            isHighRisk: false,
            summary: 'Segnale osservabile ma edge o qualità non bastano per via libera piena.'
        };
    }

    if (realEdge >= 7.5 && modelConviction >= 68 && sixPillar.score < 30) {
        return {
            level: 'SUPER_VALUE',
            action: '🔥 SUPER VALUE',
            isHighRisk: false,
            summary: 'Edge forte con rischio qualitativo controllato.'
        };
    }

    return {
        level: 'VIA_LIBERA',
        action: '🟢 VIA LIBERA / VALUE',
        isHighRisk: false,
        summary: 'Edge positivo e pilastri qualitativi coerenti.'
    };
}

function buildFootballDeepScanOperationalGate(classification = {}, context = {}) {
    const level = String(classification.level || '').toUpperCase();
    let allowBet = true;
    let status = 'CALCIO_DEEPSCAN_APPROVED';
    let action = 'APPROVE';
    let multiplier = 1;

    if (level === 'ALTO_RISCHIO') {
        allowBet = false;
        status = 'CALCIO_DEEPSCAN_BLOCKED_HIGH_RISK';
        action = 'BLOCK';
        multiplier = 0;
    } else if (level === 'RISCHIO_MODELLO') {
        status = 'CALCIO_DEEPSCAN_WATCHLIST_MODEL_RISK';
        action = 'WATCHLIST_REDUCE';
        multiplier = 0.5;
    } else if (level === 'WATCHLIST_LOW_EDGE') {
        status = 'CALCIO_DEEPSCAN_WATCHLIST_LOW_EDGE';
        action = 'WATCHLIST_CAP';
        multiplier = 0.75;
    } else if (level === 'SUPER_VALUE') {
        status = 'CALCIO_DEEPSCAN_SUPER_VALUE';
        action = 'APPROVE';
        multiplier = 1;
    }

    return {
        mode: 'OPERATIONAL_GATE',
        allowBet,
        status,
        action,
        stakeMultiplier: multiplier,
        reason: classification.summary || 'DeepScan Calcio gate operativo applicato.',
        level: classification.level || 'UNKNOWN',
        riskScore: context.sixPillar?.score ?? 0,
        auditImpact: allowBet ? 'PORTFOLIO_ELIGIBLE_IF_STAKE_POSITIVE' : 'AUDIT_ONLY_BLOCKED_BY_DEEPSCAN',
        version: DEEP_SCAN_CALCIO_VERSION,
        market: context.market || null
    };
}

function validatePredictionRating(edge, confidence, marketRegime, odd) {
    let finalRating = 'NO_BET';
    let adjustedConfidence = confidence;

    if (marketRegime.includes('VOLATILE')) adjustedConfidence *= 0.92;
    if (marketRegime.includes('LOW_SCORING')) adjustedConfidence *= 1.04;
    if (odd >= 4.50) adjustedConfidence *= 0.88;

    if (edge >= 8 && adjustedConfidence >= 78) finalRating = '💎 ELITE';
    else if (edge >= 5 && adjustedConfidence >= 70) finalRating = '🚀 STRONG';
    else if (edge >= 2 && adjustedConfidence >= 48) finalRating = '✅ PLAYABLE';

    return { rating: finalRating, adjustedConfidence: clamp(adjustedConfidence, 0, 100) };
}

function buildFootballWaitInstruction(market, classification, marketRegime, p = {}) {
    const regime = String(marketRegime || '').toUpperCase();
    const level = String(classification?.level || '').toUpperCase();
    const originalSelection = market.raw || market.compact || 'pronostico originale';

    if (market.isOver) {
        if (regime.includes('VOLATILE')) {
            return 'Attendi i primi 20 minuti: conferma ritmo alto, tiri/xG live e linee difensive aperte prima di validare l’Over.';
        }
        return 'Attendi 15-20 minuti: valida volume offensivo, pressione territoriale e almeno una fase di transizione pulita prima dell’Over.';
    }

    if (market.isUnder) {
        if (regime.includes('LOW_SCORING')) {
            return 'Attendi 20 minuti o fine primo tempo: conferma blocchi bassi, ritmo lento e xG contenuto prima di confermare l’Under.';
        }
        return 'Attendi i primi 20 minuti: verifica ritmo, falli, pressing e occasioni concesse prima di confermare l’Under.';
    }

    if (market.family === 'RESULT') {
        if (level === 'WATCHLIST_LOW_EDGE') {
            return `Attendi i primi 20 minuti: entra su ${originalSelection} solo se pressione, campo e xG live confermano il lato scelto.`;
        }
        return `Attendi 15-20 minuti: conferma baricentro, dominio territoriale e pericolosità reale prima di confermare ${originalSelection}.`;
    }

    return 'Attendi In-Play: servono conferme live su ritmo, xG e assetto tattico prima di entrare.';
}

function buildFootballAlternative(home, away, market, realEdge, classification, hT, aT, p = {}) {
    const level = String(classification?.level || '').toUpperCase();
    const isRejected = ['ALTO_RISCHIO', 'RISCHIO_MODELLO'].includes(level);
    const homeEmergency = Boolean(hT.isEmergency || hT.keyPlayerOut || hT.defenseOut || hT.attackOut);
    const awayEmergency = Boolean(aT.isEmergency || aT.keyPlayerOut || aT.defenseOut || aT.attackOut);

    // Alternative cross-market solo quando la perizia smentisce davvero il pronostico
    // o quando i numeri indicano un mercato più coerente del pick iniziale.
    if (market.isOver) {
        if ((hT.attackOut || aT.attackOut) && p['U2.5'] >= 52) {
            return { market: 'Alternativa Totals', selection: 'UNDER 2.5', confidence: 'MEDIA', rationale: 'Il pronostico Over è indebolito da attacchi penalizzati: i numeri suggeriscono maggiore protezione sull’Under.' };
        }
        if (p['O2.5'] >= 60 && !homeEmergency && !awayEmergency && realEdge >= 4.5) {
            return null; // il mercato originale resta più coerente
        }
    }

    if (market.isUnder) {
        if ((hT.defenseOut || aT.defenseOut) && p['O2.5'] >= 52) {
            return { market: 'Alternativa Totals / Goal', selection: 'OVER 2.5 o GOAL', confidence: 'MEDIA', rationale: 'Il pronostico Under è indebolito da difese compromesse: il valore si sposta su goal o Over.' };
        }
        if (p['U2.5'] >= 58 && realEdge >= 4.5) return null;
    }

    if (market.family === 'RESULT') {
        if (market.selectedSide === 'HOME' && homeEmergency && !awayEmergency) {
            return { market: 'Alternativa Doppia Chance / ML', selection: `X2 o ${away} Vincente`, confidence: 'MEDIA', rationale: `${home} ha criticità contro la selezione iniziale: la lettura qualitativa sposta valore su ospiti/doppia chance.` };
        }
        if (market.selectedSide === 'AWAY' && awayEmergency && !homeEmergency) {
            return { market: 'Alternativa Doppia Chance / ML', selection: `1X o ${home} Vincente`, confidence: 'MEDIA', rationale: `${away} ha criticità contro la selezione iniziale: la lettura qualitativa sposta valore su casa/doppia chance.` };
        }
        if (p.X > 27 && p['U2.5'] > 55 && (isRejected || realEdge < 4.5)) {
            return { market: 'Alternativa Tattica', selection: 'UNDER 2.5 o X primo tempo', confidence: 'MEDIA', rationale: 'Probabilità di stallo e Under elevate: meglio proteggersi su ritmo basso o pareggio live rispetto al segno secco.' };
        }
        if (market.selectedSide === 'HOME' && awayEmergency && realEdge >= 3.5) {
            return { market: 'Alternativa Team Total', selection: `${home} OVER 1.5 Goal`, confidence: 'MEDIA', rationale: `La criticità avversaria supporta più i goal squadra di ${home} che il segno secco.` };
        }
        if (market.selectedSide === 'AWAY' && homeEmergency && realEdge >= 3.5) {
            return { market: 'Alternativa Team Total', selection: `${away} OVER 1.5 Goal`, confidence: 'MEDIA', rationale: `La criticità avversaria supporta più i goal squadra di ${away} che il segno secco.` };
        }
    }

    return null;
}

function generateBetSuggestion(home, away, market, realEdge, classification, hT, aT, p, marketRegime = '') {
    const level = String(classification?.level || '').toUpperCase();
    const originalSelection = market.raw || market.compact || 'Pronostico originale';
    const waitInstruction = buildFootballWaitInstruction(market, classification, marketRegime, p);
    const alternative = buildFootballAlternative(home, away, market, realEdge, classification, hT, aT, p);

    if (level === 'SUPER_VALUE' || level === 'VIA_LIBERA') {
        if (realEdge >= 4.5) {
            return {
                mode: 'CONFIRM_PRONOSTICO',
                market: 'Conferma pronostico',
                selection: originalSelection,
                timing: 'Pre-match ammesso, con controllo formazioni/live se disponibile',
                confidence: level === 'SUPER_VALUE' ? 'ALTA' : 'MEDIA',
                rationale: `Il DeepScan conferma il pronostico: edge ${round(realEdge, 1)}%, pilastri qualitativi coerenti e nessun pivot migliore rilevato.`,
                alternatives: []
            };
        }
    }

    if (alternative && ['ALTO_RISCHIO', 'RISCHIO_MODELLO'].includes(level)) {
        return {
            mode: 'ALTERNATIVE_PRONOSTICO',
            market: alternative.market,
            selection: alternative.selection,
            timing: 'Preferibile attendere conferma live prima dell’alternativa',
            confidence: alternative.confidence || 'MEDIA',
            rationale: `${alternative.rationale} Il pronostico originale viene smentito o degradato dalla perizia DeepScan.`,
            alternatives: [alternative]
        };
    }

    if (alternative && level === 'WATCHLIST_LOW_EDGE' && realEdge < 2.0) {
        return {
            mode: 'ALTERNATIVE_PRONOSTICO',
            market: alternative.market,
            selection: alternative.selection,
            timing: 'Solo dopo conferma live del pattern indicato',
            confidence: 'BASSA/MEDIA',
            rationale: `${alternative.rationale} L’edge del pronostico iniziale è basso, quindi l’alternativa è preferibile solo se confermata live.`,
            alternatives: [alternative]
        };
    }

    return {
        mode: 'WAIT_IN_PLAY',
        market: 'Attesa In-Play',
        selection: waitInstruction,
        timing: waitInstruction,
        confidence: level === 'ALTO_RISCHIO' ? 'BASSA' : 'MEDIA/BASSA',
        rationale: `Il DeepScan non conferma pienamente il pronostico ${originalSelection}: livello ${classification?.action || level}, edge ${round(realEdge, 1)}% e qualità da verificare live.`,
        alternatives: alternative ? [alternative] : []
    };
}

// RECOVERY_R8: never populate missing markets with invented 33.3/50 probabilities.
function buildMarketProbabilityMap(market, modelProb, supplied = {}) {
    const p = {};
    const keys = ['1','X','2','1X','X2','12','O2.5','U2.5','GG','NG'];
    for (const key of keys) {
        const v = strictProbabilityPct(supplied && supplied[key]);
        if (v !== null) p[key] = v;
    }
    const selected = market.isHome ? '1' : market.isDraw ? 'X' : market.isAway ? '2'
        : market.isHomeDc ? '1X' : market.isAwayDc ? 'X2' : market.isNoDraw ? '12'
        : market.isOver ? 'O2.5' : market.isUnder ? 'U2.5'
        : market.isBttsYes ? 'GG' : market.isBttsNo ? 'NG' : null;
    if (selected) p[selected] = modelProb;
    // Complement is a mathematical identity only in the same two-sided 2.5 goals market.
    if (selected === 'O2.5' && p['U2.5'] === undefined) p['U2.5'] = 100 - modelProb;
    if (selected === 'U2.5' && p['O2.5'] === undefined) p['O2.5'] = 100 - modelProb;
    return p;
}

function renderPillarsHtml(pillars) {
    const rows = pillars.map(pillar => {
        const color = pillar.status === 'FAIL' ? '#ef4444' : pillar.status === 'WARN_HIGH' ? '#f97316' : pillar.status === 'WARN' ? '#f59e0b' : '#10b981';
        const evidence = pillar.evidence.slice(0, 3).map(e => `<div style="color:#94a3b8; font-size:0.75rem;">• ${escapeHtml(e)}</div>`).join('');
        return `
            <tr>
                <td style="padding:8px; border-bottom:1px solid #334155; color:#f8fafc; font-weight:700;">${escapeHtml(pillar.name)}</td>
                <td style="padding:8px; border-bottom:1px solid #334155; color:${color}; font-weight:800;">${escapeHtml(pillar.status)}</td>
                <td style="padding:8px; border-bottom:1px solid #334155; color:#cbd5e1;">${escapeHtml(pillar.risk)}/100</td>
                <td style="padding:8px; border-bottom:1px solid #334155; color:#cbd5e1;">${escapeHtml(pillar.summary)}${evidence}</td>
            </tr>
        `;
    }).join('');

    return `
        <div style="margin:15px 20px; padding:12px; border-radius:8px; background:#07111f; border:1px solid #2563eb;">
            <div style="color:#60a5fa; font-weight:800; font-size:0.9rem; margin-bottom:8px; text-transform:uppercase;">⚽ DeepScan Calcio — 6 pilastri qualitativi</div>
            <div style="overflow-x:auto;">
                <table style="width:100%; border-collapse:collapse; min-width:760px; font-size:0.78rem;">
                    <thead>
                        <tr style="background:#0f172a; color:#10b981; text-transform:uppercase; letter-spacing:0.04em;">
                            <th style="padding:8px; text-align:left;">Pilastro</th>
                            <th style="padding:8px; text-align:left;">Status</th>
                            <th style="padding:8px; text-align:left;">Rischio</th>
                            <th style="padding:8px; text-align:left;">Evidenza</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
    `;
}


// Compatibilità Patch 6: Fonti, freschezza e provenienza
function renderSourceIntelligenceHtml(sourceAudit = {}) {
    if (!sourceAudit || !Array.isArray(sourceAudit.sources)) return '';
    const statusColor = status => status === 'AVAILABLE' || status === 'VERIFIED' ? '#10b981'
        : status === 'PARTIAL' || status === 'FALLBACK' ? '#f59e0b'
        : status === 'ERROR' ? '#ef4444' : '#94a3b8';
    const rows = sourceAudit.sources.map(source => `
        <tr>
            <td style="padding:7px;border-bottom:1px solid #334155;color:#f8fafc;font-weight:700;">${escapeHtml(source.label)}</td>
            <td style="padding:7px;border-bottom:1px solid #334155;color:${statusColor(source.status)};font-weight:800;">${escapeHtml(source.status)}</td>
            <td style="padding:7px;border-bottom:1px solid #334155;color:#cbd5e1;">${escapeHtml(source.authority || 'CONTEXT_ONLY')}</td>
            <td style="padding:7px;border-bottom:1px solid #334155;color:#94a3b8;">${escapeHtml(source.detail || '')}</td>
        </tr>`).join('');
    const warnings = (sourceAudit.warnings || []).map(w => `<div style="color:#fbbf24;font-size:.75rem;margin-top:4px;">• ${escapeHtml(w)}</div>`).join('');
    const contradictions = (sourceAudit.contradictions || []).map(w => `<div style="color:#fb7185;font-size:.75rem;margin-top:4px;">⚠ ${escapeHtml(w)}</div>`).join('');
    const newsDetails = sourceAudit.sources
        .filter(source => source.id === 'HOME_NEWS' || source.id === 'AWAY_NEWS')
        .map(source => {
            const diag = source.diagnostics || {};
            const providerRows = (diag.providers || []).map(provider => `
                <div style="padding:6px 8px;border-radius:7px;background:#0f172a;border:1px solid #334155;">
                    <strong style="color:#e2e8f0;">${escapeHtml(provider.id)}</strong>
                    <span style="color:${['OK','OK_WITH_RESULTS','EMPTY'].includes(provider.status) ? (provider.status === 'EMPTY' ? '#f59e0b' : '#10b981') : '#ef4444'};font-weight:800;"> · ${escapeHtml(provider.status)}</span><br>
                    <span style="color:#94a3b8;">ricevuti ${escapeHtml(provider.received ?? 0)} · rilevanti ${escapeHtml(provider.relevant ?? 0)} · freschi ${escapeHtml(provider.fresh ?? 0)} · utilizzabili ${escapeHtml(provider.usable ?? 0)} · ${escapeHtml(provider.durationMs ?? 'N/D')} ms</span>
                    ${provider.error ? `<br><span style="color:#fb7185;">${escapeHtml(provider.error)}</span>` : ''}
                </div>`).join('');
            const articleRows = (diag.articles || []).slice(0, 5).map(article => `
                <div style="padding:5px 0;border-bottom:1px dashed #334155;color:#cbd5e1;">
                    <strong>${escapeHtml(article.title || '')}</strong><br>
                    <span style="color:#94a3b8;">${escapeHtml(article.sourceName || article.trustTier || 'Fonte non dichiarata')} · ${escapeHtml(article.publishedAt || 'data N/D')} · ${escapeHtml(article.category || 'OTHER')} · ${escapeHtml(article.trustTier || '')} · ${escapeHtml(article.squadScope || 'MEN_FIRST_TEAM')} · ${escapeHtml(article.temporalPhase || 'N/D')}</span>
                </div>`).join('');
            return `<div style="margin-top:10px;padding:9px;border:1px solid #334155;border-radius:8px;">
                <div style="color:#c4b5fd;font-weight:800;">${escapeHtml(source.label)} · ${escapeHtml(diag.status || source.status)}</div>
                <div style="color:#94a3b8;font-size:.75rem;margin-top:3px;">Copertura fonti ${escapeHtml(diag.coverageConfidence ?? source.coverageConfidence ?? 0)}% · Impatto match ${escapeHtml(diag.matchImpactConfidence ?? diag.confidence ?? source.matchImpactConfidence ?? source.confidence ?? 0)}% · unici ${escapeHtml(diag.counts?.uniqueArticles ?? diag.counts?.usableArticles ?? 0)} · duplicati consolidati ${escapeHtml(diag.counts?.duplicateRetrievals ?? 0)} · editori indipendenti ${escapeHtml(diag.counts?.independentPublishers ?? diag.counts?.independentChannels ?? 0)}</div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:6px;margin-top:6px;">${providerRows || '<span style="color:#94a3b8;">Nessuna diagnostica provider.</span>'}</div>
                ${articleRows ? `<div style="margin-top:7px;">${articleRows}</div>` : '<div style="color:#94a3b8;margin-top:7px;">Nessun articolo fresco e rilevante utilizzabile.</div>'}
            </div>`;
        }).join('');
    return `
        <div style="margin:15px 20px;padding:12px;border-radius:8px;background:#07111f;border:1px solid #8b5cf6;">
            <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">
                <div style="color:#c4b5fd;font-weight:900;font-size:.9rem;text-transform:uppercase;">🔎 Fonti, entity resolution e provenienza — Patch 7</div>
                <div style="color:#e2e8f0;font-size:.75rem;">Copertura ${escapeHtml(sourceAudit.coveragePct)}% · ${escapeHtml(sourceAudit.status)}</div>
            </div>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;min-width:760px;font-size:.76rem;">
                    <thead><tr style="background:#0f172a;color:#c4b5fd;"><th style="padding:7px;text-align:left;">Fonte</th><th style="padding:7px;text-align:left;">Stato</th><th style="padding:7px;text-align:left;">Autorità</th><th style="padding:7px;text-align:left;">Dettaglio</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            ${newsDetails}
            ${warnings}${contradictions}
            <div style="margin-top:8px;color:#94a3b8;font-size:.72rem;">Le news sono qualitative. Solo quote, storico e xG/proxy dichiarati alimentano la probabilità production.</div>
        </div>`;
}

function renderDecisionHtml({ home, away, market, targetOdd, modelProb, bookieFairProb, margin, marketReferenceAvailable, rawEdge, realEdge, marketRegime, ratingObj, classification, modelConviction, nlpBoost, homeData, awayData, suggestion, sixPillar, edgeValidation, professionalAudit, sourceAudit }) {
    const color = classification.level === 'ALTO_RISCHIO' ? '#ef4444'
        : classification.level === 'RISCHIO_MODELLO' ? '#f97316'
        : classification.level === 'WATCHLIST_LOW_EDGE' ? '#f59e0b'
        : '#10b981';

    const mcLabel = edgeValidation?.status || edgeValidation?.label || 'UNKNOWN';

    return `
        <div style="margin-top:15px; font-family:'Segoe UI',Roboto,sans-serif; background:#111827; border-radius:12px; overflow:hidden; border:1px solid #374151; box-shadow:0 20px 25px -5px rgba(0,0,0,0.5);">
            <div style="background:#1f2937; padding:15px 20px; border-bottom:1px solid #374151;">
                <div style="color:#60a5fa; font-size:0.85rem; font-weight:800; text-transform:uppercase; margin-bottom:8px; display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
                    <span>⚽ DeepScan Calcio v${DEEP_SCAN_CALCIO_VERSION}</span>
                    <span style="background:rgba(56,189,248,0.1); color:#38bdf8; padding:3px 8px; border-radius:12px; border:1px solid #0284c7;">${escapeHtml(marketRegime)}</span>
                </div>
                <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:8px; color:#cbd5e1; font-size:0.84rem;">
                    <div><strong>Pronostico:</strong><br><span style="color:#f8fafc;">${escapeHtml(market.raw)}</span></div>
                    <div><strong>Quota:</strong><br><span style="color:#f8fafc;">${round(targetOdd, 2)}</span></div>
                    <div><strong>Prob. modello:</strong><br><span style="color:#f8fafc;">${round(modelProb, 1)}%</span></div>
                    <div><strong>${marketReferenceAvailable ? 'Fair bookmaker no-vig' : 'Proxy quota NON certificato'}:</strong><br><span style="color:#f8fafc;">${round(bookieFairProb, 1)}%</span></div>
                    <div><strong>${marketReferenceAvailable ? 'Margin/Vig' : 'Margine ipotizzato'}:</strong><br><span style="color:#f8fafc;">${margin > 0 ? round(margin, 2) + '%' : 'N/A'}</span></div>
                    <div><strong>Value check:</strong><br><span style="color:#f8fafc;">${escapeHtml(mcLabel)}</span></div>
                </div>
                <div style="margin-top:10px; background:${realEdge > 0 ? 'rgba(59,130,246,0.1)' : 'rgba(239,68,68,0.1)'}; border-left:3px solid ${realEdge > 0 ? '#3b82f6' : '#ef4444'}; padding:8px 12px; border-radius:0 4px 4px 0;">
                    <strong style="color:${realEdge > 0 ? '#10b981' : '#ef4444'};">Edge finale: ${realEdge > 0 ? '+' : ''}${round(realEdge, 2)}%</strong>
                    <span style="color:#94a3b8;"> · Raw EV ${round(rawEdge, 2)}% · Conviction ${round(modelConviction, 1)}/100 · NLP impact ${(Math.abs(1 - nlpBoost) * 100).toFixed(1)}%</span>
                </div>
            </div>

            <div style="padding:15px 20px; border-bottom:1px solid #374151;">
                <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                    <span style="background:${color}; color:white; padding:6px 10px; border-radius:8px; font-weight:800;">${escapeHtml(classification.action)}</span>
                    <span style="color:#cbd5e1; font-size:0.9rem;">${escapeHtml(classification.summary)}</span>
                    <span style="color:#94a3b8; font-size:0.8rem;">Risk score ${escapeHtml(sixPillar.score)}/100 · rating ${escapeHtml(ratingObj.rating)}</span>
                </div>
            </div>

            ${renderPillarsHtml(sixPillar.pillars)}

            ${renderSourceIntelligenceHtml(sourceAudit)}

            ${calcioProfessionalGuard.renderCalcioProfessionalAuditHtml(professionalAudit)}

            <div style="padding:15px 20px; border-top:1px solid #374151;">
                <div style="color:#06b6d4; font-size:0.85rem; font-weight:800; text-transform:uppercase; margin-bottom:10px;">📉 Medical & News Check</div>
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    <div style="background:rgba(17,24,39,0.5); padding:8px 12px; border-radius:6px; border-left:2px solid ${escapeHtml(homeData.color)}; flex:1;">
                        <div style="color:#9ca3af; font-size:0.7rem;">${escapeHtml(home)}</div>
                        <div style="color:#f8fafc; font-size:0.85rem; font-weight:bold;">${escapeHtml(homeData.report)}</div>
                        <div style="color:#6b7280; font-size:0.7rem; margin-top:4px;">NLP Score: ${round(homeData.score, 1)}/5 · Conf. ${round(homeData.confidence, 0)}%</div>
                    </div>
                    <div style="background:rgba(17,24,39,0.5); padding:8px 12px; border-radius:6px; border-left:2px solid ${escapeHtml(awayData.color)}; flex:1;">
                        <div style="color:#9ca3af; font-size:0.7rem;">${escapeHtml(away)}</div>
                        <div style="color:#f8fafc; font-size:0.85rem; font-weight:bold;">${escapeHtml(awayData.report)}</div>
                        <div style="color:#6b7280; font-size:0.7rem; margin-top:4px;">NLP Score: ${round(awayData.score, 1)}/5 · Conf. ${round(awayData.confidence, 0)}%</div>
                    </div>
                </div>
            </div>

            <div style="margin:0 20px 15px 20px; padding:12px; border-radius:8px; background:rgba(234,179,8,0.1); border:1px solid rgba(234,179,8,0.4);">
                <div style="color:#eab308; font-weight:800; font-size:0.9rem; margin-bottom:8px;">💡 Suggerimento euristico DeepScan (NON perizia IA indipendente)</div>
                <div style="color:#cbd5e1; font-size:0.85rem; line-height:1.6;">
                    <strong>Modalità DeepScan:</strong> <span style="color:#fbbf24; font-weight:800;">${escapeHtml(suggestion.mode || 'WAIT_IN_PLAY')}</span><br>
                    <strong>Mercato Target:</strong> <span style="color:#f8fafc;">${escapeHtml(suggestion.market)}</span><br>
                    <strong>Esito:</strong> <strong style="color:#10b981; font-size:1rem;">${escapeHtml(suggestion.selection)}</strong><br>
                    <strong>Timing:</strong> <span style="color:#cbd5e1;">${escapeHtml(suggestion.timing || '-')}</span><br>
                    <span style="color:#9ca3af; font-style:italic;">"${escapeHtml(suggestion.rationale)}"</span>
                </div>
            </div>
        </div>
    `;
}

// ============================================================================
// MOTORE DI ANALISI QUANTITATIVA TATTICA
// ============================================================================
async function scanMatchup(home, away, prediction, odd, prob, edge, odd1, oddX, odd2, extData = {}) {
    try {
        const validatedModelProbability = strictProbabilityPct(prob);
        if (validatedModelProbability === null) {
            // R10: anche una probabilita assente produce un report parziale e
            // una richiesta IA mirata, MA non un EV o stake fittizio.
            const partial = buildMissingModelProbabilityResult(prediction, odd);
            const adaptiveAssessment = adaptiveR10.assess({home, away, league:extData.league||'',prediction,odd,probability:null,sourceAudit:{sources:[]},pillars:[]});
            const evidenceR11 = independentR11.evidencePacket({home,away,league:extData.league||extData.competition||'',kickoff:extData.kickoff||extData.matchDate,prediction,odd,odd1,oddX,odd2,extData,sourceAudit:{sources:[]},missingData:adaptiveAssessment.missingData});
            return {...partial,adaptiveAssessment,missingDataPrompt:adaptiveAssessment.prompt,
                independentAiEvidence:evidenceR11,independentAiPrompt:independentR11.buildIndependentPrompt(evidenceR11),independentAiStatus:'PROMPT_READY_NOT_EXECUTED',
                reason:adaptiveR10.renderHtml(adaptiveAssessment)+partial.reason};
        }
        const temporalAnalysis = calcioTemporalAnalysisPolicyAudit16dR2.evaluate(extData);
        const requestedProviderTimeout = Number(extData.providerTimeoutMs || 5000);
        const providerTimeoutMs = temporalAnalysis.liveNewsMode === 'BOUNDED'
            ? Math.min(Number.isFinite(requestedProviderTimeout) ? requestedProviderTimeout : 5000, temporalAnalysis.providerTimeoutMs)
            : (temporalAnalysis.liveNewsMode === 'FULL' ? (Number.isFinite(requestedProviderTimeout) ? requestedProviderTimeout : 5000) : 0);
        const providerOptions = {
            kickoff: extData.kickoff || extData.commenceTime || extData.matchDate || null,
            matchDate: extData.matchDate || extData.kickoff || extData.commenceTime || null,
            providerTimeoutMs,
            failureThreshold: extData.providerFailureThreshold || 3,
            cooldownMs: extData.providerCooldownMs || (5 * 60 * 1000)
        };
        const [homeData, awayData] = temporalAnalysis.shouldDeferNews
            ? [
                calcioTemporalAnalysisPolicyAudit16dR2.deferredTeamProfile(home),
                calcioTemporalAnalysisPolicyAudit16dR2.deferredTeamProfile(away)
              ]
            : await Promise.all([
                getSafeTeamProfile(home, providerOptions),
                getSafeTeamProfile(away, providerOptions)
              ]);

        const market = normalizePredictionMarket(prediction);
        const targetOdd = normalizeOdd(odd) || 0;
        const modelProb = validatedModelProbability;
        const reference = calculateBookmakerReference(market, targetOdd, odd1, oddX, odd2, extData);

        const bookieFairProb = reference.fairProb;
        const disagreement = bookieFairProb > 0 ? Math.abs(modelProb - bookieFairProb) : 0;
        let uncertainty = 0.10 + (disagreement / 100);
        if (!reference.marketReferenceAvailable) uncertainty += 0.06;
        uncertainty = clamp(uncertainty, 0.10, 0.46);

        const rawEdge = targetOdd > 1 ? (((modelProb / 100) * targetOdd - 1) * 100) : 0;
        const nlpBoost = computeNlpBoost(market, homeData, awayData);
        const inputEdge = Number(edge);
        const realEdge = Number.isFinite(inputEdge) ? inputEdge : (rawEdge * (1 - uncertainty) * nlpBoost);

        const marketRegime = detectMarketRegime({
            homeOdd: reference.odds.o1,
            awayOdd: reference.odds.o2,
            avgGoals: extData.avgGoals ?? extData.expectedGoals ?? extData.xgTotal,
            marketVolatility: extData.marketVolatility ?? extData.volatility
        });

        const edgeValidation = safeValidateMarketEdge(modelProb, bookieFairProb);

        const avgConfidence = (homeData.confidence + awayData.confidence) / 2;
        const mcGlobalScore = Number.isFinite(Number(extData.mcGlobal)) ? Number(extData.mcGlobal) : null;
        let modelConviction = mcGlobalScore !== null ? mcGlobalScore : avgConfidence;
        modelConviction -= disagreement * (reference.marketReferenceAvailable ? 0.65 : 0.35);
        if (homeData.sourceError || awayData.sourceError) modelConviction -= 8;
        modelConviction = clamp(modelConviction, 0, 100);

        const ratingObj = validatePredictionRating(realEdge, modelConviction, marketRegime, targetOdd);
        modelConviction = ratingObj.adjustedConfidence;

        const p = buildMarketProbabilityMap(market, modelProb, extData.marketProbabilities);

        const sourceContext = {
            ...extData,
            odd1,
            oddX,
            odd2,
            marketReferenceAvailable: reference.marketReferenceAvailable,
            marketReferenceType: reference.referenceType,
            temporalAnalysis
        };
        const sourceAudit = calcioSourceIntelligence.buildMatchSourceAudit({
            homeProfile: homeData,
            awayProfile: awayData,
            extData: sourceContext,
            now: new Date()
        });

        const selectedIssues = selectedSideHasIssues(market, homeData, awayData);

        const sixPillar = buildFootballSixPillarAssessment({
            market,
            realEdge,
            rawEdge,
            modelProb,
            bookieFairProb,
            disagreement,
            marketReferenceAvailable: reference.marketReferenceAvailable,
            referenceType: reference.referenceType,
            targetOdd,
            marketRegime,
            homeData,
            awayData,
            extData: sourceContext,
            modelConviction
        });

        const baseClassification = classifyFootballDeepScan({
            sixPillar,
            realEdge,
            modelConviction,
            selectedIssues,
            market,
            rating: ratingObj.rating
        });

        // STEP60_CALCIO_PROFESSIONAL_GUARDRAILS
        // DeepScan Calcio aggiunge controlli professionali operational-gate: lineup/news, dati xG, team matching, timing e correlazioni.
        const newsConfidenceValues = [
            homeData.sourceIntelligence?.matchImpactConfidence ?? homeData.confidence,
            awayData.sourceIntelligence?.matchImpactConfidence ?? awayData.confidence
        ].filter(value => Number.isFinite(Number(value)));
        const sourceAwareExtData = {
            ...sourceContext,
            sourceAudit,
            newsConfidence: newsConfidenceValues.length ? Math.min(...newsConfidenceValues) : 0,
            homeKeyAbsences: homeData.tactics?.keyPlayerOut ? 1 : 0,
            awayKeyAbsences: awayData.tactics?.keyPlayerOut ? 1 : 0,
            newsOfficiallyConfirmed: [homeData, awayData].every(team =>
                team.sourceIntelligence?.status === 'VERIFIED_MULTI_SOURCE' &&
                Number(team.sourceIntelligence?.counts?.officialArticles || 0) > 0)
        };
        const professionalAudit = calcioProfessionalGuard.buildCalcioProfessionalAudit({
            home,
            away,
            prediction,
            probabilities: p,
            odds: { odd1, oddX, odd2, targetOdd },
            extData: sourceAwareExtData
        });
        const classification = calcioProfessionalGuard.applyProfessionalRiskToClassification(baseClassification, professionalAudit);

        const suggestion = generateBetSuggestion(
            home,
            away,
            market,
            realEdge,
            classification,
            homeData.tactics,
            awayData.tactics,
            p,
            marketRegime
        );

        const adaptiveAssessment = adaptiveR10.assess({
            home, away, league: extData.league || extData.competition || '',
            prediction, odd: targetOdd, probability: modelProb,
            edgePp: realEdge, sourceAudit, pillars: sixPillar.pillars,
            professionalAudit, marketReferenceCertified: reference.marketReferenceAvailable,
            temporalAnalysis, historicalCombinationEvidence: extData.historicalCombinationEvidence || {}
        });
        // R11: generare la perizia indipendente PRIMA di usare qualunque
        // classificazione finale, stake, rating, score o probabilita model.
        const evidenceR11 = independentR11.evidencePacket({
            home,away,league:extData.league||extData.competition||'',kickoff:extData.kickoff||extData.commenceTime||extData.matchDate,
            prediction,odd:targetOdd,odd1,oddX,odd2,extData,sourceAudit,missingData:adaptiveAssessment.missingData
        });
        const independentAiPromptR11 = independentR11.buildIndependentPrompt(evidenceR11);
        const finalHtml = adaptiveR10.renderHtml(adaptiveAssessment) + renderDecisionHtml({
            home,
            away,
            market,
            targetOdd,
            modelProb,
            bookieFairProb,
            margin: reference.margin,
            marketReferenceAvailable: reference.marketReferenceAvailable,
            rawEdge,
            realEdge,
            marketRegime,
            ratingObj,
            classification,
            modelConviction,
            nlpBoost,
            homeData,
            awayData,
            suggestion,
            sixPillar,
            edgeValidation,
            professionalAudit,
            sourceAudit
        });

        return {
            success: true,
            action: classification.action,
            signalAction: classification.action,
            operationalAction: classification.action,
            temporalAnalysis,
            newsCollectionMode: temporalAnalysis.liveNewsMode,
            suggestionText: suggestion.selection,
            reason: finalHtml,
            isHighRisk: classification.isHighRisk,
            riskLevel: classification.level,
            riskScore: sixPillar.score,
            deepScanOperationalGate: buildFootballDeepScanOperationalGate(classification, { sixPillar, market }),
            deepScanGateMode: 'OPERATIONAL_GATE',
            pillars: sixPillar.pillars,
            deepScanAdvisory: suggestion,
            medicalNews: {
                home: { team: home, report: homeData.report, score: homeData.score, confidence: homeData.confidence, color: homeData.color },
                away: { team: away, report: awayData.report, score: awayData.score, confidence: awayData.confidence, color: awayData.color }
            },
            marketSummary: {
                prediction: market.raw,
                targetOdd,
                modelProbabilityPct: modelProb,
                bookmakerFairProbabilityPct: bookieFairProb,
                bookmakerReferenceCertified: reference.marketReferenceAvailable,
                referenceType: reference.referenceType,
                marginPct: reference.margin,
                rawEvPct: rawEdge,
                finalEdgePp: realEdge,
                convictionScore: modelConviction,
                marketRegime,
                rating: ratingObj.rating
            },
            professionalAudit,
            adaptiveAssessment,
            missingDataPrompt: adaptiveAssessment.prompt,
            independentAiEvidence: evidenceR11,
            independentAiPrompt: independentAiPromptR11,
            independentAiStatus: 'PROMPT_READY_NOT_EXECUTED',
            sourceIntelligence: sourceAudit,
            sourceIntelligenceVersion: calcioSourceIntelligence.CALCIO_SOURCE_INTELLIGENCE_VERSION,
            sourceCoverageStatus: sourceAudit.status,
            sourceCoveragePct: sourceAudit.coveragePct,
            sourceCoverageConfidence: sourceAudit.sourceCoverageConfidence,
            sourceMatchImpactConfidence: sourceAudit.matchImpactConfidence,
            professionalGuardVersion: calcioProfessionalGuard.STEP60_CALCIO_PROFESSIONAL_GUARD_VERSION,
            version: DEEP_SCAN_CALCIO_VERSION
        };

    } catch (e) {
        const errorHtml = `
            <div style="padding:15px; background:rgba(239,68,68,0.1); border-left:4px solid #ef4444; color:#f8fafc; font-family:'Segoe UI',sans-serif;">
                <h3 style="color:#ef4444; margin-top:0;">⚠️ Anomalia Deep Scan Calcio</h3>
                <p style="font-size:0.9rem;">Il motore NLP/xG ha riscontrato un errore non recuperabile. Edge base invariato; non usare il DeepScan come conferma qualitativa.</p>
                <code style="display:block; background:#111827; padding:10px; font-size:0.8rem; color:#f87171; border-radius:4px;">Error: ${escapeHtml(e.message)}</code>
            </div>
        `;
        return {
            success: true,
            action: '⚠️ ERRORE INTERNO',
            suggestionText: 'Mancanza Dati',
            reason: errorHtml,
            isHighRisk: true,
            riskLevel: 'ERROR',
            riskScore: 100,
            version: DEEP_SCAN_CALCIO_VERSION
        };
    }
}

module.exports = {
    scanMatchup,
    generateBetSuggestion,
    buildFootballWaitInstruction,
    buildFootballAlternative,
    DEEP_SCAN_CALCIO_VERSION,
    normalizePredictionMarket,
    buildFootballSixPillarAssessment,
    classifyFootballDeepScan,
    buildFootballDeepScanOperationalGate,
    calcioProfessionalGuard
};
