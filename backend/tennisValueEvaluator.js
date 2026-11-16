const { classifyTennisGateStep42, applyTennisGatePolicyStep42, STEP42_VERSION } = require('./tennisGateStep42');
const reliability10 = require('./reliability10/tennisDecisionAudit');
// ============================================================================
// TENNIS MARKET VALIDATION ENGINE
// AI BETTING QUANT PRO - Sharp Market Comparison & Active Calibration Layer
// Versione: 4.6
// ============================================================================
//
// CHANGELOG 4.1
// - FIX CRITICO: expected value calcolato sulla probabilità calibrata.
// - FIX CRITICO: output standardizzato con edge_pp ed ev_pct.
// - Compatibilità legacy mantenuta: edge, expectedValue, rawEdge, adjustedEdge.
// - Migliorata robustezza contro input sporchi/null/non numerici.
// - Aggiunta distinzione chiara tra:
//   - model_probability_pct
//   - calibrated_probability_pct
//   - market_implied_probability_pct
//   - edge_pp
//   - ev_pct
// - Aggiunta valutazione decisionale basata sia su edge in punti percentuali
//   sia su expected value percentuale.
// - Fallback sicuri se ValueEvaluator non espone metodi di calibrazione.
//
// CHANGELOG 4.2
// - Validazione input più severa: probabilità modello non numerica non viene più
//   trasformata implicitamente in 1%.
// - EV/edge restituiscono 0 solo per input non validi espliciti, non per
//   silenziosa normalizzazione sporca.
// - Audit arricchito con inputValidity, pass/fail soglie, appliedProbabilitySource
//   e formulaVersion.
// - Output aggiuntivo: thresholds_passed, data_quality, model_version,
//   metric_version, evaluator_version.
// - Compatibilità legacy invariata: edge, expectedValue, rawEdge, adjustedEdge.
//
// CHANGELOG 4.3
// - Aggiunto decision layer professionale per calibrazione predittiva Tennis.
// - Valuta sample size, Brier, calibration gap e Closing Line Value senza toccare Calcio.
//
// CHANGELOG 4.4
// - Aggiunto Tennis Professional Bet Gate finale.
//
// CHANGELOG 4.5
// - Aggiunto buildTennisOperationalReport(): report operativo finale per pronostico.
// - Output chiaro: APPROVED / WATCHLIST / BLOCKED, motivi, checklist e stake operativo.
// - Funzione Tennis-only: nessun import o modifica alla logica Calcio.
// - CHANGELOG 4.6
// - Stake policy più dinamica: calibrazione UNKNOWN non può più generare cap pieno.
// - Cap stake ridotto per disaccordo modello/mercato elevato, value score basso o reference debole.
// ============================================================================

const ValueEvaluator = require('./value_evaluator');
const { assertPreMatchOnlyContext } = require('./preMatchLeakageGuard');
const { canonicalizeGateStatus } = require('./gateStatusCanonicalizer');

const TENNIS_VALUE_EVALUATOR_VERSION = '4.7';
const TENNIS_METRIC_VERSION = 'TENNIS_EDGE_EV_V2';

// --------------------------------------------------------------------------
// ⚙️ CONFIGURAZIONE PESI DI MERCATO SHARP BOOKS
// --------------------------------------------------------------------------
const MARKET_VALIDATION_CONFIG = {
    SHARP_BOOKS: [
        'pinnacle',
        'betfair',
        'matchbook',
        'sbo',
        'smarkets'
    ],

    // Soglie legacy. Le nuove soglie operative sono gestite sotto
    // in DEFAULT_TENNIS_VALUE_CONFIG.
    MIN_EDGE: 1.5,
    MAX_MARKET_DISAGREEMENT: 12,

    SHARP_WEIGHT: {
        pinnacle: 0.42,
        betfair: 0.33,
        sbo: 0.15,
        smarkets: 0.10,
        matchbook: 0.10
    }
};

// --------------------------------------------------------------------------
// ⚙️ CONFIGURAZIONE OPERATIVA VALUE TENNIS
// --------------------------------------------------------------------------
const DEFAULT_TENNIS_VALUE_CONFIG = {
    minProbabilityPct: 52,

    // Edge in punti percentuali:
    // Esempio: prob modello calibrata 58%, implied 54% => edge_pp = +4.
    minEdgePp: 3,

    // EV percentuale:
    // Esempio: prob 58%, quota 1.90 => ev_pct = 10.20%.
    minEvPct: 2,

    maxOdd: 3.50,

    minReliableSample: 20,
    maxCalibrationAdjustmentPp: 10,

    // Soglie di rischio Tennis.
    suspendBrierAbove: 0.27,
    reduceBrierAbove: 0.245,

    suspendCalibrationErrorAbove: 10,
    reduceCalibrationErrorAbove: 7.5,

    highProbabilityCautionPct: 70,
    highProbabilityMinEdgePp: 4
};


const DEFAULT_TENNIS_CALIBRATION_PROFESSIONAL_LIMITS = {
    requiredSample: 150,
    minSegmentSample: 20,
    professionalBrierMax: 0.225,
    watchBrierMax: 0.245,
    professionalCalibrationErrorMax: 4.0,
    watchCalibrationErrorMax: 7.5,
    professionalClvBeatRateMin: 52,
    watchClvBeatRateMin: 48,
    professionalAvgClvPctMin: 0,
    watchAvgClvPctMin: -1
};


const DEFAULT_TENNIS_PROFESSIONAL_GATE_LIMITS = {
    minValueScore: 50,
    minDataSufficiencyMoneyline: 65,
    minDataSufficiencyTotals: 85,
    maxMarketDisagreementPp: 14,
    minPlayableStake: 2.00,
    maxStakePctStandard: 0.006,
    maxStakePctWatchlist: 0.003,
    maxStakePctProfessional: 0.01,
    requireMarkovForTotals: true,
    blockIfCalibrationUnknown: true,
    hardMinPlayerSampleMoneyline: 10,
    hardMinPlayerSampleTotals: 50
};


// Step49B - Consensus Gate:
// DeepScan può intervenire nel gate operativo solo per trasformare un blocco SOFT
// in WATCHLIST MICRO STAKE. Non può mai trasformare un NO_BET in stake standard
// o professionale, né può sbloccare hard veto come EV negativo, dati insufficienti,
// rischio alto o totals senza Markov.
const DEFAULT_TENNIS_CONSENSUS_GATE_LIMITS = {
    enabled: true,
    minEdgePp: 4.0,
    minEvPct: 5.0,
    minProbabilityAboveMarketPp: 4.0,
    maxSoftMarketDisagreementPp: 18.0,
    minDataSufficiencyMoneyline: 65,
    microStakePct: 0.002,
    maxMicroStakePct: 0.003,
    allowMarkets: ['moneyline']
};

// --------------------------------------------------------------------------
// 🛠️ HELPERS NUMERICI
// --------------------------------------------------------------------------
function toNumber(value, fallback = null) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function round(value, decimals = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Number(Math.round(n + 'e' + decimals) + 'e-' + decimals);
}

function clampNumber(value, min = 0, max = 100) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function isFiniteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n);
}

function parseProbabilityPct(value, fallback = null) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return n;
}

function normalizeTennisProbability(probabilityPct) {
    const n = Number(probabilityPct);
    if (!Number.isFinite(n)) return 50;
    return Math.max(1, Math.min(99, n));
}

function normalizeOdd(odd) {
    const n = Number(odd);
    if (!Number.isFinite(n) || n <= 1) return null;
    return n;
}

function hasFunction(obj, fnName) {
    return obj && typeof obj[fnName] === 'function';
}

// --------------------------------------------------------------------------
// 🧮 CALCOLI PROBABILITÀ, EDGE, EV
// --------------------------------------------------------------------------
function impliedProbability(odd) {
    const normalizedOdd = normalizeOdd(odd);
    if (!normalizedOdd) return 0;
    return 100 / normalizedOdd;
}

function calculateExpectedValuePct(probabilityPct, odd) {
    const pRaw = parseProbabilityPct(probabilityPct, null);
    const normalizedOdd = normalizeOdd(odd);

    if (pRaw === null || !normalizedOdd) return 0;

    const p = normalizeTennisProbability(pRaw) / 100;

    return ((p * normalizedOdd) - 1) * 100;
}

function calculateEdgePp(probabilityPct, marketImpliedProbabilityPct) {
    const pRaw = parseProbabilityPct(probabilityPct, null);
    const marketRaw = parseProbabilityPct(marketImpliedProbabilityPct, null);

    if (pRaw === null || marketRaw === null) return 0;

    const p = normalizeTennisProbability(pRaw);
    const market = clampNumber(marketRaw, 0, 100);

    return p - market;
}

function calculateFairOdd(probabilityPct) {
    const pRaw = parseProbabilityPct(probabilityPct, null);
    if (pRaw === null) return null;

    const p = normalizeTennisProbability(pRaw);

    if (p <= 0) return null;

    return 100 / p;
}

function calculateNoVigProbabilities(oddA, oddB) {
    const normalizedOddA = normalizeOdd(oddA);
    const normalizedOddB = normalizeOdd(oddB);

    if (!normalizedOddA || !normalizedOddB) return null;

    const pA = 1 / normalizedOddA;
    const pB = 1 / normalizedOddB;
    const total = pA + pB;

    if (total <= 0) return null;

    return {
        playerA: round((pA / total) * 100, 2),
        playerB: round((pB / total) * 100, 2),
        margin: round((total - 1) * 100, 2)
    };
}

