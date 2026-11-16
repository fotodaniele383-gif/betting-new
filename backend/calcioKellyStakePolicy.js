'use strict';

const CALCIO_KELLY_STAKE_POLICY_VERSION = 'BETTING_PATCH_14_DATA_AUTHORITY_KELLY_GATE_V1_AUDIT01';
const MINIMUM_POSITIVE_STAKE_EUR = 2;
const UNRELIABLE_THRESHOLD = 55;

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, finite(value, min))); }
function round(value, decimals = 2) {
    const factor = 10 ** decimals;
    return Math.round((finite(value, 0) + Number.EPSILON) * factor) / factor;
}

function classifyDataAuthority({ predictionReliability = {}, professionalAudit = {}, multiProviderEvidence = {}, probabilityIntegrity = {}, market = '' } = {}) {
    const score = finite(predictionReliability.score, 0);
    const dataScore = finite(professionalAudit?.dataReliability?.score, score);
    const teamConfidence = finite(professionalAudit?.teamMatching?.confidence, 0);
    const professionalStatus = String(professionalAudit?.status || '').toUpperCase();
    const dataStatus = String(professionalAudit?.dataReliability?.status || '').toUpperCase();
    const providerStatus = String(multiProviderEvidence?.status || '').toUpperCase();
    const evidenceAuthority = String(predictionReliability?.evidenceAuthority || '').toUpperCase();
    const detail = probabilityIntegrity?.diagnostics?.[market] || {};
    const disagreement = finite(detail.disagreementPp, probabilityIntegrity?.maxDisagreementPp || 99);
    const mcError = finite(detail.monteCarloStdErrorPp, probabilityIntegrity?.maxMonteCarloStdErrorPp || 9);
    const reasons = [];

    if (score < UNRELIABLE_THRESHOLD) reasons.push(`affidabilità totale ${round(score, 1)}/100 sotto ${UNRELIABLE_THRESHOLD}`);
    if (dataScore < UNRELIABLE_THRESHOLD) reasons.push(`qualità dati ${round(dataScore, 1)}/100 sotto ${UNRELIABLE_THRESHOLD}`);
    if (teamConfidence > 0 && teamConfidence < 65) reasons.push(`team matching ${round(teamConfidence, 1)}% insufficiente`);
    if (dataStatus === 'DATA_FRAGILE') reasons.push('dati classificati DATA_FRAGILE');
    if (providerStatus === 'MULTI_PROVIDER_FRAGILE') reasons.push('copertura quantitativa multi-provider fragile');
    if (professionalStatus === 'PROFESSIONAL_BLOCK_HARD') reasons.push('blocco professionale hard');
    if (disagreement > 15) reasons.push(`disaccordo modello/mercato ${round(disagreement, 1)} pp oltre guardrail`);
    if (mcError > 1.5) reasons.push(`errore Monte Carlo ${round(mcError, 2)} pp troppo elevato`);

    let dataClass = 'INATTENDIBILE';
    let multiplier = 0;
    let maxBankrollPct = 0;
    if (!reasons.length) {
        if (score >= 85 && evidenceAuthority === 'HIGH_AUTHORITY') {
            dataClass = 'ALTA'; multiplier = 1; maxBankrollPct = 2;
        } else if (score >= 70) {
            dataClass = 'BUONA'; multiplier = 0.80; maxBankrollPct = 1.25;
        } else {
            dataClass = 'ATTENDIBILE'; multiplier = 0.55; maxBankrollPct = 0.75;
        }
    }
    return {
        version: CALCIO_KELLY_STAKE_POLICY_VERSION,
        dataClass,
        reliable: dataClass !== 'INATTENDIBILE',
        score: round(score, 1),
        dataScore: round(dataScore, 1),
        teamConfidence: round(teamConfidence, 1),
        evidenceAuthority: evidenceAuthority || 'UNKNOWN',
        providerStatus: providerStatus || 'UNKNOWN',
        disagreementPp: round(disagreement, 2),
        monteCarloStdErrorPp: round(mcError, 2),
        multiplier,
        maxBankrollPct,
        reasons: reasons.length ? reasons : [`dati ${dataClass.toLowerCase()}: Kelly consentito entro cap prudenziale`]
    };
}

