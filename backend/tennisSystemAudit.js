'use strict';

// STEP75_TENNIS_SYSTEM_AUDIT
// Audit end-to-end non mutante del funnel Tennis live.
// Non modifica quote, stake, gate, paper trading o database: classifica solo dove si ferma il flusso.

const STEP75_TENNIS_SYSTEM_AUDIT_MODE = 'STEP75_TENNIS_SYSTEM_AUDIT_V1';

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function safeBool(value) {
    return value === true || String(value).toLowerCase() === 'true';
}

function sumValues(obj = {}) {
    if (!obj || typeof obj !== 'object') return 0;
    return Object.values(obj).reduce((sum, value) => sum + safeNumber(value, 0), 0);
}

function topEntries(obj = {}, limit = 5) {
    if (!obj || typeof obj !== 'object') return [];
    return Object.entries(obj)
        .map(([key, value]) => ({ key, value: safeNumber(value, 0) }))
        .filter(row => row.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, limit);
}

function mergeCounts(...objects) {
    const out = {};
    for (const obj of objects) {
        if (!obj || typeof obj !== 'object') continue;
        for (const [key, value] of Object.entries(obj)) {
            out[key] = safeNumber(out[key], 0) + safeNumber(value, 0);
        }
    }
    return out;
}

function classifyBlockerGroup(groupText = '', codeText = '') {
    const text = `${groupText} ${codeText}`.toUpperCase();
    if (!text.trim()) return 'UNKNOWN';
    if (text.includes('CALIBRATION') || text.includes('RELIABILITY') || text.includes('BRIER') || text.includes('CLV')) return 'CALIBRATION_RELIABILITY';
    if (text.includes('DATA') || text.includes('SUFFICIENCY') || text.includes('SACKMANN') || text.includes('SAMPLE')) return 'DATA_SUFFICIENCY';
    if (text.includes('ODD') || text.includes('QUOTE') || text.includes('OUTLIER') || text.includes('EXTREME')) return 'ODDS_QUALITY';
    if (text.includes('EDGE') || text.includes('EV') || text.includes('STAKE') || text.includes('THRESHOLD')) return 'VALUE_GATE';
    if (text.includes('CR') || text.includes('CROSS')) return 'CROSS_REFERENCE';
    if (text.includes('MARKOV')) return 'MARKOV_TOTALS';
    if (text.includes('DEEPSCAN')) return 'DEEPSCAN';
    return text.split(/\s+/)[0] || 'UNKNOWN';
}

function getTopBlocker(candidateAudit = {}) {
    const step69Groups = Array.isArray(candidateAudit?.step69?.topBlockerGroups)
        ? candidateAudit.step69.topBlockerGroups
        : [];
    const step69Codes = Array.isArray(candidateAudit?.step69?.topDetailedRejectCodes)
        ? candidateAudit.step69.topDetailedRejectCodes
        : [];

    if (step69Groups.length) {
        const first = step69Groups[0];
        const code = step69Codes[0]?.key || '';
        return {
            group: first.key || 'UNKNOWN',
            code,
            normalizedGroup: classifyBlockerGroup(first.key, code),
            count: safeNumber(first.value, 0),
            source: 'STEP69'
        };
    }

    const hard = mergeCounts(candidateAudit?.rejectedHard?.moneyline, candidateAudit?.rejectedHard?.totals);
    const rejected = mergeCounts(candidateAudit?.rejected?.moneyline, candidateAudit?.rejected?.totals);
    const hardTop = topEntries(hard, 1)[0];
    const rejectedTop = topEntries(rejected, 1)[0];
    const top = hardTop || rejectedTop || null;

    if (!top) {
        return {
            group: 'UNKNOWN',
            code: '',
            normalizedGroup: 'UNKNOWN',
            count: 0,
            source: 'NONE'
        };
    }

    return {
        group: top.key,
        code: top.key,
        normalizedGroup: classifyBlockerGroup(top.key, top.key),
        count: top.value,
        source: hardTop ? 'REJECTED_HARD' : 'REJECTED'
    };
}

function getSettingsThresholds(settings = {}) {
    return {
        atp: {
            edgePct: safeNumber(settings.tennisAtpEdge, 3),
            probabilityPct: safeNumber(settings.tennisAtpProb, 40),
            evPct: safeNumber(settings.tennisAtpEv, 1)
        },
        wta: {
            edgePct: safeNumber(settings.tennisWtaEdge, 5),
            probabilityPct: safeNumber(settings.tennisWtaProb, 40),
            evPct: safeNumber(settings.tennisWtaEv, 1)
        }
    };
}