// --------------------------------------------------------------------------
// ⚖️ SHARP CONSENSUS ENGINE
// --------------------------------------------------------------------------
function calculateSharpConsensus(bookmakers) {
    if (!Array.isArray(bookmakers) || bookmakers.length === 0) return null;

    let weightedProbA = 0;
    let weightedProbB = 0;
    let totalWeight = 0;
    const usedBooks = [];

    for (const book of bookmakers) {
        if (!book || !book.name) continue;

        const bookName = String(book.name).toLowerCase().trim();

        const isSharp = MARKET_VALIDATION_CONFIG.SHARP_BOOKS.some((sharp) => {
            return bookName.includes(sharp);
        });

        if (!isSharp) continue;

        const oddA = normalizeOdd(book.playerAOdd ?? book.playerA_odd ?? book.oddA);
        const oddB = normalizeOdd(book.playerBOdd ?? book.playerB_odd ?? book.oddB);

        if (!oddA || !oddB) continue;

        const noVig = calculateNoVigProbabilities(oddA, oddB);
        if (!noVig) continue;

        let weight = 0.05;

        for (const [key, val] of Object.entries(MARKET_VALIDATION_CONFIG.SHARP_WEIGHT)) {
            if (bookName.includes(key)) {
                weight = val;
                break;
            }
        }

        weightedProbA += noVig.playerA * weight;
        weightedProbB += noVig.playerB * weight;
        totalWeight += weight;

        usedBooks.push({
            name: book.name,
            weight,
            playerA: noVig.playerA,
            playerB: noVig.playerB,
            margin: noVig.margin
        });
    }

    if (totalWeight === 0) return null;

    return {
        playerA: round(weightedProbA / totalWeight, 2),
        playerB: round(weightedProbB / totalWeight, 2),
        totalWeight: round(totalWeight, 4),
        usedBooks
    };
}

// --------------------------------------------------------------------------
// 📉 METRICHE DI DISACCORDO E FIDUCIA
// --------------------------------------------------------------------------
function calculateMarketDisagreement(modelProbability, marketProbability) {
    const model = normalizeTennisProbability(modelProbability);
    const market = clampNumber(marketProbability, 0, 100);

    return Math.abs(model - market);
}

function getCLVQualityScore(clvEdge) {
    const clv = Number(clvEdge);

    if (!Number.isFinite(clv)) return 1.00;
    if (clv >= 4) return 1.15;
    if (clv >= 2) return 1.08;
    if (clv >= 0) return 1.00;
    if (clv >= -2) return 0.92;

    return 0.84;
}

function getMarketTrustScore(disagreement) {
    const d = Number(disagreement);

    if (!Number.isFinite(d)) return 0.90;
    if (d <= 3) return 1.08;
    if (d <= 6) return 1.00;
    if (d <= 10) return 0.92;

    return 0.82;
}

// ============================================================================
// TENNIS PROBABILITY CALIBRATION HELPERS
// ============================================================================
function buildTennisCalibrationContext(options = {}) {
    const reliabilityReport = options.reliabilityReport || null;
    const calibrationReport = options.calibrationReport || reliabilityReport?.calibration || null;

    const brierScore = toNumber(
        options.brierScore ??
        reliabilityReport?.brier?.avgBrier ??
        reliabilityReport?.brierScore,
        0.25
    );

    const calibrationError = toNumber(
        options.calibrationError ??
        reliabilityReport?.calibration?.summary?.weightedCalibrationError ??
        reliabilityReport?.calibrationError,
        0
    );

    const clv = toNumber(
        options.clv ??
        reliabilityReport?.clv?.avgCLV ??
        reliabilityReport?.clv,
        0
    );

    const decision = reliabilityReport?.decision || options.decision || null;

    return {
        calibrationReport,
        brierScore,
        calibrationError,
        clv,
        decision
    };
}

function fallbackConfidenceCalibration(probabilityPct, brierScore = 0.25, calibrationError = 0) {
    const probability = normalizeTennisProbability(probabilityPct);
    const brier = toNumber(brierScore, 0.25);
    const calError = toNumber(calibrationError, 0);

    if (
        ValueEvaluator &&
        hasFunction(ValueEvaluator, 'calibrateConfidence')
    ) {
        const calibrated = ValueEvaluator.calibrateConfidence(probability, brier, calError);
        return normalizeTennisProbability(calibrated);
    }

    // Fallback locale se value_evaluator.js non espone calibrateConfidence.
    // Logica prudente:
    // - Se Brier peggiora, comprimiamo verso 50.
    // - Se calibration error è alto, ulteriore shrink verso 50.
    let shrink = 0;

    if (brier > 0.27) shrink += 0.35;
    else if (brier > 0.245) shrink += 0.20;
    else if (brier < 0.21) shrink -= 0.05;

    if (calError > 10) shrink += 0.30;
    else if (calError > 7.5) shrink += 0.18;
    else if (calError < 3) shrink -= 0.03;

    shrink = clamp(shrink, 0, 0.55);

    const calibrated = 50 + ((probability - 50) * (1 - shrink));

    return normalizeTennisProbability(round(calibrated, 2));
}

function applyTennisProbabilityCalibration(probabilityPct, options = {}) {
    const {
        marketProbability = null,
        reliabilityReport = null,
        calibrationReport = null,
        brierScore = 0.25,
        calibrationError = 0,
        minReliableSample = DEFAULT_TENNIS_VALUE_CONFIG.minReliableSample,
        maxAdjustment = DEFAULT_TENNIS_VALUE_CONFIG.maxCalibrationAdjustmentPp
    } = options;

    const probability = normalizeTennisProbability(probabilityPct);
    const effectiveCalibrationReport = calibrationReport || reliabilityReport?.calibration || null;

    if (
        effectiveCalibrationReport &&
        Array.isArray(effectiveCalibrationReport.buckets) &&
        ValueEvaluator &&
        hasFunction(ValueEvaluator, 'calibrateProbabilityByBuckets')
    ) {
        const calibrated = ValueEvaluator.calibrateProbabilityByBuckets(
            probability,
            effectiveCalibrationReport,
            {
                maxAdjustment,
                minReliableSample,
                shrinkToMarket: marketProbability
            }
        );

        const calibratedProbability = normalizeTennisProbability(calibrated.probability);

        return {
            probability: round(calibratedProbability, 2),
            originalProbability: round(calibrated.originalProbability ?? probability, 2),
            adjustment: round(calibratedProbability - probability, 2),
            bucket: calibrated.bucket ?? null,
            reliability: calibrated.reliability ?? 'BUCKET_CALIBRATION',
            reason: calibrated.reason ?? 'Calibrazione tramite bucket storici',
            bucketStatus: calibrated.bucketStatus || null,
            bucketSample: Number(calibrated.bucketSample || 0),
            bucketObservedWinRate: calibrated.bucketObservedWinRate ?? null,
            bucketPredictedProb: calibrated.bucketPredictedProb ?? null,
            method: 'BUCKET'
        };
    }

    const fallbackProbability = fallbackConfidenceCalibration(
        probability,
        brierScore,
        calibrationError
    );

    return {
        probability: round(fallbackProbability, 2),
        originalProbability: round(probability, 2),
        adjustment: round(fallbackProbability - probability, 2),
        bucket: null,
        reliability: 'FALLBACK_CONFIDENCE_CALIBRATION',
        reason: 'Calibrazione fallback tramite Brier/calibration error',
        bucketStatus: null,
        bucketSample: 0,
        bucketObservedWinRate: null,
        bucketPredictedProb: null,
        method: 'FALLBACK'
    };
}

// --------------------------------------------------------------------------
// 🧮 DISCOUNT DI AFFIDABILITÀ
// --------------------------------------------------------------------------
function getReliabilityMultiplier(reliability = {}) {
    const decisionLevel = reliability?.decision?.level || reliability?.level || null;
    const brierScore = toNumber(reliability?.brierScore ?? reliability?.brier, 0.25);
    const calibrationError = toNumber(reliability?.calibrationError, 0);
    const clv = toNumber(reliability?.clv, 0);

    let multiplier = 1;

    if (decisionLevel === 'SUSPEND') multiplier = 0;
    else if (decisionLevel === 'NO_BET_OR_MICRO_STAKE') multiplier = 0.25;
    else if (decisionLevel === 'REDUCE') multiplier = 0.5;
    else if (decisionLevel === 'CAUTION') multiplier = 0.75;

    if (brierScore > DEFAULT_TENNIS_VALUE_CONFIG.suspendBrierAbove) {
        multiplier *= 0.45;
    } else if (brierScore > DEFAULT_TENNIS_VALUE_CONFIG.reduceBrierAbove) {
        multiplier *= 0.70;
    }

    if (calibrationError > DEFAULT_TENNIS_VALUE_CONFIG.suspendCalibrationErrorAbove) {
        multiplier *= 0.45;
    } else if (calibrationError > DEFAULT_TENNIS_VALUE_CONFIG.reduceCalibrationErrorAbove) {
        multiplier *= 0.70;
    }

    if (clv < 0) {
        multiplier *= 0.70;
    }

    return clamp(multiplier, 0, 1.25);
}

