'use strict';

const CALCIO_DEEPSCAN_PAYLOAD_VERSION = 'BETTING_PATCH_23_R2_CALCIO_DEEPSCAN_COMPACT_PAYLOAD_V1';
const CLIENT_TARGET_BYTES = 64 * 1024;
const SERVER_MAX_BYTES = 256 * 1024;
const EXPRESS_JSON_LIMIT = '512kb';

function finite(value, fallback = null) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function text(value, fallback = '') {
    if (value === undefined || value === null) return fallback;
    return String(value);
}

function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseJson(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch (_) { return fallback; }
}

function payloadBytes(value) {
    try { return Buffer.byteLength(JSON.stringify(value ?? {}), 'utf8'); }
    catch (_) { return Number.POSITIVE_INFINITY; }
}

function compactScalarMap(input, allowedKeys) {
    const source = plainObject(input);
    const result = {};
    for (const key of allowedKeys) {
        const value = source[key];
        if (value === undefined || value === null) continue;
        if (['string', 'number', 'boolean'].includes(typeof value)) result[key] = value;
    }
    return result;
}

function compactProbabilityIntegrity(input = {}, prediction = '') {
    const source = plainObject(input);
    const diagnostics = plainObject(source.diagnostics);
    const selected = plainObject(diagnostics[prediction]);
    return {
        ...compactScalarMap(source, [
            'version', 'coverageMode', 'reliability', 'maxDisagreementPp',
            'maxMonteCarloStdErrorPp', 'xgEvidenceMode', 'status'
        ]),
        selectedMarket: compactScalarMap(selected, [
            'monteCarloProbabilityPct', 'modelProbabilityPct', 'marketProbabilityPct',
            'finalProbabilityPct', 'disagreementPp', 'monteCarloStdErrorPp', 'status'
        ])
    };
}

function compactOpponentAdjustedForm(input = {}) {
    const source = plainObject(input);
    const expectedGoals = plainObject(source.expectedGoals);
    return {
        ...compactScalarMap(source, [
            'version', 'status', 'confidence', 'homePct', 'awayPct', 'capPct',
            'homeFactor', 'awayFactor', 'applied'
        ]),
        expectedGoals: compactScalarMap(expectedGoals, [
            'expHomeGoals', 'expAwayGoals', 'baseHomeGoals', 'baseAwayGoals',
            'homeFactor', 'awayFactor', 'applied', 'status', 'version'
        ])
    };
}

function compactClubElo(input = {}) {
    const source = plainObject(input);
    return compactScalarMap(source, [
        'status', 'available', 'authoritative', 'homeRating', 'awayRating',
        'ratingDifference', 'homeWinAdjustmentPp', 'awayWinAdjustmentPp',
        'source', 'version', 'error'
    ]);
}

function compactMultiProvider(input = {}) {
    const source = plainObject(input);
    return compactScalarMap(source, [
        'status', 'confidence', 'coveragePct', 'sourceCount', 'independentSources',
        'contradictions', 'version', 'reason'
    ]);
}

function compactPredictionReliability(input = {}) {
    const source = plainObject(input);
    return compactScalarMap(source, ['score', 'label', 'status', 'version', 'reason']);
}

function compactAnalysisStage(input = {}) {
    const source = plainObject(input);
    return compactScalarMap(source, ['status', 'label', 'reason', 'version', 'analysisOnly']);
}

function compactEventIdentity(input = {}) {
    const source = plainObject(input);
    return compactScalarMap(source, [
        'eventKey', 'canonicalPairKey', 'providerEventId', 'homeProviderName',
        'awayProviderName', 'homeCanonicalName', 'awayCanonicalName', 'status',
        'certified', 'version'
    ]);
}

function compactMarketProbabilities(input = {}) {
    const source = plainObject(input);
    const result = {};
    for (const key of ['1', 'X', '2', 'O2.5', 'U2.5', 'GG', 'NG']) {
        const value = finite(source[key], null);
        if (value !== null) result[key] = value;
    }
    return result;
}