function calculateTheoreticalStake({ bankroll = 0, kellyPct = 0, professionalMultiplier = 1, predictionReliability = {}, professionalAudit = {}, multiProviderEvidence = {}, probabilityIntegrity = {}, market = '' } = {}) {
    const authority = classifyDataAuthority({ predictionReliability, professionalAudit, multiProviderEvidence, probabilityIntegrity, market });
    const bankrollEur = Math.max(0, finite(bankroll, 0));
    const rawKellyPct = Math.max(0, finite(kellyPct, 0));
    const rawKellyStake = bankrollEur * rawKellyPct / 100;
    const legacyMultiplier = clamp(professionalMultiplier, 0, 1);

    if (!authority.reliable || rawKellyPct <= 0 || bankrollEur <= 0 || legacyMultiplier <= 0) {
        const reason = !authority.reliable
            ? `Stake €0: dati INATTENDIBILI (${authority.reasons.join(' · ')}).`
            : rawKellyPct <= 0
                ? 'Stake €0: Kelly non rileva vantaggio matematico positivo.'
                : legacyMultiplier <= 0
                    ? 'Stake €0: guardrail professionale di affidabilità azzera l’esposizione.'
                    : 'Stake €0: bankroll non valido.';
        return {
            version: CALCIO_KELLY_STAKE_POLICY_VERSION,
            theoreticalStake: 0,
            rawKellyPct: round(rawKellyPct, 4),
            rawKellyStake: round(rawKellyStake, 2),
            adjustedKellyStake: 0,
            minimumStakeApplied: false,
            dataAuthority: authority,
            reason
        };
    }

    const maxStake = bankrollEur * authority.maxBankrollPct / 100;
    const adjusted = rawKellyStake * authority.multiplier * legacyMultiplier;
    // AUDIT01 F05: the operational minimum never overrides a monetary cap.
    // Floor the upper bound to cents, so rounding cannot increase exposure.
    const capCents = Math.floor(Math.min(maxStake, bankrollEur) * 100);
    let stakeCents = Math.min(Math.round(Math.min(adjusted, maxStake) * 100), capCents);
    let minimumStakeApplied = false;
    if (adjusted > 0 && stakeCents < MINIMUM_POSITIVE_STAKE_EUR * 100) {
        if (capCents >= MINIMUM_POSITIVE_STAKE_EUR * 100) {
            stakeCents = MINIMUM_POSITIVE_STAKE_EUR * 100;
            minimumStakeApplied = true;
        } else {
            stakeCents = 0;
        }
    }
    const stake = stakeCents / 100;

    return {
        version: CALCIO_KELLY_STAKE_POLICY_VERSION,
        theoreticalStake: round(stake, 2),
        rawKellyPct: round(rawKellyPct, 4),
        rawKellyStake: round(rawKellyStake, 2),
        adjustedKellyStake: round(adjusted, 2),
        capStake: round(maxStake, 2),
        minimumStakeApplied,
        dataAuthority: authority,
        reason: stake > 0
            ? `Stake teorico Kelly ${authority.dataClass}: €${round(stake, 2).toFixed(2)}${minimumStakeApplied ? ' (minimo operativo €2 applicato)' : ''}.`
            : 'Stake €0: importo finale inferiore al minimo operativo €2.'
    };
}

function normalizePositiveOperationalStake(value, { minimum = MINIMUM_POSITIVE_STAKE_EUR, maximum = Infinity } = {}) {
    const amount = Math.max(0, finite(value, 0));
    const min = finite(minimum, NaN);
    const max = maximum === Infinity ? Infinity : finite(maximum, NaN);
    if (amount <= 0 || !Number.isFinite(min) || min < 0 || Number.isNaN(max) || max < min) return 0;
    const minCents = Math.ceil(min * 100);
    const capCents = max === Infinity ? Infinity : Math.floor(max * 100);
    if (capCents < minCents) return 0;
    return Math.min(Math.max(minCents, Math.round(amount * 100)), capCents) / 100;
}

module.exports = {
    CALCIO_KELLY_STAKE_POLICY_VERSION,
    MINIMUM_POSITIVE_STAKE_EUR,
    UNRELIABLE_THRESHOLD,
    classifyDataAuthority,
    calculateTheoreticalStake,
    normalizePositiveOperationalStake
};