function adjustTennisEdgeByReliability(edgePct, reliability = {}) {
    const edge = Number(edgePct);
    if (!Number.isFinite(edge)) return 0;

    const multiplier = getReliabilityMultiplier(reliability);

    return round(edge * multiplier, 2);
}

function adjustTennisEvByReliability(evPct, reliability = {}) {
    const ev = Number(evPct);
    if (!Number.isFinite(ev)) return 0;

    const multiplier = getReliabilityMultiplier(reliability);

    return round(ev * multiplier, 2);
}

function getTennisReliabilityLevel({
    probability,
    edgePp,
    evPct,
    brierScore,
    calibrationError,
    bucketStatus,
    bucketSample,
    clv
} = {}) {
    const p = Number(probability);
    const edge = Number(edgePp);
    const ev = Number(evPct);
    const brier = toNumber(brierScore, 0.25);
    const calError = toNumber(calibrationError, 0);
    const sample = Number(bucketSample || 0);
    const clvValue = toNumber(clv, 0);

    if (!Number.isFinite(p) || !Number.isFinite(edge) || !Number.isFinite(ev)) {
        return {
            level: 'INVALID',
            allowBet: false,
            stakeMultiplier: 0,
            reason: 'Probabilità, edge o EV non validi'
        };
    }

    if (bucketStatus === 'OVERCONFIDENT_CRITICAL') {
        return {
            level: 'SUSPEND_BUCKET',
            allowBet: false,
            stakeMultiplier: 0,
            reason: 'Bucket storico overconfident critico'
        };
    }

    if (sample > 0 && sample < DEFAULT_TENNIS_VALUE_CONFIG.minReliableSample) {
        return {
            level: 'MICRO_STAKE',
            allowBet: edge >= 6 && ev >= 4,
            stakeMultiplier: 0.25,
            reason: 'Bucket con campione insufficiente'
        };
    }

    if (
        brier > DEFAULT_TENNIS_VALUE_CONFIG.suspendBrierAbove ||
        calError > DEFAULT_TENNIS_VALUE_CONFIG.suspendCalibrationErrorAbove
    ) {
        return {
            level: 'SUSPEND',
            allowBet: false,
            stakeMultiplier: 0,
            reason: 'Brier/calibrazione Tennis fuori soglia'
        };
    }

    if (
        brier > DEFAULT_TENNIS_VALUE_CONFIG.reduceBrierAbove ||
        calError > DEFAULT_TENNIS_VALUE_CONFIG.reduceCalibrationErrorAbove ||
        clvValue < 0
    ) {
        return {
            level: 'REDUCE',
            allowBet: edge >= 5 && ev >= 3,
            stakeMultiplier: 0.5,
            reason: 'Attendibilità debole: richiesto edge/EV maggiore e stake ridotto'
        };
    }

    if (
        p >= DEFAULT_TENNIS_VALUE_CONFIG.highProbabilityCautionPct &&
        edge < DEFAULT_TENNIS_VALUE_CONFIG.highProbabilityMinEdgePp
    ) {
        return {
            level: 'HIGH_PROB_CAUTION',
            allowBet: false,
            stakeMultiplier: 0,
            reason: 'Probabilità alta ma edge insufficiente dopo calibrazione'
        };
    }

    return {
        level: 'NORMAL',
        allowBet: edge >= DEFAULT_TENNIS_VALUE_CONFIG.minEdgePp &&
            ev >= DEFAULT_TENNIS_VALUE_CONFIG.minEvPct,
        stakeMultiplier: 1,
        reason: 'Metriche compatibili con utilizzo operativo'
    };
}

// --------------------------------------------------------------------------
// 🧱 OUTPUT INVALIDO STANDARDIZZATO
// --------------------------------------------------------------------------
function buildInvalidTennisEvaluation(reason, partial = {}) {
    const modelProbability = partial.modelProbability ?? null;
    const odd = partial.odd ?? null;

    return {
        valid: false,
        reason,
        sport: 'tennis',

        odd,
        modelProbability: modelProbability !== null ? round(modelProbability, 2) : null,
        calibratedProbability: null,
        impliedProbability: odd ? round(impliedProbability(odd), 2) : null,

        model_probability_pct: modelProbability !== null ? round(modelProbability, 2) : null,
        calibrated_probability_pct: null,
        market_implied_probability_pct: odd ? round(impliedProbability(odd), 2) : null,
        market_probability_pct: null,

        fair_odd_model: null,
        fair_odd_calibrated: null,

        rawEdge: null,
        calibratedEdge: null,
        adjustedEdge: null,
        edge: null,
        edge_pp: null,
        raw_edge_pp: null,
        calibrated_edge_pp: null,
        adjusted_edge_pp: null,

        ev_pct: null,
        raw_ev_pct: null,
        calibrated_ev_pct: null,
        adjusted_ev_pct: null,
        expectedValue: null,

        probability: null,
        disagreement: null,
        valueScore: 0,
        suggestedStakeMultiplier: 0,

        thresholds_passed: {
            probability: false,
            edge_pp: false,
            ev_pct: false,
            max_odd: Boolean(odd && odd <= DEFAULT_TENNIS_VALUE_CONFIG.maxOdd),
            reliability: false
        },

        data_quality: 'CURRENT_BOOTSTRAP',
        metric_version: TENNIS_METRIC_VERSION,
        evaluator_version: TENNIS_VALUE_EVALUATOR_VERSION,

        audit: {
            sport: 'tennis',
            version: TENNIS_VALUE_EVALUATOR_VERSION,
            formulaVersion: TENNIS_METRIC_VERSION,
            inputValidity: {
                validModelProbability: modelProbability !== null,
                validOdd: Boolean(odd),
                validMarketProbability: false
            },
            formula: {
                edge_pp: 'calibrated_probability_pct - market_implied_probability_pct',
                ev_pct: '((calibrated_probability_pct / 100) * odd - 1) * 100',
                expectedValue: 'legacy alias of adjusted_ev_pct',
                edge: 'legacy alias of adjusted_edge_pp'
            }
        }
    };
}