function sanitizeExtData(input = {}, prediction = '') {
    const source = plainObject(input);
    return {
        ...compactScalarMap(source, [
            'league', 'competition', 'tournament', 'country', 'round', 'stage',
            'commenceTime', 'kickoff', 'matchDate', 'providerEventId', 'eventKey',
            'canonicalPairKey', 'homeProviderName', 'awayProviderName',
            'homeCsvName', 'awayCsvName', 'homeUnderstatName', 'awayUnderstatName',
            'homeXg', 'awayXg', 'homeUnderstatXg', 'awayUnderstatXg',
            'homeMatches', 'awayMatches', 'footballDataLoaded',
            'footballHistoryCoverageMode', 'teamHistoryMatched', 'understatLoaded',
            'understatDataAvailable', 'xgEvidenceMode', 'understatProviderVersion',
            'understatProviderStatus', 'understatSeason', 'understatAuthorityStatus',
            'reliabilityMode', 'lineupStatus', 'lineupsConfirmed', 'newsConfidence',
            'avgGoals', 'expectedGoals', 'xgTotal', 'marketVolatility', 'volatility',
            'mcGlobal', 'odd1', 'oddX', 'odd2', 'overOdd', 'underOdd',
            'defaultMarginPct', 'theoreticalStake', 'operationalStake',
            'providerTimeoutMs', 'deepScanTimeoutMs'
        ]),
        eventIdentity: compactEventIdentity(source.eventIdentity),
        probabilityIntegrity: compactProbabilityIntegrity(source.probabilityIntegrity, prediction),
        predictionReliability: compactPredictionReliability(source.predictionReliability),
        multiProviderEvidence: compactMultiProvider(source.multiProviderEvidence),
        clubEloEvidence: compactClubElo(source.clubEloEvidence),
        opponentAdjustedForm: compactOpponentAdjustedForm(source.opponentAdjustedForm),
        marketProbabilities: compactMarketProbabilities(source.marketProbabilities),
        analysisStage: compactAnalysisStage(source.analysisStage)
    };
}

function compactFromRow(row = {}, prediction = '') {
    const components = parseJson(row.calcio_prediction_index_components, {});
    const probability = plainObject(components.probability);
    const reliability = plainObject(components.reliability);
    const provenance = parseJson(row.calcio_odds_provenance_json, {});
    const selectedSource = plainObject(provenance.selectedSource);
    const marketProbabilities = {};
    const p = finite(row.estimated_prob, null);
    if (p !== null && prediction) marketProbabilities[prediction] = p;
    return {
        league: row.league || '',
        competition: row.league || '',
        kickoff: row.match_date || '',
        matchDate: row.match_date || '',
        providerEventId: selectedSource.providerEventId || row.provider_event_id || '',
        eventKey: row.match_exposure_key || row.calcio_event_key || '',
        footballDataLoaded: Boolean(row.calcio_data_reliability),
        xgEvidenceMode: row.calcio_xg_evidence_mode || '',
        marketProbabilities,
        probabilityIntegrity: {
            coverageMode: row.calcio_probability_coverage_mode || '',
            reliability: row.calcio_probability_reliability || '',
            selectedMarket: {
                monteCarloProbabilityPct: finite(probability.monteCarlo, null),
                modelProbabilityPct: finite(probability.model, null),
                marketProbabilityPct: finite(probability.marketProbability, null),
                finalProbabilityPct: finite(probability.probability, p)
            }
        },
        predictionReliability: {
            score: finite(row.calcio_prediction_reliability_score, finite(reliability.score, 0)),
            label: row.calcio_prediction_reliability_label || ''
        },
        theoreticalStake: finite(row.calcio_theoretical_stake ?? row.stake_theoretical, 0),
        operationalStake: finite(row.calcio_operational_stake ?? row.stake_operational ?? row.stake, 0)
    };
}