function thresholdsLookStrict(thresholds = {}) {
    const atp = thresholds.atp || {};
    const wta = thresholds.wta || {};
    return safeNumber(atp.edgePct, 0) > 5 ||
        safeNumber(wta.edgePct, 0) > 8 ||
        safeNumber(atp.probabilityPct, 0) > 55 ||
        safeNumber(wta.probabilityPct, 0) > 55 ||
        safeNumber(atp.evPct, 0) > 3 ||
        safeNumber(wta.evPct, 0) > 3;
}


function buildStep77SampleThresholdSnapshot(input = {}, analysisDiagnostics = {}) {
    const sampleThresholds = input.sampleThresholds || analysisDiagnostics.sampleThresholds || {};
    const professionalFromGuard = analysisDiagnostics?.reliabilityGuardrail?.requiredProfessionalSample;
    const professionalCalibrationMinSample = safeNumber(
        sampleThresholds.professionalCalibrationMinSample ?? professionalFromGuard,
        0
    );
    const closingLineValidationMinSample = safeNumber(
        sampleThresholds.closingLineValidationMinSample ?? input.professionalRules?.minClosingLineSample,
        0
    );
    return {
        mode: 'STEP77_SAMPLE_THRESHOLDS_SEPARATED',
        bootstrapMinSettledBetsForReliability: safeNumber(sampleThresholds.bootstrapMinSettledBetsForReliability, 0),
        backtestOptimizationMinSample: safeNumber(sampleThresholds.backtestOptimizationMinSample, 0),
        professionalCalibrationMinSample,
        segmentMinReliableSample: safeNumber(sampleThresholds.segmentMinReliableSample, 0),
        closingLineValidationMinSample,
        note: '50 e 150 non sono la stessa soglia: 50 = bootstrap/closing-line/minimo diagnostico; 150 = calibrazione professionale live.'
    };
}

function buildStep77CalibrationReliabilityBreakdown(candidateAudit = {}) {
    const breakdown = candidateAudit.reliabilityFailureBreakdown && typeof candidateAudit.reliabilityFailureBreakdown === 'object'
        ? candidateAudit.reliabilityFailureBreakdown
        : {};
    const samples = Array.isArray(candidateAudit.reliabilityFailureSamples)
        ? candidateAudit.reliabilityFailureSamples.slice(-8)
        : [];
    const topReasons = topEntries(breakdown, 8);
    return {
        mode: 'STEP77_RELIABILITY_FAILURE_BREAKDOWN',
        totalReasons: topReasons.reduce((sum, row) => sum + safeNumber(row.value, 0), 0),
        topReasons,
        samples,
        note: topReasons.length
            ? 'Il codice RELIABILITY_THRESHOLD_FAILED è stato esploso in sotto-cause diagnostiche.'
            : 'Nessun breakdown reliability disponibile: il blocco può avvenire prima della valutazione candidati audit.'
    };
}