// --------------------------------------------------------------------------
// 🎯 MAIN VALIDATION ENGINE
// --------------------------------------------------------------------------
function evaluateTennisValueBet(input = {}, options = {}) {
    const reliability10Audit = reliability10.evaluate(input);
    if (reliability10Audit.hardReasons.length) {
        return { ...buildInvalidTennisEvaluation('RELIABILITY10: ' + reliability10Audit.hardReasons.join(', ')), reliability10Audit };
    }
    // STEP91_PREMATCH_LEAKAGE_GUARD: vieta CLV/closing/result/profit della giocata corrente in pre-match.
    assertPreMatchOnlyContext(input);
    const rawModelProbability = parseProbabilityPct(
        input.modelProbability ??
        input.probability ??
        input.estimatedProbability ??
        input.winProbability,
        null
    );

    const odd = normalizeOdd(input.odd ?? input.quota ?? input.price);

    if (rawModelProbability === null) {
        return buildInvalidTennisEvaluation('Probabilità modello non valida', { odd });
    }

    const modelProbability = normalizeTennisProbability(rawModelProbability);

    if (!odd) {
        return buildInvalidTennisEvaluation('Quota non valida', { modelProbability });
    }

    const marketImpliedProbability = round(impliedProbability(odd), 2);

    const rawMarketProbability = parseProbabilityPct(
        input.marketProbability ??
        input.marketImpliedProbability ??
        input.market_implied_probability_pct,
        null
    );

    const marketProbability = rawMarketProbability === null
        ? marketImpliedProbability
        : clampNumber(rawMarketProbability, 0, 100);

    const appliedProbabilitySource = rawMarketProbability === null
        ? 'OFFERED_ODD_IMPLIED_PROBABILITY'
        : 'REFERENCE_MARKET_PROBABILITY';

    const context = buildTennisCalibrationContext(options);

    const minReliableSample = options.minReliableSample ??
        DEFAULT_TENNIS_VALUE_CONFIG.minReliableSample;

    const maxAdjustment = options.maxAdjustment ??
        DEFAULT_TENNIS_VALUE_CONFIG.maxCalibrationAdjustmentPp;

    const calibration = applyTennisProbabilityCalibration(modelProbability, {
        reliabilityReport: options.reliabilityReport || null,
        calibrationReport: options.calibrationReport || null,
        brierScore: context.brierScore,
        calibrationError: context.calibrationError,
        clv: context.clv,
        marketProbability,
        minReliableSample,
        maxAdjustment
    });

    const calibratedProbability = normalizeTennisProbability(calibration.probability);

    // ----------------------------------------------------------------------
    // FIX PRINCIPALE
    // ----------------------------------------------------------------------
    // Prima il file usava modelProbability per expectedValue.
    // Ora l'EV operativo usa SEMPRE la probabilità calibrata.
    // ----------------------------------------------------------------------

    const rawEdgePp = calculateEdgePp(modelProbability, marketImpliedProbability);
    const calibratedEdgePp = calculateEdgePp(calibratedProbability, marketImpliedProbability);

    const rawEvPct = calculateExpectedValuePct(modelProbability, odd);
    const calibratedEvPct = calculateExpectedValuePct(calibratedProbability, odd);

    const reliabilityInput = {
        brierScore: context.brierScore,
        calibrationError: context.calibrationError,
        clv: context.clv,
        decision: context.decision
    };

    const adjustedEdgePp = adjustTennisEdgeByReliability(
        calibratedEdgePp,
        reliabilityInput
    );

    const adjustedEvPct = adjustTennisEvByReliability(
        calibratedEvPct,
        reliabilityInput
    );

    const reliability = getTennisReliabilityLevel({
        probability: calibratedProbability,
        edgePp: adjustedEdgePp,
        evPct: adjustedEvPct,
        brierScore: context.brierScore,
        calibrationError: context.calibrationError,
        bucketStatus: calibration.bucketStatus,
        bucketSample: calibration.bucketSample,
        clv: context.clv
    });

    const minProbability = options.minProbability ??
        options.minProbabilityPct ??
        DEFAULT_TENNIS_VALUE_CONFIG.minProbabilityPct;

    const minEdgePp = options.minEdgePp ??
        options.minEdge ??
        DEFAULT_TENNIS_VALUE_CONFIG.minEdgePp;

    const minEvPct = options.minEvPct ??
        DEFAULT_TENNIS_VALUE_CONFIG.minEvPct;

    const maxOdd = options.maxOdd ??
        DEFAULT_TENNIS_VALUE_CONFIG.maxOdd;

    const thresholdsPassed = {
        probability: calibratedProbability >= minProbability,
        edge_pp: adjustedEdgePp >= minEdgePp,
        ev_pct: adjustedEvPct >= minEvPct,
        max_odd: odd <= maxOdd,
        reliability: Boolean(reliability.allowBet)
    };

    const valid = Boolean(
        thresholdsPassed.reliability &&
        thresholdsPassed.probability &&
        thresholdsPassed.edge_pp &&
        thresholdsPassed.ev_pct &&
        thresholdsPassed.max_odd
    );

    let reason = 'Value bet Tennis valida';

    if (!valid) {
        if (!reliability.allowBet) {
            reason = reliability.reason;
        } else if (calibratedProbability < minProbability) {
            reason = 'Probabilità calibrata sotto soglia minima';
        } else if (adjustedEdgePp < minEdgePp) {
            reason = 'Edge_pp corretto sotto soglia minima';
        } else if (adjustedEvPct < minEvPct) {
            reason = 'EV_pct corretto sotto soglia minima';
        } else if (odd > maxOdd) {
            reason = 'Quota sopra soglia massima rischio Tennis';
        }
    }

    const disagreementModelMarket = calculateMarketDisagreement(
        calibratedProbability,
        marketProbability
    );

    const fairOddModel = calculateFairOdd(modelProbability);
    const fairOddCalibrated = calculateFairOdd(calibratedProbability);

    const clvQualityScore = getCLVQualityScore(context.clv);
    const marketTrustScore = getMarketTrustScore(disagreementModelMarket);

    const valueScore = calculateTennisValueScore({
        edge_pp: adjustedEdgePp,
        ev_pct: adjustedEvPct,
        adjustedConfidence: clvQualityScore * marketTrustScore,
        disagreement: disagreementModelMarket
    });

    return {
        reliability10Audit,
        valid,
        reason,
        sport: 'tennis',

        // ------------------------------------------------------------------
        // Campi principali normalizzati
        // ------------------------------------------------------------------
        odd: round(odd, 2),

        model_probability_pct: round(modelProbability, 2),
        calibrated_probability_pct: round(calibratedProbability, 2),
        market_implied_probability_pct: round(marketImpliedProbability, 2),
        market_probability_pct: round(marketProbability, 2),

        fair_odd_model: fairOddModel ? round(fairOddModel, 2) : null,
        fair_odd_calibrated: fairOddCalibrated ? round(fairOddCalibrated, 2) : null,

        raw_edge_pp: round(rawEdgePp, 2),
        calibrated_edge_pp: round(calibratedEdgePp, 2),
        adjusted_edge_pp: round(adjustedEdgePp, 2),

        raw_ev_pct: round(rawEvPct, 2),
        calibrated_ev_pct: round(calibratedEvPct, 2),
        adjusted_ev_pct: round(adjustedEvPct, 2),

        // ------------------------------------------------------------------
        // Campi standard da usare nel resto del progetto
        // ------------------------------------------------------------------
        edge_pp: round(adjustedEdgePp, 2),
        ev_pct: round(adjustedEvPct, 2),

        // ------------------------------------------------------------------
        // Compatibilità legacy
        // ------------------------------------------------------------------
        impliedProbability: round(marketImpliedProbability, 2),
        modelProbability: round(modelProbability, 2),
        calibratedProbability: round(calibratedProbability, 2),

        rawEdge: round(rawEdgePp, 2),
        calibratedEdge: round(calibratedEdgePp, 2),
        adjustedEdge: round(adjustedEdgePp, 2),

        // Campo legacy: ora corretto.
        // Prima era calcolato sulla probabilità raw.
        // Ora equivale all'EV calibrato e corretto da reliability.
        expectedValue: round(adjustedEvPct, 2),

        // Campo legacy: mantiene comportamento precedente, ma ora rappresenta edge_pp.
        edge: round(adjustedEdgePp, 2),

        probability: round(calibratedProbability, 2),

        disagreement: round(disagreementModelMarket, 2),
        valueScore,

        calibration,
        reliability,

        thresholds_passed: thresholdsPassed,
        appliedProbabilitySource,
        data_quality: 'CURRENT_BOOTSTRAP',
        metric_version: TENNIS_METRIC_VERSION,
        evaluator_version: TENNIS_VALUE_EVALUATOR_VERSION,

        suggestedStakeMultiplier: reliability.stakeMultiplier,

        scores: {
            clvQualityScore: round(clvQualityScore, 3),
            marketTrustScore: round(marketTrustScore, 3),
            reliabilityMultiplier: round(getReliabilityMultiplier(reliabilityInput), 3),
            valueScore
        },

        audit: {
            sport: 'tennis',
            version: TENNIS_VALUE_EVALUATOR_VERSION,
            brierScore: round(context.brierScore || 0, 4),
            calibrationError: round(context.calibrationError || 0, 2),
            clv: round(context.clv || 0, 2),
            decision: context.decision || null,
            formulaVersion: TENNIS_METRIC_VERSION,
            appliedProbabilitySource,
            inputValidity: {
                validModelProbability: true,
                validOdd: true,
                validMarketProbability: rawMarketProbability !== null,
                usedMarketFallbackFromOdd: rawMarketProbability === null
            },
            thresholdsPassed,
            thresholds: {
                minProbability,
                minEdgePp,
                minEvPct,
                maxOdd,
                minReliableSample,
                maxAdjustment
            },
            formula: {
                edge_pp: 'calibrated_probability_pct - market_implied_probability_pct',
                ev_pct: '((calibrated_probability_pct / 100) * odd - 1) * 100',
                expectedValue: 'legacy alias of adjusted_ev_pct',
                edge: 'legacy alias of adjusted_edge_pp'
            }
        }
    };
}

// --------------------------------------------------------------------------
// 🏆 TENNIS VALUE SCORE 1-100
// --------------------------------------------------------------------------
function calculateTennisValueScore(input = {}) {
    const edge = Number(
        input.edge_pp ??
        input.adjusted_edge_pp ??
        input.edge ??
        input.adjustedEdge ??
        0
    );

    const ev = Number(
        input.ev_pct ??
        input.adjusted_ev_pct ??
        input.expectedValue ??
        0
    );

    const adjustedConfidence = Number(input.adjustedConfidence ?? 1.0);
    const disagreement = Number(input.disagreement ?? 0);

    let score = 50;

    if (Number.isFinite(edge)) score += edge * 2.5;
    if (Number.isFinite(ev)) score += ev * 0.45;
    if (Number.isFinite(adjustedConfidence)) score += (adjustedConfidence - 1) * 22;
    if (Number.isFinite(disagreement)) score -= disagreement * 1.8;

    return clamp(round(score, 2), 1, 100);
}

