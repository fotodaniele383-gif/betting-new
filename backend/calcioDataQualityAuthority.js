'use strict';

const CALCIO_DATA_QUALITY_AUTHORITY_VERSION = 'BETTING_PATCH_26E_C_DATA_QUALITY_AUTHORITY_V1';

function n(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function nullable(value) {
    // R61: missing observations must remain missing; Number(null) === 0 is unsafe.
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function text(value) { return String(value ?? '').trim(); }
function upper(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); }
function clamp(value, min = 0, max = 100) { return Math.min(max, Math.max(min, n(value, min))); }
function round(value, decimals = 2) { const f = 10 ** decimals; return Math.round((n(value) + Number.EPSILON) * f) / f; }
function unique(values = []) { return [...new Set(values.filter(Boolean).map(text))]; }

function selectedSourceAgeMinutes(oddsCertification = {}, now = new Date()) {
    const raw = oddsCertification?.selectedSource?.lastUpdate
        || oddsCertification?.lastUpdate
        || oddsCertification?.selectedSourceTimestamp
        || null;
    if (!raw) return null;
    const timestamp = new Date(raw);
    const current = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(timestamp.getTime()) || Number.isNaN(current.getTime())) return null;
    // R19: a future timestamp is negative evidence age, never silently "0 min fresh".
    return (current.getTime() - timestamp.getTime()) / 60000;
}