function buildTennisSystemAudit(input = {}) {
    const analysisDiagnostics = input.analysisDiagnostics || {};
    const candidateAudit = analysisDiagnostics.candidateAudit || {};
    const settings = input.settings || {};
    const events = analysisDiagnostics.events || {};
    const api = analysisDiagnostics.api || {};
    const candidates = analysisDiagnostics.candidates || {};
    const evaluatedMl = safeNumber(candidateAudit?.evaluated?.moneyline, 0);
    const evaluatedTotals = safeNumber(candidateAudit?.evaluated?.totals, 0);
    const evaluatedTotal = evaluatedMl + evaluatedTotals;
    const rawOperational = safeNumber(candidates.moneylineRaw, 0) + safeNumber(candidates.totalsRaw, 0);
    const selected = safeNumber(candidates.selected, 0);
    const returned = safeNumber(candidates.returned, 0);
    const oddsEvents = safeNumber(api.oddsEvents, 0);
    const processedWithModel = safeNumber(events.processedWithModel, 0);
    const skippedDataSufficiency = safeNumber(events.skippedDataSufficiency, 0);
    const skippedNoH2H = safeNumber(events.skippedNoH2H, 0);
    const skippedNoReferenceMarket = safeNumber(events.skippedNoReferenceMarket, 0);
    const topBlocker = getTopBlocker(candidateAudit);
    const thresholds = getSettingsThresholds(settings);
    const thresholdStrict = thresholdsLookStrict(thresholds);
    const useTotals = safeBool(input.useTotals ?? analysisDiagnostics?.config?.useTotals);
    const useMarkov = safeBool(input.useMarkov ?? analysisDiagnostics?.config?.useMarkov);
    const professionalMode = safeBool(input.professionalMode ?? analysisDiagnostics?.config?.professionalMode);
    const guardrailActive = safeBool(analysisDiagnostics?.reliabilityGuardrail?.active);
    const historicalBootstrap = input.tennisReliabilityReport?.historicalBootstrap || analysisDiagnostics.historicalBootstrapReliability || null;
    const historicalBootstrapActive = safeBool(historicalBootstrap?.active);
    const realReliabilityReport = input.tennisRealReliabilityReport || analysisDiagnostics.realReliabilitySnapshot || null;
    const valueBets = Array.isArray(input.formattedBets) ? input.formattedBets.length : returned;
    const sampleThresholdSnapshot = buildStep77SampleThresholdSnapshot(input, analysisDiagnostics);
    const calibrationReliabilityBreakdown = buildStep77CalibrationReliabilityBreakdown(candidateAudit);

    let flowStatus = 'UNKNOWN';
    let primaryBlocker = {
        code: 'UNKNOWN',
        label: 'Blocco non classificato',
        detail: 'Diagnostica insufficiente per classificare il blocco.'
    };
    let noResultReason = analysisDiagnostics.noResultReason || 'UNKNOWN';

    if (valueBets > 0 || returned > 0) {
        flowStatus = 'HAS_VALUE_BETS';
        primaryBlocker = {
            code: 'NONE',
            label: 'Value bet presenti',
            detail: 'Il sistema ha prodotto almeno una selezione.'
        };
        noResultReason = 'HAS_VALUE_BETS';
    } else if (safeNumber(api.oddsErrors, 0) > 0 && oddsEvents === 0) {
        flowStatus = 'PROVIDER_OR_ODDS_ERROR';
        primaryBlocker = {
            code: 'ODDS_PROVIDER',
            label: 'Provider quote / API',
            detail: 'Il provider non ha restituito eventi quote validi o ha prodotto errori.'
        };
        noResultReason = 'ODDS_API_ERRORS_OR_NO_ODDS_EVENTS';
    } else if (oddsEvents === 0) {
        flowStatus = 'NO_PROVIDER_MATCHES';
        primaryBlocker = {
            code: 'NO_ODDS_EVENTS',
            label: 'Nessun match dal provider quote',
            detail: 'Non ci sono eventi quote disponibili nel feed interrogato.'
        };
        noResultReason = 'NO_ODDS_EVENTS_RETURNED_BY_PROVIDER';
    } else if (processedWithModel === 0) {
        flowStatus = 'PRE_MODEL_PRECHECK_BLOCK';
        primaryBlocker = {
            code: skippedNoH2H > 0 ? 'NO_H2H_MARKET' : (skippedNoReferenceMarket > 0 ? 'NO_REFERENCE_MARKET' : 'MODEL_PRECHECK'),
            label: 'Blocco prima del modello',
            detail: 'Gli eventi arrivano dal feed ma non superano H2H/reference/precheck.'
        };
        noResultReason = 'NO_MATCH_PASSED_H2H_REFERENCE_AND_MODEL_PRECHECKS';
    } else if (evaluatedTotal > 0 && rawOperational === 0) {
        flowStatus = 'AUDIT_CANDIDATES_ONLY';
        primaryBlocker = {
            code: topBlocker.normalizedGroup,
            label: topBlocker.normalizedGroup === 'CALIBRATION_RELIABILITY'
                ? 'Calibrazione / reliability blocca il passaggio operativo'
                : `Candidati audit-only bloccati da ${topBlocker.group}`,
            detail: `${evaluatedTotal} candidati sono stati valutati in audit, ma nessuno è diventato candidato operativo raw. Primo gruppo: ${topBlocker.group || 'N/D'}${topBlocker.code ? ` · codice ${topBlocker.code}` : ''}.`
        };
        noResultReason = topBlocker.normalizedGroup === 'CALIBRATION_RELIABILITY'
            ? 'NO_OPERATIVE_CANDIDATE_CALIBRATION_BLOCK'
            : 'NO_OPERATIVE_CANDIDATE_AFTER_AUDIT_GATE';
    } else if (rawOperational > 0 && selected === 0) {
        flowStatus = 'SELECTION_OR_EXPOSURE_BLOCK';
        primaryBlocker = {
            code: 'SELECTION_EXPOSURE_GATE',
            label: 'Candidati operativi presenti ma non selezionati',
            detail: 'Il blocco avviene dopo la creazione candidati raw, in selezione finale/exposure guard.'
        };
        noResultReason = 'CANDIDATES_EXIST_BUT_NOT_RETURNED_AFTER_SELECTION_OR_EXPOSURE_GUARD';
    } else if (skippedDataSufficiency >= processedWithModel && processedWithModel > 0 && evaluatedTotal === 0) {
        flowStatus = 'DATA_SUFFICIENCY_BLOCK';
        primaryBlocker = {
            code: 'DATA_SUFFICIENCY',
            label: 'Data sufficiency',
            detail: 'Gli eventi sono processati ma vengono fermati per campione/dati giocatore/superficie insufficienti prima della valutazione candidate audit.'
        };
        noResultReason = 'NO_CANDIDATE_CREATED_DUE_DATA_SUFFICIENCY';
    } else {
        flowStatus = 'VALUE_OR_STAKE_GATE_ZERO';
        primaryBlocker = {
            code: 'VALUE_GATE_OR_STAKE',
            label: 'Gate valore/stake',
            detail: 'Il feed e il modello lavorano, ma non emergono candidati selezionabili.'
        };
        noResultReason = 'NO_CANDIDATE_PASSED_EDGE_EV_CR_STAKE_GATE';
    }

    const thresholdVerdict = evaluatedTotal > 0 && rawOperational === 0 && primaryBlocker.code === 'CALIBRATION_RELIABILITY'
        ? 'NON_PRIMARIO: le soglie Edge/Prob/EV non sono il primo blocco; il blocco è calibrazione/reliability.'
        : (thresholdStrict
            ? 'DA_MONITORARE: soglie configurate potenzialmente severe, verificare insieme ai codici blocco.'
            : 'NON_SEVERO: soglie Edge/Prob/EV attive risultano permissive o moderate rispetto al blocco osservato.');

    const deepScanVerdict = primaryBlocker.code === 'DEEPSCAN'
        ? 'POSSIBILE_BLOCCO_DEEPSCAN: verificare report operativo e action DeepScan.'
        : 'NON_PRIMARIO: DeepScan non risulta il blocco principale del funnel live; il blocco avviene prima/dentro gate audit/calibrazione.';

    const totalsVerdict = useTotals
        ? 'ATTIVO: totals richiesti; controllare diagnostica Step50A/50B per Over/Under.'
        : 'DISATTIVO_DA_SETUP: Over/Under non sono interrogati se tennisUseTotals/useTotals=false.';

    const matchesVerdict = oddsEvents > 0
        ? `CI_SONO_MATCH: provider ha restituito ${oddsEvents} eventi quote e ${processedWithModel} sono arrivati al modello.`
        : 'NESSUN_MATCH_PROVIDER: il feed non ha restituito eventi quote.';

    return {
        mode: STEP75_TENNIS_SYSTEM_AUDIT_MODE,
        purpose: 'Audit end-to-end non mutante per capire se zero pick dipende da feed, precheck, data sufficiency, calibrazione, DeepScan, soglie o selezione finale.',
        flowStatus,
        noResultReason,
        matchesVerdict,
        primaryBlocker,
        topBlocker,
        funnel: {
            oddsEvents,
            eventsSeen: safeNumber(events.seen, 0),
            processedWithModel,
            skippedDataSufficiency,
            skippedNoH2H,
            skippedNoReferenceMarket,
            auditCandidatesEvaluated: evaluatedTotal,
            auditMoneylineEvaluated: evaluatedMl,
            auditTotalsEvaluated: evaluatedTotals,
            rawOperationalCandidates: rawOperational,
            selectedCandidates: selected,
            returnedCandidates: returned,
            savedAttempts: safeNumber(candidates.savedAttempts, 0)
        },
        gateVerdicts: {
            thresholds: thresholdVerdict,
            deepScan: deepScanVerdict,
            totals: totalsVerdict,
            reliabilityGuardrail: guardrailActive
                ? 'ATTIVO: Step63 guardrail è attivo e può bloccare/limitare candidati.'
                : 'NON_ATTIVO: Step63 guardrail non sta applicando veto hard in questa analisi.',
            professionalMode: professionalMode
                ? 'ATTIVO: gate professionale/calibrazione possono bloccare il trading reale.'
                : 'DISATTIVO: professional mode non risulta attivo.',
            historicalBootstrap: historicalBootstrapActive
                ? 'ATTIVO: il value evaluator usa storico ATP/WTA Sackmann finché la reliability reale non supera sample/Brier/gap/CLV.'
                : 'NON_ATTIVO: la calibrazione reale CURRENT/CURRENT_BOOTSTRAP è già considerata idonea.'
        },
        configSnapshot: {
            useMarkov,
            useTotals,
            useCR: safeBool(input.useCR ?? analysisDiagnostics?.config?.useCR),
            professionalMode,
            thresholds,
            markovSelfCheckOk: input.markovSelfCheck ? (input.markovSelfCheck.ok !== false && input.markovSelfCheck.status !== 'ERROR') : null,
            reliabilitySampleSize: safeNumber(input.tennisReliabilityReport?.sampleSize ?? analysisDiagnostics?.reliabilityGuardrail?.sampleSize, 0),
            effectiveReliabilityMode: input.tennisReliabilityReport?.mode || analysisDiagnostics?.historicalBootstrapReliability?.mode || 'UNKNOWN',
            historicalBootstrapActive,
            historicalBootstrapSample: safeNumber(historicalBootstrap?.snapshot?.sample ?? input.tennisReliabilityReport?.historicalSampleSize, 0),
            realReliabilitySampleSize: safeNumber(realReliabilityReport?.sampleSize, 0),
            realReliabilityBrier: safeNumber(realReliabilityReport?.brier?.avgBrier ?? realReliabilityReport?.brier, 0),
            realReliabilityCalibrationError: safeNumber(realReliabilityReport?.calibration?.summary?.weightedCalibrationError ?? realReliabilityReport?.calibrationError, 0),
            requiredProfessionalSample: sampleThresholdSnapshot.professionalCalibrationMinSample,
            sampleThresholds: sampleThresholdSnapshot,
            closingLineValidationMinSample: sampleThresholdSnapshot.closingLineValidationMinSample,
            bootstrapMinSettledBetsForReliability: sampleThresholdSnapshot.bootstrapMinSettledBetsForReliability
        },
        calibrationReliabilityBreakdown,
        checks: [
            { area: 'Feed/API quote', status: oddsEvents > 0 && safeNumber(api.oddsErrors, 0) === 0 ? 'OK' : 'CHECK', detail: `${oddsEvents} eventi quote, ${safeNumber(api.oddsErrors, 0)} errori.` },
            { area: 'H2H / reference market', status: skippedNoH2H === 0 && skippedNoReferenceMarket === 0 ? 'OK' : 'CHECK', detail: `No H2H ${skippedNoH2H}, no reference ${skippedNoReferenceMarket}.` },
            { area: 'Data sufficiency', status: skippedDataSufficiency > 0 ? 'CHECK' : 'OK', detail: `${skippedDataSufficiency} eventi segnalati.` },
            { area: 'Candidate audit', status: evaluatedTotal > 0 ? 'OK' : 'CHECK', detail: `${evaluatedTotal} candidati audit valutati.` },
            { area: 'Operatività reale', status: rawOperational > 0 ? 'OK' : 'BLOCKED', detail: `${rawOperational} candidati raw operativi.` },
            { area: 'DeepScan', status: primaryBlocker.code === 'DEEPSCAN' ? 'CHECK' : 'OK', detail: deepScanVerdict },
            { area: 'Totals', status: useTotals ? 'OK' : 'INFO', detail: totalsVerdict }
        ],
        suggestedAction: historicalBootstrapActive
            ? 'Step78 attivo: usa lo storico ATP/WTA Sackmann come reliability temporanea per alimentare paper/live bootstrap. Non abbassare Edge/Prob/EV; il sistema tornerà automaticamente alla reliability reale quando sample, Brier, gap e CLV saranno idonei.'
            : (primaryBlocker.code === 'CALIBRATION_RELIABILITY'
                ? 'Non abbassare subito Edge/Prob/EV: leggi prima Soglie campione separate e Breakdown reliability/calibrazione Step77. Se manca CLV/closing-line o il segmento non è professionale, mantenere cap/micro stake.'
                : (primaryBlocker.code === 'DATA_SUFFICIENCY'
                    ? 'Aggiungere breakdown Data Sufficiency per player/superficie/sample e verificare mapping nomi Sackmann.'
                    : 'Leggere il funnel Step75: intervenire solo sul primo blocco non OK, evitando modifiche contemporanee a modello/stake/gate.')),
        warnings: [
            'Audit informativo: non modifica selezione, stake, salvataggio, DeepScan o DB.',
            'Se flowStatus=AUDIT_CANDIDATES_ONLY non significa che non ci siano match: significa che esistono candidati teorici ma sono bloccati prima del trading reale.'
        ]
    };
}

module.exports = {
    STEP75_TENNIS_SYSTEM_AUDIT_MODE,
    buildTennisSystemAudit,
    _private: {
        classifyBlockerGroup,
        getTopBlocker,
        thresholdsLookStrict
    }
};