// --------------------------------------------------------------------------
// 🎯 DECISION LAYER CALIBRAZIONE PREDITTIVA PROFESSIONALE
// --------------------------------------------------------------------------
function buildTennisPredictiveCalibrationDecision(segmentReport = {}, options = {}) {
    const limits = {
        ...DEFAULT_TENNIS_CALIBRATION_PROFESSIONAL_LIMITS,
    DEFAULT_TENNIS_PROFESSIONAL_GATE_LIMITS,
        ...options
    };

    const overall = segmentReport.overall || {};
    const closingLine = segmentReport.closingLine || {};

    const sample = Number(overall.sample ?? segmentReport.sampleSize ?? 0) || 0;
    const brierScore = toNumber(overall.brier, 0);
    const calibrationError = toNumber(overall.calibrationError, 0);
    const avgClvPct = toNumber(closingLine.avgClvPct, 0);
    const clvBeatRatePct = toNumber(closingLine.beatRatePct, 0);
    const closingLineSample = Number(closingLine.sample || 0) || 0;

    const gates = {
        sampleSize: sample >= limits.requiredSample,
        brierScore: brierScore > 0 && brierScore <= limits.professionalBrierMax,
        calibrationError: calibrationError <= limits.professionalCalibrationErrorMax,
        closingLineSample: closingLineSample >= limits.minSegmentSample,
        clv: closingLineSample === 0 ? false : (avgClvPct >= limits.professionalAvgClvPctMin && clvBeatRatePct >= limits.professionalClvBeatRateMin)
    };

    const watchGates = {
        sampleSize: sample >= Math.max(limits.minSegmentSample, Math.floor(limits.requiredSample / 3)),
        brierScore: brierScore > 0 && brierScore <= limits.watchBrierMax,
        calibrationError: calibrationError <= limits.watchCalibrationErrorMax,
        clv: closingLineSample > 0 && avgClvPct >= limits.watchAvgClvPctMin && clvBeatRatePct >= limits.watchClvBeatRateMin
    };

    let grade = 'BLOCKED_INSUFFICIENT_SAMPLE';
    let status = 'WARN';
    let allowProfessionalUse = false;
    let recommendation = `Campione Tennis pulito insufficiente: ${sample}/${limits.requiredSample}. Continuare paper trading senza uso reale.`;

    if (sample >= limits.requiredSample) {
        const allProfessional = gates.brierScore && gates.calibrationError && gates.clv;
        const allWatch = watchGates.brierScore && watchGates.calibrationError && (closingLineSample === 0 || watchGates.clv);

        if (allProfessional) {
            grade = 'PROFESSIONAL_READY';
            status = 'OK';
            allowProfessionalUse = true;
            recommendation = 'Calibrazione Tennis professionale: sample, Brier, calibration gap e CLV entro soglia.';
        } else if (allWatch) {
            grade = 'WATCHLIST_LIMITED_STAKE';
            status = 'WARN';
            recommendation = 'Calibrazione Tennis utilizzabile solo in paper trading o micro stake: alcune soglie non sono ancora professionali.';
        } else {
            grade = 'BLOCKED_CALIBRATION_RISK';
            status = 'ERROR';
            recommendation = 'Calibrazione Tennis non affidabile: Brier, calibration gap o CLV fuori soglia.';
        }
    }

    return {
        grade,
        status,
        allowProfessionalUse,
        sample,
        requiredSample: limits.requiredSample,
        minSegmentSample: limits.minSegmentSample,
        brierScore: round(brierScore, 4),
        calibrationError: round(calibrationError, 2),
        closingLineSample,
        avgClvPct: round(avgClvPct, 2),
        clvBeatRatePct: round(clvBeatRatePct, 2),
        gates,
        watchGates,
        recommendation
    };
}


// --------------------------------------------------------------------------
// 🧭 STEP49B - DEEPSCAN CONSENSUS GATE HELPERS
// --------------------------------------------------------------------------
function normalizeDeepScanConsensusSignal(report = {}) {
    const action = String(report.action || report.mode || report.recommendationMode || '').toUpperCase();
    const level = String(
        report.riskAssessment?.level ||
        report.quantData?.riskAssessment?.level ||
        report.level ||
        report.deepScanLevel ||
        ''
    ).toUpperCase();
    const score = toNumber(
        report.riskAssessment?.score ??
        report.quantData?.riskAssessment?.score ??
        report.riskScore,
        null
    );
    const valueScore = toNumber(
        report.riskAssessment?.valueScore ??
        report.quantData?.riskAssessment?.valueScore ??
        report.valueScore,
        null
    );
    const text = String([
        report.suggestionText,
        report.summary,
        report.explainability,
        report.message,
        report.verdict,
        report.rawText
    ].filter(Boolean).join(' ')).toUpperCase();

    const highRisk =
        level.includes('ALTO_RISCHIO') ||
        level.includes('HIGH_RISK') ||
        action.includes('ALTO RISCHIO') ||
        action.includes('HIGH RISK') ||
        action.includes('SCARTA') ||
        action.includes('VETO') ||
        text.includes('ALTO RISCHIO') ||
        text.includes('AUTOMATICAMENTE SCARTATA');

    const modelRisk =
        level.includes('RISCHIO_MODELLO') ||
        level.includes('MODEL_RISK') ||
        action.includes('RISCHIO MODELLO');

    const waitOnly =
        action.includes('WAIT') ||
        action.includes('IN_PLAY') ||
        action.includes('IN-PLAY') ||
        action.includes('ATTENDI') ||
        text.includes('ATTENDI ALMENO');

    const confirmed =
        action.includes('CONFIRM') ||
        action.includes('CONFERMA') ||
        level.includes('EDGE_TECNICO') ||
        level.includes('TECHNICAL_EDGE') ||
        text.includes('DEEPSCAN CONFERMA') ||
        text.includes('CONFERMA IL PRONOSTICO');

    return {
        mode: 'STEP49B_DEEPSCAN_CONSENSUS_SIGNAL',
        action,
        level: level || 'UNKNOWN',
        score,
        valueScore,
        confirmed,
        highRisk,
        modelRisk,
        waitOnly,
        usableForMicroUnlock: confirmed && !highRisk && !waitOnly
    };
}

function classifyTennisGateBlockType(status = '', reasons = []) {
    const s = String(status || '').toUpperCase();
    const text = `${s} ${(Array.isArray(reasons) ? reasons : []).join(' ')}`.toUpperCase();

    if (!s || s.includes('APPROVED') || s.includes('CONSENSUS')) return null;

    if (
        text.includes('VALUE EVALUATION') ||
        text.includes('NON VALIDA') ||
        text.includes('DATA_INSUFFICIENT') ||
        text.includes('DATI GIOCATORE') ||
        text.includes('MARKOV') ||
        text.includes('LOW_VALUE_SCORE') ||
        text.includes('SOTTO SOGLIA') ||
        text.includes('EV NEGAT') ||
        text.includes('EDGE_PP CORRETTO SOTTO')
    ) {
        return 'HARD';
    }

    if (
        text.includes('MARKET_DISAGREEMENT') ||
        text.includes('DISACCORDO') ||
        text.includes('CALIBRATION') ||
        text.includes('CALIBRAZIONE') ||
        text.includes('STAKE_BELOW_MINIMUM')
    ) {
        return 'SOFT';
    }

    return 'HARD';
}

function canDeepScanConsensusUnlockMicro({
    evaluation = {},
    dataSufficiency = null,
    calibrationGrade = '',
    marketType = 'moneyline',
    markovValidated = null,
    disagreement = 0,
    deepScanSignal = {},
    baseBlockType = null,
    limits = {}
} = {}) {
    const market = String(marketType || '').toLowerCase();
    const allowedMarkets = Array.isArray(limits.allowMarkets) ? limits.allowMarkets : ['moneyline'];
    const edgePp = toNumber(evaluation.edge_pp ?? evaluation.adjusted_edge_pp ?? evaluation.edge, 0);
    const evPct = toNumber(evaluation.ev_pct ?? evaluation.adjusted_ev_pct ?? evaluation.expectedValue, 0);
    const probabilityPct = toNumber(evaluation.calibrated_probability_pct ?? evaluation.calibratedProbability ?? evaluation.model_probability_pct ?? evaluation.modelProbability, 0);
    const marketProbabilityPct = toNumber(evaluation.market_implied_probability_pct ?? evaluation.impliedProbability ?? evaluation.marketProbability, null);
    const dataScore = toNumber(dataSufficiency?.score, null);
    const grade = String(calibrationGrade || '').toUpperCase();

    const probabilityAboveMarket = marketProbabilityPct === null
        ? edgePp
        : probabilityPct - marketProbabilityPct;

    const softCalibration =
        !grade ||
        grade === 'UNKNOWN' ||
        grade === 'BLOCKED_INSUFFICIENT_SAMPLE' ||
        grade === 'WATCHLIST_LIMITED_STAKE';

    const reasons = [];
    if (!limits.enabled) reasons.push('Consensus Gate disattivato');
    if (!allowedMarkets.includes(market)) reasons.push(`Mercato ${market} non abilitato al micro unlock DeepScan`);
    if (market === 'totals' && markovValidated !== true) reasons.push('Totals senza Markov validato: hard veto');
    if (baseBlockType !== 'SOFT') reasons.push(`Blocco non soft: ${baseBlockType || 'UNKNOWN'}`);
    if (!deepScanSignal.usableForMicroUnlock) reasons.push('DeepScan non conferma o richiede attesa/rischio alto');
    if (edgePp < limits.minEdgePp) reasons.push(`Edge insufficiente per micro unlock: ${round(edgePp, 2)} < ${limits.minEdgePp}`);
    if (evPct < limits.minEvPct) reasons.push(`EV insufficiente per micro unlock: ${round(evPct, 2)} < ${limits.minEvPct}`);
    if (probabilityAboveMarket < limits.minProbabilityAboveMarketPp) reasons.push(`Probabilità non abbastanza sopra mercato: ${round(probabilityAboveMarket, 2)}pp`);
    if (Math.abs(disagreement) > limits.maxSoftMarketDisagreementPp) reasons.push(`Disaccordo oltre soft band: ${round(Math.abs(disagreement), 2)}pp > ${limits.maxSoftMarketDisagreementPp}pp`);
    if (dataScore !== null && dataScore < limits.minDataSufficiencyMoneyline) reasons.push(`Data sufficiency sotto micro unlock: ${round(dataScore, 2)} < ${limits.minDataSufficiencyMoneyline}`);
    if (!softCalibration) reasons.push(`Calibrazione non soft: ${grade}`);

    return {
        allowed: reasons.length === 0,
        reasons,
        metrics: {
            edgePp: round(edgePp, 2),
            evPct: round(evPct, 2),
            probabilityPct: round(probabilityPct, 2),
            marketProbabilityPct: marketProbabilityPct === null ? null : round(marketProbabilityPct, 2),
            probabilityAboveMarketPp: round(probabilityAboveMarket, 2),
            disagreementPp: round(disagreement, 2),
            dataScore: dataScore === null ? null : round(dataScore, 2),
            calibrationGrade: grade || 'UNKNOWN'
        }
    };
}