function mergeCompactContext(clientExtData = {}, row = {}, prediction = '') {
    const fromRow = compactFromRow(row, prediction);
    const fromClient = sanitizeExtData(clientExtData, prediction);
    const merged = {
        ...fromRow,
        ...fromClient,
        eventIdentity: { ...plainObject(fromRow.eventIdentity), ...plainObject(fromClient.eventIdentity) },
        probabilityIntegrity: {
            ...plainObject(fromRow.probabilityIntegrity),
            ...plainObject(fromClient.probabilityIntegrity),
            selectedMarket: {
                ...plainObject(fromRow.probabilityIntegrity?.selectedMarket),
                ...plainObject(fromClient.probabilityIntegrity?.selectedMarket)
            }
        },
        predictionReliability: {
            ...plainObject(fromRow.predictionReliability),
            ...plainObject(fromClient.predictionReliability)
        },
        marketProbabilities: {
            ...plainObject(fromRow.marketProbabilities),
            ...plainObject(fromClient.marketProbabilities)
        }
    };
    const sanitized = sanitizeExtData(merged, prediction);
    sanitized.probabilityIntegrity = {
        ...plainObject(sanitized.probabilityIntegrity),
        selectedMarket: {
            ...plainObject(fromRow.probabilityIntegrity?.selectedMarket),
            ...plainObject(fromClient.probabilityIntegrity?.selectedMarket),
            ...plainObject(sanitized.probabilityIntegrity?.selectedMarket)
        }
    };
    return sanitized;
}

function sanitizeRequestBody(body = {}, row = null) {
    const source = plainObject(body);
    const originalBytes = payloadBytes(source);
    if (originalBytes > SERVER_MAX_BYTES) {
        const error = new Error(`CALCIO_DEEPSCAN_PAYLOAD_TOO_LARGE:${originalBytes}`);
        error.code = 'CALCIO_DEEPSCAN_PAYLOAD_TOO_LARGE';
        error.httpStatus = 413;
        error.payloadBytes = originalBytes;
        error.maxBytes = SERVER_MAX_BYTES;
        throw error;
    }
    const prediction = text(source.prediction).trim();
    const result = {
        payloadVersion: CALCIO_DEEPSCAN_PAYLOAD_VERSION,
        homeTeam: text(source.homeTeam).trim(),
        awayTeam: text(source.awayTeam).trim(),
        prediction,
        eventKey: text(source.eventKey || source.matchExposureKey).trim() || null,
        matchExposureKey: text(source.matchExposureKey || source.eventKey).trim() || null,
        matchDate: text(source.matchDate).trim() || null,
        providerEventId: text(source.providerEventId).trim() || null,
        odd: finite(source.odd, null),
        prob: finite(source.prob, null),
        edge: finite(source.edge, finite(source.edge_pp, null)),
        edge_pp: finite(source.edge_pp, finite(source.edge, null)),
        ev_pct: finite(source.ev_pct, null),
        odd1: finite(source.odd1, null),
        oddX: finite(source.oddX, null),
        odd2: finite(source.odd2, null),
        extData: mergeCompactContext(source.extData, row || {}, prediction),
        diagnostics: {
            receivedPayloadVersion: text(source.payloadVersion || 'LEGACY'),
            originalBytes,
            compactBytes: 0,
            strippedLargeFields: true
        }
    };
    result.diagnostics.compactBytes = payloadBytes(result);
    return result;
}

function assertCompactPayload(payload = {}) {
    const bytes = payloadBytes(payload);
    return {
        ok: Number.isFinite(bytes) && bytes <= CLIENT_TARGET_BYTES,
        bytes,
        targetBytes: CLIENT_TARGET_BYTES,
        version: CALCIO_DEEPSCAN_PAYLOAD_VERSION
    };
}

module.exports = {
    CALCIO_DEEPSCAN_PAYLOAD_VERSION,
    CLIENT_TARGET_BYTES,
    SERVER_MAX_BYTES,
    EXPRESS_JSON_LIMIT,
    payloadBytes,
    sanitizeExtData,
    sanitizeRequestBody,
    assertCompactPayload,
    compactProbabilityIntegrity,
    compactOpponentAdjustedForm
};