function assessDataQuality(input = {}) {
    const odds = input.oddsCertification || {};
    const reliability = clamp(input.reliabilityScore, 0, 100);
    const dataClass = upper(input.dataClass);
    const coverage = upper(input.coverageMode || input.probabilityIntegrity?.coverageMode);
    const xgMode = upper(input.xgEvidenceMode);
    const lineup = upper(input.lineupStatus);
    // R3: an unconfirmed or probable lineup must never score as official.
    const lineupOfficial = new Set(['CONFIRMED','OFFICIAL_CONFIRMED','LINEUP_CONFIRMED','CONFIRMED_OFFICIAL']).has(lineup);
    const identityCertified = input.identityCertified !== false
        && input.decisionIdentity?.certified !== false
        && input.marketIdentityCertified !== false;
    const sourceConfidence = clamp(input.sourceConfidencePct ?? input.newsConfidencePct, 0, 100);
    const poissonUsable = input.reliabilityAssessment?.poissonStress?.available === true
        && upper(input.reliabilityAssessment?.poissonStress?.status).includes('USABLE');
    const robustProbability = nullable(input.reliabilityAssessment?.robustProbabilityPct);
    const quoteAgeMinutes = selectedSourceAgeMinutes(odds, input.now || new Date());
    const daysToKickoff = nullable(input.daysToKickoff ?? input.reliabilityAssessment?.daysToKickoff);

    const hardReasons = [];
    const cautionReasons = [];
    if (odds.certified !== true || odds.operationalEligible !== true || odds.realDirect !== true || odds?.selectedSource?.derived === true) {
        hardReasons.push('Quota non certificata come diretta, eseguibile e multi-fonte.');
    }
    if (!identityCertified) hardReasons.push('Identità evento/mercato non certificata.');
    if (dataClass.includes('INATTENDIBILE') || dataClass.includes('PRIOR')) hardReasons.push(`Classe dati ${dataClass || 'N/D'} senza autorità stake.`);
    if (reliability < 55) hardReasons.push(`Affidabilità ${round(reliability, 1)}/100 sotto 55.`);
    if (robustProbability === null) hardReasons.push('Probabilità robusta non disponibile.');
    if (quoteAgeMinutes !== null && quoteAgeMinutes < -0.001) hardReasons.push('Timestamp quota nel futuro: prova non valida.');
    if (quoteAgeMinutes !== null && quoteAgeMinutes > 30) hardReasons.push(`Quota non fresca: ${round(quoteAgeMinutes, 1)} minuti.`);

    if (!xgMode.includes('STRONG_REAL_XG')) cautionReasons.push(`xG ${xgMode || 'N/D'}: evidenza non reale completa.`);
    if (!lineupOfficial) cautionReasons.push('Formazioni non confermate.');
    if (sourceConfidence < 20) cautionReasons.push(`Impatto fonti/news basso (${round(sourceConfidence, 1)}%).`);
    if (!poissonUsable) cautionReasons.push('Stress 1X2/Poisson non pienamente utilizzabile.');
    if (daysToKickoff !== null && daysToKickoff > 7) cautionReasons.push(`Analisi anticipata di ${round(daysToKickoff, 1)} giorni.`);

    let oddsScore = 0;
    if (odds.certified === true && odds.operationalEligible === true && odds.realDirect === true) {
        oddsScore = Math.min(25, 17 + Math.min(8, n(odds.sourceCount, 0)));
    }
    const identityScore = identityCertified ? 15 : 0;
    const historyScore = coverage.includes('STRONG') ? 13 : coverage.includes('PROXY') ? 10 : coverage.includes('PRIOR') ? 3 : 7;
    const xgScore = xgMode.includes('STRONG_REAL_XG') ? 15 : xgMode.includes('PROXY') ? 8 : xgMode.includes('PRIOR') ? 2 : 5;
    const newsScore = lineupOfficial ? 10
        : sourceConfidence >= 40 ? 7 : sourceConfidence >= 20 ? 5 : 2;
    const reliabilityScore = clamp(reliability / 10, 0, 10);
    const crossMarketScore = poissonUsable && robustProbability !== null ? 10 : robustProbability !== null ? 5 : 0;
    const score = round(oddsScore + identityScore + historyScore + xgScore + newsScore + reliabilityScore + crossMarketScore, 1);

    const blocking = hardReasons.length > 0;
    const status = blocking
        ? 'DATA_QUALITY_BLOCKED'
        : score >= 82 && cautionReasons.length <= 1
            ? 'DATA_QUALITY_CERTIFIED'
            : score >= 65
                ? 'DATA_QUALITY_LIMITED'
                : 'DATA_QUALITY_WEAK';
    const label = status === 'DATA_QUALITY_CERTIFIED' ? 'ALTA'
        : status === 'DATA_QUALITY_LIMITED' ? 'ATTENDIBILE CON LIMITI'
            : status === 'DATA_QUALITY_WEAK' ? 'DEBOLE' : 'BLOCCANTE';

    return {
        version: CALCIO_DATA_QUALITY_AUTHORITY_VERSION,
        status,
        label,
        score,
        blocking,
        hardReasons: unique(hardReasons),
        cautionReasons: unique(cautionReasons),
        components: {
            odds: round(oddsScore, 1),
            identity: round(identityScore, 1),
            history: round(historyScore, 1),
            xg: round(xgScore, 1),
            newsLineup: round(newsScore, 1),
            reliability: round(reliabilityScore, 1),
            crossMarket: round(crossMarketScore, 1)
        },
        evidence: {
            oddsCertified: odds.certified === true,
            oddsOperationalEligible: odds.operationalEligible === true,
            oddsSourceCount: n(odds.sourceCount, 0),
            quoteAgeMinutes: quoteAgeMinutes === null ? null : round(quoteAgeMinutes, 2),
            identityCertified,
            reliabilityScore: round(reliability, 2),
            dataClass: dataClass || null,
            coverageMode: coverage || null,
            xgEvidenceMode: xgMode || null,
            lineupStatus: lineup || null,
            sourceConfidencePct: round(sourceConfidence, 2),
            poissonStressUsable: poissonUsable,
            robustProbabilityAvailable: robustProbability !== null,
            daysToKickoff
        },
        assessedAt: new Date().toISOString()
    };
}

function persistenceFields(assessment = {}) {
    return {
        calcio_data_quality_authority_version: CALCIO_DATA_QUALITY_AUTHORITY_VERSION,
        calcio_data_quality_score: assessment.score ?? null,
        calcio_data_quality_status: assessment.status || null,
        calcio_data_quality_label: assessment.label || null,
        calcio_data_quality_blocking: assessment.blocking ? 1 : 0,
        calcio_data_quality_reasons: [...(assessment.hardReasons || []), ...(assessment.cautionReasons || [])].join(' | '),
        calcio_data_quality_audit: JSON.stringify(assessment || {})
    };
}

module.exports = {
    CALCIO_DATA_QUALITY_AUTHORITY_VERSION,
    assessDataQuality,
    persistenceFields,
    selectedSourceAgeMinutes
};