// --------------------------------------------------------------------------
// 🛡️ PROFESSIONAL BET GATE TENNIS
// --------------------------------------------------------------------------
function buildTennisProfessionalBetGate(input = {}, options = {}) {
    const limits = {
        ...DEFAULT_TENNIS_PROFESSIONAL_GATE_LIMITS,
        ...options
    };

    const evaluation = input.evaluation || input.valueEvaluation || input;
    const dataSufficiency = input.dataSufficiency || null;
    const calibrationDecision = input.predictiveCalibrationDecision || input.calibrationDecision || null;
    const marketType = String(input.marketType || input.market_type || 'moneyline').toLowerCase();
    const markovValidated = input.markovValidated ?? input.markov_validated ?? null;
    const referenceMarket = input.referenceMarket || input.reference || null;
    const stake = toNumber(input.stake ?? input.suggestedStake ?? 0, 0);
    const bankroll = Math.max(toNumber(input.bankroll ?? 1000, 1000), 1);
    const consensusLimits = {
        ...DEFAULT_TENNIS_CONSENSUS_GATE_LIMITS,
        ...(options.consensusGate || {})
    };
    const deepScanSignal = normalizeDeepScanConsensusSignal(
        input.deepScanReport || input.deepScan || input.deep_scan || input.deepScanResult || {}
    );

    const reasons = [];
    const warnings = [];
    let status = 'APPROVED_STANDARD';
    let allowBet = true;
    let professionalUse = false;
    let blockType = null;
    let consensusGate = {
        mode: 'STEP49B_DEEPSCAN_CONSENSUS_GATE',
        enabled: consensusLimits.enabled === true,
        applied: false,
        decision: 'NOT_EVALUATED',
        deepScanSignal
    };
    let consensusMicroUnlock = false;

    const evaluationValid = evaluation?.valid === true;
    if (!evaluationValid) {
        allowBet = false;
        status = 'BLOCKED_VALUE_RULES';
        reasons.push(evaluation?.reason || 'Value evaluation Tennis non valida');
    }

    const dataScore = toNumber(dataSufficiency?.score, null);
    const minDataScore = marketType === 'totals'
        ? limits.minDataSufficiencyTotals
        : limits.minDataSufficiencyMoneyline;

    // STEP91_DATA_SUFFICIENCY_HARD_RULES: il campione minimo non è compensabile da edge/EV.
    const playerSampleSize = toNumber(
        dataSufficiency?.playerSampleSize ??
        dataSufficiency?.observedSample ??
        dataSufficiency?.sampleSize ??
        dataSufficiency?.sample,
        null
    );
    const hardMinSample = marketType === 'totals'
        ? (limits.hardMinPlayerSampleTotals ?? 50)
        : (limits.hardMinPlayerSampleMoneyline ?? 10);
    if (playerSampleSize !== null && playerSampleSize < hardMinSample) {
        allowBet = false;
        status = 'BLOCKED_DATA_INSUFFICIENT';
        blockType = 'HARD';
        reasons.push(`DATA_SUFFICIENCY_BLOCK: Campione ${marketType} insufficiente ${playerSampleSize}/${hardMinSample}`);
    }

    if (dataSufficiency && dataSufficiency.passed !== true) {
        allowBet = false;
        status = 'BLOCKED_DATA_INSUFFICIENT';
        reasons.push(`Data sufficiency insufficiente: ${dataScore ?? 0}/${minDataScore}`);
        if (Array.isArray(dataSufficiency.reasons)) reasons.push(...dataSufficiency.reasons);
    } else if (dataScore !== null && dataScore < minDataScore) {
        allowBet = false;
        status = 'BLOCKED_DATA_INSUFFICIENT';
        reasons.push(`Data sufficiency sotto soglia professionale: ${dataScore}/${minDataScore}`);
    }

    const calibrationGrade = String(calibrationDecision?.grade || '').toUpperCase();

    if (!calibrationGrade && limits.blockIfCalibrationUnknown) {
        allowBet = false;
        status = 'BLOCKED_CALIBRATION_UNKNOWN';
        reasons.push('Calibrazione predittiva Tennis non disponibile');
    } else if (!calibrationGrade) {
        professionalUse = false;
        if (allowBet) status = 'APPROVED_MICRO_STAKE';
        warnings.push('Calibrazione predittiva UNKNOWN: cap pieno non consentito, solo micro stake/paper trading');
    } else if (calibrationGrade === 'PROFESSIONAL_READY') {
        professionalUse = true;
    } else if (calibrationGrade === 'WATCHLIST_LIMITED_STAKE') {
        professionalUse = false;
        warnings.push('Calibrazione in watchlist: consentito solo micro stake/paper trading');
        if (allowBet) status = 'APPROVED_MICRO_STAKE';
    } else if (calibrationGrade) {
        allowBet = false;
        status = 'BLOCKED_CALIBRATION_RISK';
        reasons.push(calibrationDecision?.recommendation || `Calibrazione Tennis non professionale: ${calibrationGrade}`);
    }

    const disagreement = toNumber(
        evaluation?.disagreement ??
        evaluation?.audit?.disagreement ??
        evaluation?.marketDisagreementPp,
        0
    );

    if (Math.abs(disagreement) > limits.maxMarketDisagreementPp) {
        allowBet = false;
        status = 'BLOCKED_MARKET_DISAGREEMENT';
        reasons.push(`Disaccordo modello/mercato troppo alto: ${round(Math.abs(disagreement), 2)}pp > ${limits.maxMarketDisagreementPp}pp`);
    }

    const valueScore = toNumber(evaluation?.valueScore ?? evaluation?.scores?.valueScore, 0);
    if (valueScore > 0 && valueScore < limits.minValueScore) {
        allowBet = false;
        status = 'BLOCKED_LOW_VALUE_SCORE';
        reasons.push(`Value score Tennis sotto soglia: ${round(valueScore, 2)}/${limits.minValueScore}`);
    }

    if (marketType === 'totals' && limits.requireMarkovForTotals && markovValidated !== true) {
        allowBet = false;
        status = 'BLOCKED_MARKOV_TOTALS';
        reasons.push('Totals Tennis bloccato: Markov non validato');
    }

    const baseBlockType = allowBet ? null : classifyTennisGateBlockType(status, reasons);
    const consensusCheck = canDeepScanConsensusUnlockMicro({
        evaluation,
        dataSufficiency,
        calibrationGrade: calibrationGrade || 'UNKNOWN',
        marketType,
        markovValidated,
        disagreement,
        deepScanSignal,
        baseBlockType,
        limits: consensusLimits
    });

    consensusGate = {
        ...consensusGate,
        decision: consensusCheck.allowed ? 'MICRO_UNLOCK' : (allowBet ? 'NOT_NEEDED' : 'KEEP_BLOCK'),
        applied: consensusCheck.allowed,
        blockTypeBeforeConsensus: baseBlockType,
        metrics: consensusCheck.metrics,
        rejectedReasons: consensusCheck.reasons
    };

    if (!allowBet && consensusCheck.allowed) {
        const previousReasons = [...new Set(reasons)];
        allowBet = true;
        professionalUse = false;
        status = 'CONSENSUS_MICRO_STAKE_DEEPSCAN_CONFIRMED';
        blockType = 'SOFT_UNLOCKED';
        consensusMicroUnlock = true;
        reasons.length = 0;
        reasons.push('Consensus Gate Step49B: DeepScan conferma, edge/EV positivi e nessun hard veto; ammesso solo micro stake.');
        warnings.push('DeepScan può sbloccare solo a micro-stake: stake standard/professionale non consentito.');
        warnings.push(...previousReasons.map(r => `Ex blocco soft: ${r}`));
    } else if (!allowBet) {
        blockType = baseBlockType || 'HARD';
    }

    let maxStakePct = professionalUse
        ? limits.maxStakePctProfessional
        : (status === 'APPROVED_MICRO_STAKE' ? limits.maxStakePctWatchlist : limits.maxStakePctStandard);

    const stakePolicyReasons = [];

    if (!professionalUse && status !== 'APPROVED_MICRO_STAKE') {
        maxStakePct = Math.min(maxStakePct, limits.maxStakePctStandard);
    }

    if (valueScore > 0 && valueScore < 60) {
        maxStakePct *= 0.65;
        stakePolicyReasons.push('Value score basso: cap stake -35%');
    } else if (valueScore > 0 && valueScore < 75) {
        maxStakePct *= 0.80;
        stakePolicyReasons.push('Value score medio: cap stake -20%');
    }

    const absDisagreementForStake = Math.abs(disagreement);
    if (absDisagreementForStake >= 12) {
        maxStakePct *= 0.65;
        stakePolicyReasons.push('Disaccordo modello/mercato alto: cap stake -35%');
    } else if (absDisagreementForStake >= 9) {
        maxStakePct *= 0.80;
        stakePolicyReasons.push('Disaccordo modello/mercato moderato: cap stake -20%');
    }

    const referenceQuality = String(referenceMarket?.quality || '').toUpperCase();
    if (!referenceQuality || ['LOW', 'UNKNOWN'].includes(referenceQuality)) {
        maxStakePct *= 0.75;
        stakePolicyReasons.push('Reference market debole/assente: cap stake -25%');
    }

    maxStakePct = Math.max(0, Math.min(maxStakePct, limits.maxStakePctProfessional));

    const minPlayableStake = Math.max(toNumber(limits.minPlayableStake, 2), 0);

    if (consensusMicroUnlock && allowBet) {
        const minMicroPct = minPlayableStake > 0 ? (minPlayableStake / bankroll) : 0;
        const maxMicroPct = toNumber(consensusLimits.maxMicroStakePct, limits.maxStakePctWatchlist);
        maxStakePct = Math.min(Math.max(maxStakePct, minMicroPct, toNumber(consensusLimits.microStakePct, minMicroPct)), maxMicroPct);
    }

    let recommendedMaxStake = allowBet ? round(bankroll * maxStakePct, 2) : 0;

    if (consensusMicroUnlock && allowBet && recommendedMaxStake < minPlayableStake) {
        recommendedMaxStake = round(minPlayableStake, 2);
    }

    if (allowBet && recommendedMaxStake > 0 && recommendedMaxStake < minPlayableStake) {
        allowBet = false;
        status = 'BLOCKED_STAKE_BELOW_MINIMUM';
        reasons.push(`Cap stake ${recommendedMaxStake} inferiore al minimo giocabile ${minPlayableStake}`);
        recommendedMaxStake = 0;
    }

    const stakeWithinCap = stake <= 0 || (stake >= minPlayableStake && stake <= recommendedMaxStake);

    if (stake > 0 && stake < minPlayableStake) {
        warnings.push(`Stake sotto minimo giocabile: ${round(stake, 2)} < ${minPlayableStake}`);
    }

    if (!stakeWithinCap && stake >= minPlayableStake) {
        warnings.push(`Stake da ridurre: ${round(stake, 2)} > cap ${recommendedMaxStake}`);
        if (allowBet && status === 'APPROVED_STANDARD') status = 'APPROVED_STAKE_REDUCED';
    }

    if (allowBet && reasons.length === 0 && warnings.length === 0) {
        reasons.push('Gate professionale Tennis superato');
    }

    return {
        mode: 'TENNIS_PROFESSIONAL_BET_GATE',
        allowBet,
        professionalUse,
        status,
        blockType: blockType || (allowBet ? null : classifyTennisGateBlockType(status, reasons)),
        consensusGate,
        reasons: [...new Set(reasons)],
        warnings: [...new Set([...warnings, ...stakePolicyReasons])],
        marketType,
        calibrationGrade: calibrationGrade || 'UNKNOWN',
        dataSufficiencyScore: dataScore,
        valueScore: round(valueScore, 2),
        marketDisagreementPp: round(disagreement, 2),
        referenceMarketQuality: referenceMarket?.quality || null,
        stakePolicy: {
            mode: 'TENNIS_KELLY_FRACTIONAL_CONFIDENCE_V1',
            bankroll: round(bankroll, 2),
            requestedStake: round(stake, 2),
            minPlayableStake,
            maxStakePct,
            recommendedMaxStake,
            stakeWithinCap,
            stakePolicyReasons: [...new Set(stakePolicyReasons)]
        },
        limits: {
            minValueScore: limits.minValueScore,
            minDataScore,
            maxMarketDisagreementPp: limits.maxMarketDisagreementPp,
            requireMarkovForTotals: limits.requireMarkovForTotals,
            consensusGate: consensusLimits
        }
    };
}

