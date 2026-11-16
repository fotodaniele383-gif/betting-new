'use strict';

const CALCIO_STAKE_LIFECYCLE_VERSION = 'BETTING_PATCH_16_FORCED_STAKE_AUTHORITY_LIFECYCLE_V2';
const MIN_POSITIVE_STAKE = 2;
const EARLY_MICRO_CAP = 3;
const EARLY_MICRO_FRACTION = 0.25;

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
function round(value, decimals = 2) {
    const factor = 10 ** decimals;
    return Math.round((safeNumber(value, 0) + Number.EPSILON) * factor) / factor;
}
function normalizePositive(value, maximum = Infinity) {
    const amount = Math.max(0, safeNumber(value, 0));
    if (amount <= 0) return 0;
    return round(Math.min(Math.max(MIN_POSITIVE_STAKE, amount), maximum), 2);
}
function microStake(theoretical, { fraction = EARLY_MICRO_FRACTION, cap = EARLY_MICRO_CAP, gateMax = Infinity } = {}) {
    const maximum = Math.min(theoretical, cap, safeNumber(gateMax, Infinity));
    if (maximum < MIN_POSITIVE_STAKE) return 0;
    return normalizePositive(theoretical * fraction, maximum);
}

function buildStakeLifecycle({ theoreticalStake = 0, gate = {}, professionalAudit = {}, odd = 0, dataAuthority = null } = {}) {
    const theoretical = Math.max(0, safeNumber(theoreticalStake, 0));
    const timingStatus = String(professionalAudit?.timing?.status || '').toUpperCase();
    const lineupStatus = String(professionalAudit?.lineupNews?.status || '').toUpperCase();
    const professionalStatus = String(professionalAudit?.status || '').toUpperCase();
    const gateStatus = String(gate.status || '').toUpperCase();
    const gateHardBlocked = professionalStatus === 'PROFESSIONAL_BLOCK_HARD'
        || gateStatus.includes('BLOCKED_HARD') || gateStatus.includes('BLOCCATA_HARD') || gateStatus.includes('NO_BET_HARD');
    const gateBlocked = gate.allowBet === false || gateStatus.includes('BLOCKED') || gateStatus.includes('NO_BET');
    const dataClass = String(dataAuthority?.dataClass || professionalAudit?.dataReliability?.reliabilityClass || '').toUpperCase();
    const gateMax = safeNumber(gate.maxStake, theoretical);
    const deepScanClass = String(gate.deepScanClass || gate.dsClass || '').toUpperCase();
    const modelSoftVeto = ['MODEL_RISK', 'WAIT_IN_PLAY', 'HIGH_RISK'].includes(deepScanClass);

    let operational = theoretical;
    let status = theoretical > 0 ? 'READY_FOR_FINAL_GATE' : 'NO_THEORETICAL_STAKE';
    let action = theoretical > 0 ? 'AWAIT_FINAL_GATE' : 'ANALYSIS_ONLY';
    let reason = theoretical > 0
        ? 'Stake teorico calcolato; l’esecuzione dipende da DeepScan, timing e Gate finale.'
        : 'Soglie quantitative o policy Kelly non producono uno stake teorico positivo.';

    if (dataClass === 'INATTENDIBILE') {
        operational = 0;
        status = 'DATA_UNRELIABLE_NO_STAKE';
        action = 'NO_BET_DATA_UNRELIABLE';
        reason = 'Qualità dati sotto soglia: pronostico INATTENDIBILE, stake teorico utilizzabile €0 e stake operativo €0.';
    } else if (gateHardBlocked) {
        operational = 0;
        status = 'BLOCKED_HARD';
        action = 'NO_BET';
        reason = 'Blocco HARD professionale/DeepScan: nessuna esecuzione.';
    } else if (modelSoftVeto) {
        operational = 0;
        status = deepScanClass === 'HIGH_RISK' ? 'BLOCKED_HARD' : 'BLOCKED_SOFT_MODEL_REVIEW';
        action = deepScanClass === 'HIGH_RISK' ? 'NO_BET' : 'NO_BET_MODEL_REVIEW';
        reason = deepScanClass === 'HIGH_RISK'
            ? 'DeepScan ALTO RISCHIO: nessuna esecuzione.'
            : 'DeepScan segnala rischio modello/attesa live: nessuna forzatura della puntata.';
    } else if (professionalStatus === 'PROFESSIONAL_BLOCK_SOFT' && theoretical > 0) {
        operational = microStake(theoretical, { gateMax: gateMax > 0 ? gateMax : EARLY_MICRO_CAP });
        status = operational > 0 ? 'SOFT_MICRO_AUTHORIZED' : 'SOFT_MICRO_BELOW_MINIMUM';
        action = operational > 0 ? 'BET_ALLOWED_MICRO_SOFT' : 'NO_BET_OR_REVIEW';
        reason = operational > 0
            ? 'BLOCCATA SOFT applicata come cap prudenziale, non come veto: 25% Kelly, minimo €2, cap €3.'
            : 'Blocco SOFT: il cap prudenziale non raggiunge il minimo €2.';
    } else if (timingStatus === 'EARLY_WATCHLIST') {
        if (theoretical > 0 && (gate.allowBet === true || !gateHardBlocked)) {
            operational = microStake(theoretical, { gateMax: gateMax > 0 ? gateMax : EARLY_MICRO_CAP });
            if (operational > 0) {
                status = 'EARLY_MICRO_AUTHORIZED';
                action = 'BET_ALLOWED_MICRO_EARLY';
                reason = 'Kickoff oltre 24 ore: micro-stake reale autorizzato al 25% del Kelly, minimo €2 e cap €3; riesaminare entro 24 ore.';
            } else {
                status = 'EARLY_MICRO_BELOW_MINIMUM';
                action = 'RECHECK_WITHIN_24H';
                reason = 'Kickoff oltre 24 ore: il cap prudenziale non raggiunge il minimo operativo €2.';
            }
        } else {
            operational = 0;
            status = theoretical > 0 ? 'THEORETICAL_ONLY_EARLY_WATCHLIST' : 'NO_THEORETICAL_STAKE';
            action = theoretical > 0 ? 'RECHECK_WITHIN_24H' : 'ANALYSIS_ONLY';
            reason = theoretical > 0
                ? 'Kickoff oltre 24 ore: stake teorico conservato ma DeepScan/Gate non autorizza il micro-stake anticipato.'
                : reason;
        }
    } else if (timingStatus === 'PRE_MATCH_EARLY') {
        if (theoretical > 0 && (gate.allowBet === true || !gateHardBlocked)) {
            operational = microStake(theoretical, { gateMax: gateMax > 0 ? gateMax : EARLY_MICRO_CAP });
            status = operational > 0 ? 'MICRO_CAP_PRE_MATCH_EARLY' : 'PRE_MATCH_MICRO_BELOW_MINIMUM';
            action = operational > 0 ? 'BET_ALLOWED_MICRO' : 'RECHECK_WITHIN_2H';
            reason = operational > 0
                ? 'Kickoff tra 2 e 24 ore: micro-stake reale al 25% del Kelly, minimo €2 e cap €3.'
                : 'Kickoff tra 2 e 24 ore: importo prudenziale sotto il minimo €2.';
        } else {
            operational = 0;
            status = 'BLOCKED_BY_FINAL_GATE';
            action = 'NO_BET_OR_REVIEW';
            reason = (Array.isArray(gate.reasons) ? gate.reasons.join(' | ') : gate.reason) || 'Gate non autorizza il micro-stake pre-match.';
        }
    } else if (timingStatus === 'LINEUP_WINDOW' && theoretical > 0 && lineupStatus !== 'LINEUP_OK') {
        if (gate.allowBet === true) {
            operational = normalizePositive(Math.min(theoretical * 0.20, 2), Math.min(theoretical, 2));
            status = operational > 0 ? 'MICRO_PENDING_LINEUP' : 'LINEUP_MICRO_BELOW_MINIMUM';
            action = operational > 0 ? 'MICRO_OR_WAIT' : 'WAIT_LINEUP';
            reason = operational > 0
                ? 'Finestra lineup: formazioni non confermate, micro-stake €2 massimo.'
                : 'Finestra lineup: nessun importo supera il minimo operativo.';
        } else {
            operational = 0;
            status = 'BLOCKED_BY_FINAL_GATE';
            action = 'NO_BET';
            reason = (Array.isArray(gate.reasons) ? gate.reasons.join(' | ') : '') || 'Gate finale non autorizzato.';
        }
    } else if (timingStatus === 'FINAL_GATE' && theoretical > 0 && ['LINEUP_RISK_HIGH'].includes(lineupStatus)) {
        operational = 0;
        status = 'FINAL_LINEUP_BLOCK';
        action = 'NO_BET';
        reason = 'Ultima ora con rischio lineup elevato: stake operativo bloccato.';
    } else if (gateBlocked) {
        operational = 0;
        status = 'BLOCKED_BY_FINAL_GATE';
        action = 'NO_BET';
        reason = (Array.isArray(gate.reasons) ? gate.reasons.join(' | ') : '') || 'Gate finale non autorizzato.';
    } else if (theoretical > 0) {
        const maximum = gateMax > 0 ? Math.min(theoretical, gateMax) : theoretical;
        operational = normalizePositive(maximum, theoretical);
        status = operational > 0 ? 'OPERATIONAL_AUTHORIZED' : 'OPERATIONAL_BELOW_MINIMUM';
        action = operational > 0 ? 'BET_ALLOWED' : 'ANALYSIS_ONLY';
        reason = operational > 0
            ? 'Timing e Gate consentono lo stake operativo entro il cap.'
            : 'Importo finale inferiore al minimo operativo €2.';
    }

    operational = round(Math.max(0, operational), 2);
    return {
        version: CALCIO_STAKE_LIFECYCLE_VERSION,
        theoreticalStake: round(theoretical, 2),
        operationalStake: operational,
        estimatedOperationalProfit: round(operational * Math.max(0, safeNumber(odd, 0) - 1), 2),
        status,
        action,
        reason,
        timingStatus: timingStatus || 'TIMING_UNKNOWN',
        lineupStatus: lineupStatus || 'LINEUP_UNKNOWN',
        professionalStatus: professionalStatus || 'PROFESSIONAL_UNKNOWN',
        dataClass: dataClass || 'UNKNOWN',
        minimumPositiveStake: MIN_POSITIVE_STAKE,
        earlyMicroCap: EARLY_MICRO_CAP,
        earlyMicroFraction: EARLY_MICRO_FRACTION,
        automaticExecution: operational > 0,
        qualityOrigin: gateHardBlocked ? 'HARD_VETO' : dataClass === 'INATTENDIBILE' ? 'DATA_UNRELIABLE' : operational > 0 && ['EARLY_WATCHLIST','PRE_MATCH_EARLY','LINEUP_WINDOW'].includes(timingStatus) ? 'TIMING_MICRO_CAP' : operational > 0 ? 'KELLY_AUTHORIZED' : theoretical <= 0 ? 'QUANT_THRESHOLD' : 'SOFT_REVIEW'
    };
}

module.exports = {
    CALCIO_STAKE_LIFECYCLE_VERSION,
    buildStakeLifecycle,
    MIN_POSITIVE_STAKE,
    EARLY_MICRO_CAP,
    EARLY_MICRO_FRACTION
};