// --------------------------------------------------------------------------
// 📦 EXPORTS
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// 📋 REPORT OPERATIVO FINALE TENNIS
// --------------------------------------------------------------------------
function normalizeOperationalStatus(gate = {}) {
    // STEP91 canonical status source: una sola gerarchia Gate per backend/UI/migrazioni.
    const status = String(gate.status || '').toUpperCase();
    const canonical = canonicalizeGateStatus({
        status: gate.status,
        label: gate.label,
        blockType: gate.blockType || classifyTennisGateBlockType(status, gate.reasons),
        allowBet: gate.allowBet,
        professionalUse: gate.professionalUse,
        action: gate.action
    });

    if (canonical.code === 'APPROVED_FULL_STAKE') {
        return { status: 'APPROVED_FULL_STAKE', action: 'BET_ALLOWED', label: canonical.label, severity: canonical.severity };
    }
    if (canonical.code === 'APPROVED') {
        return { status: 'APPROVED_STEP90', action: 'BET_ALLOWED_WITH_CAP', label: canonical.label, severity: canonical.severity };
    }
    if (canonical.code === 'APPROVED_WITH_CAP') {
        return { status: 'APPROVED_STANDARD', action: 'BET_ALLOWED_WITH_CAP', label: canonical.label, severity: canonical.severity };
    }
    if (canonical.code === 'WATCHLIST_MICRO') {
        return { status: 'WATCHLIST_MICRO_STAKE', action: 'PAPER_OR_MICRO_STAKE', label: canonical.label, severity: canonical.severity };
    }
    if (canonical.code === 'BLOCKED_SOFT') {
        return { status: status || 'BLOCKED_SOFT', action: 'NO_BET_REVIEW', label: canonical.label, severity: canonical.severity };
    }
    return { status: status || 'BLOCKED_HARD', action: 'NO_BET', label: canonical.label, severity: canonical.severity };
}


function buildTennisOperationalReport(input = {}, options = {}) {
    const evaluation = input.evaluation || input.valueEvaluation || {};
    const gate = input.professionalGate || input.gate || {};
    const calibrationDecision = input.predictiveCalibrationDecision || input.calibrationDecision || {};
    const dataSufficiency = input.dataSufficiency || {};
    const referenceMarket = input.referenceMarket || input.reference || {};
    const marketType = String(input.marketType || input.market_type || gate.marketType || 'moneyline').toLowerCase();
    const markovValidated = input.markovValidated ?? input.markov_validated ?? gate.markovValidated ?? null;
    const bankroll = Math.max(toNumber(input.bankroll ?? options.bankroll ?? 1000, 1000), 1);
    const requestedStake = toNumber(input.stake ?? input.requestedStake ?? 0, 0);
    const gateAllowsBet = gate.allowBet === true;
    const minPlayableStake = toNumber(gate.stakePolicy?.minPlayableStake ?? options.minPlayableStake ?? 2, 2);
    const gateMaxStake = toNumber(gate.stakePolicy?.recommendedMaxStake ?? gate.maxStake ?? null, null);
    const operationalMaxStake = gateAllowsBet
        ? (gateMaxStake !== null ? gateMaxStake : round(bankroll * 0.006, 2))
        : 0;
    const recommendedStake = gateAllowsBet
        ? (requestedStake > 0 ? Math.min(requestedStake, operationalMaxStake) : operationalMaxStake)
        : 0;

    const normalized = normalizeOperationalStatus(gate);

    const edgePp = toNumber(evaluation.edge_pp ?? evaluation.adjusted_edge_pp ?? evaluation.edge, 0);
    const evPct = toNumber(evaluation.ev_pct ?? evaluation.adjusted_ev_pct ?? evaluation.expectedValue, 0);
    const probabilityPct = toNumber(
        evaluation.calibrated_probability_pct ??
        evaluation.calibratedProbability ??
        evaluation.model_probability_pct ??
        evaluation.modelProbability,
        0
    );
    const valueScore = toNumber(gate.valueScore ?? evaluation.valueScore ?? evaluation.scores?.valueScore, 0);
    const dataScore = toNumber(gate.dataSufficiencyScore ?? dataSufficiency.score, null);
    const marketDisagreementPp = toNumber(
        gate.marketDisagreementPp ??
        evaluation.marketDisagreementPp ??
        evaluation.disagreement ??
        evaluation.audit?.disagreement,
        0
    );

    const calibrationGrade = String(gate.calibrationGrade || calibrationDecision.grade || 'UNKNOWN').toUpperCase();
    const clvPct = toNumber(input.clvPct ?? input.clv_pct ?? calibrationDecision.avgClvPct, null);
    const clvBeatRatePct = toNumber(input.clvBeatRatePct ?? calibrationDecision.clvBeatRatePct, null);

    const checks = [
        {
            key: 'value',
            label: 'Value / EV',
            status: evaluation.valid === true && edgePp > 0 && evPct > 0 ? 'PASS' : 'FAIL',
            detail: `Edge ${round(edgePp, 2)}pp · EV ${round(evPct, 2)}% · Prob ${round(probabilityPct, 2)}%`
        },
        {
            key: 'data_sufficiency',
            label: 'Dati giocatori',
            status: dataSufficiency.passed === true || (dataScore !== null && dataScore >= (marketType === 'totals' ? 85 : 65)) ? 'PASS' : 'FAIL',
            detail: dataScore === null ? 'Score non disponibile' : `Score ${round(dataScore, 1)}`
        },
        {
            key: 'calibration',
            label: 'Calibrazione predittiva',
            status: calibrationGrade === 'PROFESSIONAL_READY'
                ? 'PASS'
                : (calibrationGrade === 'WATCHLIST_LIMITED_STAKE' ? 'WARN' : 'FAIL'),
            detail: calibrationDecision.recommendation || calibrationGrade
        },
        // STEP91_QUOTE_REFERENCE_AND_MODEL_CORRELATION_SPLIT
        {
            key: 'quote_reference',
            label: 'CR quote / Reference',
            status: referenceMarket && referenceMarket.quality ? 'PASS' : 'WARN',
            detail: referenceMarket && referenceMarket.quality
                ? `Reference ${referenceMarket.quality}${referenceMarket.source ? ` · ${referenceMarket.source}` : ''}`
                : 'Reference quote assente o incompleta'
        },
        {
            key: 'model_market_correlation',
            label: 'Correlazione modello/mercato',
            status: Math.abs(marketDisagreementPp) <= 14 ? 'PASS' : 'FAIL',
            detail: `Gap modello/mercato ${round(marketDisagreementPp, 2)}pp${Math.abs(marketDisagreementPp) > 14 ? ' > soglia 14pp' : ' entro soglia 14pp'}`
        },
        {
            key: 'markov_totals',
            label: 'Markov totals',
            status: marketType === 'totals'
                ? (markovValidated === true ? 'PASS' : 'FAIL')
                : 'PASS',
            detail: marketType === 'totals'
                ? (markovValidated === true ? 'Markov validato' : 'Totals bloccato senza Markov')
                : 'Non richiesto per moneyline'
        },
        {
            key: 'stake_cap',
            label: 'Stake operativo',
            status: requestedStake <= 0 || (requestedStake >= minPlayableStake && requestedStake <= operationalMaxStake) ? 'PASS' : 'WARN',
            detail: `Stake richiesto ${round(requestedStake, 2)} · min ${round(minPlayableStake, 2)} · cap ${round(operationalMaxStake, 2)}`
        },
        {
            key: 'closing_line',
            label: 'CLV storico aggregato',
            status: clvPct === null ? 'WARN' : (clvPct >= 0 ? 'PASS' : 'WARN'),
            detail: clvPct === null
                ? 'CLV corrente escluso dal pre-match'
                : `CLV ${round(clvPct, 2)}%${clvBeatRatePct !== null ? ` · Beat ${round(clvBeatRatePct, 1)}%` : ''}`
        }
    ];

    const failCount = checks.filter(c => c.status === 'FAIL').length;
    const warnCount = checks.filter(c => c.status === 'WARN').length;

    let summary = normalized.label === 'BLOCCATA SOFT'
        ? 'Pronostico Tennis in blocco soft: non usare a stake reale finché non arriva consenso DeepScan/edge, ma può essere rivalutato.'
        : 'Pronostico Tennis bloccato hard: non usare a stake reale.';
    if (normalized.action === 'BET_ALLOWED') {
        summary = 'Pronostico Tennis approvato per uso professionale con stake entro cap.';
    } else if (normalized.action === 'BET_ALLOWED_WITH_CAP') {
        summary = 'Pronostico Tennis approvato solo con stake controllato e monitoraggio CLV.';
    } else if (normalized.action === 'PAPER_OR_MICRO_STAKE') {
        summary = normalized.label.includes('DEEPSCAN')
            ? 'DeepScan conferma, ma il Consensus Gate limita il pronostico a micro-stake/paper trading.'
            : 'Pronostico Tennis in watchlist: usare solo paper trading o micro stake.';
    }

    const reasons = Array.isArray(gate.reasons) ? gate.reasons : [];
    const warnings = Array.isArray(gate.warnings) ? gate.warnings : [];
    const operationalStakePolicyReasons = Array.isArray(gate.stakePolicy?.stakePolicyReasons)
        ? gate.stakePolicy.stakePolicyReasons
        : [];

    return {
        mode: 'TENNIS_OPERATIONAL_REPORT_V1',
        status: normalized.status,
        action: normalized.action,
        label: normalized.label,
        severity: normalized.severity,
        summary,
        allowBet: gateAllowsBet,
        professionalUse: gate.professionalUse === true,
        blockType: gate.blockType || null,
        consensusGate: gate.consensusGate || null,
        marketType,
        value: {
            edge_pp: round(edgePp, 2),
            ev_pct: round(evPct, 2),
            probability_pct: round(probabilityPct, 2),
            valueScore: round(valueScore, 2)
        },
        calibration: {
            grade: calibrationGrade,
            sample: calibrationDecision.sample ?? null,
            requiredSample: calibrationDecision.requiredSample ?? null,
            brierScore: calibrationDecision.brierScore ?? null,
            calibrationError: calibrationDecision.calibrationError ?? null,
            clvBeatRatePct: calibrationDecision.clvBeatRatePct ?? clvBeatRatePct
        },
        data: {
            sufficiencyScore: dataScore,
            referenceMarketQuality: gate.referenceMarketQuality || referenceMarket.quality || null,
            markovValidated: markovValidated === true
        },
        stake: {
            bankroll: round(bankroll, 2),
            requestedStake: round(requestedStake, 2),
            minPlayableStake: round(minPlayableStake, 2),
            maxStake: round(operationalMaxStake, 2),
            recommendedStake: round(recommendedStake, 2),
            capApplied: requestedStake > operationalMaxStake
        },
        checks,
        failCount,
        warnCount,
        reasons: [...new Set(reasons)],
        warnings: [...new Set([...warnings, ...operationalStakePolicyReasons])],
        generatedAt: new Date().toISOString()
    };
}

module.exports = {
    TENNIS_VALUE_EVALUATOR_VERSION,
    TENNIS_METRIC_VERSION,
    MARKET_VALIDATION_CONFIG,
    DEFAULT_TENNIS_VALUE_CONFIG,
    DEFAULT_TENNIS_CALIBRATION_PROFESSIONAL_LIMITS,
    DEFAULT_TENNIS_PROFESSIONAL_GATE_LIMITS,
    DEFAULT_TENNIS_CONSENSUS_GATE_LIMITS,

    // Calcoli matematici base
    toNumber,
    clamp,
    round,
    clampNumber,
    normalizeTennisProbability,
    normalizeOdd,
    parseProbabilityPct,
    impliedProbability,
    calculateExpectedValuePct,
    calculateEdgePp,
    calculateFairOdd,
    calculateNoVigProbabilities,

    // Calibrazione
    buildTennisCalibrationContext,
    applyTennisProbabilityCalibration,
    fallbackConfidenceCalibration,
    buildTennisPredictiveCalibrationDecision,
    buildTennisProfessionalBetGate,
    buildTennisOperationalReport,
    normalizeDeepScanConsensusSignal,
    classifyTennisGateBlockType,
    canDeepScanConsensusUnlockMicro,

    // Reliability / risk adjustment
    getReliabilityMultiplier,
    adjustTennisEdgeByReliability,
    adjustTennisEvByReliability,
    getTennisReliabilityLevel,

    // Engine principale
    buildInvalidTennisEvaluation,
    evaluateTennisValueBet,

    // Compatibilità legacy
    validateTennisPrediction: evaluateTennisValueBet,
    evaluateTennisValue: evaluateTennisValueBet,
    evaluateValue: evaluateTennisValueBet,

    // Market
    calculateSharpConsensus,
    calculateMarketDisagreement,
    getCLVQualityScore,
    getMarketTrustScore,

    // Score
    calculateTennisValueScore
};

// STEP42_EVALUATOR_GATE_WRAPPER
// Wrapper non invasivo: se il modulo esporta funzioni che restituiscono una valutazione Tennis,
// normalizza il Gate in modalità hard-only senza toccare DeepScan advisory.
(function installStep42EvaluatorWrapper() {
  if (!module.exports || typeof module.exports !== 'object') return;

  const candidateNames = [
    'evaluateTennisValue',
    'evaluateValue',
    'evaluateTennisBet',
    'buildTennisOperationalReport',
    'buildProfessionalGate',
    'professionalGate',
    'evaluate'
  ];

  candidateNames.forEach((name) => {
    const original = module.exports[name];
    if (typeof original !== 'function' || original.__step42Wrapped) return;

    const wrapped = function step42WrappedEvaluator(...args) {
      const result = original.apply(this, args);
      if (result && typeof result.then === 'function') {
        return result.then((payload) => applyTennisGatePolicyStep42(payload, { force: true }));
      }
      return applyTennisGatePolicyStep42(result, { force: true });
    };

    wrapped.__step42Wrapped = true;
    module.exports[name] = wrapped;
  });

  module.exports.classifyTennisGateStep42 = classifyTennisGateStep42;
  module.exports.applyTennisGatePolicyStep42 = applyTennisGatePolicyStep42;
  module.exports.STEP42_VERSION = STEP42_VERSION;
})();
// /STEP42_EVALUATOR_GATE_WRAPPER
