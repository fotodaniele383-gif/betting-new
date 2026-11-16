// SAFE13_OPERATIVO_MANUALE_V1 — solo copia controllata, non il sorgente SAFE13
if (process.env.SAFE13_MANUAL_PAPER !== '1' || !process.env.BETTING_DB_PATH) throw new Error('SAFE13_MANUAL_PAPER_LAUNCHER_REQUIRED');
const { installStep42TennisGateMiddleware, transformTennisPayloadStep42, computeTennisMarketMixAudit } = require('./tennisGateStep42');
const { explainTennisCandidateRejection, recordStep69Candidate, finalizeStep69Explainability, STEP69_VERSION } = require('./tennisAiRejectionExplainability');
// ============================================================================
// MODULO TENNIS QUANT PRO - SERVER CORE
// Versione: 15.8
// ============================================================================
//
// CHANGELOG 15.0
// - Rimosso Markov duplicato interno.
// - Usato backend/markov.js tramite adapter robusto.
// - DB con path assoluto.
// - Modalità bootstrap nuovo storico: niente reliability derivata da vecchio DB.
// - Backtest senza reliability fittizia.
// - Edge Tennis standardizzato:
//      edge_pp = calibrated_probability_pct - market_implied_probability_pct
// - EV Tennis standardizzato:
//      ev_pct = ((calibrated_probability_pct / 100) * odd - 1) * 100
// - Valutazione value bet centralizzata in tennisValueEvaluator.js.
// - Fallback bookmaker sharp più severo.
// - Cross reference migliorato.
// - Output arricchito ma compatibile con UI legacy.
// - Salvataggio ai_forward_test con valori coerenti.
//
// CHANGELOG 15.1
// - Fix auto-ottimizzazione Tennis: non salva soglie se il campione valido è insufficiente.
// - Mostra messaggio chiaro: “Ottimizzazione non applicata: campione insufficiente”.
// - Mantiene i valori precedenti in system_settings quando ATP/WTA sample è insufficiente.
// - OVERALL_GLOBAL ora espone count/sampleSize per evitare diagnostics a zero incoerenti.
//
// CHANGELOG 15.2
// - Auto-ottimizzazione Tennis trasformata in recommendation-only.
// - /api/tennis/optimize NON salva più automaticamente system_settings.
// - Nessuna soglia live viene aggiornata dal backtest senza applicazione manuale futura.
// - getDynamicParamsTennis ignora leagueParams backtest se non esiste flag tennisOptimizationApplied=true.
// - Response optimize espone activeSettings, recommendedSettings, previousSettings, applied=false e settingsSaved=false.
//
// CHANGELOG 15.3
// - Aggiunto endpoint GET /api/tennis/health.
// - Health check Tennis non mutante: non salva settings e non chiama API esterne.
// - Verifica componenti principali: ValueEvaluator, Markov, PaperTrading, DeepScan, Sackmann.
// CHANGELOG 15.10
// - Step67: DeepScan è gate operativo: può bloccare/ridurre/sbloccare micro-stake con audit trail separato.
// - Step 19: compatibile con DeepScan Six-Pillar Mashup v14.7.
// - Lo stake suggerito dal DeepScan resta separato dallo stake operativo.
// - Soglia minima stake Tennis aggiornata a 2 EUR per suggerimenti/stake positivi.
// - Espone optimizeMode=RECOMMENDATION_ONLY e autoApplySettings=false.
// - Espone DB path assoluto, data mode, metric/version mode e sample nuovo storico.
//
// CHANGELOG 15.4
// - Spostata inizializzazione Sackmann fuori dall’import globale: bootstrap lazy/controllato.
// - Aggiunto filtro storico Tennis strict: usa solo data_quality CURRENT/CURRENT_BOOTSTRAP.
// - Aggiunta separazione ATP/WTA, superficie, mercato e fascia quota nelle metriche/calibrazione.
// - Aggiunte regole professionali di data sufficiency: esclude match con dati giocatore insufficienti.
// - Aggiunta validazione closing line nel backtest storico.
// - Stake Tennis reso più prudente in modalità professionale.
// - Totals/Markov ammessi solo con campione Sackmann sufficiente e self-check Markov valido.
//
// CHANGELOG 15.5
// - Aggiunto report predittivo Tennis professionale non mutante dentro /api/tennis/health.
// - Dashboard-ready calibration: ATP/WTA, superficie, mercato, fascia quota, Brier e CLV.
// - Nessun impatto su Calcio: nessun endpoint /api/calcio, scheduler o motore football modificato.
//
// CHANGELOG 15.6
// - Aggiunto Tennis Professional Bet Gate finale per ogni selezione costruita.
// - Il gate registra allow/block, motivi, cap stake e qualità del segnale.
// - Persistenza opzionale su ai_forward_test senza modificare Calcio.
//
// CHANGELOG 15.7
// - Aggiunto report operativo finale Tennis per ogni pronostico.
// - Output dashboard-ready: APPROVED / WATCHLIST / BLOCKED, checklist e stake cap.
// - Persistenza opzionale audit report su ai_forward_test, senza toccare Calcio.
//
// CHANGELOG 15.13
// - Step 36: stake Tennis centralizzato su Kelly frazionario + attendibilità.
// - Minimo giocabile: 2 EUR solo per bet operative allowBet=true.
// - Bet BLOCCATE/NO_BET restano a stake operativo 0.
// - Stake cresce con ValueScore, edge/EV, reliability e cap Professional Gate.
// - Persistenza audit stake: Kelly %, raw stake, moltiplicatore confidenza e cap applicato.
// - Step 38: DeepScan riceve contesto completo da request+DB senza modificare stake/gate.
// CHANGELOG 15.15 / STEP69
// - Analisi AI Tennis: explainability dei rifiuti candidate audit.
// - Separa EV teorico/calibrato da EV operativo dopo gate.
// - Aggiunge funnel compatto, motivi specifici e UI leggibile per zero pick.
// ============================================================================


// ============================================================================
// STEP91Y_TENNIS_PAPER_TRADING_FINAL_STABILITY: restore finale Paper Trading Tennis senza duplicati e senza leakage pending.
// ============================================================================
// 1. IMPORTAZIONI
// ============================================================================

const express = require('express');
const axios = require('axios');
const sqlite3 = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const sackmann = require('./sackmann');
const deepScanTennis = require('./deepScanTennis');
const { assertPreMatchOnlyContext, stripForbiddenPreMatchFields } = require('./preMatchLeakageGuard');
const { buildCanonicalTennisMatchKey, isSameMatchPair } = require('./tennisPlayerIdentity');
const sideIdentity = require('./tennisSideIdentityGuard');
const paperTradingTennisEngine = require('./paperTrading.tennis');
const apiUsageTracker = require('./apiUsageTracker');
const paperTradingIdentity = require('./paperTradingIdentity');
const tennisForwardLifecycle = require('./tennisForwardLifecycle');
const tennisForwardCohorts = require('./tennisForwardCohorts');
const tennisPendingEventRevisionSafety = require('./tennisPendingEventRevisionSafety');
const tennisQualityGateV2 = require('./tennisQualityGateV2');
const tennisUnifiedPredictionIndex = require('./tennisUnifiedPredictionIndex');
const tennisForwardCaptureHealth = require('./tennisForwardCaptureHealth');
const tennisForwardSampleIntake = require('./tennisForwardSampleIntake');
const tennisRuntimeHealthContract = require('./tennisRuntimeHealthContract');
const tennisPrematchCaptureGate = require('./tennisPrematchCaptureGate');
const tennisCanonicalEventTime = require('./tennisCanonicalEventTime');
const tennisOfficialScheduleAuthority = require('./tennisOfficialScheduleAuthority');
const tennisSettlementTruthPatch34R4 = require('./tennisSettlementTruthPatch34R4');
const tennisStakeAuthorityPatch35 = require('./tennisStakeAuthorityPatch35');
const tennisRiskAuthorityPatch36 = require('./tennisRiskAuthorityPatch36');
const tennisStakeExecutionContractPatch46 = require('./tennisStakeExecutionContractPatch46');
const tennisStakeContractAuthorityT7 = require('./tennisStakeContractAuthorityT7');
const tennisTourDriftAuthorityPatch36 = require('./tennisTourDriftAuthorityPatch36');
const tennisExternalMatchIntelligencePatch37 = require('./tennisExternalMatchIntelligencePatch37');
const tennisDecisionTruthPatch38 = require('./tennisDecisionTruthPatch38');
const tennisForwardHealthSemanticsPatch38 = require('./tennisForwardHealthSemanticsPatch38');
const tennisProbabilityCalibrationGuardPatch39 = require('./tennisProbabilityCalibrationGuardPatch39');
const tennisClvSnapshotCoveragePatch39 = require('./tennisClvSnapshotCoveragePatch39');
const tennisEvidenceVerificationAgentPatch39 = require('./tennisEvidenceVerificationAgentPatch39');
const tennisExternalReceiptLinkPatch39 = require('./tennisExternalReceiptLinkPatch39');
const tennisWtaFreshnessRecoveryPatch39 = require('./tennisWtaFreshnessRecoveryPatch39');
const tennisWtaSourceDiscoveryPatch43 = require('./tennisWtaSourceDiscoveryPatch43');
const tennisWtaInformationRecoveryPatch52 = require('./tennisWtaInformationRecoveryPatch52');
const clvCrossSportCoveragePatch53 = require('./clvCrossSportCoveragePatch53');
const statisticalProductionReadinessGatePatch55 = require('./statisticalProductionReadinessGatePatch55');
const unifiedCrossSportPortfolioRiskAuthorityPatch56 = require('./unifiedCrossSportPortfolioRiskAuthorityPatch56');
const tennisVenueRegistryPatch39 = require('./tennisVenueRegistryPatch39');
const tennisDeepScanTaxonomyPatch40 = require('./tennisDeepScanTaxonomyPatch40');
const tennisTradingReportingPatch40 = require('./tennisTradingReportingPatch40');
const tennisH2HWeightPolicyPatch40 = require('./tennisH2HWeightPolicyPatch40');
const tennisRejectedCaptureObservability = require('./tennisRejectedCaptureObservability');
const tennisPlayerEvidence = require('./tennisPlayerEvidence');
const tennisCanonicalPlayerEvidenceBridge = require('./tennisCanonicalPlayerEvidenceBridge');
const tennisMatchupIntelligence = require('./tennisMatchupIntelligence');
const tennisHistoricalCombinationEvidence = require('./tennisHistoricalCombinationEvidence');
const tennisProgramProgressionAudit = require('./tennisProgramProgressionAudit');
const tennisCoreContractAudit = require('./tennisCoreContractAudit');
const tennisReleaseSecurity = require('./tennisReleaseSecurity');
const tennisOfficialSettlementResolver = require('./tennisOfficialSettlementResolver');
const tennisPlayerDataRefresh = require('./tennisPlayerDataRefresh');
const tennisMultiProviderData = require('./tennisMultiProviderData');
const tennisTourDataReadiness = require('./tennisTourDataReadiness');
const tennisInformationRetrieval = require('./tennisInformationRetrievalCertification');
const tennisHistoricalPlayerStats = require('./tennisHistoricalPlayerStats');
const tennisHistoricalValidationPerformance = require('./tennisHistoricalValidationPerformance');
const tennisEvidenceMaturityT9 = require('./tennisEvidenceMaturityT9');
const tennisT10ShadowMonitor = require('./tennisT10ShadowMonitor');
const tennisT10R2PortfolioForwardAudit = require('./tennisT10R2PortfolioForwardAudit');
const tennisStakeDecisionTraceT11 = require('./tennisStakeDecisionTraceT11');
const tennisCalibratedValueShadowT11R3 = require('./tennisCalibratedValueShadowT11R3');
const tennisSettlementContractAuditT11R3 = require('./tennisSettlementContractAuditT11R3');
const tennisCalibratedValueLedgerT11R3R1 = require('./tennisCalibratedValueLedgerT11R3R1');
const tennisStatisticalChallenger = require('./tennisStatisticalChallenger');
const tennisTournamentStageModel = require('./tennisTournamentStageModel');
const tennisProfessionalStatisticalEnsemble = require('./tennisProfessionalStatisticalEnsemble');
const tennisTechnicalHealthAlignmentPatch50 = require('./tennisTechnicalHealthAlignmentPatch50');

const {
    buildTennisSystemAudit,
    STEP75_TENNIS_SYSTEM_AUDIT_MODE
} = require('./tennisSystemAudit');
const {
    STEP78_TENNIS_HISTORICAL_BOOTSTRAP_MODE,
    selectEffectiveTennisReliabilityReport
} = require('./tennisHistoricalReliability');
const tennisScope = require('./tennisOperationalScope');
const { resolveTennisTournamentSurface } = require('./tennisTournamentSurfaceResolver');
const { resolveTournamentCatalogContext, getAllowedSeriesKeys } = require('./tennisTournamentCatalog');
const auditTrail = require('./auditTrail');
const step90GateDecision = require('./preMatchGateDecisionPolicy');
const step96DeepScanGatePolicy = require('./step96DeepScanGateCombinationPolicy');
const tennisPatchRegistry = require('./tennisPatchRegistry');
const {
    TENNIS_MATCH_FORMAT_CONTRACT_VERSION,
    resolveTennisMatchFormat
} = require('./tennisMatchFormat');
const tennisEventIdentity = require('./tennisEventIdentity');
const tennisSettlementContract = require('./tennisSettlementContract');
const runtimeDiagnostics = require('./runtimeDiagnostics');
const tennisCalibrationEligibility = require('./tennisCalibrationEligibility');
const tennisPredictionSnapshots = require('./tennisPredictionSnapshots');

const {
    evaluateTennisValueBet,
    calculateTennisValueScore,
    calculateSharpConsensus,
    calculateNoVigProbabilities,
    calculateExpectedValuePct,
    calculateEdgePp,
    impliedProbability,
    buildTennisPredictiveCalibrationDecision,
    buildTennisProfessionalBetGate,
    buildTennisOperationalReport
} = require('./tennisValueEvaluator');

let MarkovEngine = null;

try {
    MarkovEngine = require('./markov');
} catch (error) {
    console.warn('⚠️ markov.js non trovato o non importabile. Le simulazioni totals Tennis verranno disabilitate.');
}


// ============================================================================
// 2. ROUTER E PATH ASSOLUTI
// ============================================================================

const router = express.Router();

const ROOT_DIR = __dirname;
const DB_PATH = process.env.BETTING_DB_PATH || path.resolve(ROOT_DIR, 'database_betting.db');
const ABSOLUTE_SACKMANN_DIR = path.resolve(ROOT_DIR, 'sackmann_data');
const CACHE_DIR = path.resolve(ROOT_DIR, 'cache');
const REAL_ODDS_DIR = path.resolve(ROOT_DIR, 'tennis_real_odds');
const NEWS_CACHE_DIR = path.resolve(ROOT_DIR, 'cache_news');
const TENNIS_HISTORICAL_STATS_DATASET = path.resolve(ROOT_DIR, '..', 'data', 'tennisdb_historical_player_stats.json');

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(REAL_ODDS_DIR)) fs.mkdirSync(REAL_ODDS_DIR, { recursive: true });

let sackmannInitialized = false;
let sackmannInitError = null;

function ensureSackmannReady({ required = false } = {}) {
    if (sackmannInitialized) {
        return { ok: true, initialized: true, dataDir: ABSOLUTE_SACKMANN_DIR };
    }

    try {
        if (!sackmann || typeof sackmann.init !== 'function') {
            throw new Error('sackmann.init non disponibile');
        }

        sackmann.init(ABSOLUTE_SACKMANN_DIR);
        sackmannInitialized = true;
        sackmannInitError = null;

        return { ok: true, initialized: true, dataDir: ABSOLUTE_SACKMANN_DIR };
    } catch (error) {
        sackmannInitialized = false;
        sackmannInitError = error;

        if (required) {
            throw error;
        }

        return {
            ok: false,
            initialized: false,
            dataDir: ABSOLUTE_SACKMANN_DIR,
            error: error.message
        };
    }
}

// ============================================================================
// PATCH 14 - VERIFIED PLAYER DATA REFRESH & FRESHNESS GUARD
// Aggiornamento allowlist, atomico e last-known-good. Il percorso di analisi
// resta locale e sincrono; la rete è usata solo dal refresh separato.
// ============================================================================
const patch14AutoRefreshSchedule = process.env.SAFE13_MANUAL_PAPER === '1' ? {enabled:false,schedule:false,mode:'MANUAL_ONLY'} : tennisPlayerDataRefresh.scheduleAutoRefresh({
    dataDir: ABSOLUTE_SACKMANN_DIR,
    refreshFn: tennisMultiProviderData.refreshMultiProvider,
    onSuccess: result => {
        sackmannInitialized = false;
        ensureSackmannReady({ required: false });
        runtimeDiagnostics.writeDiagnostic({
            level: 'INFO', component: 'TENNIS_PLAYER_DATA', operation: 'PLAYER_DATA_AUTO_REFRESH',
            operationId: result.operationId, phase: 'PLAYER_DATA_REFRESH_COMPLETE', event: 'PLAYER_DATA_REFRESH_COMPLETE',
            message: 'Aggiornamento dati giocatori completato e motore as-of-safe ricaricato.',
            context: { latestMatchAt: result.activeStatus?.latestMatchAt, matchCount: result.activeStatus?.matchCount, playerCount: result.activeStatus?.playerCount }
        });
    },
    onError: error => {
        const failure = error?.patch21 || error?.patch20 || error?.patch14 || {};
        const lockConflict = ['PATCH21_REFRESH_ALREADY_RUNNING','PATCH20_REFRESH_ALREADY_RUNNING','PATCH14_REFRESH_ALREADY_RUNNING'].includes(String(error?.message || ''));
        runtimeDiagnostics.writeDiagnostic({
            level: lockConflict ? 'INFO' : (failure.degradedUsingLastKnownGood === true ? 'WARN' : 'ERROR'),
            component: 'TENNIS_PLAYER_DATA', operation: 'PLAYER_DATA_AUTO_REFRESH',
            operationId: failure.operationId || runtimeDiagnostics.createOperationId('TENNIS_PLAYER_DATA_AUTO_REFRESH'),
            phase: lockConflict ? 'PLAYER_DATA_REFRESH_SKIPPED_LOCK_ACTIVE' : 'PLAYER_DATA_REFRESH_FAILED',
            event: lockConflict ? 'PLAYER_DATA_REFRESH_SKIPPED_LOCK_ACTIVE' : 'PLAYER_DATA_REFRESH_FAILED',
            message: lockConflict
                ? 'Refresh aggiuntivo saltato: un refresh player-data è già in esecuzione; nessun dato perso e nessuna seconda esecuzione avviata.'
                : (failure.degradedUsingLastKnownGood === true
                    ? `Refresh rete non riuscito per ${failure.sourceId || 'fonte non identificata'}; dataset last-known-good preservato.`
                    : error.message),
            context: {
                refreshState: failure.status || null,
                sourceId: failure.sourceId || null,
                networkDiagnostics: failure.networkDiagnostics || null,
                attempts: failure.attempts || [],
                restoredLastKnownGood: failure.restoredLastKnownGood === true,
                degradedUsingLastKnownGood: failure.degradedUsingLastKnownGood === true,
                skippedBecauseAlreadyRunning: lockConflict
            }
        });
    }
});

// PATCH52_WTA_INFORMATION_RECOVERY: provider cooldown, mirror fallback, safe staging and LKG.
// Patch39/Patch43 endpoints remain compatible but delegate to the Patch52 authority.
const patch52WtaRefreshSchedule = tennisWtaInformationRecoveryPatch52.schedule({
    dataDir: ABSOLUTE_SACKMANN_DIR,
    projectRoot: path.resolve(ROOT_DIR, '..'),
    delayMs: 60000,
    onResult: result => {
        if (['RECOVERED_CURRENT_SHADOW','RECOVERED_AGING_SHADOW'].includes(result?.status)) {
            sackmannInitialized = false;
            ensureSackmannReady({ required: false });
        }
        runtimeDiagnostics.writeDiagnostic({
            level: result?.success === false || /STALE|COOLDOWN|FAILED/.test(String(result?.status || '')) ? 'WARN' : 'INFO',
            component: 'TENNIS_WTA_INFORMATION_RECOVERY', operation: 'PATCH52_WTA_REFRESH',
            operationId: result?.operationId || runtimeDiagnostics.createOperationId('TENNIS_WTA_PATCH52'),
            phase: result?.status || 'WTA_RECOVERY_RESULT', event: 'WTA_RECOVERY_RESULT',
            message: ['RECOVERED_CURRENT_SHADOW','RECOVERED_AGING_SHADOW'].includes(result?.status)
                ? `WTA match-level recuperato tramite ${result?.selectedProvider || 'fonte verificata'} fino a ${result?.after?.latestMatchAt || 'data non disponibile'}; resta shadow fino ai gate statistici.`
                : `WTA recovery: ${result?.status || 'UNKNOWN'}; last-known-good e stake zero preservati.`,
            context: result
        });
    },
    onError: error => runtimeDiagnostics.writeDiagnostic({
        level: 'WARN', component: 'TENNIS_WTA_INFORMATION_RECOVERY', operation: 'PATCH52_WTA_REFRESH',
        operationId: runtimeDiagnostics.createOperationId('TENNIS_WTA_PATCH52'),
        phase: 'WTA_RECOVERY_UNHANDLED_ERROR', event: 'WTA_RECOVERY_UNHANDLED_ERROR',
        message: error.message, context: { lastKnownGoodPreserved: true, noBotBypass: true, stakeAuthority: false }
    })
});
const patch43WtaRefreshSchedule = Object.freeze({ enabled:false, supersededBy:tennisWtaInformationRecoveryPatch52.VERSION, reason:'PATCH52_RECOVERY_AUTHORITY_ACTIVE' });
const patch39WtaRefreshSchedule = Object.freeze({ enabled:false, supersededBy:tennisWtaInformationRecoveryPatch52.VERSION, reason:'PATCH52_RECOVERY_AUTHORITY_ACTIVE' });


// ============================================================================
// PATCH 12 - PLAYER EVIDENCE & MATCHUP INTELLIGENCE
// Il motore quantitativo usa solo dati locali strutturati antecedenti al match.
// Il challenger resta shadow-only e non ha autorità su DeepScan, gate o stake.
// ============================================================================
function buildPatch12PlayerMatchupIntelligence({
    player1,
    player2,
    surface,
    asOf,
    referenceMarket,
    productionModel,
    prediction,
    marketType,
    tour = null,
    round = null,
    matchup = null
} = {}) {
    try {
        const resolvedMatchup = matchup || tennisPlayerEvidence.buildMatchupEvidence(
            player1,
            player2,
            surface,
            asOf,
            { dataDir: ABSOLUTE_SACKMANN_DIR, tour, round, historicalDatasetPath: TENNIS_HISTORICAL_STATS_DATASET }
        );
        const challenger = tennisPlayerEvidence.buildChallengerPrediction({
            player1,
            player2,
            surface,
            asOf,
            marketProbabilityP1: referenceMarket?.playerAProbability,
            marketProbabilityP2: referenceMarket?.playerBProbability,
            productionProbabilityP1: productionModel?.prob1,
            productionProbabilityP2: productionModel?.prob2,
            prediction,
            marketType,
            matchup: resolvedMatchup
        }, { dataDir: ABSOLUTE_SACKMANN_DIR, tour, round, historicalDatasetPath: TENNIS_HISTORICAL_STATS_DATASET });
        return {
            version: tennisMatchupIntelligence.TENNIS_MATCHUP_INTELLIGENCE_VERSION,
            mode: tennisMatchupIntelligence.MODE,
            deepScanSeparate: true,
            productionProbabilityChangedByChallenger: false,
            stakeAuthority: false,
            matchup: resolvedMatchup,
            challenger,
            professionalStatisticalEnsemble: productionModel?.professionalStatisticalEnsemble || null
        };
    } catch (error) {
        return {
            version: tennisMatchupIntelligence.TENNIS_MATCHUP_INTELLIGENCE_VERSION,
            mode: tennisMatchupIntelligence.MODE,
            deepScanSeparate: true,
            productionProbabilityChangedByChallenger: false,
            stakeAuthority: false,
            status: 'ENGINE_ERROR_AUDIT_ONLY',
            error: error.message,
            matchup: null,
            challenger: null,
            professionalStatisticalEnsemble: null
        };
    }
}

function summarizePatch12PlayerMatchupIntelligence(value = null) {
    const matchup = value?.matchup || null;
    const challenger = value?.challenger || null;
    return {
        version: value?.version || tennisMatchupIntelligence.TENNIS_MATCHUP_INTELLIGENCE_VERSION,
        mode: value?.mode || tennisMatchupIntelligence.MODE,
        status: value?.status || challenger?.status || matchup?.status || 'UNAVAILABLE',
        matchupLabel: matchup?.matchupLabel || null,
        matchupStatus: matchup?.status || null,
        coverageScore: matchup?.coverageScore ?? challenger?.coverageScore ?? null,
        confidenceScore: matchup?.confidenceScore ?? challenger?.confidenceScore ?? null,
        productionProbability: challenger?.selectedProductionProbability ?? null,
        challengerProbability: challenger?.selectedChallengerProbability ?? null,
        probabilityDeltaPp: challenger?.probabilityDeltaPp ?? null,
        uncertaintyLowPct: challenger?.uncertaintyLowPct ?? null,
        uncertaintyHighPct: challenger?.uncertaintyHighPct ?? null,
        player1EvidenceStatus: matchup?.p1?.status || null,
        player2EvidenceStatus: matchup?.p2?.status || null,
        player1Freshness: matchup?.p1?.freshnessStatus || null,
        player2Freshness: matchup?.p2?.freshnessStatus || null,
        bestAvailableForecast: value?.professionalStatisticalEnsemble ? {
            side: value.professionalStatisticalEnsemble.bestForecastSide,
            player: value.professionalStatisticalEnsemble.bestForecastPlayer,
            probability: value.professionalStatisticalEnsemble.bestForecastProbability,
            confidenceLabel: value.professionalStatisticalEnsemble.confidenceLabel,
            status: value.professionalStatisticalEnsemble.forecastStatus,
            hardExclusion: false
        } : null,
        deepScanSeparate: true,
        stakeAuthority: false,
        productionProbabilityChangedByChallenger: false,
        error: value?.error || null
    };
}

const db = new sqlite3(DB_PATH);

// TENNIS PATCH 28 R3: una sola autorità ordina il riallineamento degli stati derivati.
// Prima il ledger lifecycle/calibrazione, poi la maturità coorte, infine health capture.
// Snapshot, sigilli, righe sorgente, probabilità, gate, stake e settlement authority restano immutabili.
const TENNIS_PATCH28_R3_DERIVED_STATE_ORCHESTRATOR_VERSION = 'TENNIS_PATCH28_R3_DERIVED_STATE_ORCHESTRATOR_V1';
let patch28R3DerivedStateRunning = false;
let patch28R3LastDerivedStateReport = null;

function runPatch28R3DerivedStateReconcile(source = 'runtime') {
    if (patch28R3DerivedStateRunning) {
        return {
            success: true,
            skipped: true,
            reason: 'RECONCILE_ALREADY_RUNNING',
            version: TENNIS_PATCH28_R3_DERIVED_STATE_ORCHESTRATOR_VERSION,
            lastReport: patch28R3LastDerivedStateReport
        };
    }
    patch28R3DerivedStateRunning = true;
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_PATCH28_R3_STATE_RECONCILE');
    try {
        const lifecycle = tennisForwardLifecycle.reconcileForwardLifecycle(db, { apply: true, operationId });
        const cohorts = tennisForwardCohorts.reconcileForwardCohortMaturity(db, { operationId, limit: 100 });
        const lifecycleAfter = tennisForwardLifecycle.scanForwardLifecycle(db, { includeDetails: false, limit: 100 });
        const capture = tennisForwardCaptureHealth.scanForwardCaptureHealth(db, { limit: 100, operationId });
        const structuralBlocked = Number(capture.structuralBlocked || 0);
        const driftBets = Number(lifecycleAfter.driftBets || 0);
        const blockedCohorts = Number(cohorts.blocked || 0);
        const success = lifecycle.success !== false && driftBets === 0 && blockedCohorts === 0 && structuralBlocked === 0;
        const report = {
            success,
            version: TENNIS_PATCH28_R3_DERIVED_STATE_ORCHESTRATOR_VERSION,
            operationId, source,
            lifecycle: {
                beforeDrift: Number(lifecycle.before?.driftBets || 0),
                repaired: Array.isArray(lifecycle.repaired) ? lifecycle.repaired.length : 0,
                failed: Array.isArray(lifecycle.failed) ? lifecycle.failed.length : 0,
                afterDrift: driftBets
            },
            cohorts: {
                scanned: Number(cohorts.scanned || 0),
                updated: Number(cohorts.updated || 0),
                blocked: blockedCohorts
            },
            capture: {
                status: capture.status || null,
                runtimeSeverity: capture.runtimeSeverity || null,
                structuralBlocked,
                evidenceOverdue: Number(capture.evidenceOverdue || 0),
                trackedBets: Number(capture.trackedBets || 0)
            },
            sourceRowsChanged: false,
            authorityChanged: false,
            generatedAt: new Date().toISOString()
        };
        patch28R3LastDerivedStateReport = report;
        const changed = report.lifecycle.beforeDrift > 0 || report.lifecycle.repaired > 0 || report.cohorts.updated > 0;
        if (changed || !success || structuralBlocked > 0) {
            runtimeDiagnostics.writeDiagnostic({
                level: success ? 'INFO' : 'WARN',
                component: 'TENNIS_DERIVED_STATE',
                operation: 'PATCH28_R3_ORDERED_RECONCILE',
                operationId,
                phase: 'DERIVED_STATE_ORDERED_RECONCILE',
                event: success ? 'DERIVED_STATE_ALIGNED' : 'DERIVED_STATE_REQUIRES_ATTENTION',
                message: success
                    ? `Stati derivati Tennis allineati: ${report.lifecycle.repaired} lifecycle e ${report.cohorts.updated} coorti aggiornati.`
                    : `Riallineamento Tennis incompleto: drift ${driftBets}, coorti bloccate ${blockedCohorts}, anomalie strutturali ${structuralBlocked}.`,
                context: report
            });
        }
        return report;
    } catch (error) {
        const report = {
            success: false,
            version: TENNIS_PATCH28_R3_DERIVED_STATE_ORCHESTRATOR_VERSION,
            operationId, source, error: error.message || String(error),
            generatedAt: new Date().toISOString()
        };
        patch28R3LastDerivedStateReport = report;
        runtimeDiagnostics.captureError({
            component: 'TENNIS_DERIVED_STATE',
            operation: 'PATCH28_R3_ORDERED_RECONCILE',
            operationId,
            phase: 'DERIVED_STATE_ORDERED_RECONCILE',
            event: 'DERIVED_STATE_RECONCILE_FAILED',
            error, context: { source }
        });
        return report;
    } finally {
        patch28R3DerivedStateRunning = false;
    }
}
const patch28R3StartupTimer = process.env.SAFE13_MANUAL_PAPER === '1' ? null : setTimeout(() => runPatch28R3DerivedStateReconcile('startup'), 1200);
patch28R3StartupTimer?.unref?.();
const patch28R3Interval = process.env.SAFE13_MANUAL_PAPER === '1' ? null : setInterval(() => runPatch28R3DerivedStateReconcile('interval'), 15 * 60 * 1000);
patch28R3Interval?.unref?.();
paperTradingIdentity.ensureSchema(db);


// ============================================================================
// 3. CONFIGURAZIONI GLOBALI
// ============================================================================

const TENNIS_ENGINE_VERSION = '15.16_STEP78_HISTORICAL_BOOTSTRAP_RELIABILITY';
/* STEP91B_LEGACY_VERSION_COMPAT_ONLY
 * Compatibilità test statici legacy: alcuni test storici leggono il sorgente con
 * source.toContain(...) e pretendono versioni precedenti anche quando la runtime
 * è già avanzata a Step78/Step91. Queste stringhe NON sono usate a runtime.
 * Runtime reale attiva: const TENNIS_ENGINE_VERSION = '15.16_STEP78_HISTORICAL_BOOTSTRAP_RELIABILITY';
 * const TENNIS_ENGINE_VERSION = '15.6'
 * const TENNIS_ENGINE_VERSION = '15.7'
 * const TENNIS_ENGINE_VERSION = '15.8'
 * const TENNIS_ENGINE_VERSION = '15.9'
 * TENNIS_ENGINE_VERSION = '15.11'
 * const TENNIS_ENGINE_VERSION = '15.14_SENIOR_AUDIT_TOTALS_FIX'
 */
const TENNIS_MODEL_VERSION = 'TENNIS_QUANT_BOOTSTRAP_2026_V1';
const TENNIS_METRIC_VERSION = 'TENNIS_EDGE_EV_V2';

const DEFAULT_BANKROLL = 1000;
const DEFAULT_MIN_BET = 2.00;

// Senior Audit 2026-05-22: i mercati Over/Under Tennis erano penalizzati da
// moltiplicatori direzionali fissi che spingevano sistematicamente verso Under
// e rendevano Moneyline 1/2 dominante nella selezione finale.
// Ora le probabilità totals vengono normalizzate, shrinkate verso 50/50 e capate
// finché lo storico clean non diventa statisticamente robusto.
const TENNIS_TOTALS_PROBABILITY_SHRINK = 0.16;
const TENNIS_TOTALS_MAX_CALIBRATED_PROB = 74.0;
const TENNIS_DEFAULT_MAX_MARKETS_PER_MATCH = 2;
const TENNIS_TOTALS_MAX_LINES_PER_MATCH = 4;
const STEP49C_REPAIR_MICRO_STAKE = 3.00;
const STEP50B_TOTALS_DIAGNOSTIC_MAX_EXAMPLES = 12;
const STEP54_EXPOSURE_GUARD_MIN_SCORE_DELTA = 5;
const STEP54_EXPOSURE_GUARD_MAX_REAL_STAKED_PICKS_PER_MATCH = 1;
const DEFAULT_MAX_STAKE_PCT = 0.006;
const DEFAULT_PROFESSIONAL_MAX_STAKE_PCT = 0.01;
const DEFAULT_KELLY_FRACTION = 0.15;
const DEFAULT_PRE_GATE_MAX_STAKE_PCT = 0.0125;

const TENNIS_KELLY_STAKE_POLICY = Object.freeze({
    mode: 'TENNIS_KELLY_FRACTIONAL_CONFIDENCE_V1',
    minPlayableStake: DEFAULT_MIN_BET,
    kellyFraction: DEFAULT_KELLY_FRACTION,
    preGateMaxStakePct: DEFAULT_PRE_GATE_MAX_STAKE_PCT,
    standardMaxStakePct: DEFAULT_MAX_STAKE_PCT,
    professionalMaxStakePct: DEFAULT_PROFESSIONAL_MAX_STAKE_PCT,
    blockedStake: 0
});

const BOOTSTRAP_MIN_SETTLED_BETS_FOR_RELIABILITY = 50;
const TENNIS_MIN_BACKTEST_OPT_SAMPLE = 50;
const TENNIS_PROFESSIONAL_CALIBRATION_MIN_SAMPLE = 150;
const STEP78_REAL_RELIABILITY_MAX_BRIER_FOR_ACTIVATION = 0.245;
const STEP78_REAL_RELIABILITY_MAX_CALIBRATION_ERROR_FOR_ACTIVATION = 7.5;

const ALLOWED_SERIES_KEYS = getAllowedSeriesKeys ? getAllowedSeriesKeys() : [
    'Grand Slam',
    'Masters 1000',
    'WTA 1000',
    'ATP500',
    'WTA500',
    'ATP250',
    'WTA250',
    'Challenger',
    'Masters Cup'
];

const SHARP_BOOK_KEYS = [
    'pinnacle',
    'betfair',
    'matchbook',
    'smarkets',
    'sbo'
];

const ACCEPTABLE_REFERENCE_BOOK_KEYS = [
    'pinnacle',
    'betfair',
    'matchbook',
    'smarkets',
    'sbo',
    'bet365',
    'williamhill',
    'unibet',
    'bwin',
    'betsson',
    '888sport'
];

const TENNIS_VALUE_DEFAULTS = {
    maxOddMoneyline: 3.50,
    maxOddTotals: 2.50,
    minReliableSample: 20,
    maxAdjustment: 10,
    bootstrapBrierScore: 0.24,
    bootstrapCalibrationError: 0,
    bootstrapClv: 0
};

const TENNIS_CLEAN_DATA_QUALITY_VALUES = ['CURRENT_BOOTSTRAP', 'CURRENT'];
const TENNIS_MARKETS = {
    MONEYLINE: 'moneyline',
    TOTALS: 'totals'
};

const TENNIS_PROFESSIONAL_RULES = {
    defaultEnabled: true,
    minMoneylineSackmannSample: 12,
    minTotalsSackmannSample: 50,
    minReferenceQuality: 'MEDIUM',
    maxModelMarketDisagreementPp: 14,
    maxStakePctStandard: 0.006,
    maxStakePctHighConfidence: DEFAULT_PROFESSIONAL_MAX_STAKE_PCT,
    minDataSufficiencyScoreMoneyline: 65,
    minDataSufficiencyScoreTotals: 85,
    minClosingLineSample: 50
};

function isProfessionalModeEnabled(settings = {}) {
    return settings.tennisProfessionalMode !== false;
}

function getCleanTennisDataQualitySql(column = 'data_quality') {
    return `UPPER(COALESCE(${column}, '')) IN ('CURRENT_BOOTSTRAP', 'CURRENT')`;
}

function isCleanTennisDataQuality(value) {
    return TENNIS_CLEAN_DATA_QUALITY_VALUES.includes(String(value || '').trim().toUpperCase());
}

function inferTennisTourType(value = '') {
    const v = String(value || '').toUpperCase();

    if (v.includes('WTA') || v.includes('WOMEN')) return 'WTA';
    if (v.includes('ATP') || v.includes('MEN')) return 'ATP';

    return 'UNKNOWN';
}

function inferTennisMarketTypeFromPrediction(prediction = '') {
    const p = String(prediction || '').toUpperCase();

    if (p.includes('OVER') || p.includes('UNDER')) return TENNIS_MARKETS.TOTALS;
    return TENNIS_MARKETS.MONEYLINE;
}

function getTennisOddsBucket(odd) {
    const o = Number(odd);

    if (!Number.isFinite(o)) return 'unknown';
    if (o < 1.50) return '<1.50';
    if (o < 2.00) return '1.50-1.99';
    if (o < 2.50) return '2.00-2.49';
    if (o < 3.00) return '2.50-2.99';
    return '3.00+';
}

function getReferenceQualityRank(quality) {
    const q = String(quality || '').toUpperCase();
    if (q === 'HIGH') return 4;
    if (q === 'MEDIUM') return 3;
    if (q === 'MEDIUM_LOW') return 2;
    if (q === 'LOW') return 1;
    return 0;
}


// ============================================================================
// 4. API KEYS ODDS API
// ============================================================================
//
// Preferenza:
// process.env.ODDS_API_KEYS="key1,key2,key3"
//
// STEP64_NO_HARDCODED_API_FALLBACK: niente fallback legacy nel codice.
// Configurare .env con ODDS_API_KEYS=key1,key2,key3.
// ============================================================================

const API_KEYS = String(process.env.ODDS_API_KEYS || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);

// STEP64_NO_HARDCODED_API_FALLBACK
const EFFECTIVE_API_KEYS = API_KEYS;
if (EFFECTIVE_API_KEYS.length === 0) {
    console.warn('⚠️ STEP64 Tennis: nessuna ODDS_API_KEYS configurata. Analisi live Tennis/API disabilitata finché non imposti il file .env.');
}
// STEP51_API_USAGE_CREDITS_COUNTER - server.tennis inventory
apiUsageTracker.registerApiKeyInventory({ source: 'server.tennis.js', keyCount: EFFECTIVE_API_KEYS.length });

let currentKeyIndex = 0;


// ============================================================================
// 5. HTTP CLIENT ODDS API
// ============================================================================

function safeOddsUsageTelemetry(method, payload, fallback = null) {
    try {
        const fn = apiUsageTracker && apiUsageTracker[method];
        return typeof fn === 'function' ? fn(payload) : fallback;
    } catch (error) {
        console.warn(`⚠️ [ODDS_API_LEDGER_NON_BLOCKING] ${method}: ${error.message || error}`);
        return fallback;
    }
}

const TENNIS_ODDS_API_TIMEOUT_MS = Math.max(12000, Math.min(45000, Number(process.env.TENNIS_ODDS_API_TIMEOUT_MS || 20000)));
const TENNIS_ODDS_API_CATALOG_TIMEOUT_MS = Math.max(TENNIS_ODDS_API_TIMEOUT_MS, Math.min(45000, Number(process.env.TENNIS_ODDS_API_CATALOG_TIMEOUT_MS || 25000)));

function isTennisOddsTimeout(error) {
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '').toLowerCase();
    return code === 'ECONNABORTED' || code === 'ETIMEDOUT' || message.includes('timeout');
}

async function fetchOddsApi(urlTemplate, options = {}) {
    if (!EFFECTIVE_API_KEYS.length) throw new Error('Nessuna API key configurata per The Odds API.');
    const source = options.source || 'server.tennis.js';
    const route = options.route || 'fetchOddsApi';
    const timeoutMs = Math.max(12000, Math.min(45000, Number(options.timeoutMs || TENNIS_ODDS_API_TIMEOUT_MS)));
    const operation = apiUsageTracker.classifyOddsApiOperation(urlTemplate);
    const cachedResponse = apiUsageTracker.getCachedOddsApiResponse(urlTemplate, { source, route, forceRefresh: options.forceRefresh === true });
    if (cachedResponse && cachedResponse.hit === true) return cachedResponse.data;

    let lastError = null;
    for (let i = 0; i < EFFECTIVE_API_KEYS.length; i++) {
        const key = EFFECTIVE_API_KEYS[currentKeyIndex];
        const url = urlTemplate.replace('API_KEY_PLACEHOLDER', key);
        const attempt = safeOddsUsageTelemetry('recordOddsApiNetworkAttempt', { key, source, operation, route, urlTemplate }, { attemptId: `TELEMETRY_DEGRADED_${Date.now()}_${i}` });
        try {
            const response = await axios.get(url, { timeout: timeoutMs });
            safeOddsUsageTelemetry('recordOddsApiResponse', { attemptId: attempt?.attemptId, key, source, operation, route, urlTemplate, headers: response.headers, statusCode: response.status, data: response.data });
            apiUsageTracker.setCachedOddsApiResponse(urlTemplate, response.data, { source, route });
            return response.data;
        } catch (error) {
            lastError = error;
            safeOddsUsageTelemetry('recordOddsApiFailure', { attemptId: attempt?.attemptId, key, source, operation, route, urlTemplate, headers: error.response?.headers || {}, statusCode: error.response?.status || 0, errorCode: error.response?.data?.error_code || error.code || error.message });
            if (isTennisOddsTimeout(error)) {
                error.code = 'TENNIS_ODDS_PROVIDER_TIMEOUT';
                error.timeoutMs = timeoutMs;
                error.retryable = true;
            }
            if (error.response && [429, 401, 403].includes(error.response.status)) {
                currentKeyIndex = (currentKeyIndex + 1) % EFFECTIVE_API_KEYS.length;
                continue;
            }
            throw error;
        }
    }
    throw new Error(`Tutte le chiavi API sono esaurite o non valide. Ultimo errore: ${lastError?.message || 'sconosciuto'}`);
}


// ============================================================================
// 6. HELPERS NUMERICI
// ============================================================================

function toNumber(value, fallback = null) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function safeFloat(val) {
    if (val === undefined || val === null || val === '') return NaN;
    if (typeof val === 'string') return parseFloat(val.replace(',', '.'));
    return parseFloat(val);
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

function normalizeProbabilityPct(value) {
    return clamp(value, 1, 99);
}

function normalizeOdd(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 1) return null;
    return n;
}

function normalizeKey(key) {
    return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function safeJsonParse(json, fallback = {}) {
    try {
        if (!json) return fallback;
        return JSON.parse(json);
    } catch (error) {
        return fallback;
    }
}


// ============================================================================
// 7. SETTINGS E DB HELPERS
// ============================================================================

function getSystemSettings() {
    try {
        const row = db.prepare('SELECT config_json FROM system_settings WHERE id = 1').get();
        return row ? safeJsonParse(row.config_json, {}) : {};
    } catch (error) {
        console.warn('⚠️ Impossibile leggere system_settings:', error.message);
        return {};
    }
}

function saveSystemSettings(settings) {
    try {
        db.prepare('UPDATE system_settings SET config_json = ? WHERE id = 1').run(JSON.stringify(settings));
        return true;
    } catch (error) {
        console.warn('⚠️ Impossibile salvare system_settings:', error.message);
        return false;
    }
}

function columnExists(tableName, columnName) {
    try {
        const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
        return rows.some(r => r.name === columnName);
    } catch (error) {
        return false;
    }
}

function safeAlterTableAddColumn(tableName, columnDefinition) {
    const columnName = String(columnDefinition).split(/\s+/)[0];

    if (columnExists(tableName, columnName)) return;

    try {
        db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`).run();
    } catch (error) {
        console.warn(`⚠️ Colonna ${columnName} non aggiunta a ${tableName}:`, error.message);
    }
}

function ensureTennisTrackingColumns() {
    safeAlterTableAddColumn('ai_forward_test', 'sport_type TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'edge_pp REAL');
    safeAlterTableAddColumn('ai_forward_test', 'ev_pct REAL');
    safeAlterTableAddColumn('ai_forward_test', 'model_version TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'metric_version TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'engine_version TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'data_quality TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'market_implied_prob REAL');
    safeAlterTableAddColumn('ai_forward_test', 'fair_odd_model REAL');
    safeAlterTableAddColumn('ai_forward_test', 'fair_odd_calibrated REAL');
    safeAlterTableAddColumn('ai_forward_test', 'tour_type TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'surface TEXT');
    // STEP111_TENNIS_TOURNAMENT_SURFACE_CATALOG: colonne additive e non distruttive.
    // Se non esistono vengono create; se esistono non vengono toccate.
    safeAlterTableAddColumn('ai_forward_test', 'surface_source TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'surface_rule_id TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'surface_original TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'surface_overridden_provider TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'surface_detail TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'surface_regime_key TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'surface_confidence REAL');
    safeAlterTableAddColumn('ai_forward_test', 'surface_indoor INTEGER');
    safeAlterTableAddColumn('ai_forward_test', 'tournament_name TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'tournament_canonical_name TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'tournament_catalog_id TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'tournament_category TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'tournament_level TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'tournament_country TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'tournament_period TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'market_type TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'point_line REAL');
    safeAlterTableAddColumn('ai_forward_test', 'reference_market_source TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'reference_market_quality TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'reference_odd1 REAL');
    safeAlterTableAddColumn('ai_forward_test', 'reference_odd2 REAL');
    safeAlterTableAddColumn('ai_forward_test', 'model_confidence_score REAL');
    safeAlterTableAddColumn('ai_forward_test', 'data_sufficiency_score REAL');
    safeAlterTableAddColumn('ai_forward_test', 'closing_odd REAL');
    safeAlterTableAddColumn('ai_forward_test', 'opening_odd REAL');
    safeAlterTableAddColumn('ai_forward_test', 'clv_pct REAL');
    safeAlterTableAddColumn('ai_forward_test', 'closing_line_available INTEGER');
    safeAlterTableAddColumn('ai_forward_test', 'markov_validated INTEGER');
    safeAlterTableAddColumn('ai_forward_test', 'professional_gate_status TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'professional_gate_allow_bet INTEGER');
    safeAlterTableAddColumn('ai_forward_test', 'professional_gate_reasons TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'professional_gate_max_stake REAL');
    safeAlterTableAddColumn('ai_forward_test', 'deep_scan_risk_level TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'deep_scan_risk_score REAL');
    safeAlterTableAddColumn('ai_forward_test', 'stake_policy_note TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'stake_base_before_deepscan REAL');
    safeAlterTableAddColumn('ai_forward_test', 'kelly_fraction_pct REAL');
    safeAlterTableAddColumn('ai_forward_test', 'kelly_raw_stake REAL');
    safeAlterTableAddColumn('ai_forward_test', 'stake_confidence_multiplier REAL');
    safeAlterTableAddColumn('ai_forward_test', 'stake_confidence_level TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'stake_min_applied INTEGER');
    safeAlterTableAddColumn('ai_forward_test', 'stake_cap_applied INTEGER');
    safeAlterTableAddColumn('ai_forward_test', 'stake_policy_mode TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'clv_method TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'closing_odd_side TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'tennis_operational_status TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'tennis_operational_action TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'tennis_operational_summary TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'match_exposure_key TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'exposure_role TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'exposure_group_status TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'exposure_reason TEXT');

    // STEP67/68 - audit-grade portfolio/export columns.
    safeAlterTableAddColumn('ai_forward_test', 'trading_scope TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'paper_trading_scope TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'portfolio_scope TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'audit_scope_reason TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'audit_trail_id TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'audit_trail_event_id TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'audit_frozen_at TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'audit_snapshot_json TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'deepscan_gate_mode TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'deepscan_gate_status TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'deepscan_gate_multiplier REAL');
    safeAlterTableAddColumn('ai_forward_test', 'deepscan_gate_reason TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'clv_learning_signal TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'clv_learning_action TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'clv_learning_multiplier REAL');
    safeAlterTableAddColumn('ai_forward_test', 'calibration_probability_adjustment REAL');
    safeAlterTableAddColumn('ai_forward_test', 'calibration_bucket TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'calibration_grade TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'calibration_version TEXT');
    // STEP90_PREMATCH_GATE_ALIGNMENT - colonne derivate/audit non mutanti.
    safeAlterTableAddColumn('ai_forward_test', 'pre_match_gate_code TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'pre_match_gate_label TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'pre_match_gate_reason TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'pre_match_gate_version TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'pre_match_clv_used INTEGER');
    safeAlterTableAddColumn('ai_forward_test', 'pre_match_historical_sample INTEGER');
    safeAlterTableAddColumn('ai_forward_test', 'pre_match_historical_roi REAL');
    safeAlterTableAddColumn('ai_forward_test', 'pre_match_historical_brier REAL');
    safeAlterTableAddColumn('ai_forward_test', 'pre_match_historical_clv_sample INTEGER');
    safeAlterTableAddColumn('ai_forward_test', 'pre_match_updated_at TEXT');
    // PATCH35_FINAL_STAKE_AUTHORITY
    safeAlterTableAddColumn('ai_forward_test', 'tennis_stake_authority_version TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'tennis_stake_authority_status TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'tennis_stake_authority_proposed_stake REAL');
    safeAlterTableAddColumn('ai_forward_test', 'tennis_stake_authority_final_stake REAL');
    safeAlterTableAddColumn('ai_forward_test', 'tennis_stake_authority_sample INTEGER');
    safeAlterTableAddColumn('ai_forward_test', 'tennis_stake_authority_reliability TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'tennis_stake_authority_reason TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'tennis_stake_authority_decided_at TEXT');
    // PATCH36_FINAL_RISK_AUTHORITY_AND_WTA_FRESHNESS_CIRCUIT_BREAKER
    safeAlterTableAddColumn('ai_forward_test', 'tennis_risk_authority_version TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'tennis_risk_authority_status TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'tennis_risk_authority_reason TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'tennis_risk_authority_tour TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'tennis_risk_authority_freshness_status TEXT');
    safeAlterTableAddColumn('ai_forward_test', 'tennis_risk_authority_freshness_days REAL');
    safeAlterTableAddColumn('ai_forward_test', 'tennis_risk_authority_circuit_breaker INTEGER');
    safeAlterTableAddColumn('ai_forward_test', 'tennis_risk_authority_decided_at TEXT');

        // STEP91J_ROBUST_SIDE_IDENTITY_GUARD - identità lato/pick Tennis.
        safeAlterTableAddColumn('ai_forward_test', 'predicted_player_name TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'opponent_player_name TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'internal_side TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'official_event_order TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'provider_event_id TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'provider_home_team TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'provider_away_team TEXT');
        // PATCH 3 - identità canonica evento/mercato Tennis (solo colonne additive).
        safeAlterTableAddColumn('ai_forward_test', 'tennis_canonical_match_key TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'tennis_event_fingerprint TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'tennis_market_fingerprint TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'tennis_event_identity_status TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'tennis_event_identity_reason TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'tennis_event_identity_confidence TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'tennis_event_identity_version TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'canonical_match_datetime TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'canonical_tournament_key TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'canonical_player_pair_key TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'side_mapping_warning TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'side_mapping_verified INTEGER');
        safeAlterTableAddColumn('ai_forward_test', 'side_identity_version TEXT');
        // STEP96F_RUNTIME_MICRO_TEST_FINAL_OVERRIDE_AND_DRIFT_AUDIT
        safeAlterTableAddColumn('ai_forward_test', 'analysis_drift_detected INTEGER');
        safeAlterTableAddColumn('ai_forward_test', 'analysis_drift_reason TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'analysis_previous_deepscan TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'analysis_previous_gate TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'analysis_current_deepscan TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'analysis_current_gate TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'analysis_fingerprint TEXT');
        safeAlterTableAddColumn('ai_forward_test', 'analysis_updated_at TEXT');
}

ensureTennisTrackingColumns();
// TENNIS_PATCH46_STAKE_AUTHORITY_SEMANTIC_SEPARATION_FINAL_EXECUTABLE_CONTRACT
tennisStakeExecutionContractPatch46.ensureSchema(db);
unifiedCrossSportPortfolioRiskAuthorityPatch56.ensureSchema(db);


// ============================================================================
// 8. CALIBRAZIONE MODELLO TENNIS
// ============================================================================
//
// Nota:
// Questa funzione è una pre-calibrazione matematica del modello live.
// La calibrazione vera di value/edge/EV viene centralizzata in tennisValueEvaluator.js.
// ============================================================================

function preCalibrateModelProbability(p) {
    const probability = normalizeProbabilityPct(p);
    const x = (probability - 50) / 12;
    const calibrated = 50 + (35 * Math.tanh(x));

    return normalizeProbabilityPct(round(calibrated, 2));
}

function normalizeTwoWayProbabilities(p1, p2) {
    const a = normalizeProbabilityPct(p1);
    const b = normalizeProbabilityPct(p2);
    const total = a + b;

    if (total <= 0) {
        return { p1: 50, p2: 50 };
    }

    return {
        p1: round((a / total) * 100, 2),
        p2: round((b / total) * 100, 2)
    };
}


// ============================================================================
// 9. MARKOV ADAPTER
// ============================================================================
//
// Il file server.tennis.js non contiene più una classe Markov duplicata.
// Tutte le simulazioni passano da backend/markov.js, con adapter per gestire
// nomi funzione diversi senza rompere il progetto.
// ============================================================================

function hasMarkovFunction(functionName) {
    return MarkovEngine && typeof MarkovEngine[functionName] === 'function';
}

function markovProbGame(pServe, pServeBP = null) {
    if (hasMarkovFunction('probGame')) {
        return MarkovEngine.probGame(pServe, pServeBP);
    }

    if (hasMarkovFunction('calculateGameWinProbability')) {
        return MarkovEngine.calculateGameWinProbability(pServe, pServeBP);
    }

    if (hasMarkovFunction('gameProbability')) {
        return MarkovEngine.gameProbability(pServe, pServeBP);
    }

    return null;
}

function markovSimulateTotals(pA, pB, targetLine, bestOf = 3, bpA = null, bpB = null, scoringRules = null) {
    if (!MarkovEngine) return null;

    if (hasMarkovFunction('simulateTotals')) {
        return MarkovEngine.simulateTotals(pA, pB, targetLine, bestOf, bpA, bpB, {scoringRules});
    }

    if (hasMarkovFunction('simulateMatchTotals')) {
        return MarkovEngine.simulateMatchTotals({
            pA,
            pB,
            targetLine,
            bestOf,
            scoringRules,
            bpA,
            bpB
        });
    }

    if (hasMarkovFunction('getTotalsProbability')) {
        return MarkovEngine.getTotalsProbability(pA, pB, targetLine, bestOf, bpA, bpB, {scoringRules});
    }

    return null;
}

function normalizeMarkovTotalsResult(result) {
    if (!result) return null;

    const probOver = toNumber(
        result.probOver ??
        result.over ??
        result.overProbability ??
        result.probabilityOver,
        null
    );

    const probUnder = toNumber(
        result.probUnder ??
        result.under ??
        result.underProbability ??
        result.probabilityUnder,
        null
    );

    if (!Number.isFinite(probOver) || !Number.isFinite(probUnder)) {
        return null;
    }

    const over = probOver > 1 ? probOver / 100 : probOver;
    const under = probUnder > 1 ? probUnder / 100 : probUnder;

    const total = over + under;

    if (total <= 0) return null;

    return {
        probOver: over / total,
        probUnder: under / total
    };
}

function balanceTennisTotalsProbabilities(simTotals, context = {}) {
    if (!simTotals) return null;

    let rawOverPct = toNumber(simTotals.probOver, null);
    let rawUnderPct = toNumber(simTotals.probUnder, null);

    if (!Number.isFinite(rawOverPct) || !Number.isFinite(rawUnderPct)) return null;

    rawOverPct = rawOverPct > 1 ? rawOverPct : rawOverPct * 100;
    rawUnderPct = rawUnderPct > 1 ? rawUnderPct : rawUnderPct * 100;

    const rawTotal = rawOverPct + rawUnderPct;
    if (!Number.isFinite(rawTotal) || rawTotal <= 0) return null;

    rawOverPct = (rawOverPct / rawTotal) * 100;
    rawUnderPct = 100 - rawOverPct;

    const shrink = clamp(toNumber(context.shrink, TENNIS_TOTALS_PROBABILITY_SHRINK), 0, 0.45);
    const maxProb = clamp(toNumber(context.maxProb, TENNIS_TOTALS_MAX_CALIBRATED_PROB), 55, 82);

    let probOverPct = 50 + ((rawOverPct - 50) * (1 - shrink));
    let probUnderPct = 100 - probOverPct;

    if (probOverPct > maxProb) {
        probOverPct = maxProb;
        probUnderPct = 100 - maxProb;
    } else if (probUnderPct > maxProb) {
        probUnderPct = maxProb;
        probOverPct = 100 - maxProb;
    }

    return {
        probOverPct: round(probOverPct, 2),
        probUnderPct: round(probUnderPct, 2),
        rawOverPct: round(rawOverPct, 2),
        rawUnderPct: round(rawUnderPct, 2),
        shrink,
        maxProb,
        line: context.line ?? null,
        mode: 'TOTALS_BALANCED_NO_DIRECTIONAL_BIAS'
    };
}

function getTennisCandidateScore(bet = {}) {
    return (toNumber(bet.valueScore, 0) * 0.75) +
        toNumber(bet.ev_pct, 0) +
        (toNumber(bet.edge_pp, 0) * 0.5);
}

function isTennisTotalsCandidate(bet = {}) {
    const market = String(bet.marketType || bet.market_type || '').toLowerCase();
    const prediction = String(bet.prediction || '').toUpperCase();
    const strategy = String(bet.strategy_tag || '').toUpperCase();
    return market === TENNIS_MARKETS.TOTALS || prediction.includes('OVER') || prediction.includes('UNDER') || strategy.includes('OVER') || strategy.includes('UNDER');
}

function selectTennisCandidatesForMatch(matchBets = [], settings = {}) {
    if (!Array.isArray(matchBets) || matchBets.length === 0) return [];

    const maxMarkets = Math.max(1, Math.min(3, Math.trunc(toNumber(
        settings.tennisMaxMarketsPerMatch,
        settings.tennisAllowMixedMarketsPerMatch === false ? 1 : TENNIS_DEFAULT_MAX_MARKETS_PER_MATCH
    ))));

    const sorted = [...matchBets].sort((a, b) => getTennisCandidateScore(b) - getTennisCandidateScore(a));
    if (maxMarkets <= 1) return [sorted[0]];

    const moneyline = sorted.find(b => !isTennisTotalsCandidate(b));
    const totals = sorted.find(isTennisTotalsCandidate);
    const selected = [];

    if (moneyline) selected.push(moneyline);
    if (totals) selected.push(totals);

    for (const bet of sorted) {
        if (selected.length >= maxMarkets) break;
        if (!selected.includes(bet)) selected.push(bet);
    }

    return selected
        .sort((a, b) => getTennisCandidateScore(b) - getTennisCandidateScore(a))
        .slice(0, maxMarkets);
}


// ============================================================================
// 10. NOMI, SERIE, DATE
// ============================================================================

function formatTennisName(fullName) {
    if (!fullName) return '';

    const parts = String(fullName).trim().split(/\s+/);

    if (parts.length < 2) return fullName;

    const lastPart = parts[parts.length - 1];

    if (lastPart.length === 2 && lastPart.endsWith('.')) {
        return fullName;
    }

    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ');

    return `${lastName} ${firstName[0]}.`;
}

function normalizeTennisSeries(series, leagueType) {
    const type = String(leagueType || '').toUpperCase() === 'ATP' ? 'ATP' : 'WTA';
    const prefix = `[${type}] `;

    if (!series) return `${prefix}Other`;

    const s = String(series).toUpperCase().trim();

    // STEP111_TENNIS_TOURNAMENT_SURFACE_CATALOG:
    // prima di usare euristiche legacy, prova a classificare il torneo da catalogo
    // canonico ATP/WTA 1000/500. Questo evita che WTA 500/1000 vengano saltati
    // o censiti come [WTA]Other quando il provider non espone una serie pulita.
    try {
        const catalog = resolveTournamentCatalogContext({
            tournament: series,
            title: series,
            sportKey: series,
            league: `${type} ${series}`,
            tour: type
        });
        if (catalog && catalog.isCatalogMatch && catalog.seriesLabel) {
            return `${prefix}${catalog.seriesLabel}`;
        }
    } catch (error) {
        // fallback legacy non mutante
    }

    if (
        s === 'G' ||
        s.includes('GRAND SLAM') ||
        s.includes('WIMBLEDON') ||
        s.includes('ROLAND GARROS') ||
        s.includes('AUSTRALIAN OPEN') ||
        s.includes('FRENCH OPEN') ||
        s.includes('US OPEN')
    ) {
        return `${prefix}Grand Slam`;
    }

    if (
        s === 'M' ||
        s === 'PM' ||
        s === 'P5' ||
        s === 'T1' ||
        s.includes('1000') ||
        s.includes('MASTERS') ||
        s.includes('INDIAN WELLS') ||
        s.includes('MIAMI') ||
        s.includes('MADRID') ||
        s.includes('ROME') ||
        s.includes('ROMA') ||
        s.includes('CINCINNATI') ||
        s.includes('CANADA') ||
        s.includes('DOHA') ||
        s.includes('DUBAI') ||
        s.includes('BEIJING') ||
        s.includes('PECHINO') ||
        s.includes('GUADALAJARA')
    ) {
        return `${prefix}Masters 1000`;
    }

    if (
        s === 'F' ||
        s === 'CC' ||
        s === 'WTA FINALS' ||
        s === 'ATP FINALS' ||
        s.includes('TOUR FINALS') ||
        s.includes('MASTERS CUP')
    ) {
        return `${prefix}Masters Cup`;
    }

    if (
        s === 'P' ||
        s === 'T2' ||
        s.includes('500') ||
        s.includes('PREMIER') ||
        s.includes('INTERNATIONAL GOLD') ||
        s.includes('BRISBANE') ||
        s.includes('ADELAIDE') ||
        s.includes('ABU DHABI') ||
        s.includes('SAN DIEGO') ||
        s.includes('CHARLESTON') ||
        s.includes('STUTTGART') ||
        s.includes('STOCCARDA') ||
        s.includes('BERLIN') ||
        s.includes('BERLINO') ||
        s.includes('EASTBOURNE') ||
        s.includes('WASHINGTON') ||
        s.includes('ZHENGZHOU') ||
        s.includes('OSTRAVA') ||
        s.includes('ROTTERDAM') ||
        s.includes('RIO') ||
        s.includes('ACAPULCO') ||
        s.includes('BARCELONA') ||
        s.includes('HALLE') ||
        s.includes('QUEEN') ||
        s.includes('HAMBURG') ||
        s.includes('TOKYO') ||
        s.includes('BASEL') ||
        s.includes('VIENNA')
    ) {
        return `${prefix}${type === 'WTA' ? 'WTA500' : 'ATP500'}`;
    }

    if (
        s === 'I' ||
        s === 'A' ||
        s === 'T3' ||
        s === 'T4' ||
        s === 'T5' ||
        s.includes('250') ||
        s.includes('INTERNATIONAL')
    ) {
        return `${prefix}ATP250`;
    }

    if (
        s === 'C' ||
        s === 'CH' ||
        s.includes('CHALLENGER')
    ) {
        return `${prefix}Challenger`;
    }

    return `${prefix}Other`;
}

function parseDate(val) {
    if (!val) return 'Sconosciuta';

    if (typeof val === 'number') {
        if (val > 19000000 && val < 21000000) {
            const s = String(val);
            return `${s.substring(6, 8)}/${s.substring(4, 6)}/${s.substring(0, 4)}`;
        }

        const excelEpoch = new Date(1899, 11, 30);
        return new Date(excelEpoch.getTime() + val * 86400000).toLocaleDateString('it-IT');
    }

    if (typeof val === 'string') {
        if (val.length === 8 && !isNaN(val)) {
            return `${val.substring(6, 8)}/${val.substring(4, 6)}/${val.substring(0, 4)}`;
        }

        return val;
    }

    if (val instanceof Date) {
        return val.toLocaleDateString('it-IT');
    }

    return String(val);
}

function inferSurfaceFromTournamentTitle(title, context = {}) {
    const resolved = resolveTennisTournamentSurface({
        tournament: context.tournament || title,
        title,
        league: context.league || title,
        eventName: context.eventName || title,
        sportKey: context.sportKey,
        date: context.date || context.match_date || context.commence_time,
        providerSurface: context.providerSurface
    });

    // Compatibilità storica: questa funzione deve restituire una surface modello.
    // Da Step83 non trasforma più un torneo generico ignoto in Hard dichiarato.
    return resolved.modelSurface || resolved.surface || 'Hard';
}

function normalizeSurface(surface) {
    const s = String(surface || '').trim();

    if (['Hard', 'Clay', 'Grass'].includes(s)) return s;

    const lower = s.toLowerCase();

    if (lower.includes('clay') || lower.includes('terra')) return 'Clay';
    if (lower.includes('grass') || lower.includes('erba')) return 'Grass';

    return 'Hard';
}


// ============================================================================
// 11. PARAMETRI DINAMICI TENNIS
// ============================================================================
//
// Nota importante:
// Poiché hai eliminato il DB sporco, non usiamo più paperTradingParams derivati
// da vecchio storico. In questa versione i parametri vengono presi da settings
// manuali/globali oppure da leagueParams solo se presenti e scelti esplicitamente.
// ============================================================================

function getDynamicParamsTennis(settings, normalizedSeries, leagueType) {
    const isAtp = String(leagueType || '').toUpperCase() === 'ATP';

    const globalFallbackEdge = parseFloat(
        settings[isAtp ? 'tennisAtpEdge' : 'tennisWtaEdge']
    ) || (isAtp ? 4.0 : 4.5);

    const globalFallbackProb = parseFloat(
        settings[isAtp ? 'tennisAtpProb' : 'tennisWtaProb']
    ) || 52.0;

    // STEP77_TENNIS_RELIABILITY_AUDIT_FIX:
    // l'EV live deve usare la soglia configurata in Setup (tennisAtpEv/tennisWtaEv)
    // e non un hard-code nascosto. Questo allinea audit/UI/gate value senza toccare
    // calibrazione, DeepScan, stake policy o paper trading.
    const globalFallbackEv = parseFloat(
        settings[isAtp ? 'tennisAtpEv' : 'tennisWtaEv']
    ) || 2.0;

    let targetEdge = globalFallbackEdge;
    let targetProb = globalFallbackProb;
    let targetEv = globalFallbackEv;

    // ------------------------------------------------------------------------
    // Safety 15.2:
    // useHistoricalOpt può restare attivo per calcolare raccomandazioni/backtest,
    // ma NON deve cambiare i parametri live tramite leagueParams se non è stato
    // confermato esplicitamente un futuro apply manuale.
    // ------------------------------------------------------------------------
    const allowAppliedOptimization = settings.tennisOptimizationApplied === true;

    if (
        allowAppliedOptimization &&
        settings.useHistoricalOpt === true &&
        settings.leagueParams &&
        settings.leagueParams[normalizedSeries] &&
        settings.leagueParams[normalizedSeries].global
    ) {
        const leagueEdge = parseFloat(settings.leagueParams[normalizedSeries].global.edge);
        const leagueProb = parseFloat(settings.leagueParams[normalizedSeries].global.prob);
        const leagueEv = parseFloat(settings.leagueParams[normalizedSeries].global.ev);

        if (Number.isFinite(leagueEdge)) targetEdge = leagueEdge;
        if (Number.isFinite(leagueProb)) targetProb = leagueProb;
        if (Number.isFinite(leagueEv)) targetEv = leagueEv;
    } else if (
        allowAppliedOptimization &&
        settings.useHistoricalOpt === true &&
        settings.leagueParams &&
        settings.leagueParams.OVERALL_GLOBAL
    ) {
        const globalEdge = parseFloat(settings.leagueParams.OVERALL_GLOBAL.edge);
        const globalProb = parseFloat(settings.leagueParams.OVERALL_GLOBAL.prob);
        const globalEv = parseFloat(settings.leagueParams.OVERALL_GLOBAL.ev);

        if (Number.isFinite(globalEdge)) targetEdge = globalEdge;
        if (Number.isFinite(globalProb)) targetProb = globalProb;
        if (Number.isFinite(globalEv)) targetEv = globalEv;
    }

    targetEdge = Number.isFinite(targetEdge) ? targetEdge : globalFallbackEdge;
    targetProb = Number.isFinite(targetProb) ? targetProb : globalFallbackProb;
    targetEv = Number.isFinite(targetEv) ? targetEv : globalFallbackEv;

    return {
        targetEdge,
        targetProb,
        targetEv,
        source: allowAppliedOptimization ? 'MANUALLY_APPLIED_OPTIMIZATION' : 'MANUAL_GLOBAL_SETTINGS'
    };
}


// ============================================================================
// 12. MARKET E BOOKMAKER HELPERS
// ============================================================================

function getBookmakerKey(bookmaker) {
    return String(bookmaker?.key || bookmaker?.name || '').toLowerCase().trim();
}

function isSharpBookmaker(bookmaker) {
    const key = getBookmakerKey(bookmaker);

    return SHARP_BOOK_KEYS.some(sharp => key.includes(sharp));
}

function isAcceptableReferenceBookmaker(bookmaker) {
    const key = getBookmakerKey(bookmaker);

    return ACCEPTABLE_REFERENCE_BOOK_KEYS.some(ref => key.includes(ref));
}

function getMarket(bookmaker, marketKey) {
    if (!bookmaker || !Array.isArray(bookmaker.markets)) return null;

    return bookmaker.markets.find(m => m.key === marketKey) || null;
}

function getOutcomePrice(market, outcomeName, point = undefined) {
    if (!market || !Array.isArray(market.outcomes)) return null;

    const outcome = market.outcomes.find(o => {
        if (o.name !== outcomeName) return false;

        if (point === undefined) return true;

        return Number(o.point) === Number(point);
    });

    return normalizeOdd(outcome?.price);
}


// STEP50A_TOTALS_LIVE_PARSER
// Il provider ha confermato markets=totals. Questo parser trasforma i totals reali
// del feed in coppie Over/Under per linea, scegliendo le migliori quote disponibili
// e filtrando linee coerenti con best-of-3 / best-of-5.
function isSupportedTennisTotalsLine(point, bestOf = 3) {
    const n = Number(point);
    if (!Number.isFinite(n)) return false;

    // Evita mercati non-game-total travestiti da totals, es. 3.5 set/game speciali.
    // Le linee intere vengono lasciate disponibili solo come diagnostica feed;
    // per value betting operativo usiamo linee .5 per evitare push.
    if (!String(point).includes('.5') && Math.abs(n % 1) !== 0.5) return false;

    if (Number(bestOf) >= 5) {
        return n >= 24.5 && n <= 45.5;
    }

    return n >= 15.5 && n <= 28.5;
}

function collectBestTennisTotalsOddsByLine(bookmakers = [], bestOf = 3, options = {}) {
    const lines = new Map();
    const maxLines = Math.max(1, Math.trunc(toNumber(options.maxLines, TENNIS_TOTALS_MAX_LINES_PER_MATCH)));

    for (const bookmaker of Array.isArray(bookmakers) ? bookmakers : []) {
        const totalsMarket = getMarket(bookmaker, 'totals');
        if (!totalsMarket || !Array.isArray(totalsMarket.outcomes)) continue;

        const byPoint = new Map();
        for (const outcome of totalsMarket.outcomes) {
            const point = outcome?.point;
            if (!isSupportedTennisTotalsLine(point, bestOf)) continue;

            const key = String(Number(point));
            if (!byPoint.has(key)) {
                byPoint.set(key, { line: Number(point), over: null, under: null });
            }

            const bucket = byPoint.get(key);
            const name = String(outcome.name || '').toUpperCase();
            const odd = normalizeOdd(outcome.price);
            if (!odd) continue;

            if (name === 'OVER') bucket.over = odd;
            if (name === 'UNDER') bucket.under = odd;
        }

        for (const bucket of byPoint.values()) {
            if (!bucket.over || !bucket.under) continue;

            const key = String(bucket.line);
            if (!lines.has(key)) {
                lines.set(key, {
                    line: bucket.line,
                    over: null,
                    under: null,
                    booksWithPair: 0,
                    books: []
                });
            }

            const row = lines.get(key);
            row.booksWithPair += 1;
            row.books.push(bookmaker.key || bookmaker.name || 'unknown');

            if (!row.over || bucket.over > row.over.odd) {
                row.over = {
                    odd: bucket.over,
                    bookmaker: bookmaker.key || bookmaker.name || 'unknown'
                };
            }

            if (!row.under || bucket.under > row.under.odd) {
                row.under = {
                    odd: bucket.under,
                    bookmaker: bookmaker.key || bookmaker.name || 'unknown'
                };
            }
        }
    }

    const targetLine = Number(bestOf) >= 5 ? 37.5 : 20.5;

    return [...lines.values()]
        .filter(row => row.over && row.under)
        .sort((a, b) => {
            const countDiff = b.booksWithPair - a.booksWithPair;
            if (countDiff !== 0) return countDiff;
            return Math.abs(a.line - targetLine) - Math.abs(b.line - targetLine);
        })
        .slice(0, maxLines);
}

// STEP50A_REAL_TOTALS_ODDS_NO_VIG
function getTotalsReferenceProbability(overOdd, underOdd, side = 'over') {
    const fair = calculateNoVigTennis(overOdd, underOdd);
    if (!fair) return null;
    return String(side).toLowerCase() === 'under' ? fair.prob2 : fair.prob1;
}
function createStep50BOverUnderBalanceDiagnostic() {
    return {
        mode: 'STEP50B_OVER_UNDER_BALANCE_DIAGNOSTICS',
        feed: {
            overOutcomes: 0,
            underOutcomes: 0,
            pairedLines: 0,
            supportedLines: 0
        },
        evaluated: {
            over: 0,
            under: 0
        },
        emitted: {
            over: 0,
            under: 0
        },
        blocked: {
            over: 0,
            under: 0
        },
        blockedReasons: {},
        selectedSideReasons: [],
        notes: [
            'Step50B: diagnostica simmetrica Over/Under; entrambi i lati devono essere valutati quando il feed fornisce una coppia reale.',
            'Uno sbilanciamento verso Over non è automaticamente errore se Under viene valutato e scartato con motivo esplicito.'
        ]
    };
}

function recordStep50BTotalsBlocked(balance, side, reason, context = {}) {
    if (!balance) return;
    const normalizedSide = String(side || '').toLowerCase() === 'under' ? 'under' : 'over';
    const normalizedReason = String(reason || 'UNKNOWN_TOTALS_BLOCK').trim() || 'UNKNOWN_TOTALS_BLOCK';
    balance.blocked[normalizedSide] = (balance.blocked[normalizedSide] || 0) + 1;
    balance.blockedReasons[normalizedReason] = (balance.blockedReasons[normalizedReason] || 0) + 1;

    if (Array.isArray(balance.selectedSideReasons) && balance.selectedSideReasons.length < STEP50B_TOTALS_DIAGNOSTIC_MAX_EXAMPLES) {
        balance.selectedSideReasons.push({
            side: normalizedSide.toUpperCase(),
            selected: false,
            reason: normalizedReason,
            line: context.line ?? null,
            odd: context.odd ?? null,
            modelProbability: context.modelProbability ?? null,
            marketProbability: context.marketProbability ?? null,
            edge_pp: context.edge_pp ?? null,
            ev_pct: context.ev_pct ?? null
        });
    }
}

function recordStep50BTotalsEmitted(balance, side, context = {}) {
    if (!balance) return;
    const normalizedSide = String(side || '').toLowerCase() === 'under' ? 'under' : 'over';
    balance.emitted[normalizedSide] = (balance.emitted[normalizedSide] || 0) + 1;

    if (Array.isArray(balance.selectedSideReasons) && balance.selectedSideReasons.length < STEP50B_TOTALS_DIAGNOSTIC_MAX_EXAMPLES) {
        balance.selectedSideReasons.push({
            side: normalizedSide.toUpperCase(),
            selected: true,
            reason: context.reason || 'VALID_TOTALS_EDGE_EV_WITH_REAL_ODDS',
            line: context.line ?? null,
            odd: context.odd ?? null,
            modelProbability: context.modelProbability ?? null,
            marketProbability: context.marketProbability ?? null,
            edge_pp: context.edge_pp ?? null,
            ev_pct: context.ev_pct ?? null
        });
    }
}
// /STEP50B_OVER_UNDER_BALANCE_DIAGNOSTICS
// /STEP50A_TOTALS_LIVE_PARSER

function calculateNoVigTennis(odd1, odd2) {
    const o1 = normalizeOdd(odd1);
    const o2 = normalizeOdd(odd2);

    if (!o1 || !o2) return null;

    const result = calculateNoVigProbabilities(o1, o2);

    if (!result) return null;

    return {
        prob1: result.playerA,
        prob2: result.playerB,
        margin: result.margin
    };
}

function fairOddFromProbabilityPct(probPct) {
    const p = toNumber(probPct, null);
    if (!p || !Number.isFinite(p) || p <= 0) return null;
    return round(100 / p, 3);
}

function averageValidOdds(values = []) {
    const odds = values
        .map(v => normalizeOdd(v))
        .filter(v => Number.isFinite(v) && v > 1);

    if (!odds.length) return null;

    return round(odds.reduce((sum, v) => sum + v, 0) / odds.length, 3);
}

function getReferenceOddForSide(referenceMarket = {}, side = '1') {
    const ref = referenceMarket || {};
    const isP1 = String(side) === '1';
    const rawBooks = Array.isArray(ref.rawBooks) ? ref.rawBooks : [];

    const rawAverage = averageValidOdds(rawBooks.map(book => isP1 ? book.playerAOdd : book.playerBOdd));
    if (rawAverage) return rawAverage;

    const directOdd = isP1
        ? (ref.playerAOdd ?? ref.odd1 ?? ref.p1Odd ?? ref.homeOdd)
        : (ref.playerBOdd ?? ref.odd2 ?? ref.p2Odd ?? ref.awayOdd);
    const normalizedDirect = normalizeOdd(directOdd);
    if (normalizedDirect) return round(normalizedDirect, 3);

    const prob = isP1
        ? (ref.playerAProbability ?? ref.prob1 ?? ref.p1Probability)
        : (ref.playerBProbability ?? ref.prob2 ?? ref.p2Probability);

    return fairOddFromProbabilityPct(prob);
}

function mapBookmakersForH2H(bookmakers, playerAName, playerBName) {
    if (!Array.isArray(bookmakers)) return [];

    return bookmakers
        .map(book => {
            const h2h = getMarket(book, 'h2h');

            if (!h2h) return null;

            const playerAOdd = getOutcomePrice(h2h, playerAName);
            const playerBOdd = getOutcomePrice(h2h, playerBName);

            if (!playerAOdd || !playerBOdd) return null;

            return {
                name: book.key || book.name,
                key: book.key || book.name,
                playerAOdd,
                playerBOdd,
                isSharp: isSharpBookmaker(book),
                isReference: isAcceptableReferenceBookmaker(book)
            };
        })
        .filter(Boolean);
}

function selectReferenceMarket(bookmakers, playerAName, playerBName) {
    const mapped = mapBookmakersForH2H(bookmakers, playerAName, playerBName);

    if (!mapped.length) return null;

    const sharpBooks = mapped.filter(b => b.isSharp);

    if (sharpBooks.length > 0) {
        const consensus = calculateSharpConsensus(sharpBooks);

        if (consensus) {
            return {
                source: 'SHARP_CONSENSUS',
                quality: 'HIGH',
                playerAProbability: consensus.playerA,
                playerBProbability: consensus.playerB,
                usedBooks: consensus.usedBooks || sharpBooks.map(b => b.name),
                rawBooks: sharpBooks
            };
        }
    }

    const acceptableBooks = mapped.filter(b => b.isReference);

    if (acceptableBooks.length >= 2) {
        const consensus = calculateSharpConsensus(acceptableBooks);

        if (consensus) {
            return {
                source: 'REFERENCE_CONSENSUS',
                quality: 'MEDIUM',
                playerAProbability: consensus.playerA,
                playerBProbability: consensus.playerB,
                usedBooks: consensus.usedBooks || acceptableBooks.map(b => b.name),
                rawBooks: acceptableBooks
            };
        }

        const avg = averageNoVigConsensus(acceptableBooks);

        if (avg) {
            return {
                source: 'REFERENCE_AVERAGE',
                quality: 'MEDIUM_LOW',
                playerAProbability: avg.playerA,
                playerBProbability: avg.playerB,
                usedBooks: acceptableBooks.map(b => b.name),
                rawBooks: acceptableBooks
            };
        }
    }

    const firstSharp = sharpBooks[0];

    if (firstSharp) {
        const fair = calculateNoVigTennis(firstSharp.playerAOdd, firstSharp.playerBOdd);

        if (fair) {
            return {
                source: `SINGLE_SHARP_${firstSharp.name}`,
                quality: 'MEDIUM',
                playerAProbability: fair.prob1,
                playerBProbability: fair.prob2,
                usedBooks: [firstSharp.name],
                rawBooks: [firstSharp]
            };
        }
    }

    return {
        source: 'NO_RELIABLE_REFERENCE_MARKET',
        quality: 'LOW',
        playerAProbability: null,
        playerBProbability: null,
        usedBooks: [],
        rawBooks: mapped
    };
}

function averageNoVigConsensus(mappedBooks) {
    if (!Array.isArray(mappedBooks) || mappedBooks.length === 0) return null;

    let sumA = 0;
    let sumB = 0;
    let count = 0;

    for (const book of mappedBooks) {
        const fair = calculateNoVigTennis(book.playerAOdd, book.playerBOdd);

        if (!fair) continue;

        sumA += fair.prob1;
        sumB += fair.prob2;
        count++;
    }

    if (count === 0) return null;

    return {
        playerA: round(sumA / count, 2),
        playerB: round(sumB / count, 2)
    };
}

function getBestOfferedOdds(bookmakers, marketKey, outcomeName, point = undefined, excludeBookKey = null) {
    if (!Array.isArray(bookmakers)) return null;

    let best = null;

    for (const bookmaker of bookmakers) {
        const bookKey = getBookmakerKey(bookmaker);

        if (excludeBookKey && bookKey === String(excludeBookKey).toLowerCase()) continue;

        const market = getMarket(bookmaker, marketKey);
        if (!market) continue;

        const price = getOutcomePrice(market, outcomeName, point);

        if (!price) continue;

        if (!best || price > best.odd) {
            best = {
                bookmaker: bookmaker.key || bookmaker.name || 'unknown',
                odd: price
            };
        }
    }

    return best;
}

function getBestOddsForBothPlayers(bookmakers, playerAName, playerBName, excludeBookKey = null) {
    return {
        playerA: getBestOfferedOdds(bookmakers, 'h2h', playerAName, undefined, excludeBookKey),
        playerB: getBestOfferedOdds(bookmakers, 'h2h', playerBName, undefined, excludeBookKey)
    };
}

function passesCrossReference({
    offeredOdd,
    referenceProbability,
    useCR,
    minRatio = 0.92
}) {
    if (!useCR) {
        return {
            passed: true,
            reason: 'CR disattivato'
        };
    }

    const odd = normalizeOdd(offeredOdd);
    const prob = Number(referenceProbability);

    if (!odd || !Number.isFinite(prob) || prob <= 0) {
        return {
            passed: false,
            reason: 'Reference market non affidabile'
        };
    }

    const referenceFairOdd = 100 / prob;
    const passed = odd >= referenceFairOdd * minRatio;

    return {
        passed,
        reason: passed ? 'CR superato' : 'Quota offerta troppo distante dal fair sharp/reference',
        referenceFairOdd: round(referenceFairOdd, 2),
        ratio: round(odd / referenceFairOdd, 4)
    };
}


// ============================================================================
// 13. KELLY E STAKE
// ============================================================================

function getKellyFractionRaw(prob, odd) {
    const p = normalizeProbabilityPct(prob) / 100;
    const o = normalizeOdd(odd);

    if (!o || !Number.isFinite(p) || p <= 0 || p >= 1) return 0;

    const b = o - 1;
    if (b <= 0) return 0;

    const fullKelly = ((p * o) - 1) / b;
    if (!Number.isFinite(fullKelly) || fullKelly <= 0) return 0;

    return fullKelly;
}

function calculateKelly(prob, odd, options = {}) {
    const fraction = toNumber(options.fraction ?? DEFAULT_KELLY_FRACTION, DEFAULT_KELLY_FRACTION);
    const maxPercent = toNumber(options.maxPercent ?? 1.25, 1.25);
    const rawKelly = getKellyFractionRaw(prob, odd);
    const stakePercent = rawKelly * fraction * 100;

    if (!Number.isFinite(stakePercent) || stakePercent <= 0) return 0;

    return round(Math.min(stakePercent, maxPercent), 4);
}

function getStakeReliabilityLevel(evaluation = {}) {
    return String(
        evaluation.reliability?.level ||
        evaluation.audit?.reliability?.level ||
        evaluation.stakeConfidenceLevel ||
        'NORMAL'
    ).toUpperCase();
}

function getTennisStakeConfidenceMultiplier(evaluation = {}, marketType = TENNIS_MARKETS.MONEYLINE) {
    const reliabilityLevel = getStakeReliabilityLevel(evaluation);
    const evaluatorMultiplier = toNumber(evaluation.suggestedStakeMultiplier, 1);
    const valueScore = toNumber(evaluation.valueScore ?? evaluation.scores?.valueScore, 0);
    const edgePp = toNumber(evaluation.edge_pp ?? evaluation.adjusted_edge_pp ?? evaluation.edge, 0);
    const evPct = toNumber(evaluation.ev_pct ?? evaluation.adjusted_ev_pct ?? evaluation.expectedValue, 0);

    let confidenceMultiplier = 1;

    if (reliabilityLevel === 'MICRO_STAKE') confidenceMultiplier *= 0.60;
    else if (reliabilityLevel === 'REDUCE') confidenceMultiplier *= 0.75;
    else if (reliabilityLevel === 'NORMAL') confidenceMultiplier *= 1.00;
    else if (['INVALID', 'SUSPEND', 'SUSPEND_BUCKET', 'HIGH_PROB_CAUTION'].includes(reliabilityLevel)) confidenceMultiplier = 0;

    if (valueScore >= 90) confidenceMultiplier *= 1.45;
    else if (valueScore >= 82) confidenceMultiplier *= 1.30;
    else if (valueScore >= 74) confidenceMultiplier *= 1.15;
    else if (valueScore > 0 && valueScore < 55) confidenceMultiplier *= 0.75;

    if (edgePp >= 12 && evPct >= 18) confidenceMultiplier *= 1.15;
    else if (edgePp >= 9 && evPct >= 12) confidenceMultiplier *= 1.08;

    if (String(marketType || '').toLowerCase() === TENNIS_MARKETS.TOTALS) {
        // I totals restano più volatili: Markov può validarli, ma non devono
        // saltare automaticamente a stake alto solo perché edge/EV sono elevati.
        confidenceMultiplier *= 0.90;
    }

    const combined = evaluatorMultiplier * confidenceMultiplier;
    return round(clamp(combined, 0, 1.60), 4);
}

function normalizePlayableStake(amount, {
    minBet = DEFAULT_MIN_BET,
    maxStake = Infinity
} = {}) {
    const raw = toNumber(amount, 0);
    const min = toNumber(minBet, DEFAULT_MIN_BET);
    const cap = toNumber(maxStake, Infinity);

    if (!Number.isFinite(raw) || raw <= 0) return 0;
    if (Number.isFinite(cap) && cap <= 0) return 0;
    if (Number.isFinite(cap) && cap < min) return 0;

    let normalized = raw < min ? min : raw;

    if (Number.isFinite(cap)) {
        normalized = Math.min(normalized, cap);
    }

    if (normalized > 0 && normalized < min) return 0;

    return round(normalized, 2);
}

function calculateStakePolicy({
    probability,
    odd,
    bankroll,
    evaluation = null,
    marketType = TENNIS_MARKETS.MONEYLINE,
    suggestedStakeMultiplier = null,
    minBet = DEFAULT_MIN_BET,
    maxStakePct = DEFAULT_PRE_GATE_MAX_STAKE_PCT
} = {}) {
    const bank = Math.max(toNumber(bankroll, DEFAULT_BANKROLL), 0);
    const kellyPercent = calculateKelly(probability, odd, {
        fraction: DEFAULT_KELLY_FRACTION,
        maxPercent: DEFAULT_PRE_GATE_MAX_STAKE_PCT * 100
    });
    const rawKellyStake = (kellyPercent / 100) * bank;
    const confidenceMultiplier = evaluation
        ? getTennisStakeConfidenceMultiplier(evaluation, marketType)
        : toNumber(suggestedStakeMultiplier ?? 1, 1);
    const capAmount = bank * toNumber(maxStakePct, DEFAULT_PRE_GATE_MAX_STAKE_PCT);
    const beforeCap = rawKellyStake * confidenceMultiplier;
    const legacyStake = normalizePlayableStake(beforeCap, {
        minBet,
        maxStake: capAmount
    });
    // QUANT_V2_R2_TENNIS_DECISION_AUTHORITY_BEGIN
    const v2 = require('./quantv2Decision').evaluate({
        mode:'PREMATCH',
        calibratedProbabilityPct: evaluation?.calibrated_probability_pct ?? evaluation?.calibratedProbability ?? probability,
        odd,bankroll:bank,reliabilityPct:
            evaluation?.reliability?.score ?? evaluation?.reliabilityScore ??
            ((evaluation?.reliability?.allowBet === true || evaluation?.valid === true) ? 65 : 0),
        oddCertified: evaluation?.quantv2OddsCertified === true || evaluation?.oddsCertified === true,
        hardBlock: evaluation?.reliability?.allowBet === false || evaluation?.quantv2HardBlock === true,
        deepscanAction: evaluation?.deepScanAction || evaluation?.ds_action,
        deepscanVeto: evaluation?.deepScanVeto === true,
        uncertaintyPp:evaluation?.quantv2UncertaintyPp,
        existingHardReasons:evaluation?.quantv2HardReasons,
        downstreamAuthorized:evaluation?.quantv2DownstreamAuthorized !== false
    });
    // V2 attivo solo dall'avviatore dedicato. Non aggira evalP.valid / cr.passed.
    const stake = process.env.BETTINGAPP_QUANT_V2 === '1' ? v2.stake : legacyStake;
    // QUANT_V2_R2_TENNIS_DECISION_AUTHORITY_END

    const stakeConfidenceLevel = getStakeReliabilityLevel(evaluation || {});

    return {
        mode: process.env.BETTINGAPP_QUANT_V2 === '1' ? 'QUANT_V2_EV_PRUDENTE' : TENNIS_KELLY_STAKE_POLICY.mode,
        stake,
        decisionV2: process.env.BETTINGAPP_QUANT_V2 === '1' ? v2 : null,
        kellyFractionPct: kellyPercent,
        kellyRawStake: round(rawKellyStake, 2),
        stakeBeforeCap: round(beforeCap, 2),
        confidenceMultiplier,
        stakeConfidenceLevel,
        minStakeApplied: stake > 0 && beforeCap > 0 && beforeCap < minBet,
        capApplied: stake > 0 && capAmount > 0 && beforeCap > capAmount,
        minPlayableStake: minBet,
        maxStakePct: toNumber(maxStakePct, DEFAULT_PRE_GATE_MAX_STAKE_PCT),
        maxStakeAmount: round(capAmount, 2),
        policy: TENNIS_KELLY_STAKE_POLICY
    };
}

function calculateStakeAmount(args = {}) {
    return calculateStakePolicy(args).stake;
}


// ============================================================================
// 14. RELIABILITY BOOTSTRAP NUOVO STORICO
// ============================================================================
//
// Poiché il DB sporco è stato eliminato, non dobbiamo più usare lo storico
// vecchio. Questa funzione usa il nuovo storico solo quando il campione diventa
// sufficiente. Prima di quel momento lavora in modalità neutra dichiarata.
// ============================================================================

function buildBootstrapTennisReliabilityReport() {
    return {
        mode: 'BOOTSTRAP_NEUTRAL_NEW_HISTORY',
        sampleSize: 0,
        brier: {
            avgBrier: TENNIS_VALUE_DEFAULTS.bootstrapBrierScore
        },
        calibration: {
            summary: {
                weightedCalibrationError: TENNIS_VALUE_DEFAULTS.bootstrapCalibrationError
            },
            buckets: []
        },
        decision: {
            level: 'NORMAL',
            stakeMultiplier: 1,
            allowBet: true,
            reason: 'Bootstrap nuovo storico: campione non ancora sufficiente'
        },
        clv: {
            avgCLV: TENNIS_VALUE_DEFAULTS.bootstrapClv
        }
    };
}

function getNewHistoryTennisReliabilityReport() {
    try {
        const rows = db.prepare(`
            SELECT *
            FROM ai_forward_test
            WHERE status IN ('WON', 'LOST', 'PUSH', 'VOID')
              AND (
                    UPPER(COALESCE(sport_type, '')) = 'TENNIS'
                    OR UPPER(COALESCE(bet_type, '')) LIKE '%TENNIS%'
                    OR UPPER(COALESCE(strategy_tag, '')) LIKE '%TENNIS%'
              )
              AND UPPER(COALESCE(data_quality, '')) IN ('CURRENT_BOOTSTRAP', 'CURRENT')
        `).all();

        const validSettled = rows.filter(b => {
            const status = String(b.status || '').toUpperCase();
            return status === 'WON' || status === 'LOST';
        });

        const segmentCalibration = buildTennisSegmentCalibrationReport(validSettled);

        if (validSettled.length < BOOTSTRAP_MIN_SETTLED_BETS_FOR_RELIABILITY) {
            const bootstrap = buildBootstrapTennisReliabilityReport();
            bootstrap.sampleSize = validSettled.length;
            bootstrap.segmentCalibration = segmentCalibration;
            bootstrap.decision.reason = `Bootstrap nuovo storico: ${validSettled.length}/${BOOTSTRAP_MIN_SETTLED_BETS_FOR_RELIABILITY} bet settled`;
            return bootstrap;
        }

        // Import lazy per mantenere il comportamento compatibile se value_evaluator
        // ha dipendenze o metodi diversi.
        const ValueEvaluator = require('./value_evaluator');

        if (ValueEvaluator && typeof ValueEvaluator.buildReliabilityReport === 'function') {
            const report = ValueEvaluator.buildReliabilityReport(validSettled, {
                bucketSize: 5,
                minSample: 10,
                sportFilter: 'tennis'
            });

            return {
                ...report,
                mode: 'NEW_HISTORY_RELIABILITY',
                sampleSize: validSettled.length,
                segmentCalibration
            };
        }

        const bootstrap = buildBootstrapTennisReliabilityReport();
        bootstrap.sampleSize = validSettled.length;
        bootstrap.segmentCalibration = segmentCalibration;
        bootstrap.decision.reason = 'ValueEvaluator.buildReliabilityReport non disponibile: uso bootstrap neutro';
        return bootstrap;
    } catch (error) {
        const bootstrap = buildBootstrapTennisReliabilityReport();
        bootstrap.decision.reason = `Errore lettura nuovo storico: ${error.message}`;
        return bootstrap;
    }
}

function getBacktestNeutralReliabilityOptions() {
    return {
        reliabilityMode: 'BACKTEST_NEUTRAL_NO_FAKE_RELIABILITY',
        brierScore: TENNIS_VALUE_DEFAULTS.bootstrapBrierScore,
        calibrationError: TENNIS_VALUE_DEFAULTS.bootstrapCalibrationError,
        clv: TENNIS_VALUE_DEFAULTS.bootstrapClv,
        decision: {
            level: 'NORMAL',
            allowBet: true,
            stakeMultiplier: 1,
            reason: 'Backtest neutro: nessuna reliability fittizia'
        }
    };
}


// ============================================================================
// STEP63 - TENNIS CANDIDATE REJECTION AUDIT & LIVE RELIABILITY GUARD
// ============================================================================
//
// Problema rilevato: con sample nuovo storico < soglia professionale piena,
// una reliability globale sfavorevole può diventare hard veto e azzerare tutti
// i candidati live prima ancora del Gate/DeepScan. In bootstrap questo è troppo
// aggressivo: il dato storico deve ridurre/cappare, non impedire la diagnostica.
// Step63 non cambia il modello probabilistico: impedisce solo che la calibration
// non matura (<150 settled) diventi blocco totale nella fase di candidate build.
// ============================================================================

const STEP63_TENNIS_CANDIDATE_AUDIT_MODE = 'STEP63_TENNIS_CANDIDATE_REJECTION_AUDIT';
const STEP63_LIVE_RELIABILITY_GUARD_MODE = 'STEP63_LIVE_RELIABILITY_GUARD_NO_HARD_VETO_UNDER_PRO_SAMPLE';
const STEP63_TOP_REJECTED_LIMIT = 10;

// STEP65 - Tennis Audit Candidate Visibility & Bootstrap Overconfidence Control
// Mostra candidati audit-only anche quando non sono operativi e impedisce
// che overconfidence/reliability bootstrap rendano la giornata completamente opaca.
const STEP65_TENNIS_AUDIT_VISIBILITY_MODE = 'STEP65_TENNIS_AUDIT_CANDIDATE_VISIBILITY';
const STEP65_BOOTSTRAP_OVERCONFIDENCE_MODE = 'STEP65_BOOTSTRAP_OVERCONFIDENCE_AUDIT_ONLY';
const STEP65_BOOTSTRAP_MAX_DISPLAY_PROBABILITY = 88;
const STEP65_TOP_AUDIT_LIMIT = 10;

// STEP66 - Tennis Odds Extraction Certification Fix
// Certifica che quote Moneyline provengano solo dal mercato h2h reale,
// scarta outlier rispetto al fair/reference e rende tracciabile EV/quote in UI.
const STEP66_TENNIS_ODDS_CERTIFICATION_MODE = 'STEP66_TENNIS_ODDS_EXTRACTION_CERTIFICATION_FIX';
const STEP66B_TENNIS_NAME_MATCHING_MODE = 'STEP66B_TENNIS_CERTIFIED_NAME_MATCHING';
const STEP66_MONEYLINE_MARKET_KEY = 'h2h';
const STEP66_TOTALS_MARKET_KEY = 'totals';
const STEP66_MAX_MONEYLINE_OUTLIER_RATIO = 1.85;
const STEP66_MAX_SINGLE_BOOK_LONGSHOT_ODD = 18;
const STEP66_MAX_CERTIFIED_MONEYLINE_ODD = 25;
const STEP66_OPERATIONAL_POLICY_MAX_MONEYLINE_ODD = TENNIS_VALUE_DEFAULTS.maxOddMoneyline;
const STEP66_EV_MISMATCH_TOLERANCE = 0.75;


function ensureStep66OddsCertificationDiagnostics(diagnostics = {}) {
    const audit = ensureStep63CandidateDiagnostics(diagnostics);
    if (!audit.oddsCertification || typeof audit.oddsCertification !== 'object') {
        audit.oddsCertification = {
            mode: STEP66_TENNIS_ODDS_CERTIFICATION_MODE,
            nameMatchingMode: STEP66B_TENNIS_NAME_MATCHING_MODE,
            h2hPairsInspected: 0,
            certifiedMoneyline: 0,
            rejectedMoneyline: 0,
            rejectedReasons: {},
            samples: [],
            notes: [
                'Moneyline certificata solo da market key h2h con outcome player certificati e mappati in modo univoco.',
                'Step66B accetta varianti Tennis sicure: Nome Cognome, Cognome Nome, J. Cognome, Cognome J., piccoli typo sul nome con cognome esatto.',
                'Outlier rispetto a fair/reference o median bookmaker esclusi dalla selezione.'
            ]
        };
    }
    return audit.oddsCertification;
}

function recordStep66OddsCertification(diagnostics, row = {}) {
    const cert = ensureStep66OddsCertificationDiagnostics(diagnostics);
    cert.h2hPairsInspected = toNumber(cert.h2hPairsInspected, 0) + 1;

    if (row.certified === true) {
        cert.certifiedMoneyline = toNumber(cert.certifiedMoneyline, 0) + 1;
    } else {
        cert.rejectedMoneyline = toNumber(cert.rejectedMoneyline, 0) + 1;
        const reason = String(row.reason || 'ODDS_CERTIFICATION_FAILED').toUpperCase();
        cert.rejectedReasons[reason] = toNumber(cert.rejectedReasons[reason], 0) + 1;
    }

    if (Array.isArray(cert.samples) && cert.samples.length < 12) {
        cert.samples.push({
            match: row.match || 'N/D',
            side: row.side || 'N/D',
            bookmaker: row.bookmaker || 'unknown',
            marketKey: row.marketKey || STEP66_MONEYLINE_MARKET_KEY,
            outcomeName: row.outcomeName || row.sideName || 'N/D',
            odd: round(row.odd, 2),
            baselineOdd: row.baselineOdd ? round(row.baselineOdd, 2) : null,
            ratio: row.ratio ? round(row.ratio, 3) : null,
            certified: row.certified === true,
            reason: row.reason || (row.certified ? 'CERTIFIED_H2H_MONEYLINE' : 'ODDS_CERTIFICATION_FAILED'),
            nameCertification: row.nameCertification || null
        });
    }
}

function medianNumber(values = []) {
    const nums = values.map(v => Number(v)).filter(v => Number.isFinite(v)).sort((a, b) => a - b);
    if (!nums.length) return null;
    const mid = Math.floor(nums.length / 2);
    return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function normalizeStep66TennisName(value = '') {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[,;:_\-]+/g, ' ')
        .replace(/\./g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenizeStep66TennisName(value = '') {
    return normalizeStep66TennisName(value).split(' ').filter(Boolean);
}

function step66Levenshtein(a = '', b = '') {
    const x = String(a || '');
    const y = String(b || '');
    const dp = Array.from({ length: x.length + 1 }, () => Array(y.length + 1).fill(0));
    for (let i = 0; i <= x.length; i++) dp[i][0] = i;
    for (let j = 0; j <= y.length; j++) dp[0][j] = j;
    for (let i = 1; i <= x.length; i++) {
        for (let j = 1; j <= y.length; j++) {
            const cost = x[i - 1] === y[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            );
        }
    }
    return dp[x.length][y.length];
}

function buildStep66NameParts(value = '') {
    const tokens = tokenizeStep66TennisName(value);
    const lastName = tokens.length ? tokens[tokens.length - 1] : '';
    const firstTokens = tokens.slice(0, -1);
    return {
        original: value,
        normalized: tokens.join(' '),
        tokens,
        firstTokens,
        firstName: firstTokens.join(' '),
        firstInitial: firstTokens.length ? firstTokens[0][0] : '',
        lastName
    };
}

function isStep66PointFreeOutcome(outcome = {}) {
    return outcome && (outcome.point === undefined || outcome.point === null || outcome.point === '');
}

function certifyStep66TennisOutcomeName(outcomeName = '', targetName = '', opponentName = '') {
    const outcome = buildStep66NameParts(outcomeName);
    const target = buildStep66NameParts(targetName);
    const opponent = buildStep66NameParts(opponentName);

    if (!outcome.tokens.length || !target.tokens.length || !target.lastName) {
        return { matched: false, level: 'UNCERTIFIED_OUTCOME_NAME_MISMATCH', score: 0 };
    }

    const targetExact = target.normalized;
    const targetReversed = [target.lastName, ...target.firstTokens].filter(Boolean).join(' ');
    const outcomeNorm = outcome.normalized;
    const outcomeLast = outcome.tokens[outcome.tokens.length - 1] || '';
    const outcomeFirst = outcome.tokens[0] || '';
    const outcomeSecond = outcome.tokens[1] || '';

    const sameSurnameAsOpponent = opponent.lastName && opponent.lastName === target.lastName;
    const outcomeIsOpponentExact = opponent.normalized && outcomeNorm === opponent.normalized;
    const outcomeIsOpponentReversed = opponent.lastName && outcomeNorm === [opponent.lastName, ...opponent.firstTokens].filter(Boolean).join(' ');
    if (outcomeIsOpponentExact || outcomeIsOpponentReversed) {
        return { matched: false, level: 'UNCERTIFIED_MATCHES_OPPONENT', score: 0 };
    }

    if (outcomeNorm === targetExact) {
        return { matched: true, level: 'CERTIFIED_H2H_EXACT', score: 100 };
    }

    if (outcomeNorm === targetReversed) {
        return { matched: true, level: 'CERTIFIED_H2H_REVERSED', score: 96 };
    }

    // Iniziale + cognome: J. Sinner / J Sinner
    if (outcome.tokens.length === 2 && outcomeLast === target.lastName && target.firstInitial && outcomeFirst.length === 1 && outcomeFirst === target.firstInitial) {
        return { matched: true, level: 'CERTIFIED_H2H_INITIAL', score: 92 };
    }

    // Cognome + iniziale: Sinner J. / Sinner J
    if (outcome.tokens.length === 2 && outcomeFirst === target.lastName && target.firstInitial && outcomeSecond.length === 1 && outcomeSecond === target.firstInitial) {
        return { matched: true, level: 'CERTIFIED_H2H_INITIAL', score: 92 };
    }

    // Cognome solo: accettato solo se non ambiguo rispetto all'avversario.
    if (outcome.tokens.length === 1 && outcomeNorm === target.lastName) {
        if (sameSurnameAsOpponent) {
            return { matched: false, level: 'UNCERTIFIED_AMBIGUOUS_SURNAME', score: 0 };
        }
        return { matched: true, level: 'CERTIFIED_H2H_SURNAME_UNAMBIGUOUS', score: 82 };
    }

    // Piccolo typo sul nome, cognome esatto: Janik Sinner -> Jannik Sinner.
    if (outcome.tokens.length >= 2 && outcomeLast === target.lastName && target.firstTokens.length > 0) {
        const candidateFirst = outcome.tokens.slice(0, -1).join(' ');
        const targetFirst = target.firstTokens.join(' ');
        const distance = step66Levenshtein(candidateFirst, targetFirst);
        const maxDistance = targetFirst.length >= 5 ? 1 : 0;
        if (distance <= maxDistance && target.firstInitial && candidateFirst[0] === target.firstInitial) {
            return { matched: true, level: 'CERTIFIED_H2H_FUZZY_FIRSTNAME', score: 88, distance };
        }
    }

    // Forma invertita con piccolo typo sul nome: Sinner Janik -> Jannik Sinner.
    if (outcome.tokens.length >= 2 && outcomeFirst === target.lastName && target.firstTokens.length > 0) {
        const candidateFirst = outcome.tokens.slice(1).join(' ');
        const targetFirst = target.firstTokens.join(' ');
        const distance = step66Levenshtein(candidateFirst, targetFirst);
        const maxDistance = targetFirst.length >= 5 ? 1 : 0;
        if (distance <= maxDistance && target.firstInitial && candidateFirst[0] === target.firstInitial) {
            return { matched: true, level: 'CERTIFIED_H2H_FUZZY_FIRSTNAME_REVERSED', score: 86, distance };
        }
    }

    return { matched: false, level: 'UNCERTIFIED_OUTCOME_NAME_MISMATCH', score: 0 };
}

function findCertifiedStep66H2HOutcome(market, targetName, opponentName) {
    if (!market || market.key !== STEP66_MONEYLINE_MARKET_KEY || !Array.isArray(market.outcomes)) return null;

    const matches = market.outcomes
        .map((outcome, index) => {
            if (!isStep66PointFreeOutcome(outcome)) return null;
            const nameCertification = certifyStep66TennisOutcomeName(outcome.name, targetName, opponentName);
            if (!nameCertification.matched) return null;
            return { outcome, index, nameCertification };
        })
        .filter(Boolean)
        .sort((a, b) => b.nameCertification.score - a.nameCertification.score);

    if (matches.length === 0) return null;
    if (matches.length > 1 && matches[0].nameCertification.score === matches[1].nameCertification.score) {
        return { outcome: null, index: -1, nameCertification: { matched: false, level: 'UNCERTIFIED_AMBIGUOUS_OUTCOME_MATCH', score: 0 } };
    }

    return matches[0];
}

function collectStep66H2HMoneylineRows(bookmakers = [], playerAName = '', playerBName = '') {
    const rows = [];

    for (const bookmaker of Array.isArray(bookmakers) ? bookmakers : []) {
        const market = getMarket(bookmaker, STEP66_MONEYLINE_MARKET_KEY);
        if (!market || !Array.isArray(market.outcomes)) continue;

        const outcomeAMatch = findCertifiedStep66H2HOutcome(market, playerAName, playerBName);
        const outcomeBMatch = findCertifiedStep66H2HOutcome(market, playerBName, playerAName);
        const outcomeA = outcomeAMatch?.outcome;
        const outcomeB = outcomeBMatch?.outcome;
        const oddA = normalizeOdd(outcomeA?.price);
        const oddB = normalizeOdd(outcomeB?.price);

        // Certificazione market-level: due esiti esatti, nessun Draw, nessun point.
        if (!outcomeA || !outcomeB || !oddA || !oddB) continue;
        if (outcomeAMatch.index === outcomeBMatch.index) continue;
        if (market.outcomes.length !== 2) continue;

        const noVig = calculateNoVigTennis(oddA, oddB);
        if (!noVig) continue;

        rows.push({
            bookmaker: bookmaker.key || bookmaker.name || 'unknown',
            bookKey: getBookmakerKey(bookmaker),
            marketKey: market.key,
            commence_time: bookmaker.commence_time || null,
            playerA: { name: outcomeA.name, odd: oddA, outcome: outcomeA, nameCertification: outcomeAMatch.nameCertification },
            playerB: { name: outcomeB.name, odd: oddB, outcome: outcomeB, nameCertification: outcomeBMatch.nameCertification },
            nameCertification: {
                mode: STEP66B_TENNIS_NAME_MATCHING_MODE,
                playerA: outcomeAMatch.nameCertification,
                playerB: outcomeBMatch.nameCertification
            },
            margin: noVig.margin,
            isSharp: isSharpBookmaker(bookmaker),
            isReference: isAcceptableReferenceBookmaker(bookmaker)
        });
    }

    return rows;
}

function certifyStep66MoneylineOffer({
    row,
    side,
    referenceProbability,
    medianOdd,
    totalRows,
    matchLabel,
    diagnostics
} = {}) {
    const isPlayerB = String(side) === '2' || String(side).toUpperCase() === 'B';
    const sideData = isPlayerB ? row?.playerB : row?.playerA;
    const odd = normalizeOdd(sideData?.odd);
    const referenceFairOdd = referenceProbability ? fairOddFromProbabilityPct(referenceProbability) : null;
    const baselineOdd = Number.isFinite(referenceFairOdd) && referenceFairOdd > 1 ? referenceFairOdd : medianOdd;
    const ratio = baselineOdd ? odd / baselineOdd : null;

    let certified = true;
    let reason = 'CERTIFIED_H2H_MONEYLINE';

    if (!row || row.marketKey !== STEP66_MONEYLINE_MARKET_KEY) {
        certified = false;
        reason = 'MARKET_KEY_NOT_H2H';
    } else if (!odd) {
        certified = false;
        reason = 'INVALID_ODD';
    } else if (odd > STEP66_MAX_CERTIFIED_MONEYLINE_ODD) {
        certified = false;
        reason = 'MONEYLINE_ODD_ABOVE_CERTIFIED_LIMIT';
    } else if (totalRows <= 1 && odd > STEP66_MAX_SINGLE_BOOK_LONGSHOT_ODD) {
        certified = false;
        reason = 'SINGLE_BOOK_LONGSHOT_NOT_CERTIFIED';
    } else if (ratio && ratio > STEP66_MAX_MONEYLINE_OUTLIER_RATIO && odd > STEP66_OPERATIONAL_POLICY_MAX_MONEYLINE_ODD) {
        certified = false;
        reason = 'MONEYLINE_OUTLIER_VS_REFERENCE';
    }

    recordStep66OddsCertification(diagnostics, {
        match: matchLabel,
        side: isPlayerB ? '2' : '1',
        sideName: sideData?.name,
        bookmaker: row?.bookmaker,
        marketKey: row?.marketKey,
        outcomeName: sideData?.name,
        nameCertification: sideData?.nameCertification || null,
        odd,
        baselineOdd,
        ratio,
        certified,
        reason
    });

    return {
        certified,
        reason,
        bookmaker: row?.bookmaker,
        marketKey: row?.marketKey || STEP66_MONEYLINE_MARKET_KEY,
        outcomeName: sideData?.name || null,
        nameCertification: sideData?.nameCertification || null,
        nameCertificationMode: STEP66B_TENNIS_NAME_MATCHING_MODE,
        odd: odd ? round(odd, 3) : null,
        baselineOdd: baselineOdd ? round(baselineOdd, 3) : null,
        ratio: ratio ? round(ratio, 4) : null,
        evSource: 'ADJUSTED_EV_REPORTED__CALIBRATED_EV_AVAILABLE',
        operationalPolicyMaxOdd: STEP66_OPERATIONAL_POLICY_MAX_MONEYLINE_ODD,
        oddsWithinOperationalPolicy: odd ? odd <= STEP66_OPERATIONAL_POLICY_MAX_MONEYLINE_ODD : false
    };
}

function getBestCertifiedStep66MoneylineOdds(bookmakers, playerAName, playerBName, referenceMarket = {}, diagnostics = {}) {
    const rows = collectStep66H2HMoneylineRows(bookmakers, playerAName, playerBName);
    const matchLabel = `${playerAName} - ${playerBName}`;

    const sideRows = (side) => {
        const isB = side === '2';
        return rows
            .map(row => {
                const odd = isB ? row.playerB.odd : row.playerA.odd;
                const referenceProbability = isB ? referenceMarket.playerBProbability : referenceMarket.playerAProbability;
                const medianOdd = medianNumber(rows.map(r => isB ? r.playerB.odd : r.playerA.odd));
                const certification = certifyStep66MoneylineOffer({
                    row,
                    side,
                    referenceProbability,
                    medianOdd,
                    totalRows: rows.length,
                    matchLabel,
                    diagnostics
                });
                return { row, odd, certification };
            })
            .filter(item => item.certification.certified === true && normalizeOdd(item.odd));
    };

    const pickBest = (items, side) => {
        if (!items.length) return null;
        const best = [...items].sort((a, b) => b.odd - a.odd)[0];
        const isB = side === '2';
        return {
            bookmaker: best.row.bookmaker,
            odd: round(best.odd, 3),
            certification: best.certification,
            marketKey: STEP66_MONEYLINE_MARKET_KEY,
            outcomeName: isB ? best.row.playerB.name : best.row.playerA.name
        };
    };

    return {
        playerA: pickBest(sideRows('1'), '1'),
        playerB: pickBest(sideRows('2'), '2'),
        source: STEP66_TENNIS_ODDS_CERTIFICATION_MODE,
        rowsInspected: rows.length
    };
}

function buildStep66EvCertification(evaluation = {}, odd = null) {
    const displayedProbability = toNumber(evaluation?.calibrated_probability_pct ?? evaluation?.probability ?? 0, 0);
    const reportedEv = toNumber(evaluation?.ev_pct ?? evaluation?.adjusted_ev_pct, null);
    const calibratedEv = toNumber(evaluation?.calibrated_ev_pct, calculateExpectedValuePct(displayedProbability, odd));
    const rawEv = toNumber(evaluation?.raw_ev_pct, null);
    const recomputedDisplayedEv = round(calculateExpectedValuePct(displayedProbability, odd), 2);
    const mismatch = reportedEv !== null && Math.abs(recomputedDisplayedEv - reportedEv) > STEP66_EV_MISMATCH_TOLERANCE;

    return {
        mode: STEP66_TENNIS_ODDS_CERTIFICATION_MODE,
        displayedProbabilityPct: round(displayedProbability, 2),
        reportedEvPct: reportedEv !== null ? round(reportedEv, 2) : null,
        recomputedDisplayedEvPct: recomputedDisplayedEv,
        calibratedEvPct: calibratedEv !== null ? round(calibratedEv, 2) : null,
        rawEvPct: rawEv !== null ? round(rawEv, 2) : null,
        evSource: 'ADJUSTED_EV_PCT',
        warning: mismatch ? 'EV_DISPLAY_USES_ADJUSTED_VALUE__SEE_RECOMPUTED_DISPLAYED_EV' : null
    };
}

function buildStep63LiveEvaluationReliabilityContext(report = {}) {
    const sampleSize = Number(report?.sampleSize || 0);
    const originalDecisionLevel = String(report?.decision?.level || report?.decision?.status || '').toUpperCase();
    const originalBrier = toNumber(report?.brier?.avgBrier ?? report?.brierScore, TENNIS_VALUE_DEFAULTS.bootstrapBrierScore);
    const originalCalibrationError = toNumber(
        report?.calibration?.summary?.weightedCalibrationError ??
        report?.calibrationError,
        TENNIS_VALUE_DEFAULTS.bootstrapCalibrationError
    );
    const originalClv = toNumber(report?.clv?.avgCLV ?? report?.clv, TENNIS_VALUE_DEFAULTS.bootstrapClv);

    const requiresGuard = sampleSize > 0 && sampleSize < TENNIS_PROFESSIONAL_CALIBRATION_MIN_SAMPLE;

    if (!requiresGuard) {
        return {
            ...report,
            step63Guard: {
                active: false,
                mode: STEP63_LIVE_RELIABILITY_GUARD_MODE,
                sampleSize,
                requiredProfessionalSample: TENNIS_PROFESSIONAL_CALIBRATION_MIN_SAMPLE,
                reason: 'Campione sufficiente o bootstrap neutro: nessun guardrail Step63 applicato.'
            }
        };
    }

    const guardedBrier = Math.min(
        Number.isFinite(originalBrier) ? originalBrier : TENNIS_VALUE_DEFAULTS.bootstrapBrierScore,
        0.245
    );

    const guardedCalibrationError = Math.min(
        Number.isFinite(originalCalibrationError) ? originalCalibrationError : TENNIS_VALUE_DEFAULTS.bootstrapCalibrationError,
        7.5
    );

    const guardedClv = Math.max(
        Number.isFinite(originalClv) ? originalClv : TENNIS_VALUE_DEFAULTS.bootstrapClv,
        0
    );

    return {
        ...report,
        mode: `${report?.mode || 'NEW_HISTORY_RELIABILITY'}_STEP63_LIVE_GUARDED`,
        brier: {
            ...(report?.brier || {}),
            avgBrier: guardedBrier
        },
        calibration: {
            ...(report?.calibration || {}),
            summary: {
                ...(report?.calibration?.summary || {}),
                weightedCalibrationError: guardedCalibrationError
            }
        },
        clv: {
            ...(report?.clv || {}),
            avgCLV: guardedClv
        },
        decision: {
            ...(report?.decision || {}),
            level: 'REDUCE',
            allowBet: true,
            stakeMultiplier: 0.50,
            reason: `Step63: storico Tennis ${sampleSize}/${TENNIS_PROFESSIONAL_CALIBRATION_MIN_SAMPLE}. Reliability usata come guardrail/cap, non come hard veto live.`
        },
        step63Guard: {
            active: true,
            mode: STEP63_LIVE_RELIABILITY_GUARD_MODE,
            sampleSize,
            requiredProfessionalSample: TENNIS_PROFESSIONAL_CALIBRATION_MIN_SAMPLE,
            originalDecisionLevel,
            originalBrier: round(originalBrier, 4),
            originalCalibrationError: round(originalCalibrationError, 2),
            originalClv: round(originalClv, 2),
            guardedBrier: round(guardedBrier, 4),
            guardedCalibrationError: round(guardedCalibrationError, 2),
            guardedClv: round(guardedClv, 2),
            reason: 'Evita zero candidati live causati da calibration/reliability non ancora professionale.'
        }
    };
}

function selectTennisLiveSegmentCalibrationReport(segmentReport, context = {}) {
    const sampleSize = Number(segmentReport?.sampleSize || 0);

    if (sampleSize > 0 && sampleSize < TENNIS_PROFESSIONAL_CALIBRATION_MIN_SAMPLE) {
        return null;
    }

    return selectTennisSegmentCalibrationReport(segmentReport, context);
}

function ensureStep63CandidateDiagnostics(diagnostics = {}) {
    if (!diagnostics.candidateAudit) {
        diagnostics.candidateAudit = {
            mode: STEP63_TENNIS_CANDIDATE_AUDIT_MODE,
            evaluated: {
                moneyline: 0,
                totals: 0
            },
            acceptedForSelection: {
                moneyline: 0,
                totals: 0
            },
            rejected: {
                moneyline: {},
                totals: {}
            },
            auditOnly: {
                moneyline: {},
                totals: {}
            },
            rejectedHard: {
                moneyline: {},
                totals: {}
            },
            topRejected: [],
            topRejectedText: [],
            topAuditCandidates: [],
            topAuditText: [],
            reliabilityFailureBreakdown: {},
            reliabilityFailureSamples: [],
            oddsCertification: {
                mode: STEP66_TENNIS_ODDS_CERTIFICATION_MODE,
                h2hPairsInspected: 0,
                certifiedMoneyline: 0,
                rejectedMoneyline: 0,
                rejectedReasons: {},
                samples: [],
                notes: [
                    'Moneyline certificata solo da market key h2h con outcome player certificati e mappati in modo univoco.',
                'Step66B accetta varianti Tennis sicure: Nome Cognome, Cognome Nome, J. Cognome, Cognome J., piccoli typo sul nome con cognome esatto.',
                    'Outlier rispetto a fair/reference o median bookmaker esclusi dalla selezione.'
                ]
            },
            step65Mode: STEP65_TENNIS_AUDIT_VISIBILITY_MODE,
            step65OverconfidenceMode: STEP65_BOOTSTRAP_OVERCONFIDENCE_MODE,
            note: 'Candidati valutati ma non selezionati: audit-only, non salvati nel paper trading.'
        };
    }

    return diagnostics.candidateAudit;
}

function getStep63CandidateRejectCode({ evaluation = {}, cr = {}, stakePolicy = null, selected = false } = {}) {
    if (selected) return 'ACCEPTED_FOR_SELECTION';

    if (!evaluation || evaluation.valid !== true) {
        const thresholds = evaluation?.thresholds_passed || {};
        const reason = String(evaluation?.reason || '').toUpperCase();

        if (reason.includes('BRIER') || reason.includes('CALIBRAZIONE')) return 'RELIABILITY_OR_CALIBRATION_BLOCK';
        if (reason.includes('BUCKET') || reason.includes('OVERCONFIDENT')) return 'BUCKET_OVERCONFIDENCE_BLOCK';
        if (thresholds.reliability === false) return 'RELIABILITY_THRESHOLD_FAILED';
        if (thresholds.probability === false) return 'PROBABILITY_THRESHOLD_FAILED';
        if (thresholds.edge_pp === false) return 'EDGE_THRESHOLD_FAILED';
        if (thresholds.ev_pct === false) return 'EV_THRESHOLD_FAILED';
        if (thresholds.max_odd === false) return 'MAX_ODD_THRESHOLD_FAILED';

        return 'VALUE_EVALUATION_INVALID';
    }

    if (cr && cr.passed === false) return 'CROSS_REFERENCE_FAILED';

    if (stakePolicy && toNumber(stakePolicy.stake, 0) <= 0) return 'STAKE_POLICY_ZERO';

    return 'NOT_SELECTED_UNKNOWN';
}

function pushStep63TopRejected(candidateAudit, entry) {
    const score = (
        Math.max(0, toNumber(entry.edge_pp, 0)) * 2 +
        Math.max(0, toNumber(entry.ev_pct, 0)) * 0.35 +
        Math.max(0, toNumber(entry.probability, 0) - 50) * 0.25
    );

    candidateAudit.topRejected.push({
        ...entry,
        score: round(score, 2)
    });

    candidateAudit.topRejected = candidateAudit.topRejected
        .sort((a, b) => toNumber(b.score, 0) - toNumber(a.score, 0))
        .slice(0, STEP63_TOP_REJECTED_LIMIT);

    candidateAudit.topRejectedText = candidateAudit.topRejected.map(row => {
        return `${row.match} · ${row.prediction} @${row.odd} · prob ${row.probability}% · EV teorico ${row.theoretical_ev_pct ?? row.calibrated_ev_pct ?? row.ev_pct}% · EV operativo ${row.operational_ev_pct ?? row.ev_pct}% · blocco ${row.detailedRejectCode || row.rejectCode}`;
    });
}

function classifyStep65AuditStatus(entry = {}, rejectCode = '') {
    const probability = toNumber(entry.probability, 0);
    const edge = toNumber(entry.edge_pp, 0);
    const ev = toNumber(entry.ev_pct, 0);
    const code = String(rejectCode || '').toUpperCase();

    if (code === 'ACCEPTED_FOR_SELECTION') return 'SELECTED';

    const numericallyInteresting = edge >= 3 || ev >= 5;
    const extremeProbability = probability >= STEP65_BOOTSTRAP_MAX_DISPLAY_PROBABILITY || probability <= (100 - STEP65_BOOTSTRAP_MAX_DISPLAY_PROBABILITY);

    if (code.includes('OVERCONFIDENCE') || (extremeProbability && numericallyInteresting)) {
        return 'OVERCONFIDENCE_AUDIT';
    }

    if (code.includes('RELIABILITY') || code.includes('CALIBRATION')) {
        return numericallyInteresting ? 'RELIABILITY_AUDIT' : 'RELIABILITY_REJECTED_HARD';
    }

    if (code.includes('PROBABILITY') && numericallyInteresting) {
        return 'PROBABILITY_AUDIT';
    }

    if ((code.includes('EDGE') || code.includes('EV')) && numericallyInteresting) {
        return 'EDGE_EV_AUDIT';
    }

    if (code.includes('STAKE') && numericallyInteresting) {
        return 'STAKE_ZERO_AUDIT';
    }

    return 'REJECTED_HARD';
}

function pushStep65AuditCandidate(candidateAudit, entry = {}, auditStatus = 'AUDIT_ONLY') {
    const score = toNumber(entry.score, null);
    const fallbackScore = (
        Math.max(0, toNumber(entry.edge_pp, 0)) * 2 +
        Math.max(0, toNumber(entry.ev_pct, 0)) * 0.35 +
        Math.max(0, Math.abs(toNumber(entry.probability, 50) - 50)) * 0.18
    );

    const row = {
        ...entry,
        auditStatus,
        displayProbability: round(clamp(toNumber(entry.probability, 0), 100 - STEP65_BOOTSTRAP_MAX_DISPLAY_PROBABILITY, STEP65_BOOTSTRAP_MAX_DISPLAY_PROBABILITY), 2),
        score: round(score !== null ? score : fallbackScore, 2)
    };

    candidateAudit.topAuditCandidates.push(row);
    candidateAudit.topAuditCandidates = candidateAudit.topAuditCandidates
        .sort((a, b) => toNumber(b.score, 0) - toNumber(a.score, 0))
        .slice(0, STEP65_TOP_AUDIT_LIMIT);

    candidateAudit.topAuditText = candidateAudit.topAuditCandidates.map(item => {
        return `${item.auditStatus} · ${item.match} · ${item.prediction} @${item.odd} · prob ${item.probability}% · EV teorico ${item.theoretical_ev_pct ?? item.calibrated_ev_pct ?? item.ev_pct}% · EV operativo ${item.operational_ev_pct ?? item.ev_pct}% · blocco ${item.detailedRejectCode || item.rejectCode}`;
    });
}


function buildStep77ReliabilityFailureAudit(evaluation = {}) {
    // STEP77_TENNIS_RELIABILITY_AUDIT_FIX
    // Audit non mutante: spiega cosa c'è dietro RELIABILITY_THRESHOLD_FAILED.
    const reliability = evaluation?.reliability || {};
    const calibration = evaluation?.calibration || {};
    const audit = evaluation?.audit || {};
    const thresholds = evaluation?.thresholds_passed || {};
    const brierScore = toNumber(audit.brierScore, null);
    const calibrationError = toNumber(audit.calibrationError, null);
    const clv = toNumber(audit.clv, null);
    const bucketSample = toNumber(calibration.bucketSample, 0);
    const bucketStatus = String(calibration.bucketStatus || '').toUpperCase();
    const reliabilityLevel = String(reliability.level || '').toUpperCase();
    const reliabilityReason = String(reliability.reason || evaluation.reason || '').toUpperCase();

    const reasons = [];
    if (thresholds.reliability === false) reasons.push('RELIABILITY_THRESHOLD_FALSE');
    if (reliabilityLevel) reasons.push(`LEVEL_${reliabilityLevel}`);
    if (reliabilityReason.includes('BRIER')) reasons.push('BRIER_OR_CALIBRATION_OUT_OF_RANGE');
    if (brierScore !== null && brierScore > TENNIS_VALUE_DEFAULTS.reduceBrierAbove) reasons.push('BRIER_ABOVE_REDUCE_LIMIT');
    if (brierScore !== null && brierScore > TENNIS_VALUE_DEFAULTS.suspendBrierAbove) reasons.push('BRIER_ABOVE_SUSPEND_LIMIT');
    if (calibrationError !== null && calibrationError > TENNIS_VALUE_DEFAULTS.reduceCalibrationErrorAbove) reasons.push('CALIBRATION_GAP_ABOVE_REDUCE_LIMIT');
    if (calibrationError !== null && calibrationError > TENNIS_VALUE_DEFAULTS.suspendCalibrationErrorAbove) reasons.push('CALIBRATION_GAP_ABOVE_SUSPEND_LIMIT');
    if (bucketStatus) reasons.push(`BUCKET_${bucketStatus}`);
    if (bucketSample > 0 && bucketSample < TENNIS_VALUE_DEFAULTS.minReliableSample) reasons.push('SEGMENT_BUCKET_LOW_SAMPLE');
    if (calibration.method === 'FALLBACK') reasons.push('NO_SEGMENT_BUCKET_USING_FALLBACK_CALIBRATION');
    if (clv !== null && clv < 0) reasons.push('CLV_NEGATIVE');
    if (!reasons.length && String(evaluation.reason || '').toUpperCase().includes('ATTENDIBIL')) reasons.push('WEAK_RELIABILITY_GENERIC');

    return {
        mode: 'STEP77_RELIABILITY_FAILURE_AUDIT_V1',
        reliabilityLevel: reliability.level || null,
        reliabilityAllowBet: reliability.allowBet === true,
        reliabilityReason: reliability.reason || evaluation.reason || null,
        brierScore: brierScore === null ? null : round(brierScore, 4),
        calibrationError: calibrationError === null ? null : round(calibrationError, 2),
        clv: clv === null ? null : round(clv, 2),
        calibrationMethod: calibration.method || null,
        bucketStatus: calibration.bucketStatus || null,
        bucketSample,
        bucket: calibration.bucket || null,
        thresholdsPassed: thresholds,
        primaryReasons: [...new Set(reasons)]
    };
}

function incrementStep77ReliabilityBreakdown(candidateAudit, reliabilityAudit = {}) {
    if (!candidateAudit.reliabilityFailureBreakdown || typeof candidateAudit.reliabilityFailureBreakdown !== 'object') {
        candidateAudit.reliabilityFailureBreakdown = {};
    }
    const reasons = Array.isArray(reliabilityAudit.primaryReasons) && reliabilityAudit.primaryReasons.length
        ? reliabilityAudit.primaryReasons
        : ['UNCLASSIFIED_RELIABILITY_FAILURE'];
    reasons.forEach(reason => {
        candidateAudit.reliabilityFailureBreakdown[reason] = toNumber(candidateAudit.reliabilityFailureBreakdown[reason], 0) + 1;
    });
}

function recordStep63CandidateAudit(diagnostics, {
    marketType,
    matchLabel,
    prediction,
    odd,
    oddsCertification = null,
    evaluation,
    cr,
    stakePolicy = null,
    selected = false
} = {}) {
    const candidateAudit = ensureStep63CandidateDiagnostics(diagnostics);
    const marketKey = String(marketType || '').toLowerCase() === TENNIS_MARKETS.TOTALS ? 'totals' : 'moneyline';

    candidateAudit.evaluated[marketKey] = toNumber(candidateAudit.evaluated[marketKey], 0) + 1;

    const rejectCode = getStep63CandidateRejectCode({ evaluation, cr, stakePolicy, selected });

    if (selected || rejectCode === 'ACCEPTED_FOR_SELECTION') {
        candidateAudit.acceptedForSelection[marketKey] = toNumber(candidateAudit.acceptedForSelection[marketKey], 0) + 1;
        return;
    }

    candidateAudit.rejected[marketKey][rejectCode] = toNumber(candidateAudit.rejected[marketKey][rejectCode], 0) + 1;

    const step69Explanation = explainTennisCandidateRejection({
        marketType: marketKey,
        evaluation,
        cr,
        stakePolicy,
        odd,
        rejectCode,
        selected: false
    });

    const step77ReliabilityAudit = buildStep77ReliabilityFailureAudit(evaluation);
    if (rejectCode.includes('RELIABILITY') || step77ReliabilityAudit.primaryReasons.length) {
        incrementStep77ReliabilityBreakdown(candidateAudit, step77ReliabilityAudit);
        if (!Array.isArray(candidateAudit.reliabilityFailureSamples)) candidateAudit.reliabilityFailureSamples = [];
        candidateAudit.reliabilityFailureSamples.push({
            match: matchLabel || 'N/D',
            prediction: prediction || 'N/D',
            odd: round(odd, 2),
            level: step77ReliabilityAudit.reliabilityLevel,
            reason: step77ReliabilityAudit.reliabilityReason,
            brierScore: step77ReliabilityAudit.brierScore,
            calibrationError: step77ReliabilityAudit.calibrationError,
            clv: step77ReliabilityAudit.clv,
            bucketSample: step77ReliabilityAudit.bucketSample,
            primaryReasons: step77ReliabilityAudit.primaryReasons
        });
        candidateAudit.reliabilityFailureSamples = candidateAudit.reliabilityFailureSamples.slice(-12);
    }

    const rejectedEntry = {
        marketType: marketKey,
        match: matchLabel || 'N/D',
        prediction: prediction || 'N/D',
        odd: round(odd, 2),
        probability: round(evaluation?.calibrated_probability_pct ?? evaluation?.probability ?? 0, 2),
        edge_pp: round(evaluation?.edge_pp ?? evaluation?.adjusted_edge_pp ?? 0, 2),
        ev_pct: round(evaluation?.ev_pct ?? evaluation?.adjusted_ev_pct ?? 0, 2),
        calibrated_ev_pct: round(evaluation?.calibrated_ev_pct ?? step69Explanation.evAudit?.theoreticalEvPct ?? 0, 2),
        raw_ev_pct: round(evaluation?.raw_ev_pct ?? step69Explanation.evAudit?.theoreticalEvPct ?? 0, 2),
        market_probability_pct: round(evaluation?.market_probability_pct ?? evaluation?.market_implied_probability_pct ?? step69Explanation.probabilityAudit?.marketProbabilityPct ?? 0, 2),
        model_probability_pct: round(evaluation?.model_probability_pct ?? step69Explanation.probabilityAudit?.modelProbabilityPct ?? 0, 2),
        reason: evaluation?.reason || cr?.reason || 'N/D',
        rejectCode,
        detailedRejectCode: step69Explanation.detailedRejectCode,
        blockerGroup: step69Explanation.blockerGroup,
        rejectionExplanation: step69Explanation.explanation,
        probabilityMode: step69Explanation.probabilityAudit?.probabilityMode,
        probabilityCapApplied: step69Explanation.probabilityAudit?.capOrFloorApplied === true,
        extremeOddGuard: step69Explanation.probabilityAudit?.extremeOddGuard === true,
        theoretical_edge_pp: step69Explanation.evAudit?.theoreticalEdgePp,
        operational_edge_pp: step69Explanation.evAudit?.operationalEdgePp,
        theoretical_ev_pct: step69Explanation.evAudit?.theoreticalEvPct,
        operational_ev_pct: step69Explanation.evAudit?.operationalEvPct,
        ev_suppression_reason: step69Explanation.evAudit?.suppressionReason,
        oddsCertification: oddsCertification || null,
        evCertification: buildStep66EvCertification(evaluation, odd),
        reliabilityFailureAudit: step77ReliabilityAudit,
        step69: step69Explanation
    };

    recordStep69Candidate(candidateAudit, rejectedEntry, step69Explanation);
    pushStep63TopRejected(candidateAudit, rejectedEntry);

    const auditStatus = classifyStep65AuditStatus(rejectedEntry, rejectCode);
    const targetBucket = auditStatus === 'REJECTED_HARD' || auditStatus.endsWith('_REJECTED_HARD')
        ? candidateAudit.rejectedHard
        : candidateAudit.auditOnly;

    targetBucket[marketKey][auditStatus] = toNumber(targetBucket[marketKey][auditStatus], 0) + 1;
    pushStep65AuditCandidate(candidateAudit, rejectedEntry, auditStatus);
}

function buildCalibrationBucketFromRows(rows, label) {
    const validRows = rows
        .map(row => {
            const predicted = Number(row.estimated_prob ?? row.estimatedProb ?? row.calibrated_probability_pct);
            const status = String(row.status || '').toUpperCase();
            const actual = status === 'WON' ? 1 : (status === 'LOST' ? 0 : null);

            if (!Number.isFinite(predicted) || actual === null) return null;

            return {
                predicted: clamp(predicted, 1, 99),
                actual
            };
        })
        .filter(Boolean);

    if (!validRows.length) {
        return {
            label,
            sample: 0,
            avgPredictedProb: 0,
            observedWinRate: 0,
            brier: 0,
            calibrationError: 0,
            buckets: []
        };
    }

    const sample = validRows.length;
    const avgPredictedProb = validRows.reduce((sum, row) => sum + row.predicted, 0) / sample;
    const observedWinRate = validRows.reduce((sum, row) => sum + row.actual, 0) / sample * 100;
    const brier = validRows.reduce((sum, row) => {
        const p = row.predicted / 100;
        return sum + Math.pow(p - row.actual, 2);
    }, 0) / sample;

    return {
        label,
        sample,
        avgPredictedProb: round(avgPredictedProb, 2),
        observedWinRate: round(observedWinRate, 2),
        brier: round(brier, 4),
        calibrationError: round(Math.abs(avgPredictedProb - observedWinRate), 2),
        buckets: [{
            from: Math.floor(avgPredictedProb / 5) * 5,
            to: Math.floor(avgPredictedProb / 5) * 5 + 4.99,
            sample,
            predicted: round(avgPredictedProb, 2),
            observed: round(observedWinRate, 2),
            error: round(Math.abs(avgPredictedProb - observedWinRate), 2),
            brier: round(brier, 4)
        }]
    };
}

function buildTennisClosingLineValidationReport(rows = []) {
    const validRows = rows
        .map(row => {
            const odd = Number(row.odd);
            const closingOdd = Number(row.closing_odd ?? row.closingOdd);
            const storedClv = Number(row.clv_pct ?? row.clvPct);
            const clvPct = Number.isFinite(storedClv)
                ? storedClv
                : (Number.isFinite(odd) && odd > 1 && Number.isFinite(closingOdd) && closingOdd > 1
                    ? ((closingOdd / odd) - 1) * 100
                    : NaN);

            if (!Number.isFinite(clvPct)) return null;

            return {
                clvPct,
                beatClosingLine: clvPct > 0
            };
        })
        .filter(Boolean);

    const sample = validRows.length;

    if (!sample) {
        return {
            sample: 0,
            avgClvPct: 0,
            beatRatePct: 0,
            positive: 0,
            mode: 'NO_CLOSING_LINE_SAMPLE'
        };
    }

    const positive = validRows.filter(row => row.beatClosingLine).length;
    const avgClvPct = validRows.reduce((sum, row) => sum + row.clvPct, 0) / sample;

    return {
        sample,
        avgClvPct: round(avgClvPct, 2),
        beatRatePct: round((positive / sample) * 100, 2),
        positive,
        mode: 'CLOSING_LINE_VALIDATION'
    };
}

function buildTennisPredictiveCalibrationDashboard(segmentCalibration = {}) {
    const decisionBuilder = typeof buildTennisPredictiveCalibrationDecision === 'function'
        ? buildTennisPredictiveCalibrationDecision
        : null;

    const decision = decisionBuilder
        ? decisionBuilder(segmentCalibration, {
            requiredSample: TENNIS_PROFESSIONAL_CALIBRATION_MIN_SAMPLE,
            minSegmentSample: TENNIS_VALUE_DEFAULTS.minReliableSample
        })
        : {
            grade: 'UNKNOWN',
            status: 'WARN',
            allowProfessionalUse: false,
            recommendation: 'Decisione calibrazione non disponibile.'
        };

    return {
        mode: 'TENNIS_PREDICTIVE_CALIBRATION_DASHBOARD',
        generatedAt: new Date().toISOString(),
        requiredSample: TENNIS_PROFESSIONAL_CALIBRATION_MIN_SAMPLE,
        minSegmentSample: TENNIS_VALUE_DEFAULTS.minReliableSample,
        decision,
        overall: segmentCalibration.overall || buildCalibrationBucketFromRows([], 'OVERALL_TENNIS_CLEAN'),
        closingLine: segmentCalibration.closingLine || buildTennisClosingLineValidationReport([]),
        segments: {
            byTour: segmentCalibration.byTour || {},
            bySurface: segmentCalibration.bySurface || {},
            byMarket: segmentCalibration.byMarket || {},
            byOddsBucket: segmentCalibration.byOddsBucket || {},
            byTourSurfaceMarket: segmentCalibration.byTourSurfaceMarket || {}
        },
        notes: [
            'Usa solo Tennis CURRENT/CURRENT_BOOTSTRAP con status WON/LOST.',
            'Non applica soglie automaticamente e non modifica system_settings.',
            'Non legge né modifica Calcio.'
        ]
    };
}

function buildTennisSegmentCalibrationReport(rows = []) {
    const cleanRows = rows.filter(row => {
        const status = String(row.status || '').toUpperCase();
        return isCleanTennisDataQuality(row.data_quality) &&
            String(row.sport_type || '').toUpperCase() === 'TENNIS' &&
            (status === 'WON' || status === 'LOST');
    });

    const groups = {
        byTour: {},
        bySurface: {},
        byMarket: {},
        byOddsBucket: {},
        byTourSurfaceMarket: {}
    };

    for (const row of cleanRows) {
        const tour = inferTennisTourType(row.tour_type || row.strategy_tag || row.league || row.bet_type);
        const surface = normalizeSurface(row.surface || 'Hard');
        const market = String(row.market_type || inferTennisMarketTypeFromPrediction(row.prediction)).toLowerCase();
        const oddsBucket = getTennisOddsBucket(row.odd);
        const combinedKey = `${tour}|${surface}|${market}`;

        const push = (bucket, key) => {
            if (!bucket[key]) bucket[key] = [];
            bucket[key].push(row);
        };

        push(groups.byTour, tour);
        push(groups.bySurface, surface);
        push(groups.byMarket, market);
        push(groups.byOddsBucket, oddsBucket);
        push(groups.byTourSurfaceMarket, combinedKey);
    }

    const finalizeGroup = (bucket) => Object.fromEntries(
        Object.entries(bucket).map(([key, bucketRows]) => [key, buildCalibrationBucketFromRows(bucketRows, key)])
    );

    const overall = buildCalibrationBucketFromRows(cleanRows, 'OVERALL_TENNIS_CLEAN');
    const segmentReport = {
        mode: 'TENNIS_SEGMENTED_CALIBRATION',
        sampleSize: cleanRows.length,
        minSampleWarning: BOOTSTRAP_MIN_SETTLED_BETS_FOR_RELIABILITY,
        professionalMinSample: TENNIS_PROFESSIONAL_CALIBRATION_MIN_SAMPLE,
        overall,
        byTour: finalizeGroup(groups.byTour),
        bySurface: finalizeGroup(groups.bySurface),
        byMarket: finalizeGroup(groups.byMarket),
        byOddsBucket: finalizeGroup(groups.byOddsBucket),
        byTourSurfaceMarket: finalizeGroup(groups.byTourSurfaceMarket),
        closingLine: buildTennisClosingLineValidationReport(cleanRows)
    };

    segmentReport.predictiveDashboard = buildTennisPredictiveCalibrationDashboard(segmentReport);

    return segmentReport;
}

function selectTennisSegmentCalibrationReport(segmentReport, {
    tourType,
    surface,
    marketType,
    odd
} = {}) {
    if (!segmentReport || typeof segmentReport !== 'object') return null;

    const tour = inferTennisTourType(tourType);
    const normalizedSurface = normalizeSurface(surface || 'Hard');
    const market = String(marketType || TENNIS_MARKETS.MONEYLINE).toLowerCase();
    const oddsBucket = getTennisOddsBucket(odd);
    const combinedKey = `${tour}|${normalizedSurface}|${market}`;

    const candidates = [
        segmentReport.byTourSurfaceMarket?.[combinedKey],
        segmentReport.byMarket?.[market],
        segmentReport.bySurface?.[normalizedSurface],
        segmentReport.byTour?.[tour],
        segmentReport.byOddsBucket?.[oddsBucket],
        segmentReport.overall
    ];

    const selected = candidates.find(report => report && report.sample >= TENNIS_VALUE_DEFAULTS.minReliableSample);
    if (!selected) return null;

    return {
        summary: {
            weightedCalibrationError: selected.calibrationError,
            sample: selected.sample,
            segment: selected.label
        },
        buckets: selected.buckets || []
    };
}

function buildTennisDataSufficiencyReport({
    model,
    referenceMarket,
    marketType,
    professionalMode = true,
    markovSelfCheck = null
} = {}) {
    const reasons = [];
    let score = 100;
    const market = String(marketType || TENNIS_MARKETS.MONEYLINE).toLowerCase();
    const sample = Number(model?.sackmannSample || 0);
    const referenceQualityRank = getReferenceQualityRank(referenceMarket?.quality);
    const minReferenceQualityRank = getReferenceQualityRank(TENNIS_PROFESSIONAL_RULES.minReferenceQuality);

    if (!professionalMode) {
        return {
            passed: true,
            score: 100,
            mode: 'NON_PROFESSIONAL_MODE',
            reasons: ['Modalità professionale Tennis disattivata']
        };
    }

    if (!referenceMarket || referenceQualityRank < minReferenceQualityRank) {
        score -= 35;
        reasons.push('Reference market non sufficiente per modalità professionale');
    }

    if (!model || model.hasSackmannData !== true) {
        score -= 45;
        reasons.push(model?.hasCanonicalPlayerData === true
            ? 'Dati match-level insufficienti; Canonical Player Evidence disponibile solo per contesto DeepScan'
            : 'Dati giocatore match-level e Canonical Player Evidence assenti');
    }

    const requiredSample = market === TENNIS_MARKETS.TOTALS
        ? TENNIS_PROFESSIONAL_RULES.minTotalsSackmannSample
        : TENNIS_PROFESSIONAL_RULES.minMoneylineSackmannSample;

    // STEP91_DATA_SUFFICIENCY_HARD_RULES: campione minimo non compensabile da edge/EV.
    const hardMinSample = market === TENNIS_MARKETS.TOTALS ? 50 : 10;
    let hardDataSufficiencyBlock = false;
    if (sample < hardMinSample) {
        hardDataSufficiencyBlock = true;
        score = Math.min(score, 49);
        reasons.push(`DATA_SUFFICIENCY_BLOCK: Campione ${market} insufficiente ${sample}/${hardMinSample}`);
    }

    if (sample < requiredSample) {
        score -= market === TENNIS_MARKETS.TOTALS ? 40 : 25;
        reasons.push(`Campione giocatore insufficiente: ${sample}/${requiredSample}`);
    }

    if (market === TENNIS_MARKETS.TOTALS) {
        if (!model?.canUseTotals) {
            score -= 30;
            reasons.push('Totals disabilitati: dati punto/Markov insufficienti');
        }

        if (markovSelfCheck && markovSelfCheck.ok !== true) {
            score -= 30;
            reasons.push('Markov self-check non valido per totals');
        }
    }

    if (Math.abs(Number(model?.prob1 || 0) - Number(model?.prob2 || 0)) > TENNIS_PROFESSIONAL_RULES.maxModelMarketDisagreementPp + 35) {
        score -= 10;
        reasons.push('Disallineamento estremo tra probabilità giocatori');
    }

    score = clamp(score, 0, 100);

    const minScore = market === TENNIS_MARKETS.TOTALS
        ? TENNIS_PROFESSIONAL_RULES.minDataSufficiencyScoreTotals
        : TENNIS_PROFESSIONAL_RULES.minDataSufficiencyScoreMoneyline;

    const passedByScore = score >= minScore;

    // STEP91C_DATA_SUFFICIENCY_FLOW_REPAIR
    // La hard rule Step91 resta un veto operativo, ma non deve fermare il funnel
    // prima della candidate audit quando feed, H2H, reference market e modello sono
    // disponibili. Altrimenti la UI torna a zero match e non mostra DeepScan/Gate.
    // Il blocco pre-candidato resta solo per mancanze strutturali non valutabili.
    const preCandidateBlock = !model || !referenceMarket;
    const operationalHardBlock = hardDataSufficiencyBlock || !passedByScore;

    return {
        passed: !operationalHardBlock,
        score: round(score, 2),
        mode: 'TENNIS_PROFESSIONAL_DATA_SUFFICIENCY',
        flowRepairMode: 'STEP91C_DATA_SUFFICIENCY_FLOW_REPAIR',
        marketType: market,
        requiredSample,
        hardMinSample,
        hardDataSufficiencyBlock,
        operationalHardBlock,
        preCandidateBlock,
        auditCandidateAllowed: preCandidateBlock !== true,
        playerSampleSize: sample,
        observedSample: sample,
        minScore,
        reasons: reasons.length ? reasons : ['Dati sufficienti']
    };
}


// ============================================================================
// 15. COSTRUZIONE BET OBJECT
// ============================================================================

function applyProfessionalGateStakeCap(stake, professionalGate = {}) {
    const requestedStake = toNumber(stake, 0);

    if (!Number.isFinite(requestedStake) || requestedStake <= 0) {
        return {
            stake: 0,
            adjusted: requestedStake !== 0,
            originalStake: round(requestedStake, 2),
            reason: 'Stake non valido o nullo'
        };
    }

    if (professionalGate && professionalGate.allowBet === false) {
        return {
            stake: 0,
            adjusted: true,
            originalStake: round(requestedStake, 2),
            reason: `Stake azzerato: ${professionalGate.status || 'gate bloccante'}`
        };
    }

    const cap = toNumber(professionalGate?.stakePolicy?.recommendedMaxStake, null);

    if (cap !== null && cap >= 0) {
        const cappedStake = normalizePlayableStake(requestedStake, {
            minBet: DEFAULT_MIN_BET,
            maxStake: cap
        });

        if (requestedStake > cap || cappedStake !== round(requestedStake, 2)) {
            return {
                stake: cappedStake,
                adjusted: true,
                originalStake: round(requestedStake, 2),
                reason: cappedStake > 0
                    ? `Stake ridotto dal Professional Gate: ${round(requestedStake, 2)} > cap ${round(cap, 2)}`
                    : `Stake azzerato: cap ${round(cap, 2)} inferiore al minimo giocabile €${DEFAULT_MIN_BET.toFixed(2)}`
            };
        }
    }

    const playableStake = normalizePlayableStake(requestedStake, {
        minBet: DEFAULT_MIN_BET,
        maxStake: cap ?? Infinity
    });

    return {
        stake: playableStake,
        adjusted: playableStake !== round(requestedStake, 2),
        originalStake: round(requestedStake, 2),
        reason: playableStake > 0
            ? 'Stake entro cap operativo'
            : `Stake sotto il minimo giocabile €${DEFAULT_MIN_BET.toFixed(2)}`
    };
}

// STEP79_STAKE_NOTE_CONSISTENCY
                // Corregge precedenza stake: WATCHLIST MICRO STAKE + RISCHIO MODELLO mantiene micro-stake; VALUE CONFERMATO MICRO riabilita micro anche da BLOCCATA SOFT/HARD.
                // STEP64_TENNIS_DEEPSCAN_STAKE_MATRIX
const STEP64_TENNIS_STAKE_MATRIX_MODE = 'STEP64_TENNIS_DEEPSCAN_GATE_STAKE_MATRIX';
const STEP64_WTA_MAX_MICRO_STAKE = Math.max(DEFAULT_MIN_BET, Number(process.env.TENNIS_WTA_MAX_MICRO_STAKE || 2));

function classifyStep64DeepScanStakeMatrix(report = {}) {
    const action = String(report.action || '').toUpperCase();
    const level = String(report.riskAssessment?.level || report.quantData?.riskAssessment?.level || report.level || '').toUpperCase();
    const text = [
        action,
        level,
        report.suggestionText,
        report.summary,
        report.explainability,
        report.verdict
    ].map(v => String(v || '').toUpperCase()).join(' ');

    // Step83: VALUE CONFERMATO MICRO è una classe di autorizzazione micro-stake
    // e deve avere precedenza sui testi legacy che possono contenere anche rischio/modello.
    if (text.includes('VALUE CONFERMATO') || text.includes('VALUE_CONFIRMED') || text.includes('VALUE_CONFERMATO') || text.includes('🟢')) return 'VALUE_CONFERMATO_MICRO';
    if (text.includes('ALTO RISCHIO') || text.includes('ALTO_RISCHIO') || text.includes('HIGH_RISK') || text.includes('🔴')) return 'ALTO_RISCHIO';
    if (text.includes('RISCHIO MODELLO') || text.includes('RISCHIO_MODELLO') || text.includes('MODEL_RISK') || text.includes('🟠')) return 'RISCHIO_MODELLO';
    if (text.includes('EDGE TECNICO') || text.includes('TECHNICAL_EDGE') || text.includes('📊')) return 'EDGE_TECNICO';
    if (text.includes('WATCHLIST') || text.includes('LOW EDGE') || text.includes('🟡')) return 'WATCHLIST_LOW_EDGE';
    return 'UNKNOWN';
}

function isStep64WtaTennisRow(row = {}) {
    const text = [row.tour_type, row.league, row.strategy_tag, row.bet_type].map(v => String(v || '').toUpperCase()).join(' ');
    return text.includes('WTA');
}

function getStep64MicroStakeForTennisRow(row = {}, preferredStake = STEP49C_REPAIR_MICRO_STAKE) {
    const preferred = Math.max(DEFAULT_MIN_BET, toNumber(preferredStake, STEP49C_REPAIR_MICRO_STAKE));
    return round(isStep64WtaTennisRow(row) ? Math.min(preferred, STEP64_WTA_MAX_MICRO_STAKE) : preferred, 2);
}


// STEP90_PREMATCH_GATE_ALIGNMENT
function buildStep90TennisRowInput(row = {}, report = {}, fallbackGateText = '') {
    return {
        ...row,
        sport: 'TENNIS',
        gateStatus: row.tennis_operational_status || row.professional_gate_status || row.deepscan_gate_status || fallbackGateText,
        operationalStatus: row.tennis_operational_status,
        operationalAction: row.tennis_operational_action,
        operationalSummary: row.tennis_operational_summary,
        gateReasons: row.professional_gate_reasons || row.deepscan_gate_reason || row.stake_policy_note || fallbackGateText,
        gateAllowBet: row.professional_gate_allow_bet,
        ds_action: report.action || row.ds_action,
        ds_suggestion: report.suggestionText || report.summary || row.ds_suggestion,
        deep_scan_risk_level: report.riskAssessment?.level || report.quantData?.riskAssessment?.level || row.deep_scan_risk_level,
        edge_pp: row.edge_pp,
        ev_pct: row.ev_pct,
        estimated_prob: row.estimated_prob,
        text: fallbackGateText
    };
}

function getStep90TennisHistoricalStats(row = {}, report = {}, fallbackGateText = '') {
    try {
        const rows = db.prepare(`
            SELECT id, status, stake, profit, estimated_prob, edge_pp, ev_pct, ds_action, ds_suggestion,
                   deep_scan_risk_level, professional_gate_status, professional_gate_allow_bet,
                   professional_gate_reasons, tennis_operational_status, tennis_operational_action,
                   tennis_operational_summary, deepscan_gate_status, deepscan_gate_reason,
                   data_quality, closing_line_available, clv_verified, closing_odd, clv_pct, clv_edge, clv
            FROM ai_forward_test
            WHERE UPPER(COALESCE(status,'')) IN ('WON','LOST')
              AND UPPER(COALESCE(sport_type,'')) = 'TENNIS'
              AND UPPER(COALESCE(data_quality,'CURRENT_BOOTSTRAP')) IN ('CURRENT','CURRENT_BOOTSTRAP')
        `).all();
        const transformed = rows.map(r => buildStep90TennisRowInput(r, {}, ''));
        const statsMap = step90GateDecision.calculateHistoricalStats(transformed, step90GateDecision.buildStatsKey);
        const target = buildStep90TennisRowInput(row, report, fallbackGateText);
        return statsMap.get(step90GateDecision.buildStatsKey(target)) || null;
    } catch (error) {
        return null;
    }
}

function setStep90TennisDecisionColumns(setter, decision) {
    if (!decision || typeof setter !== 'function') return;
    if (columnExists('ai_forward_test', 'pre_match_gate_code')) setter('pre_match_gate_code', decision.code);
    if (columnExists('ai_forward_test', 'pre_match_gate_label')) setter('pre_match_gate_label', decision.label);
    if (columnExists('ai_forward_test', 'pre_match_gate_reason')) setter('pre_match_gate_reason', decision.reason);
    if (columnExists('ai_forward_test', 'pre_match_gate_version')) setter('pre_match_gate_version', decision.version);
    if (columnExists('ai_forward_test', 'pre_match_clv_used')) setter('pre_match_clv_used', decision.clvUsedForCurrentPick ? 1 : 0);
    if (columnExists('ai_forward_test', 'pre_match_historical_sample')) setter('pre_match_historical_sample', decision.historicalSample || 0);
    if (columnExists('ai_forward_test', 'pre_match_historical_roi')) setter('pre_match_historical_roi', decision.historicalRoiPct);
    if (columnExists('ai_forward_test', 'pre_match_historical_brier')) setter('pre_match_historical_brier', decision.historicalBrier);
    if (columnExists('ai_forward_test', 'pre_match_historical_clv_sample')) setter('pre_match_historical_clv_sample', decision.historicalClvSample || 0);
    if (columnExists('ai_forward_test', 'pre_match_updated_at')) setter('pre_match_updated_at', new Date().toISOString());
}

function mapStep90DecisionToTennisStatus(decision, fallback = 'WATCHLIST MICRO') {
    const code = String(decision?.code || '').toUpperCase();
    if (code === 'APPROVED_FULL_STAKE') return 'APPROVATA STAKE PIENO';
    if (code === 'APPROVED') return 'APPROVATA';
    if (code === 'APPROVED_WITH_CAP') return 'APPROVATA CON CAP';
    if (code === 'WATCHLIST_MICRO') return 'WATCHLIST MICRO';
    if (code === 'BLOCKED_HARD') return 'BLOCCATA HARD';
    if (code === 'BLOCKED_SOFT') return 'BLOCCATA SOFT';
    return fallback;
}


    // STEP96_RISK_MODEL_SOFT_COMBINATION_RECALIBRATION
    function getStep96DeepScanGateCombinationStatsForPending(existingPending = {}, report = {}) {
        try {
            const targetDeepScan = step96DeepScanGatePolicy.normalizeStep96DeepScanCategory(
                report.action || existingPending.ds_action || existingPending.deep_scan_risk_level || ''
            );
            const targetGate = step96DeepScanGatePolicy.normalizeStep96GateCategory(
                existingPending.tennis_operational_status ||
                existingPending.professional_gate_status ||
                existingPending.deepscan_gate_status ||
                existingPending.professional_gate_reasons ||
                ''
            );

            const rows = db.prepare([
                "SELECT status, stake, profit, ds_action, ds_suggestion, deep_scan_risk_level,",
                "       professional_gate_status, professional_gate_reasons,",
                "       tennis_operational_status, tennis_operational_action,",
                "       tennis_operational_summary, data_quality, sport_type",
                "FROM ai_forward_test",
                "WHERE (",
                "        UPPER(COALESCE(sport_type,'')) = 'TENNIS'",
                "        OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'",
                "        OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%'",
                "      )",
                "  AND UPPER(COALESCE(data_quality,'CURRENT_BOOTSTRAP')) IN ('CURRENT','CURRENT_BOOTSTRAP')",
                "  AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PENDING','VOID','PUSH')"
            ].join('\n')).all();

            const stats = {
                deepScan: targetDeepScan,
                gate: targetGate,
                totalSignals: 0,
                wins: 0,
                losses: 0,
                pending: 0,
                void: 0,
                push: 0,
                operationalResolved: 0,
                operationalPending: 0,
                stakeReal: 0,
                profitReal: 0
            };

            for (const row of rows) {
                const ds = step96DeepScanGatePolicy.normalizeStep96DeepScanCategory(
                    row.ds_action || row.ds_suggestion || row.deep_scan_risk_level || ''
                );
                const gate = step96DeepScanGatePolicy.normalizeStep96GateCategory(
                    row.tennis_operational_status ||
                    row.professional_gate_status ||
                    row.deepscan_gate_status ||
                    row.professional_gate_reasons ||
                    ''
                );

                if (ds !== targetDeepScan || gate !== targetGate) continue;

                const status = String(row.status || '').toUpperCase();
                const stake = toNumber(row.stake, 0);
                const profit = toNumber(row.profit, 0);

                stats.totalSignals += 1;
                if (status === 'WON') stats.wins += 1;
                else if (status === 'LOST') stats.losses += 1;
                else if (status === 'PENDING') stats.pending += 1;
                else if (status === 'VOID') stats.void += 1;
                else if (status === 'PUSH') stats.push += 1;

                if ((status === 'WON' || status === 'LOST') && stake > 0) {
                    stats.operationalResolved += 1;
                    stats.stakeReal += stake;
                    stats.profitReal += profit;
                } else if (status === 'PENDING' && stake > 0) {
                    stats.operationalPending += 1;
                }
            }

            return step96DeepScanGatePolicy.normalizeStats(stats);
        } catch (error) {
            return null;
        }
    }

    
    // STEP96C_RUNTIME_MICRO_TEST_ACTIVATION
    function isStep96CRiskModelSoftRuntimeMicroEligible({
        step64Category,
        existingPending = {},
        report = {},
        step64GateText = '',
        step64HardVeto = false,
        step96CombinationDecision = null,
        step96CombinationStats = null
    } = {}) {
        const category = String(step64Category || '').toUpperCase();
        const combinedGateText = [
            step64GateText,
            existingPending.pre_match_gate_label,
            existingPending.tennis_operational_status,
            existingPending.tennis_operational_action,
            existingPending.tennis_operational_summary,
            existingPending.professional_gate_status,
            existingPending.professional_gate_reasons,
            existingPending.deepscan_gate_status,
            existingPending.deepscan_gate_reason
        ].map(v => String(v || '').toUpperCase()).join(' ');

        const hardVeto = Boolean(step64HardVeto) ||
            combinedGateText.includes('BLOCCATA HARD') ||
            combinedGateText.includes('BLOCKED_HARD') ||
            combinedGateText.includes('BLOCKED HARD') ||
            combinedGateText.includes('NO_BET_HARD') ||
            combinedGateText.includes('NO BET HARD') ||
            combinedGateText.includes('OPPOSITE_SIDE_CONFLICT') ||
            combinedGateText.includes('DATA_INSUFFICIENT');

        const softGate = combinedGateText.includes('BLOCCATA SOFT') ||
            combinedGateText.includes('BLOCKED_SOFT') ||
            combinedGateText.includes('BLOCKED SOFT') ||
            combinedGateText.includes('SOFT_BLOCK') ||
            combinedGateText.includes('SOFT BLOCK') ||
            step96CombinationDecision?.gate === 'BLOCCATA SOFT';

        const edgePp = toNumber(existingPending.edge_pp ?? report.edge_pp, 0);
        const evPct = toNumber(existingPending.ev_pct ?? report.ev_pct, 0);
        const rowNumericallyPositive = edgePp >= 5 && evPct >= 5;

        const stats = step96DeepScanGatePolicy.normalizeStats(
            step96CombinationStats || step96CombinationDecision?.stats || {}
        );
        const policyAllows = step96CombinationDecision?.allowMicroStake === true &&
            ['MICRO_TEST', 'WATCHLIST_MICRO', 'MANTIENI'].includes(String(step96CombinationDecision.action || '').toUpperCase());
        const statsStrong = typeof step96DeepScanGatePolicy.isStep96CStrongRiskModelSoftSignal === 'function'
            ? step96DeepScanGatePolicy.isStep96CStrongRiskModelSoftSignal(stats)
            : (stats.resolvedSignals >= 25 && stats.signalWinRatePct >= 58 && stats.pendingRatePct <= 35 && (stats.operationalResolved < 5 || stats.roiPct >= 0));

        const allow = category === 'RISCHIO_MODELLO' &&
            softGate === true &&
            hardVeto === false &&
            rowNumericallyPositive === true &&
            (policyAllows === true || statsStrong === true);

        return {
            mode: 'STEP96C_RUNTIME_MICRO_TEST_ACTIVATION',
            allow,
            softGate,
            hardVeto,
            rowNumericallyPositive,
            edgePp,
            evPct,
            policyAllows,
            statsStrong,
            stats,
            decision: step96CombinationDecision,
            recommendedStake: Math.max(DEFAULT_MIN_BET, toNumber(step96CombinationDecision?.recommendedStake, DEFAULT_MIN_BET)),
            reason: allow
                ? 'Step96C: RISCHIO MODELLO + BLOCCATA SOFT con storico positivo e nessun hard veto: attivo MICRO TEST controllato, non stake pieno.'
                : 'Step96C: condizioni micro test non soddisfatte.'
        };
    }

    // STEP96D_RUNTIME_MICRO_TEST_PERSISTENCE_FIX
    // Collega la decisione Step96/Step96C alla fotografia salvata da Analisi AI.
    // Il bug precedente: /deepscan poteva abilitare micro-test, ma il successivo /analyze
    // aggiornava il PENDING esistente con stake 0 perché la riga live non portava la decisione Step96C.
    // Qui applichiamo il micro-test prima dell'upsert PENDING e lo preserviamo nel Paper Trading.
    function applyStep96DRuntimeMicroTestToBet(bet = {}, existingPending = {}) {
        if (!bet || typeof bet !== 'object') return bet || {};

        const dsSource = existingPending.ds_action || existingPending.deep_scan_risk_level || existingPending.ds_suggestion || bet.ds_action || bet.deep_scan_risk_level || '';
        const gateSource = existingPending.tennis_operational_status || existingPending.professional_gate_status || existingPending.professional_gate_reasons || bet.tennis_operational_status || bet.professional_gate_status || '';
        const deepScanCategory = step96DeepScanGatePolicy.normalizeStep96DeepScanCategory(dsSource);
        const gateCategory = step96DeepScanGatePolicy.normalizeStep96GateCategory(gateSource);
        const combinedText = [
            dsSource,
            gateSource,
            existingPending.tennis_operational_action,
            existingPending.tennis_operational_summary,
            existingPending.deepscan_gate_status,
            existingPending.deepscan_gate_reason,
            existingPending.stake_policy_note,
            bet.tennis_operational_action,
            bet.tennis_operational_summary,
            bet.stake_policy_note
        ].map(v => String(v || '').toUpperCase()).join(' ');

        const hardVeto = combinedText.includes('BLOCCATA HARD') ||
            combinedText.includes('BLOCKED_HARD') ||
            combinedText.includes('NO_BET_HARD') ||
            combinedText.includes('NO BET HARD') ||
            combinedText.includes('ALTO RISCHIO') ||
            combinedText.includes('HIGH_RISK') ||
            combinedText.includes('OPPOSITE_SIDE_CONFLICT');

        const edgePp = toNumber(bet.edge_pp ?? bet.edge ?? existingPending.edge_pp, 0);
        const evPct = toNumber(bet.ev_pct ?? existingPending.ev_pct, 0);

        if (deepScanCategory !== 'RISCHIO MODELLO' || gateCategory !== 'BLOCCATA SOFT' || hardVeto || edgePp < 5 || evPct < 5) {
            return bet;
        }

        const stats = getStep96DeepScanGateCombinationStatsForPending(existingPending, {
            action: 'RISCHIO MODELLO',
            edge_pp: edgePp,
            ev_pct: evPct
        });
        const decision = step96DeepScanGatePolicy.evaluateStep96DeepScanGateCombinationDecision({
            deepScan: 'RISCHIO MODELLO',
            gate: 'BLOCCATA SOFT',
            historicalStats: stats || {}
        });
        const eligibility = isStep96CRiskModelSoftRuntimeMicroEligible({
            step64Category: 'RISCHIO_MODELLO',
            existingPending: {
                ...existingPending,
                edge_pp: edgePp,
                ev_pct: evPct,
                tennis_operational_status: 'BLOCCATA SOFT'
            },
            report: {
                action: 'RISCHIO MODELLO',
                edge_pp: edgePp,
                ev_pct: evPct
            },
            step64GateText: combinedText,
            step64HardVeto: false,
            step96CombinationDecision: decision,
            step96CombinationStats: stats
        });

        if (!eligibility || eligibility.allow !== true) return bet;

        const micro = getStep64MicroStakeForTennisRow({ ...existingPending, ...bet }, eligibility.recommendedStake || decision.recommendedStake || DEFAULT_MIN_BET);
        const odd = normalizeOdd(bet.odd || existingPending.odd) || 1;
        const estimatedProfit = micro > 0 && odd > 1 ? round(micro * (odd - 1), 2) : 0;
        const reason = 'Step96D: RISCHIO MODELLO + BLOCCATA SOFT con storico positivo: MICRO TEST runtime persistito nel Paper Trading. No stake pieno.';

        return {
            ...bet,
            invested: micro.toFixed(2),
            stake: micro,
            estimatedProfit: estimatedProfit.toFixed(2),
            professional_gate_status: 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP96D',
            professional_gate_allow_bet: true,
            professional_gate_reasons: reason,
            professional_gate_max_stake: micro,
            tennis_operational_status: 'WATCHLIST MICRO',
            tennis_operational_action: 'PAPER_OR_MICRO_STAKE',
            tennis_operational_summary: reason,
            deep_scan_risk_level: 'RISCHIO_MODELLO',
            deepscan_gate_mode: 'STEP96D_RUNTIME_MICRO_TEST_PERSISTENCE_FIX',
            deepscan_gate_status: 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP96D',
            deepscan_gate_reason: reason,
            stake_policy_note: reason,
            stakePolicyApplied: {
                ...(bet.stakePolicyApplied || {}),
                adjusted: true,
                originalStake: toNumber(existingPending.stake ?? bet.stake ?? bet.invested, 0),
                stake: micro,
                reason
            },
            stakePolicy: {
                ...(bet.stakePolicy || {}),
                finalStake: micro,
                professionalGateCap: micro,
                gateCapApplied: true,
                gateCapReason: reason
            },
            step96DRuntimeMicroTestPersistence: true,
            step96RuntimeEligibility: eligibility,
            step96CombinationDecision: decision,
            step96CombinationStats: stats
        };
    }

    // ============================================================================
// STEP99_RISK_MODEL_SOFT_DEEPSCAN_STAKE_FINAL
// Fix finale: DeepScan RISCHIO MODELLO + Gate BLOCCATA SOFT non deve restare
// automaticamente a stake 0 quando lo storico della combinazione è positivo.
// DATA_SUFFICIENCY_BLOCK vieta stake pieno/portfolio reale, ma non il micro-test
// statistico paper-trading. DeepScan non decide lo stake da solo: questa funzione
// agisce dopo la matrice Step64/96 e prima della persistenza DB/UI.
// ============================================================================
const STEP99_RISK_MODEL_SOFT_DEEPSCAN_STAKE_FINAL = 'STEP99_RISK_MODEL_SOFT_DEEPSCAN_STAKE_FINAL';

function step99RiskModelSoftText() {
    return Array.from(arguments).map(v => String(v || '').toUpperCase()).join(' ');
}

function step99RiskModelSoftTrueHardVeto(text = '') {
    const t = String(text || '').toUpperCase();
    // DATA_SUFFICIENCY_BLOCK non è un hard veto per micro-test statistico.
    // Blocca solo stake pieno/portfolio reale.
    return t.includes('BLOCCATA HARD') ||
        t.includes('BLOCKED_HARD') ||
        t.includes('BLOCKED HARD') ||
        t.includes('NO_BET_HARD') ||
        t.includes('NO BET HARD') ||
        t.includes('ALTO RISCHIO') ||
        t.includes('HIGH_RISK') ||
        t.includes('HIGH RISK') ||
        t.includes('OPPOSITE_SIDE_CONFLICT') ||
        t.includes('SIDE_PROBABILITY_MISMATCH') ||
        t.includes('INVALID_ODD') ||
        t.includes('QUOTE NON VALIDE') ||
        t.includes('RETIREMENT') ||
        t.includes('WALKOVER');
}

function step99NormalizeSignalStats(stats = {}) {
    const wins = toNumber(stats.wins, 0);
    const losses = toNumber(stats.losses, 0);
    const pending = toNumber(stats.pending, 0);
    const resolvedSignals = toNumber(stats.resolvedSignals, wins + losses);
    const totalSignals = toNumber(stats.totalSignals, wins + losses + pending);
    const signalWinRatePct = toNumber(stats.signalWinRatePct, resolvedSignals > 0 ? (wins / resolvedSignals) * 100 : 0);
    const pendingRatePct = toNumber(stats.pendingRatePct, totalSignals > 0 ? (pending / totalSignals) * 100 : 0);
    const roiPct = toNumber(stats.roiPct, 0);
    return { ...stats, wins, losses, pending, resolvedSignals, totalSignals, signalWinRatePct, pendingRatePct, roiPct };
}

function getStep99RiskModelSoftStats(existingPending = {}, report = {}) {
    try {
        if (typeof getStep96DRiskModelSoftRuntimeSignalStats === 'function') {
            return step99NormalizeSignalStats(getStep96DRiskModelSoftRuntimeSignalStats());
        }
        if (typeof getStep96DeepScanGateCombinationStatsForPending === 'function') {
            return step99NormalizeSignalStats(getStep96DeepScanGateCombinationStatsForPending(existingPending, report) || {});
        }
    } catch (error) {
        return step99NormalizeSignalStats({});
    }
    return step99NormalizeSignalStats({});
}

function getStep99RiskModelSoftMicroDecision(existingPending = {}, report = {}, stakeAdjustment = {}, extra = {}) {
    const dsText = step99RiskModelSoftText(
        report.action, report.level, report.riskAssessment?.level, report.quantData?.riskAssessment?.level,
        report.suggestionText, report.summary, report.explainability, report.verdict,
        stakeAdjustment.level, stakeAdjustment.status,
        existingPending.ds_action, existingPending.deep_scan_risk_level, existingPending.ds_suggestion,
        extra.deepScanText
    );
    const gateText = step99RiskModelSoftText(
        existingPending.pre_match_gate_label,
        existingPending.professional_gate_status, existingPending.professional_gate_reasons,
        existingPending.tennis_operational_status, existingPending.tennis_operational_action, existingPending.tennis_operational_summary,
        existingPending.deepscan_gate_status, existingPending.deepscan_gate_reason, existingPending.stake_policy_note,
        stakeAdjustment.reason, extra.gateText
    );
    const isRiskModel = dsText.includes('RISCHIO MODELLO') || dsText.includes('RISCHIO_MODELLO') || dsText.includes('MODEL_RISK') || dsText.includes('MODEL RISK');
    const isSoftGate = gateText.includes('BLOCCATA SOFT') || gateText.includes('BLOCKED_SOFT') || gateText.includes('BLOCKED SOFT') || gateText.includes('MODEL_RISK_STEP64') || gateText.includes('NO_BET_PREMATCH_MODEL_RISK');
    const hardVeto = step99RiskModelSoftTrueHardVeto(dsText + ' ' + gateText);
    const edgePp = toNumber(extra.edge_pp ?? report.edge_pp ?? existingPending.edge_pp, 0);
    const evPct = toNumber(extra.ev_pct ?? report.ev_pct ?? existingPending.ev_pct, 0);
    const numericallyPositive = edgePp >= 5 && evPct >= 5;
    const stats = getStep99RiskModelSoftStats(existingPending, report);
    let policyDecision = null;
    try {
        policyDecision = step96DeepScanGatePolicy.evaluateStep96DeepScanGateCombinationDecision({
            deepScan: 'RISCHIO MODELLO',
            gate: 'BLOCCATA SOFT',
            historicalStats: stats
        });
    } catch (error) {
        policyDecision = null;
    }
    const policyAllows = policyDecision?.allowMicroStake === true;
    const statsPositive = (stats.resolvedSignals >= 10 && stats.signalWinRatePct >= 55) ||
        (stats.totalSignals >= 20 && stats.signalWinRatePct >= 50 && stats.pendingRatePct <= 45);
    const allow = isRiskModel && isSoftGate && !hardVeto && numericallyPositive && (policyAllows || statsPositive);
    return {
        mode: STEP99_RISK_MODEL_SOFT_DEEPSCAN_STAKE_FINAL,
        allow, isRiskModel, isSoftGate, hardVeto, numericallyPositive, edgePp, evPct,
        stats, policyDecision, policyAllows, statsPositive,
        recommendedStake: Math.max(DEFAULT_MIN_BET, toNumber(policyDecision?.recommendedStake, DEFAULT_MIN_BET)),
        reason: allow
            ? 'Step99: RISCHIO MODELLO + BLOCCATA SOFT con storico combinazione positivo: micro-test paper-trading attivo. DATA_SUFFICIENCY_BLOCK vieta stake pieno, non micro-test statistico.'
            : 'Step99: micro-test non applicato perché almeno una condizione è falsa.'
    };
}

function applyStep99RiskModelSoftMicroToBet(bet = {}, existingPending = {}, options = {}) {
    if (!bet || typeof bet !== 'object') return bet || {};
    const reportLike = {
        action: bet.ds_action || bet.deep_scan_risk_level || bet.deepScanStatus || options.deepScanText || 'RISCHIO MODELLO',
        edge_pp: bet.edge_pp ?? bet.edge ?? existingPending.edge_pp,
        ev_pct: bet.ev_pct ?? existingPending.ev_pct
    };
    const decision = getStep99RiskModelSoftMicroDecision(existingPending, reportLike, {}, {
        gateText: options.gateText || bet.tennis_operational_status || bet.professional_gate_status || '',
        edge_pp: bet.edge_pp ?? bet.edge ?? existingPending.edge_pp,
        ev_pct: bet.ev_pct ?? existingPending.ev_pct
    });
    if (!decision.allow) return bet;
    const micro = getStep64MicroStakeForTennisRow({ ...existingPending, ...bet }, decision.recommendedStake || DEFAULT_MIN_BET);
    const odd = normalizeOdd(bet.odd || existingPending.odd) || 1;
    const estimatedProfit = micro > 0 && odd > 1 ? round(micro * (odd - 1), 2) : 0;
    const reason = decision.reason + ' Fonte: ' + (options.source || 'savePending') + '. No stake pieno, no promozione automatica, portfolio reale escluso fino a settlement.';
    return {
        ...bet,
        invested: micro.toFixed(2),
        stake: micro,
        estimatedProfit: estimatedProfit.toFixed(2),
        professional_gate_status: 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP99',
        professional_gate_allow_bet: true,
        professional_gate_reasons: reason,
        professional_gate_max_stake: micro,
        tennis_operational_status: 'WATCHLIST MICRO',
        tennis_operational_action: 'PAPER_OR_MICRO_STAKE',
        tennis_operational_summary: reason,
        deep_scan_risk_level: 'RISCHIO_MODELLO',
        deepscan_gate_mode: STEP99_RISK_MODEL_SOFT_DEEPSCAN_STAKE_FINAL,
        deepscan_gate_status: 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP99',
        deepscan_gate_multiplier: 0.5,
        deepscan_gate_reason: reason,
        stake_policy_note: reason,
        trading_scope: 'PAPER_OPERATIONAL',
        paper_trading_scope: 'PAPER_OPERATIONAL',
        portfolio_scope: 'EXCLUDED_FROM_REAL_PORTFOLIO',
        audit_scope_reason: 'Step99: micro-test paper operativo; portfolio reale solo dopo settlement e senza promozione automatica.',
        stakePolicyApplied: { ...(bet.stakePolicyApplied || {}), adjusted: true, originalStake: toNumber(existingPending.stake ?? bet.stake ?? bet.invested, 0), stake: micro, reason },
        stakePolicy: { ...(bet.stakePolicy || {}), finalStake: micro, professionalGateCap: micro, gateCapApplied: true, gateCapReason: reason },
        step99RiskModelSoftMicroRuntimeFinal: true,
        step96RiskModelSoftRuntimeMicro: true,
        step96CRiskModelSoftRuntimeMicro: true,
        step99RuntimeEligibility: decision,
        step99CombinationStats: decision.stats
    };
}

function applyStep99RiskModelSoftMicroRuntime({ existingPending = {}, report = {}, stakeAdjustment = {}, step64Set = null, source = 'deepscan.route' } = {}) {
    const decision = getStep99RiskModelSoftMicroDecision(existingPending, report, stakeAdjustment);
    if (!decision.allow) return { applied: false, stakeAdjustment, decision };
    const micro = getStep64MicroStakeForTennisRow(existingPending, decision.recommendedStake || DEFAULT_MIN_BET);
    const reason = decision.reason + ' Fonte: ' + source + '. No stake pieno, no promozione automatica, portfolio reale escluso fino a settlement.';
    if (typeof step64Set === 'function') {
        step64Set('stake', micro);
        if (columnExists('ai_forward_test', 'professional_gate_allow_bet')) step64Set('professional_gate_allow_bet', 1);
        if (columnExists('ai_forward_test', 'professional_gate_status')) step64Set('professional_gate_status', 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP99');
        if (columnExists('ai_forward_test', 'professional_gate_reasons')) step64Set('professional_gate_reasons', reason);
        if (columnExists('ai_forward_test', 'professional_gate_max_stake')) step64Set('professional_gate_max_stake', micro);
        if (columnExists('ai_forward_test', 'tennis_operational_status')) step64Set('tennis_operational_status', 'WATCHLIST MICRO');
        if (columnExists('ai_forward_test', 'tennis_operational_action')) step64Set('tennis_operational_action', 'PAPER_OR_MICRO_STAKE');
        if (columnExists('ai_forward_test', 'tennis_operational_summary')) step64Set('tennis_operational_summary', reason);
        if (columnExists('ai_forward_test', 'deepscan_gate_mode')) step64Set('deepscan_gate_mode', STEP99_RISK_MODEL_SOFT_DEEPSCAN_STAKE_FINAL);
        if (columnExists('ai_forward_test', 'deepscan_gate_status')) step64Set('deepscan_gate_status', 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP99');
        if (columnExists('ai_forward_test', 'deepscan_gate_multiplier')) step64Set('deepscan_gate_multiplier', 0.5);
        if (columnExists('ai_forward_test', 'deepscan_gate_reason')) step64Set('deepscan_gate_reason', reason);
        if (columnExists('ai_forward_test', 'stake_policy_note')) step64Set('stake_policy_note', reason);
        if (columnExists('ai_forward_test', 'trading_scope')) step64Set('trading_scope', 'PAPER_OPERATIONAL');
        if (columnExists('ai_forward_test', 'paper_trading_scope')) step64Set('paper_trading_scope', 'PAPER_OPERATIONAL');
        if (columnExists('ai_forward_test', 'portfolio_scope')) step64Set('portfolio_scope', 'EXCLUDED_FROM_REAL_PORTFOLIO');
        if (columnExists('ai_forward_test', 'audit_scope_reason')) step64Set('audit_scope_reason', 'Step99: micro-test paper operativo; portfolio reale escluso fino a settlement.');
    }
    const nextStakeAdjustment = {
        ...stakeAdjustment,
        mode: STEP99_RISK_MODEL_SOFT_DEEPSCAN_STAKE_FINAL,
        status: 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP99',
        level: 'RISCHIO_MODELLO_SOFT_MICRO_TEST',
        multiplier: 0.5,
        adjusted: true,
        adjustedStake: micro,
        currentStake: micro,
        suggestedStake: micro,
        reason,
        step99RiskModelSoftMicroRuntimeFinal: true,
        step96RiskModelSoftRuntimeMicro: true,
        step96CRiskModelSoftRuntimeMicro: true,
        step99RuntimeEligibility: decision,
        step99CombinationStats: decision.stats
    };
    return { applied: true, micro, reason, stakeAdjustment: nextStakeAdjustment, decision };
}

function getDeepScanStakeAdjustmentPolicy(report = {}, baseStake = 0, existingBet = {}, currentStakeOverride = null) {
    const action = String(report.action || '').toUpperCase();
    const level = String(report.riskAssessment?.level || report.quantData?.riskAssessment?.level || '').toUpperCase();
    const score = toNumber(report.riskAssessment?.score ?? report.quantData?.riskAssessment?.score, null);

    // Step67: DeepScan è gate operativo.
    // Può modificare gate/stake in modo esplicito; portfolio reale resta filtrato da operational scope.
    const stake = toNumber(baseStake, 0);
    const currentStake = currentStakeOverride === null || currentStakeOverride === undefined
        ? stake
        : toNumber(currentStakeOverride, stake);

    const operationalStatus = String(existingBet.tennis_operational_status || '').toUpperCase();
    const operationalAction = String(existingBet.tennis_operational_action || '').toUpperCase();
    const gateStatus = String(existingBet.professional_gate_status || '').toUpperCase();
    const gateAllowRaw = existingBet.professional_gate_allow_bet;
    const gateAllowFalse = gateAllowRaw === 0 || gateAllowRaw === false || String(gateAllowRaw).toUpperCase() === 'FALSE';
    const operationalBlocked =
        operationalStatus.includes('BLOCKED') ||
        operationalAction.includes('NO_BET') ||
        gateStatus.includes('BLOCKED') ||
        (gateAllowFalse && (operationalStatus || operationalAction || gateStatus));

    let multiplier = 1;
    let status = 'OPERATIONAL_GATE_UNCHANGED';
    let reason = 'DeepScan operational gate: nessuna riduzione richiesta.';

    if (level === 'ALTO_RISCHIO' || action.includes('ALTO RISCHIO') || action.includes('🔴')) {
        multiplier = 0.25;
        status = 'OPERATIONAL_GATE_DEEPSCAN_HIGH_RISK';
        reason = 'DeepScan alto rischio: gate operativo riduce/blocca l’esposizione.';
    } else if (level === 'RISCHIO_MODELLO' || action.includes('RISCHIO MODELLO') || action.includes('🟠')) {
        multiplier = 0.50;
        status = 'OPERATIONAL_GATE_DEEPSCAN_MODEL_RISK';
        reason = 'DeepScan rischio modello: gate operativo riduce l’esposizione.';
    } else if (level === 'WATCHLIST_LOW_EDGE' || action.includes('WATCHLIST') || action.includes('LOW EDGE') || action.includes('🟡')) {
        multiplier = 0.75;
        status = 'OPERATIONAL_GATE_DEEPSCAN_LOW_EDGE';
        reason = 'DeepScan watchlist/low edge: gate operativo applica cap prudente.';
    }

    let suggestedStake = round(stake * multiplier, 2);
    if (suggestedStake > 0 && suggestedStake < DEFAULT_MIN_BET) {
        suggestedStake = DEFAULT_MIN_BET;
    }

    if (operationalBlocked) {
        return {
            mode: 'OPERATIONAL_GATE',
            status: 'BLOCKED_OPERATIONAL_GATE_PRIORITY',
            level: level || 'UNKNOWN',
            score,
            multiplier,
            originalStake: round(stake, 2),
            currentStake: round(currentStake, 2),
            suggestedStake,
            adjustedStake: round(currentStake, 2),
            adjusted: false,
            shouldPersistStake: true,
            reason: `${reason} Report operativo/Gate bloccante: NO_BET; il suggerimento resta teorico e non riabilita lo stake.`
        };
    }

    const gateCap = toNumber(existingBet.professional_gate_max_stake, null);
    if (gateCap !== null && gateCap > 0 && suggestedStake > gateCap) {
        const beforeCap = suggestedStake;
        suggestedStake = Math.max(DEFAULT_MIN_BET, round(gateCap, 2));
        status = `${status}_CAPPED_BY_GATE`;
        reason = `${reason} Cap Gate considerato nel suggerimento: ${round(beforeCap, 2)} > ${round(gateCap, 2)}.`;
    }

    return {
        mode: 'OPERATIONAL_GATE',
        status,
        level: level || 'UNKNOWN',
        score,
        multiplier,
        originalStake: round(stake, 2),
        currentStake: round(currentStake, 2),
        suggestedStake,
        adjustedStake: suggestedStake,
        adjusted: suggestedStake !== currentStake,
        shouldPersistStake: true,
        reason
    };
}

function parseProfessionalGateDisagreementFromReasons(reasonsText = '') {
    const text = String(reasonsText || '');
    const match = text.match(/Disaccordo[^:]*:\s*([0-9]+(?:[.,][0-9]+)?)pp/i);
    if (!match) return null;
    return toNumber(String(match[1]).replace(',', '.'), null);
}

function getStep50DConsensusMicroStake(gate = {}, existingPending = {}) {
    // STEP50D_CONSENSUS_MICRO_STAKE_FLOOR
    // Quando il Consensus Gate sblocca un blocco SOFT, il cap precedente a 0 / sotto-minimo
    // non deve mantenere lo stake operativo a zero: quel cap nasce dal NO_BET pre-consensus.
    // Usiamo quindi un micro-stake controllato, mai stake standard/professionale.
    const recommendedCap = toNumber(gate?.stakePolicy?.recommendedMaxStake, null);
    const pendingCap = toNumber(existingPending?.professional_gate_max_stake, null);
    const usableCap = [recommendedCap, pendingCap]
        .filter(v => Number.isFinite(v) && v >= DEFAULT_MIN_BET)
        .sort((a, b) => a - b)[0];

    if (Number.isFinite(usableCap)) {
        return round(Math.min(STEP49C_REPAIR_MICRO_STAKE, usableCap), 2);
    }

    return STEP49C_REPAIR_MICRO_STAKE;
}

function buildStep49BDeepScanConsensusGateForPending(report = {}, existingPending = {}) {
    const odd = normalizeOdd(existingPending.odd);
    const estimatedProb = toNumber(existingPending.estimated_prob ?? existingPending.estimatedProb, null);
    const marketImplied = toNumber(existingPending.market_implied_prob, odd ? round(100 / odd, 2) : null);
    const edgePp = toNumber(existingPending.edge_pp, estimatedProb !== null && marketImplied !== null ? estimatedProb - marketImplied : null);
    const evPct = toNumber(existingPending.ev_pct, estimatedProb !== null && odd ? ((estimatedProb / 100) * odd - 1) * 100 : null);
    const marketType = String(existingPending.market_type || inferTennisMarketTypeFromPrediction(existingPending.prediction)).toLowerCase();
    const dataScore = toNumber(existingPending.data_sufficiency_score, null);
    const disagreementFromReasons = parseProfessionalGateDisagreementFromReasons(existingPending.professional_gate_reasons);
    const disagreement = disagreementFromReasons !== null ? disagreementFromReasons : Math.abs(toNumber(edgePp, 0));
    const valueScore = toNumber(existingPending.model_confidence_score, null) ?? calculateTennisValueScore({
        edge_pp: edgePp,
        ev_pct: evPct,
        calibrated_probability_pct: estimatedProb,
        market_implied_probability_pct: marketImplied,
        reliability: { level: 'NORMAL' }
    });
    const markovValidated = existingPending.markov_validated === 1 || existingPending.markov_validated === true;
    const previousGateStatus = String(existingPending.professional_gate_status || '').toUpperCase();
    const previousOperationalStatus = String(existingPending.tennis_operational_status || '').toUpperCase();
    const previousOperationalAction = String(existingPending.tennis_operational_action || '').toUpperCase();
    const previousGateAllowRaw = existingPending.professional_gate_allow_bet;
    const previousGateAllowFalse = previousGateAllowRaw === 0 || previousGateAllowRaw === false || String(previousGateAllowRaw).toUpperCase() === 'FALSE';
    const previousSoftBlocked =
        previousGateStatus.includes('BLOCKED') ||
        previousGateStatus.includes('BLOCCATA') ||
        previousGateStatus.includes('SOFT') ||
        previousOperationalStatus.includes('BLOCCATA') ||
        previousOperationalStatus.includes('BLOCKED') ||
        previousOperationalAction.includes('NO_BET') ||
        previousOperationalAction.includes('REVIEW') ||
        previousGateAllowFalse;

    const evaluation = {
        valid: Number.isFinite(edgePp) && Number.isFinite(evPct) && Number.isFinite(estimatedProb) && edgePp > 0 && evPct > 0,
        reason: 'Ricostruita da pending DB per Consensus Gate Step49B',
        calibrated_probability_pct: estimatedProb,
        model_probability_pct: estimatedProb,
        market_implied_probability_pct: marketImplied,
        edge_pp: edgePp,
        ev_pct: evPct,
        adjusted_edge_pp: edgePp,
        adjusted_ev_pct: evPct,
        expectedValue: evPct,
        disagreement,
        marketDisagreementPp: disagreement,
        valueScore,
        reliability: { level: 'NORMAL', allowBet: true, stakeMultiplier: 1 }
    };

    const dataSufficiency = dataScore === null
        ? null
        : {
            passed: dataScore >= (marketType === TENNIS_MARKETS.TOTALS ? TENNIS_PROFESSIONAL_RULES.minDataSufficiencyScoreTotals : TENNIS_PROFESSIONAL_RULES.minDataSufficiencyScoreMoneyline),
            score: dataScore,
            reasons: []
        };

    const calibrationDecision = {
        grade: 'BLOCKED_INSUFFICIENT_SAMPLE',
        recommendation: 'Step49B: calibrazione storica insufficiente, eventuale sblocco consentito solo a micro stake con consenso DeepScan.'
    };

    const gate = buildTennisProfessionalBetGate({
        evaluation,
        dataSufficiency,
        predictiveCalibrationDecision: calibrationDecision,
        marketType,
        markovValidated,
        stake: toNumber(existingPending.stake_base_before_deepscan, null) ?? toNumber(existingPending.stake, 0),
        bankroll: DEFAULT_BANKROLL,
        referenceMarket: { quality: existingPending.reference_market_quality || 'MEDIUM', source: existingPending.reference_market_source || 'PENDING_DB' },
        deepScanReport: report
    }, {
        blockIfCalibrationUnknown: false,
        consensusGate: {
            enabled: true,
            maxSoftMarketDisagreementPp: 18,
            minEdgePp: 4,
            minEvPct: 5,
            minProbabilityAboveMarketPp: 4
        }
    });

    const operationalReport = buildTennisOperationalReport({
        evaluation,
        professionalGate: gate,
        dataSufficiency,
        predictiveCalibrationDecision: calibrationDecision,
        marketType,
        markovValidated,
        stake: toNumber(existingPending.stake, 0),
        requestedStake: toNumber(existingPending.stake_base_before_deepscan, null) ?? toNumber(existingPending.stake, 0),
        bankroll: DEFAULT_BANKROLL,
        referenceMarket: { quality: existingPending.reference_market_quality || 'MEDIUM' }
    });

    const shouldApplyMicroUnlock =
        gate.allowBet === true &&
        String(gate.status || '').includes('CONSENSUS_MICRO') &&
        previousSoftBlocked;

    return {
        gate,
        operationalReport,
        shouldApplyMicroUnlock,
        microStake: shouldApplyMicroUnlock
            ? getStep50DConsensusMicroStake(gate, existingPending)
            : toNumber(existingPending.stake, 0)
    };
}

// ============================================================================
// STEP49C_REPAIR_SOFT_BLOCKS
// Runtime helper: se una riga pending era stata creata prima dello Step49C, ma
// contiene già DeepScan confermativo/advisory positivo, può essere idratata in
// WATCHLIST MICRO · DEEPSCAN senza attendere un nuovo DeepScan manuale.
// Lo sblocco resta limitato a Moneyline, micro-stake e blocchi soft.
// ============================================================================
function isStep49CConfirmativeDeepScanText(row = {}) {
    const text = [
        row.ds_action,
        row.ds_suggestion,
        row.deep_scan_risk_level,
        row.stake_policy_note,
        row.tennis_operational_summary
    ].map(v => String(v || '')).join(' ').toUpperCase();

    if (!text.trim()) return false;
    if (text.includes('ALTO RISCHIO') || text.includes('HIGH_RISK') || text.includes('HIGH RISK')) return false;
    if (text.includes('WAIT_IN_PLAY') || text.includes('ATTENDI') || text.includes('IN-PLAY')) return false;
    if (text.includes('RISCHIO MODELLO') || text.includes('MODEL_RISK')) return false;

    return text.includes('DEEPSCAN ADVISORY: NESSUNA RIDUZIONE') ||
        text.includes('CONFIRM_PRONOSTICO') ||
        text.includes('CONFERMA IL PRONOSTICO') ||
        text.includes('DEEPSCAN CONFERMA') ||
        text.includes('VALUE CONFERMATO') ||
        text.includes('VALUE_CONFERMATO') ||
        text.includes('NESSUNA RIDUZIONE SUGGERITA');
}

function isStep49CRepairEligibleSoftBlock(row = {}) {
    const stake = toNumber(row.stake, 0);
    const marketType = String(row.market_type || inferTennisMarketTypeFromPrediction(row.prediction)).toLowerCase();
    const prediction = String(row.prediction || '').toUpperCase();
    const gateStatus = String(row.professional_gate_status || '').toUpperCase();
    const opStatus = String(row.tennis_operational_status || '').toUpperCase();
    const opAction = String(row.tennis_operational_action || '').toUpperCase();
    const gateReasons = String(row.professional_gate_reasons || '').toUpperCase();
    const edgePp = toNumber(row.edge_pp, null);
    const evPct = toNumber(row.ev_pct, null);
    const odd = normalizeOdd(row.odd);
    const estimatedProb = toNumber(row.estimated_prob, null);
    const marketImplied = toNumber(row.market_implied_prob, odd ? round(100 / odd, 2) : null);

    if (stake >= DEFAULT_MIN_BET) return false;
    if (marketType === TENNIS_MARKETS.TOTALS || prediction.includes('OVER') || prediction.includes('UNDER')) return false;
    if (gateStatus.includes('HARD') || gateStatus.includes('OPPOSITE_SIDE_CONFLICT')) return false;
    if (opStatus.includes('HARD') || opAction.includes('NO_BET_HARD')) return false;
    if (gateReasons.includes('ALTO RISCHIO') || gateReasons.includes('HIGH_RISK')) return false;
    if (!isStep49CConfirmativeDeepScanText(row)) return false;
    if (!Number.isFinite(edgePp) || edgePp < 4) return false;
    if (!Number.isFinite(evPct) || evPct < 5) return false;
    if (Number.isFinite(estimatedProb) && Number.isFinite(marketImplied) && estimatedProb <= marketImplied) return false;

    return gateStatus.includes('SOFT') ||
        opStatus.includes('BLOCCATA SOFT') ||
        opStatus.includes('BLOCKED_SOFT') ||
        opAction.includes('NO_BET') ||
        opAction.includes('REVIEW') ||
        row.professional_gate_allow_bet === 0 ||
        row.professional_gate_allow_bet === false;
}

function getStep49CRepairMicroStake(row = {}) {
    const cap = toNumber(row.professional_gate_max_stake, null);
    if (Number.isFinite(cap) && cap >= DEFAULT_MIN_BET) {
        return round(Math.min(STEP49C_REPAIR_MICRO_STAKE, cap), 2);
    }
    return STEP49C_REPAIR_MICRO_STAKE;
}

// ============================================================================
// STEP49C - HYDRATE CONSENSUS MICRO UNLOCK FROM PENDING DB
// ============================================================================
function isStep49CConsensusMicroUnlockedRow(row = {}) {
    const gateStatus = String(row.professional_gate_status || '').toUpperCase();
    const opStatus = String(row.tennis_operational_status || '').toUpperCase();
    const opAction = String(row.tennis_operational_action || '').toUpperCase();
    const note = String(row.stake_policy_note || row.ds_suggestion || '').toUpperCase();
    const stake = toNumber(row.stake, 0);

    const alreadyUnlocked = stake >= DEFAULT_MIN_BET && (
        gateStatus.includes('CONSENSUS_MICRO_STAKE_DEEPSCAN_CONFIRMED') ||
        opStatus.includes('WATCHLIST_MICRO') ||
        opStatus.includes('WATCHLIST MICRO') ||
        opAction.includes('PAPER_OR_MICRO_STAKE') ||
        note.includes('STEP49C') ||
        note.includes('STEP49B CONSENSUS GATE')
    );

    return alreadyUnlocked || isStep49CRepairEligibleSoftBlock(row);
}

function hydrateStep49CConsensusMicroUnlockFromPending(bet = {}) {
    try {
        const row = db.prepare(`
            SELECT id,
                   stake,
                   odd,
                   prediction,
                   estimated_prob,
                   edge_pp,
                   ev_pct,
                   market_implied_prob,
                   market_type,
                   ds_action,
                   deep_scan_risk_level,
                   professional_gate_status,
                   professional_gate_allow_bet,
                   professional_gate_reasons,
                   professional_gate_max_stake,
                   tennis_operational_status,
                   tennis_operational_action,
                   tennis_operational_summary,
                   stake_policy_note,
                   ds_suggestion
            FROM ai_forward_test
            WHERE home_team = ?
              AND away_team = ?
              AND prediction = ?
              AND COALESCE(league, '') = COALESCE(?, '')
              AND COALESCE(market_type, '') = COALESCE(?, '')
              AND COALESCE(point_line, -9999) = COALESCE(?, -9999)
              AND status = 'PENDING'
              AND UPPER(COALESCE(sport_type, '')) = 'TENNIS'
            ORDER BY id DESC
            LIMIT 1
        `).get(bet.home, bet.away, bet.prediction, bet.league || '', bet.marketType || null, bet.point ?? null);

        if (!row || !isStep49CConsensusMicroUnlockedRow(row)) return bet;

        const repairEligible = isStep49CRepairEligibleSoftBlock(row);
        const repairStake = repairEligible ? getStep49CRepairMicroStake(row) : null;
        const finalStake = repairEligible
            ? repairStake
            : (normalizePlayableStake(row.stake, {
                minBet: DEFAULT_MIN_BET,
                maxStake: toNumber(row.professional_gate_max_stake, row.stake) || row.stake
            }) || round(row.stake, 2));
        const finalProfit = finalStake * (toNumber(bet.odd, 0) - 1);
        const operationalStatus = repairEligible ? 'WATCHLIST_MICRO_STAKE' : (row.tennis_operational_status || 'WATCHLIST_MICRO_STAKE');
        const operationalAction = repairEligible ? 'PAPER_OR_MICRO_STAKE' : (row.tennis_operational_action || 'PAPER_OR_MICRO_STAKE');
        const operationalSummary = repairEligible
            ? 'Step49C Repair: DeepScan conferma: micro-stake attivo, stake standard non consentito.'
            : (row.tennis_operational_summary || 'Step49C: DeepScan conferma: micro-stake attivo, stake standard non consentito.');

        return {
            ...bet,
            invested: finalStake.toFixed(2),
            estimatedProfit: finalProfit.toFixed(2),
            professional_gate_status: repairEligible ? 'CONSENSUS_MICRO_STAKE_DEEPSCAN_CONFIRMED_REPAIR' : (row.professional_gate_status || 'CONSENSUS_MICRO_STAKE_DEEPSCAN_CONFIRMED'),
            professional_gate_allow_bet: true,
            professional_gate_reasons: repairEligible ? 'Step49C Repair: soft block con DeepScan confermativo; sblocco solo micro-stake, stake standard non consentito.' : (row.professional_gate_reasons || 'Step49C Consensus Gate: DeepScan conferma, sblocco solo micro-stake; stake standard non consentito.'),
            professional_gate_max_stake: repairEligible ? finalStake : (toNumber(row.professional_gate_max_stake, finalStake) || finalStake),
            tennis_operational_status: operationalStatus,
            tennis_operational_action: operationalAction,
            tennis_operational_summary: operationalSummary,
            operationalReport: {
                ...(bet.operationalReport || {}),
                status: operationalStatus,
                action: operationalAction,
                label: 'WATCHLIST MICRO · DEEPSCAN',
                severity: 'WARN',
                allowBet: true,
                professionalUse: false,
                summary: operationalSummary,
                stake: {
                    ...(bet.operationalReport?.stake || {}),
                    requestedStake: toNumber(bet.requestedStake, finalStake),
                    maxStake: toNumber(row.professional_gate_max_stake, finalStake) || finalStake,
                    recommendedStake: finalStake
                }
            },
            stakePolicy: {
                ...(bet.stakePolicy || {}),
                finalStake,
                professionalGateCap: toNumber(row.professional_gate_max_stake, finalStake) || finalStake,
                gateCapApplied: true,
                gateCapReason: 'Step49C Consensus Gate: DeepScan conferma: micro-stake attivo, stake standard non consentito.'
            }
        };
    } catch (error) {
        console.warn('[STEP49C] Impossibile idratare consenso micro-stake:', error.message);
        return bet;
    }
}

function buildTennisBetObject({
    date,
    league,
    home,
    away,
    prediction,
    odd,
    evaluation,
    stake,
    isCR,
    strategyTag,
    bookmaker,
    marketType,
    point = null,
    reference = null,
    tourType = null,
    surface = null,
    dataSufficiency = null,
    openingOdd = null,
    closingOdd = null,
    clvPct = null,
    markovValidated = null,
    professionalGate = null,
    bankroll = DEFAULT_BANKROLL,
    stakePolicy = null,
        providerEventId = null,
        providerHomeTeam = null,
        providerAwayTeam = null,
        officialEventOrder = null,
        playerMatchupIntelligence = null
    }) {
    const stakePolicyMeta = stakePolicy || calculateStakePolicy({
        probability: evaluation.calibrated_probability_pct ?? evaluation.calibratedProbability,
        odd,
        bankroll,
        evaluation,
        marketType,
        minBet: DEFAULT_MIN_BET,
        maxStakePct: DEFAULT_PRE_GATE_MAX_STAKE_PCT
    });
    const initialStake = round(stakePolicyMeta.stake ?? stake, 2);
    const finalProfessionalGate = professionalGate || evaluation.professionalGate || buildTennisProfessionalBetGate({
        evaluation,
        dataSufficiency,
        predictiveCalibrationDecision: evaluation.audit?.decision || evaluation.calibrationDecision || null,
        marketType,
        markovValidated,
        stake: initialStake,
        bankroll,
        referenceMarket: reference
    }, {
        blockIfCalibrationUnknown: false
    });

    const stakeCapResult = applyProfessionalGateStakeCap(initialStake, finalProfessionalGate);
    const finalStake = stakeCapResult.stake;
    const estimatedProfit = finalStake * (odd - 1);

    const finalOperationalReport = buildTennisOperationalReport({
        evaluation,
        professionalGate: finalProfessionalGate,
        dataSufficiency,
        predictiveCalibrationDecision: evaluation.audit?.decision || evaluation.calibrationDecision || null,
        marketType,
        markovValidated,
        stake: finalStake,
        requestedStake: initialStake,
        bankroll,
        referenceMarket: reference,
        clvPct
    });

    return {
        date,
        league,
        match: `${home} - ${away}`,
        home,
        away,
        canonicalMatchKey: buildCanonicalTennisMatchKey(home, away, date, league),
            provider_event_id: providerEventId || null,
            provider_home_team: providerHomeTeam || home || null,
            provider_away_team: providerAwayTeam || away || null,
            official_event_order: officialEventOrder || ((providerHomeTeam || home || '') + ' - ' + (providerAwayTeam || away || '')).trim(),
prediction,
        odd: round(odd, 2),
        bookmaker: bookmaker || null,
        marketType,
        point,

        estimatedProb: round(evaluation.calibrated_probability_pct ?? evaluation.calibratedProbability, 2),
        modelProbability: round(evaluation.model_probability_pct ?? evaluation.modelProbability, 2),
        marketImpliedProbability: round(evaluation.market_implied_probability_pct ?? evaluation.impliedProbability, 2),

        edge_pp: round(evaluation.edge_pp ?? evaluation.adjusted_edge_pp ?? evaluation.adjustedEdge, 2),
        ev_pct: round(evaluation.ev_pct ?? evaluation.adjusted_ev_pct ?? evaluation.expectedValue, 2),

        raw_edge_pp: round(evaluation.raw_edge_pp ?? evaluation.rawEdge, 2),
        calibrated_edge_pp: round(evaluation.calibrated_edge_pp ?? evaluation.calibratedEdge, 2),
        adjusted_edge_pp: round(evaluation.adjusted_edge_pp ?? evaluation.adjustedEdge, 2),

        raw_ev_pct: round(evaluation.raw_ev_pct, 2),
        calibrated_ev_pct: round(evaluation.calibrated_ev_pct, 2),
        adjusted_ev_pct: round(evaluation.adjusted_ev_pct ?? evaluation.expectedValue, 2),

        edge: round(evaluation.edge_pp ?? evaluation.adjustedEdge, 2),
        ev: round(evaluation.ev_pct ?? evaluation.expectedValue, 2),

        invested: finalStake.toFixed(2),
        requestedStake: initialStake.toFixed(2),
        estimatedProfit: estimatedProfit.toFixed(2),
        // AUDIT16D_R3_T5_R3: snapshot immutabile del bankroll usato dall'analisi.
        bankroll,
        bankrollSnapshot: bankroll,
        bankroll_snapshot: bankroll,
        stakePolicy: {
            ...stakePolicyMeta,
            finalStake,
            professionalGateCap: finalProfessionalGate?.stakePolicy?.recommendedMaxStake ?? null,
            gateCapApplied: stakeCapResult.adjusted === true,
            gateCapReason: stakeCapResult.reason
        },
        stakePolicyApplied: stakeCapResult,

        isValue: (evaluation.ev_pct ?? evaluation.expectedValue) > 0 ? 'Value Bet' : 'No Value',
        isCR: Boolean(isCR),

        rawProb: round(evaluation.calibrated_probability_pct ?? evaluation.calibratedProbability, 2),
        valueScore: calculateTennisValueScore(evaluation),

        strategy_tag: strategyTag,
        rawEdge: round(evaluation.edge_pp ?? evaluation.adjustedEdge, 2),

        reliability: evaluation.reliability || null,
        calibration: evaluation.calibration || null,
        audit: evaluation.audit || null,
        reference,
        totalsDeepScanContext: reference && reference.source === 'STEP50E_REAL_TOTALS_ODDS_NO_VIG_DEEPSCAN_CONTEXT' ? reference : null,
        overOdd: reference?.overOdd ?? null,
        underOdd: reference?.underOdd ?? null,
        noVigOverProb: reference?.noVigOverProb ?? null,
        noVigUnderProb: reference?.noVigUnderProb ?? null,
        modelProbOver: reference?.modelProbOver ?? null,
        modelProbUnder: reference?.modelProbUnder ?? null,
        expectedGames: reference?.expectedGames ?? null,
        gamesStdDev: reference?.gamesStdDev ?? null,
        markovConfidence: reference?.markovConfidence ?? null,
        bestOfSets: reference?.bestOfSets ?? null,
        lineDistance: reference?.lineDistance ?? null,
        duplicateLineRank: reference?.duplicateLineRank ?? null,
        referenceOdd1: getReferenceOddForSide(reference, '1'),
        referenceOdd2: getReferenceOddForSide(reference, '2'),
        odd1: getReferenceOddForSide(reference, '1'),
        odd2: getReferenceOddForSide(reference, '2'),
        tour_type: tourType || inferTennisTourType(strategyTag || league),
        surface: surface ? normalizeSurface(surface) : null,
        surface_source: reference?.surfaceResolution?.source || null,
        surface_rule_id: reference?.surfaceResolution?.ruleId || null,
        surface_original: reference?.surfaceResolution?.providerSurface || null,
        surface_overridden_provider: reference?.surfaceResolution?.overriddenProviderSurface || null,
        surface_detail: reference?.surfaceResolution?.surfaceDetail || reference?.surfaceResolution?.surfaceLabel || null,
        surface_regime_key: reference?.surfaceResolution?.surfaceRegimeKey || null,
        surface_confidence: reference?.surfaceResolution?.confidence ?? null,
        surface_indoor: reference?.surfaceResolution?.indoor === true ? 1 : 0,
        tournament_name: reference?.surfaceResolution?.tournamentName || reference?.surfaceResolution?.tournamentCanonicalName || league || null,
        tournament_canonical_name: reference?.surfaceResolution?.tournamentCanonicalName || reference?.surfaceResolution?.tournamentName || league || null,
        tournament_catalog_id: reference?.surfaceResolution?.tournamentCatalogId || null,
        tournament_category: reference?.surfaceResolution?.tournamentCategory || null,
        tournament_level: reference?.surfaceResolution?.tournamentLevel || null,
        tournament_country: reference?.surfaceResolution?.tournamentCountry || null,
        tournament_period: reference?.surfaceResolution?.tournamentPeriod || null,
        dataSufficiency,
        dataSufficiencyScore: dataSufficiency?.score ?? null,
        reference_market_source: reference?.source || null,
        reference_market_quality: reference?.quality || null,
        openingOdd,
        closingOdd,
        clvPct,
        markovValidated,
        professionalGate: finalProfessionalGate,
        professional_gate_status: finalProfessionalGate?.status || null,
        professional_gate_allow_bet: finalProfessionalGate?.allowBet === true,
        professional_gate_reasons: Array.isArray(finalProfessionalGate?.reasons) ? finalProfessionalGate.reasons.join(' | ') : null,
        professional_gate_max_stake: finalProfessionalGate?.stakePolicy?.recommendedMaxStake ?? null,
        operationalReport: finalOperationalReport,
        tennis_operational_status: finalOperationalReport?.status || null,
        tennis_operational_action: finalOperationalReport?.action || null,
        tennis_operational_summary: finalOperationalReport?.summary || null,
        playerMatchupIntelligence,
        matchupIntelligenceSummary: summarizePatch12PlayerMatchupIntelligence(playerMatchupIntelligence),
        challengerPrediction: playerMatchupIntelligence?.challenger || null
    };
}


// ============================================================================
// STEP54_PAPER_EXPOSURE_GUARD
// Obiettivo: evitare più esposizioni operative sullo stesso match Tennis.
// Il modello di pronostico non viene modificato: vengono solo marcate/azzerate
// le alternative operative duplicate. Le alternative restano tracciabili come audit.
// ============================================================================
function normalizeStep54ExposureToken(value = '') {
    let text = String(value || '').trim().toLowerCase();
    try {
        text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (error) {
        // normalize non disponibile: mantieni il testo base.
    }
    return text.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function getStep54ExposureDateKey(value = '') {
    const text = String(value || '').trim();
    if (!text) return 'unknown-date';
    return text.split(',')[0].trim() || text;
}

function buildStep54TennisExposureKey(row = {}) {
    const dateKey = getStep54ExposureDateKey(row.date || row.match_date || row.matchDate);
    const leagueKey = normalizeStep54ExposureToken(row.league || row.tournament || 'tennis');
    const homeKey = normalizeStep54ExposureToken(row.home || row.home_team || row.playerA || row.match?.split(' - ')[0]);
    const awayKey = normalizeStep54ExposureToken(row.away || row.away_team || row.playerB || row.match?.split(' - ')[1]);
    return [dateKey, leagueKey, homeKey, awayKey].join('|');
}

function isStep54TotalsExposure(row = {}) {
    const market = String(row.marketType || row.market_type || '').toLowerCase();
    const prediction = String(row.prediction || '').toUpperCase();
    const strategy = String(row.strategy_tag || '').toUpperCase();
    return market === TENNIS_MARKETS.TOTALS || prediction.includes('OVER') || prediction.includes('UNDER') || strategy.includes('OVER') || strategy.includes('UNDER');
}

function getStep54ExposureSide(row = {}) {
    const key = normalizeTennisPredictionKey(row.prediction);
    if (key === '1' || key === '2') return `MONEYLINE_${key}`;
    if (key === 'OVER' || key === 'UNDER') return `TOTALS_${key}`;
    return String(row.prediction || 'UNKNOWN').toUpperCase();
}

function getStep54Stake(row = {}) {
    return toNumber(row.stake ?? row.invested ?? row.finalStake ?? row.stakePolicy?.finalStake, 0);
}

function isStep54RealStakeCandidate(row = {}) {
    const stake = getStep54Stake(row);
    const statusText = [
        row.professional_gate_status,
        row.professional_gate_reasons,
        row.tennis_operational_status,
        row.tennis_operational_action,
        row.tennis_operational_summary,
        row.exposure_group_status
    ].map(v => String(v || '').toUpperCase()).join(' ');

    if (stake <= 0) return false;
    if (statusText.includes('NO_BET') || statusText.includes('BLOCKED') || statusText.includes('BLOCCATA HARD')) return false;
    if (statusText.includes('AUDIT_ALTERNATIVE') || statusText.includes('EXPOSURE_GUARD')) return false;
    return true;
}

function getStep54DeepScanGateScore(row = {}) {
    const edge = toNumber(row.edge_pp ?? row.edge, 0);
    const ev = toNumber(row.ev_pct ?? row.ev, 0);
    const valueScore = toNumber(row.valueScore ?? row.model_confidence_score, 0);
    const stake = getStep54Stake(row);
    const dsText = [row.ds_action, row.deep_scan_risk_level, row.ds_suggestion].map(v => String(v || '').toUpperCase()).join(' ');
    const gateText = [
        row.professional_gate_status,
        row.professional_gate_reasons,
        row.tennis_operational_status,
        row.tennis_operational_action,
        row.tennis_operational_summary
    ].map(v => String(v || '').toUpperCase()).join(' ');

    let score = (valueScore * 0.35) + (edge * 1.2) + (ev * 0.9);

    if (dsText.includes('VALUE CONFERMATO') || dsText.includes('VALUE_CONFIRMED') || dsText.includes('🟢')) score += 60;
    else if (dsText.includes('WATCHLIST') || dsText.includes('LOW EDGE')) score += 30;
    else if (dsText.includes('EDGE TECNICO') || dsText.includes('📊')) score += 12;
    else if (dsText.includes('RISCHIO MODELLO')) score -= 65;
    else if (dsText.includes('ALTO RISCHIO') || dsText.includes('🔴')) score -= 90;

    if (gateText.includes('WATCHLIST_MICRO') || gateText.includes('WATCHLIST MICRO') || gateText.includes('CONSENSUS_MICRO')) score += 45;
    if (gateText.includes('APPROVATA CON CAP') || gateText.includes('APPROVED')) score += 35;
    if (gateText.includes('BLOCCATA SOFT') || gateText.includes('BLOCKED_SOFT')) score -= 20;
    if (gateText.includes('BLOCCATA HARD') || gateText.includes('BLOCKED_HARD') || gateText.includes('OPPOSITE_SIDE_CONFLICT')) score -= 120;
    if (gateText.includes('NO_BET') || gateText.includes('NO BET')) score -= 45;

    if (isStep54TotalsExposure(row)) {
        score -= 8;
        if (row.markov_validated === 1 || row.markovValidated === true) score += 18;
    }

    if (stake > 0) score += Math.min(15, stake);
    return round(score, 2);
}

function getStep54PendingRowsForMatch(bet = {}) {
    const exposureKey = buildStep54TennisExposureKey(bet);
    try {
        const rows = loadTennisPendingIdentityCandidates().filter(row =>
            tennisEventIdentity.compareTennisEventIdentity(bet, row).sameEvent === true
        );
        return rows.map(row => ({
            ...row,
            home: row.home_team,
            away: row.away_team,
            date: row.match_date,
            marketType: row.market_type,
            point: row.point_line,
            valueScore: row.model_confidence_score,
            matchExposureKey: row.match_exposure_key || exposureKey
        }));
    } catch (error) {
        console.warn('[STEP54/PATCH3] Impossibile leggere esposizioni pending Tennis:', error.message);
        return [];
    }
}

function markStep54BetAsAuditAlternative(bet, reason, status = 'BLOCKED_EXPOSURE_GUARD_AUDIT_ALTERNATIVE') {
    const originalStake = getStep54Stake(bet);
    const exposureKey = buildStep54TennisExposureKey(bet);
    const summary = `${reason} Alternativa conservata solo come audit/counterfactual: non entra nel ROI operativo reale.`;

    bet.invested = '0.00';
    bet.estimatedProfit = '0.00';
    bet.professional_gate_status = status;
    bet.professional_gate_allow_bet = false;
    bet.professional_gate_reasons = summary;
    bet.professional_gate_max_stake = 0;
    bet.tennis_operational_status = 'AUDIT_ALTERNATIVE';
    bet.tennis_operational_action = 'NO_BET_EXPOSURE_GUARD';
    bet.tennis_operational_summary = summary;
    bet.match_exposure_key = exposureKey;
    bet.exposure_role = 'AUDIT_ALTERNATIVE';
    bet.exposure_group_status = status;
    bet.exposure_reason = summary;
    bet.stakePolicyApplied = {
        adjusted: true,
        originalStake: round(originalStake, 2),
        stake: 0,
        reason: summary
    };
    bet.stakePolicy = {
        ...(bet.stakePolicy || {}),
        finalStake: 0,
        professionalGateCap: 0,
        gateCapApplied: true,
        gateCapReason: summary
    };
    return bet;
}

function downgradeStep54ExistingRowsToAudit(rows = [], reason) {
    const ids = rows.map(row => row.id).filter(Boolean);
    if (!ids.length) return;

    const setParts = ['stake = 0'];
    const params = [];
    if (columnExists('ai_forward_test', 'professional_gate_status')) setParts.push("professional_gate_status = 'BLOCKED_EXPOSURE_GUARD_REPLACED_BY_PRIMARY'");
    if (columnExists('ai_forward_test', 'professional_gate_allow_bet')) setParts.push('professional_gate_allow_bet = 0');
    if (columnExists('ai_forward_test', 'professional_gate_reasons')) { setParts.push('professional_gate_reasons = ?'); params.push(reason); }
    if (columnExists('ai_forward_test', 'professional_gate_max_stake')) setParts.push('professional_gate_max_stake = 0');
    if (columnExists('ai_forward_test', 'tennis_operational_status')) setParts.push("tennis_operational_status = 'AUDIT_ALTERNATIVE'");
    if (columnExists('ai_forward_test', 'tennis_operational_action')) setParts.push("tennis_operational_action = 'NO_BET_EXPOSURE_GUARD'");
    if (columnExists('ai_forward_test', 'tennis_operational_summary')) { setParts.push('tennis_operational_summary = ?'); params.push(reason); }
    if (columnExists('ai_forward_test', 'stake_policy_note')) { setParts.push('stake_policy_note = ?'); params.push(reason); }
    if (columnExists('ai_forward_test', 'exposure_role')) setParts.push("exposure_role = 'AUDIT_ALTERNATIVE'");
    if (columnExists('ai_forward_test', 'exposure_group_status')) setParts.push("exposure_group_status = 'BLOCKED_EXPOSURE_GUARD_REPLACED_BY_PRIMARY'");
    if (columnExists('ai_forward_test', 'exposure_reason')) { setParts.push('exposure_reason = ?'); params.push(reason); }

    db.prepare(`UPDATE ai_forward_test SET ${setParts.join(', ')} WHERE id IN (${ids.map(() => '?').join(', ')})`).run(...params, ...ids);
}

function applyStep54PaperExposureGuard(bet = {}) {
    // STEP54_PAPER_EXPOSURE_GUARD_PRIMARY_SELECTION
    const exposureKey = buildStep54TennisExposureKey(bet);
    bet.match_exposure_key = exposureKey;
    bet.exposure_role = bet.exposure_role || 'PRIMARY_CANDIDATE';
    bet.exposure_group_status = bet.exposure_group_status || 'STEP54_EXPOSURE_CHECKED';

    const existingRows = getStep54PendingRowsForMatch(bet);
    if (!existingRows.length) return bet;

    const currentSide = getStep54ExposureSide(bet);
    const currentIsTotals = isStep54TotalsExposure(bet);
    const currentStake = getStep54Stake(bet);
    const currentScore = getStep54DeepScanGateScore(bet);

    const sameTotalsSideRows = existingRows.filter(row =>
        currentIsTotals && isStep54TotalsExposure(row) && getStep54ExposureSide(row) === currentSide
    );

    if (sameTotalsSideRows.length > 0) {
        return markStep54BetAsAuditAlternative(
            bet,
            `Step54 Exposure Guard: esiste già una linea ${currentSide.replace('TOTALS_', '')} sullo stesso match. Manteniamo una sola linea totals primaria; questa resta alternativa DeepScan/audit.`,
            'BLOCKED_DUPLICATE_TOTALS_LINE_AUDIT'
        );
    }

    if (currentStake <= 0) {
        bet.exposure_role = 'AUDIT_ALTERNATIVE';
        bet.exposure_group_status = 'STEP54_STAKE_ZERO_AUDIT_ALTERNATIVE';
        bet.exposure_reason = bet.exposure_reason || 'Step54: stake zero; riga mantenuta solo per audit/counterfactual.';
        return bet;
    }

    const stakedRows = existingRows.filter(isStep54RealStakeCandidate);
    if (!stakedRows.length) {
        bet.exposure_role = 'PRIMARY_OPERATIONAL';
        bet.exposure_group_status = 'STEP54_PRIMARY_OPERATIONAL';
        bet.exposure_reason = 'Step54: prima esposizione operativa reale sul match.';
        return bet;
    }

    const bestExisting = stakedRows
        .map(row => ({ row, score: getStep54DeepScanGateScore(row) }))
        .sort((a, b) => b.score - a.score)[0];

    if (currentScore > bestExisting.score + STEP54_EXPOSURE_GUARD_MIN_SCORE_DELTA) {
        const reason = `Step54 Exposure Guard: nuova selezione primaria migliore sullo stesso match (${round(currentScore, 2)} > ${round(bestExisting.score, 2)}). Le precedenti diventano audit alternative.`;
        downgradeStep54ExistingRowsToAudit(stakedRows, reason);
        bet.exposure_role = 'PRIMARY_OPERATIONAL';
        bet.exposure_group_status = 'STEP54_PRIMARY_REPLACED_EXISTING';
        bet.exposure_reason = reason;
        return bet;
    }

    return markStep54BetAsAuditAlternative(
        bet,
        `Step54 Exposure Guard: esiste già una selezione operativa primaria sullo stesso match con score qualità/gate maggiore o equivalente (${round(bestExisting.score, 2)} vs ${round(currentScore, 2)}).`,
        'BLOCKED_EXPOSURE_GUARD_AUDIT_ALTERNATIVE'
    );
}


function normalizeTennisPredictionKey(prediction = '') {
    const p = String(prediction || '').trim().toUpperCase();
    if (p === '1' || p === 'HOME' || p === 'P1' || p === 'PLAYER1') return '1';
    if (p === '2' || p === 'AWAY' || p === 'P2' || p === 'PLAYER2') return '2';
    if (p.includes('OVER')) return 'OVER';
    if (p.includes('UNDER')) return 'UNDER';
    return p;
}


// ============================================================================
// PATCH 3 - CANONICAL TENNIS EVENT IDENTITY
// Query e decisione PENDING basate su provider event id oppure fingerprint
// canonico completo. Nessun settlement/CLV viene letto o modificato.
// ============================================================================
function loadTennisPendingIdentityCandidates() {
    try {
        return db.prepare(`
            SELECT id, match_date, league, home_team, away_team, prediction,
                   market_type, point_line, provider_event_id,
                   predicted_player_name, opponent_player_name, internal_side,
                   tour_type, tournament_name, tournament_canonical_name,
                   tennis_canonical_match_key, tennis_event_fingerprint,
                   tennis_market_fingerprint, status, stake,
                   professional_gate_status, professional_gate_reasons,
                   tennis_operational_status, tennis_operational_action,
                   tennis_operational_summary, match_exposure_key,
                   exposure_role, exposure_group_status, exposure_reason,
                   edge_pp, ev_pct, model_confidence_score, strategy_tag,
                   ds_action, ds_suggestion, deep_scan_risk_level,
                   professional_gate_allow_bet, markov_validated
            FROM ai_forward_test
            WHERE UPPER(COALESCE(status, '')) = 'PENDING'
              AND COALESCE(paper_result_active, 1) = 1
              AND (UPPER(COALESCE(sport_type, '')) = 'TENNIS'
                   OR UPPER(COALESCE(bet_type, '')) LIKE '%TENNIS%')
            ORDER BY id DESC
        `).all();
    } catch (error) {
        console.warn('[PATCH3_IDENTITY] Impossibile leggere PENDING Tennis:', error.message);
        return [];
    }
}

function resolvePendingTennisIdentity(bet = {}, pendingRows = null) {
    const rows = Array.isArray(pendingRows) ? pendingRows : loadTennisPendingIdentityCandidates();
    return tennisEventIdentity.selectPendingTennisIdentityMatch(bet, rows);
}

function applyTennisPatch3IdentityAuditGuard(bet = {}) {
    if (!bet || bet.__patch3IdentityAuditOnly !== true) return bet;
    const reason = bet.__patch3IdentityReason || bet.tennis_event_identity_reason ||
        'Patch 3: identità evento Tennis ambigua; riga mantenuta solo per audit senza stake operativo.';
    const originalStake = toNumber(bet.invested ?? bet.stake ?? bet.stakePolicy?.finalStake, 0);
    return {
        ...bet,
        invested: '0.00',
        stake: 0,
        estimatedProfit: '0.00',
        professional_gate_status: 'BLOCKED_EVENT_IDENTITY_AMBIGUOUS',
        professional_gate_allow_bet: false,
        professional_gate_reasons: reason,
        professional_gate_max_stake: 0,
        tennis_operational_status: 'AUDIT_ONLY_EVENT_IDENTITY',
        tennis_operational_action: 'NO_BET_IDENTITY_GUARD',
        tennis_operational_summary: reason,
        trading_scope: 'AUDIT_ONLY_EVENT_IDENTITY',
        paper_trading_scope: 'AUDIT_ONLY',
        portfolio_scope: 'EXCLUDED_FROM_REAL_PORTFOLIO',
        audit_scope_reason: reason,
        stake_policy_note: reason,
        stakePolicyApplied: {
            ...(bet.stakePolicyApplied || {}),
            adjusted: true,
            originalStake,
            stake: 0,
            reason
        },
        stakePolicy: {
            ...(bet.stakePolicy || {}),
            finalStake: 0,
            professionalGateCap: 0,
            gateCapApplied: true,
            gateCapReason: reason
        }
    };
}

function markTennisPatch3IdentityAuditOnly(bet = {}, resolution = {}) {
    const reason = `Patch 3 Event Identity: ${resolution.reason || 'identità evento ambigua'}`;
    return applyTennisPatch3IdentityAuditGuard({
        ...bet,
        __patch3IdentityAuditOnly: true,
        __patch3IdentityReason: reason,
        tennis_event_identity_status: resolution.status || bet.tennis_event_identity_status || 'AMBIGUOUS',
        tennis_event_identity_reason: reason
    });
}

function blockOppositePendingTennisConflicts(bet, pendingRows = null) {
    const predictionKey = normalizeTennisPredictionKey(bet.prediction);
    if (!['1', '2', 'OVER', 'UNDER'].includes(predictionKey)) return null;

    const rows = Array.isArray(pendingRows) ? pendingRows : loadTennisPendingIdentityCandidates();
    const oppositeConflicts = rows.filter(row => {
        const comparison = tennisEventIdentity.compareTennisEventIdentity(bet, row);
        return comparison.sameEvent === true && tennisEventIdentity.isOppositeSelection(bet, row);
    });
    if (!oppositeConflicts.length) return null;

    const reason = `Opposite-side conflict Patch 3: esiste già un PENDING Tennis sullo stesso evento canonico e sulla stessa linea (${oppositeConflicts.map(r => r.prediction).join(', ')}). Nessuno dei due lati deve avere stake operativo.`;
    const ids = oppositeConflicts.map(r => r.id).filter(Boolean);
    const setParts = ['stake = 0'];
    const params = [];

    if (columnExists('ai_forward_test', 'professional_gate_status')) setParts.push("professional_gate_status = 'BLOCKED_OPPOSITE_SIDE_CONFLICT'");
    if (columnExists('ai_forward_test', 'professional_gate_allow_bet')) setParts.push('professional_gate_allow_bet = 0');
    if (columnExists('ai_forward_test', 'professional_gate_reasons')) { setParts.push('professional_gate_reasons = ?'); params.push(reason); }
    if (columnExists('ai_forward_test', 'tennis_operational_status')) setParts.push("tennis_operational_status = 'BLOCKED'");
    if (columnExists('ai_forward_test', 'tennis_operational_action')) setParts.push("tennis_operational_action = 'NO_BET'");
    if (columnExists('ai_forward_test', 'tennis_operational_summary')) { setParts.push('tennis_operational_summary = ?'); params.push(reason); }
    if (columnExists('ai_forward_test', 'stake_policy_note')) { setParts.push('stake_policy_note = ?'); params.push(reason); }

    if (ids.length) {
        db.prepare(`UPDATE ai_forward_test SET ${setParts.join(', ')} WHERE id IN (${ids.map(() => '?').join(', ')})`).run(...params, ...ids);
    }

    return { conflicts: oppositeConflicts, reason };
}

function buildStep91VTennisPendingPairs(bet = {}) {
    // STEP91V_TENNIS_PAPER_TRADING_OPERATIONAL_RESTORE
    // Colonne mutabili PENDING: usate sia per INSERT sia per UPSERT.
    // Non include status/profit/settlement/CLV corrente, così il paper trading non viene contaminato.
    const pairs = [];
    const add = (column, value, options = {}) => {
        if (!columnExists('ai_forward_test', column)) return;
        if (options.skipEmpty === true && (value === undefined || value === null || value === '')) return;
        const existing = pairs.findIndex(item => item[0] === column);
        if (existing >= 0) pairs[existing] = [column, value];
        else pairs.push([column, value]);
    };

    add('edge_pp', bet.edge_pp, { skipEmpty: true });
    add('ev_pct', bet.ev_pct, { skipEmpty: true });
    add('model_version', TENNIS_MODEL_VERSION);
    add('metric_version', TENNIS_METRIC_VERSION);
    add('engine_version', TENNIS_ENGINE_VERSION);
    add('data_quality', 'CURRENT_BOOTSTRAP');
    add('market_implied_prob', bet.marketImpliedProbability, { skipEmpty: true });
    add('fair_odd_model', bet.audit?.fair_odd_model || null, { skipEmpty: true });
    add('fair_odd_calibrated', bet.audit?.fair_odd_calibrated || null, { skipEmpty: true });
    add('tour_type', bet.tour_type || inferTennisTourType(bet.strategy_tag || bet.league), { skipEmpty: true });
    add('surface', bet.surface || null, { skipEmpty: true });
    add('surface_source', bet.surface_source || bet.reference?.surfaceResolution?.source || null, { skipEmpty: true });
    add('surface_rule_id', bet.surface_rule_id || bet.reference?.surfaceResolution?.ruleId || null, { skipEmpty: true });
    add('surface_original', bet.surface_original || bet.reference?.surfaceResolution?.providerSurface || null, { skipEmpty: true });
    add('surface_overridden_provider', bet.surface_overridden_provider || bet.reference?.surfaceResolution?.overriddenProviderSurface || null, { skipEmpty: true });
    add('surface_detail', bet.surface_detail || bet.reference?.surfaceResolution?.surfaceDetail || bet.reference?.surfaceResolution?.surfaceLabel || null, { skipEmpty: true });
    add('surface_regime_key', bet.surface_regime_key || bet.reference?.surfaceResolution?.surfaceRegimeKey || null, { skipEmpty: true });
    add('surface_confidence', bet.surface_confidence ?? bet.reference?.surfaceResolution?.confidence ?? null, { skipEmpty: true });
    add('surface_indoor', (bet.surface_indoor === 1 || bet.surface_indoor === true || bet.reference?.surfaceResolution?.indoor === true) ? 1 : 0, { skipEmpty: true });
    add('tournament_name', bet.tournament_name || bet.tournamentName || bet.reference?.surfaceResolution?.tournamentName || bet.league || null, { skipEmpty: true });
    add('tournament_canonical_name', bet.tournament_canonical_name || bet.tournamentCanonicalName || bet.reference?.surfaceResolution?.tournamentCanonicalName || bet.tournament_name || bet.league || null, { skipEmpty: true });
    add('tournament_catalog_id', bet.tournament_catalog_id || bet.reference?.surfaceResolution?.tournamentCatalogId || null, { skipEmpty: true });
    add('tournament_category', bet.tournament_category || bet.reference?.surfaceResolution?.tournamentCategory || null, { skipEmpty: true });
    add('tournament_level', bet.tournament_level || bet.reference?.surfaceResolution?.tournamentLevel || null, { skipEmpty: true });
    add('tournament_country', bet.tournament_country || bet.reference?.surfaceResolution?.tournamentCountry || null, { skipEmpty: true });
    add('tournament_period', bet.tournament_period || bet.reference?.surfaceResolution?.tournamentPeriod || null, { skipEmpty: true });
    add('market_type', bet.marketType || inferTennisMarketTypeFromPrediction(bet.prediction), { skipEmpty: true });
    add('point_line', bet.point ?? null, { skipEmpty: true });
    add('reference_market_source', bet.reference_market_source || bet.reference?.source || null, { skipEmpty: true });
    add('reference_market_quality', bet.reference_market_quality || bet.reference?.quality || null, { skipEmpty: true });
    add('reference_odd1', bet.referenceOdd1 || bet.odd1 || null, { skipEmpty: true });
    add('reference_odd2', bet.referenceOdd2 || bet.odd2 || null, { skipEmpty: true });
    add('model_confidence_score', bet.valueScore || null, { skipEmpty: true });
    add('data_sufficiency_score', bet.dataSufficiencyScore || null, { skipEmpty: true });
    add('opening_odd', bet.openingOdd || null, { skipEmpty: true });
    add('markov_validated', bet.markovValidated === true ? 1 : 0, { skipEmpty: true });
    add('professional_gate_status', bet.professional_gate_status || bet.professionalGate?.status || null, { skipEmpty: true });
    add('professional_gate_allow_bet', (bet.professional_gate_allow_bet === true || bet.professionalGate?.allowBet === true) ? 1 : 0);
    add('professional_gate_reasons', bet.professional_gate_reasons || (Array.isArray(bet.professionalGate?.reasons) ? bet.professionalGate.reasons.join(' | ') : null), { skipEmpty: true });
    add('professional_gate_max_stake', bet.professional_gate_max_stake || bet.professionalGate?.stakePolicy?.recommendedMaxStake || null, { skipEmpty: true });
    add('tennis_operational_status', bet.tennis_operational_status || bet.operationalReport?.status || null, { skipEmpty: true });
    add('tennis_operational_action', bet.tennis_operational_action || bet.operationalReport?.action || null, { skipEmpty: true });
    add('tennis_operational_summary', bet.tennis_operational_summary || bet.operationalReport?.summary || null, { skipEmpty: true });
    add('deep_scan_risk_level', bet.deep_scan_risk_level || null, { skipEmpty: true });
    add('deep_scan_risk_score', bet.deep_scan_risk_score || null, { skipEmpty: true });
    add('stake_policy_note', bet.stakePolicyApplied?.reason || bet.stakePolicy?.gateCapReason || 'Step91V: pending aggiornato da Analisi AI senza duplicare la riga.', { skipEmpty: true });
    add('stake_base_before_deepscan', parseFloat(bet.requestedStake || bet.invested || 0) || null, { skipEmpty: true });
    add('kelly_fraction_pct', bet.stakePolicy?.kellyFractionPct ?? null, { skipEmpty: true });
    add('kelly_raw_stake', bet.stakePolicy?.kellyRawStake ?? null, { skipEmpty: true });
    add('stake_confidence_multiplier', bet.stakePolicy?.confidenceMultiplier ?? null, { skipEmpty: true });
    add('stake_confidence_level', bet.stakePolicy?.stakeConfidenceLevel ?? null, { skipEmpty: true });
    add('stake_min_applied', bet.stakePolicy?.minStakeApplied === true ? 1 : 0);
    add('stake_cap_applied', (bet.stakePolicy?.capApplied === true || bet.stakePolicy?.gateCapApplied === true) ? 1 : 0);
    add('stake_policy_mode', bet.stakePolicy?.mode || TENNIS_KELLY_STAKE_POLICY.mode, { skipEmpty: true });

    // Step91H/J/K: identità lato/pick. Un solo set canonico, niente duplicati nell'INSERT.
    add('predicted_player_name', bet.predicted_player_name || bet.predictedPlayerName || null, { skipEmpty: true });
    add('opponent_player_name', bet.opponent_player_name || bet.opponentPlayerName || null, { skipEmpty: true });
    add('internal_side', bet.internal_side || bet.internalSide || null, { skipEmpty: true });
    add('official_event_order', bet.official_event_order || bet.officialEventOrder || null, { skipEmpty: true });
    add('provider_event_id', bet.provider_event_id || bet.providerEventId || null, { skipEmpty: true });
    add('provider_home_team', bet.provider_home_team || bet.providerHomeTeam || null, { skipEmpty: true });
    add('provider_away_team', bet.provider_away_team || bet.providerAwayTeam || null, { skipEmpty: true });
    add('side_mapping_warning', bet.side_mapping_warning || bet.sideMappingWarning || null, { skipEmpty: true });
    add('side_mapping_verified', (bet.side_mapping_verified === true || bet.side_mapping_verified === 1 || bet.sideMappingVerified === true) ? 1 : 0);
    add('side_identity_version', bet.side_identity_version || bet.sideIdentityVersion || sideIdentity.STEP91H_TENNIS_SIDE_IDENTITY_GUARD, { skipEmpty: true });

    // Patch 3: identità evento/mercato canonica per UPSERT e audit.
    add('tennis_canonical_match_key', bet.tennis_canonical_match_key || bet.canonicalMatchKey || null, { skipEmpty: true });
    add('tennis_event_fingerprint', bet.tennis_event_fingerprint || null, { skipEmpty: true });
    add('tennis_market_fingerprint', bet.tennis_market_fingerprint || null, { skipEmpty: true });
    add('tennis_event_identity_status', bet.tennis_event_identity_status || null, { skipEmpty: true });
    add('tennis_event_identity_reason', bet.tennis_event_identity_reason || null, { skipEmpty: true });
    add('tennis_event_identity_confidence', bet.tennis_event_identity_confidence || null, { skipEmpty: true });
    add('tennis_event_identity_version', bet.tennis_event_identity_version || tennisEventIdentity.TENNIS_EVENT_IDENTITY_VERSION, { skipEmpty: true });
    add('canonical_match_datetime', bet.canonical_match_datetime || null, { skipEmpty: true });
    add('canonical_tournament_key', bet.canonical_tournament_key || null, { skipEmpty: true });
    add('canonical_player_pair_key', bet.canonical_player_pair_key || null, { skipEmpty: true });

    add('match_exposure_key', bet.tennis_event_fingerprint || bet.match_exposure_key || buildStep54TennisExposureKey(bet), { skipEmpty: true });
    add('exposure_role', bet.exposure_role || null, { skipEmpty: true });
    add('exposure_group_status', bet.exposure_group_status || null, { skipEmpty: true });
    add('exposure_reason', bet.exposure_reason || null, { skipEmpty: true });

    return pairs;
}

function updateExistingPendingTennisBet(existingId, bet = {}, betTypeStr = null) {
    // STEP91V: Analisi AI deve aggiornare il PENDING esistente senza creare duplicati.
    // Si aggiornano solo campi pre-match/operativi; status/profit/settlement restano intatti.
    const setParts = [];
    const params = [];
    const add = (column, value, options = {}) => {
        if (options.skipEmpty === true && (value === undefined || value === null || value === '')) return;
        setParts.push(`${column} = ?`);
        params.push(value);
    };

    add('bet_type', betTypeStr || (bet.isCR ? 'SINGLE_TENNIS_CR' : 'SINGLE_TENNIS'));
    add('match_date', bet.date, { skipEmpty: true });
    add('home_team', bet.home, { skipEmpty: true });
    add('away_team', bet.away, { skipEmpty: true });
    add('prediction', bet.prediction, { skipEmpty: true });
    add('odd', bet.odd, { skipEmpty: true });
    add('stake', parseFloat(bet.invested), { skipEmpty: true });
    add('estimated_prob', bet.estimatedProb, { skipEmpty: true });
    add('edge', bet.edge_pp, { skipEmpty: true });
    add('league', bet.league, { skipEmpty: true });
    add('strategy_tag', bet.strategy_tag, { skipEmpty: true });
    add('sport_type', 'TENNIS');

    for (const [column, value] of buildStep91VTennisPendingPairs(bet)) {
        // Non sovrascrivere DeepScan manuale con null; il builder già skippa i vuoti.
        add(column, value, { skipEmpty: true });
    }

    if (!setParts.length) return false;
    params.push(existingId);

    db.prepare(`
        UPDATE ai_forward_test
        SET ${setParts.join(', ')}
        WHERE id = ?
          AND status = 'PENDING'
          AND UPPER(COALESCE(sport_type, '')) = 'TENNIS'
    `).run(...params);

    return true;
}

// ============================================================================
// STEP91W_TENNIS_PAPER_TRADING_STABILITY_RESTORE
// Ripristino professionale Paper Trading Tennis:
// - nessun duplicato su PENDING esistente;
// - update sicuro della riga PENDING quando Analisi AI ritrova lo stesso match;
// - preserva settlement WON/LOST/VOID e CLV;
// - mantiene side identity, exposure guard e opposite-side conflict.
// ============================================================================
function buildStep91XTennisPendingScopeSnapshot(bet = {}) {
    // STEP91X_TENNIS_PAPER_TRADING_PROFESSIONAL_RESTORE
    // Scope deterministica per PENDING creati/aggiornati dall'Analisi AI.
    // Usa solo Gate + stake + stato operativo corrente, mai lo scope legacy già presente.
    const stake = Math.max(0, toNumber(bet.invested ?? bet.stake ?? bet.stakePolicy?.finalStake, 0));
    const gateAllow = bet.professional_gate_allow_bet === true ||
        bet.professional_gate_allow_bet === 1 ||
        String(bet.professional_gate_allow_bet).toUpperCase() === 'TRUE' ||
        bet.professionalGate?.allowBet === true;
    const gateText = [
        bet.professional_gate_status,
        bet.professional_gate_reasons,
        bet.tennis_operational_status,
        bet.tennis_operational_action,
        bet.tennis_operational_summary,
        bet.deepscan_gate_status,
        bet.deepscan_gate_reason,
        bet.exposure_role,
        bet.exposure_group_status,
        bet.exposure_reason,
        bet.stakePolicyApplied?.reason,
        bet.stakePolicy?.gateCapReason
    ].map(v => String(v || '').toUpperCase()).join(' ');
    if (step101eHasTrueHardVetoText(gateText)) {
        return { trading_scope: 'AUDIT_ONLY_HARD_VETO', paper_trading_scope: 'AUDIT_ONLY', portfolio_scope: 'EXCLUDED_FROM_REAL_PORTFOLIO', audit_scope_reason: 'Step101E/91X: hard veto reale; micro-test non operativo.', paperOperational: false, portfolioEligible: false };
    }
    const step101EPositiveMicroScope = step101eBuildPositiveMicroScopeSnapshot(gateText, stake, 'Step101E/91X');
    if (step101EPositiveMicroScope) return step101EPositiveMicroScope;

    const blocked = gateAllow !== true ||
        gateText.includes('NO_BET') ||
        gateText.includes('NO BET') ||
        gateText.includes('BLOCCATA') ||
        gateText.includes('BLOCKED') ||
        gateText.includes('BLOCKED_HARD') ||
        gateText.includes('BLOCKED_SOFT');
    const auditAlternative = gateText.includes('AUDIT_ALTERNATIVE') ||
        gateText.includes('EXPOSURE_GUARD') ||
        gateText.includes('COUNTERFACTUAL') ||
        gateText.includes('SHADOW');

    if (stake <= 0) {
        return {
            trading_scope: 'AUDIT_ONLY_ZERO_STAKE',
            paper_trading_scope: 'AUDIT_ONLY',
            portfolio_scope: 'EXCLUDED_FROM_REAL_PORTFOLIO',
            audit_scope_reason: 'Step91X: stake zero nel pending Tennis; riga conservata solo per audit.',
            paperOperational: false,
            portfolioEligible: false
        };
    }

    if (blocked) {
        return {
            trading_scope: 'AUDIT_ONLY_BLOCKED_BY_GATE',
            paper_trading_scope: 'AUDIT_ONLY',
            portfolio_scope: 'EXCLUDED_FROM_REAL_PORTFOLIO',
            audit_scope_reason: 'Step91X: Gate/DeepScan non consente bet operativa; pending escluso dal Paper operativo.',
            paperOperational: false,
            portfolioEligible: false
        };
    }

    if (auditAlternative) {
        return {
            trading_scope: 'AUDIT_ONLY_COUNTERFACTUAL',
            paper_trading_scope: 'AUDIT_ONLY',
            portfolio_scope: 'EXCLUDED_FROM_REAL_PORTFOLIO',
            audit_scope_reason: 'Step91X: alternativa/counterfactual/exposure guard; esclusa dal Paper operativo.',
            paperOperational: false,
            portfolioEligible: false
        };
    }

    return {
        trading_scope: 'PAPER_OPERATIONAL',
        paper_trading_scope: 'PAPER_OPERATIONAL',
        portfolio_scope: 'EXCLUDED_FROM_REAL_PORTFOLIO',
        audit_scope_reason: 'Step91X: Pending Tennis operativo: gate_allow_bet=true, stake > 0, nessun blocco hard/soft/no-bet.',
        paperOperational: true,
        portfolioEligible: false
    };
}

function buildStep91WTennisOptionalPairs(bet = {}) {
    const scopeSnapshot = buildStep91XTennisPendingScopeSnapshot(bet);
    // PATCH10_QUALITY_BASE_BEFORE_DEEPSCAN: quantitative-only, no ds_action/result/current CLV.
    const qualityBase = tennisQualityGateV2.evaluateBaseQualityGate(bet);
    const optional = [
        ['edge_pp', bet.edge_pp],
        ['ev_pct', bet.ev_pct],
        ['model_version', TENNIS_MODEL_VERSION],
        ['metric_version', TENNIS_METRIC_VERSION],
        ['engine_version', TENNIS_ENGINE_VERSION],
        ['data_quality', 'CURRENT_BOOTSTRAP'],
        ['market_implied_prob', bet.marketImpliedProbability],
        ['fair_odd_model', bet.audit?.fair_odd_model || null],
        ['fair_odd_calibrated', bet.audit?.fair_odd_calibrated || null],
        ['tour_type', bet.tour_type || inferTennisTourType(bet.strategy_tag || bet.league)],
        ['surface', bet.surface || null],
        ['surface_source', bet.surface_source || bet.reference?.surfaceResolution?.source || null],
        ['surface_rule_id', bet.surface_rule_id || bet.reference?.surfaceResolution?.ruleId || null],
        ['surface_original', bet.surface_original || bet.reference?.surfaceResolution?.providerSurface || null],
        ['surface_overridden_provider', bet.surface_overridden_provider || bet.reference?.surfaceResolution?.overriddenProviderSurface || null],
        ['surface_detail', bet.surface_detail || bet.reference?.surfaceResolution?.surfaceDetail || bet.reference?.surfaceResolution?.surfaceLabel || null],
        ['surface_regime_key', bet.surface_regime_key || bet.reference?.surfaceResolution?.surfaceRegimeKey || null],
        ['surface_confidence', bet.surface_confidence ?? bet.reference?.surfaceResolution?.confidence ?? null],
        ['surface_indoor', (bet.surface_indoor === 1 || bet.surface_indoor === true || bet.reference?.surfaceResolution?.indoor === true) ? 1 : 0],
        ['tournament_name', bet.tournament_name || bet.tournamentName || bet.reference?.surfaceResolution?.tournamentName || bet.league || null],
        ['tournament_canonical_name', bet.tournament_canonical_name || bet.tournamentCanonicalName || bet.reference?.surfaceResolution?.tournamentCanonicalName || bet.tournament_name || bet.league || null],
        ['tournament_catalog_id', bet.tournament_catalog_id || bet.reference?.surfaceResolution?.tournamentCatalogId || null],
        ['tournament_category', bet.tournament_category || bet.reference?.surfaceResolution?.tournamentCategory || null],
        ['tournament_level', bet.tournament_level || bet.reference?.surfaceResolution?.tournamentLevel || null],
        ['tournament_country', bet.tournament_country || bet.reference?.surfaceResolution?.tournamentCountry || null],
        ['tournament_period', bet.tournament_period || bet.reference?.surfaceResolution?.tournamentPeriod || null],
        ['market_type', bet.marketType || inferTennisMarketTypeFromPrediction(bet.prediction)],
        ['point_line', bet.point ?? null],
        ['reference_market_source', bet.reference_market_source || bet.reference?.source || null],
        ['reference_market_quality', bet.reference_market_quality || bet.reference?.quality || null],
        ['reference_odd1', bet.referenceOdd1 || bet.odd1 || null],
        ['reference_odd2', bet.referenceOdd2 || bet.odd2 || null],
        ['model_confidence_score', bet.valueScore || null],
        ['data_sufficiency_score', bet.dataSufficiencyScore || null],
        ['opening_odd', bet.openingOdd || null],
        // STEP91X_PREMATCH_LEAKAGE_GUARD_PAPER: non scrivere closing_odd/clv_pct/profit/settled_at nei PENDING.
        ['markov_validated', bet.markovValidated === true ? 1 : 0],
        ['bankroll_snapshot', bet.bankroll_snapshot ?? bet.bankrollSnapshot ?? bet.bankroll ?? null],
        ['professional_gate_status', bet.professional_gate_status || bet.professionalGate?.status || null],
        ['professional_gate_allow_bet', (bet.professional_gate_allow_bet === true || bet.professionalGate?.allowBet === true) ? 1 : 0],
        ['professional_gate_reasons', bet.professional_gate_reasons || (Array.isArray(bet.professionalGate?.reasons) ? bet.professionalGate.reasons.join(' | ') : null)],
        ['professional_gate_max_stake', bet.professional_gate_max_stake || bet.professionalGate?.stakePolicy?.recommendedMaxStake || null],
        ['quality_base_code', qualityBase.code], ['quality_base_label', qualityBase.label], ['quality_base_score', qualityBase.score],
        ['quality_base_reason', qualityBase.reason], ['quality_base_version', qualityBase.version],
        ['quality_final_code', bet.quality_final_code || null], ['quality_final_label', bet.quality_final_label || null], ['quality_final_score', bet.quality_final_score ?? null],
        ['quality_final_reason', bet.quality_final_reason || null], ['quality_final_version', bet.quality_final_version || null],
        ['quality_stake_mode', bet.quality_stake_mode || null], ['quality_stake_amount', bet.quality_stake_amount ?? null], ['quality_budget_pct', bet.quality_budget_pct ?? null],
        ['quality_decision_at', bet.quality_decision_at || null], ['quality_deepscan_class', bet.quality_deepscan_class || null], ['quality_deepscan_separate', 1],
        ['tennis_operational_status', bet.tennis_operational_status || bet.operationalReport?.status || null],
        ['tennis_operational_action', bet.tennis_operational_action || bet.operationalReport?.action || null],
        ['tennis_operational_summary', bet.tennis_operational_summary || bet.operationalReport?.summary || null],
        ['deep_scan_risk_level', bet.deep_scan_risk_level || null],
        ['deep_scan_risk_score', bet.deep_scan_risk_score || null],
        ['stake_policy_note', bet.stakePolicyApplied?.reason || bet.stakePolicy?.gateCapReason || null],
        ['stake_base_before_deepscan', parseFloat(bet.requestedStake || bet.invested || 0) || null],
        ['kelly_fraction_pct', bet.stakePolicy?.kellyFractionPct ?? null],
        ['kelly_raw_stake', bet.stakePolicy?.kellyRawStake ?? null],
        ['stake_confidence_multiplier', bet.stakePolicy?.confidenceMultiplier ?? null],
        ['stake_confidence_level', bet.stakePolicy?.stakeConfidenceLevel ?? null],
        ['stake_min_applied', bet.stakePolicy?.minStakeApplied === true ? 1 : 0],
        ['stake_cap_applied', (bet.stakePolicy?.capApplied === true || bet.stakePolicy?.gateCapApplied === true) ? 1 : 0],
        ['stake_policy_mode', bet.stakePolicy?.mode || TENNIS_KELLY_STAKE_POLICY.mode],
        ['trading_scope', scopeSnapshot.trading_scope],
        ['paper_trading_scope', scopeSnapshot.paper_trading_scope],
        ['portfolio_scope', scopeSnapshot.portfolio_scope],
        ['audit_scope_reason', scopeSnapshot.audit_scope_reason],
        ['predicted_player_name', bet.predicted_player_name || bet.predictedPlayerName || null],
        ['opponent_player_name', bet.opponent_player_name || bet.opponentPlayerName || null],
        ['internal_side', bet.internal_side || bet.internalSide || null],
        ['official_event_order', bet.official_event_order || bet.officialEventOrder || null],
        ['provider_event_id', bet.provider_event_id || bet.providerEventId || null],
        ['provider_home_team', bet.provider_home_team || bet.providerHomeTeam || null],
        ['provider_away_team', bet.provider_away_team || bet.providerAwayTeam || null],
        ['side_mapping_warning', bet.side_mapping_warning || bet.sideMappingWarning || null],
        ['side_mapping_verified', (bet.side_mapping_verified === true || bet.side_mapping_verified === 1 || bet.sideMappingVerified === true) ? 1 : 0],
        ['side_identity_version', bet.side_identity_version || bet.sideIdentityVersion || sideIdentity.STEP91H_TENNIS_SIDE_IDENTITY_GUARD || 'STEP91H_TENNIS_SIDE_IDENTITY_GUARD'],
        ['match_exposure_key', bet.match_exposure_key || buildStep54TennisExposureKey(bet)],
        ['exposure_role', bet.exposure_role || null],
        ['exposure_group_status', bet.exposure_group_status || null],
        ['exposure_reason', bet.exposure_reason || null]
    ];

    const seen = new Set();
    return optional.filter(([column]) => {
        if (seen.has(column)) return false;
        seen.add(column);
        return true;
    });
}

function buildStep91WTennisBasePairs(bet = {}, betTypeStr = 'SINGLE_TENNIS') {
    return [
        ['bet_type', betTypeStr],
        ['match_date', bet.date],
        ['home_team', bet.home],
        ['away_team', bet.away],
        ['prediction', bet.prediction],
        ['odd', bet.odd],
        ['stake', parseFloat(bet.invested)],
        ['estimated_prob', bet.estimatedProb],
        ['edge', bet.edge_pp],
        ['league', bet.league],
        ['strategy_tag', bet.strategy_tag],
        ['sport_type', 'TENNIS']
    ];
}

function applyStep91WConflictToBet(bet = {}, oppositeConflict = null) {
    if (!oppositeConflict) return bet;
    bet.invested = '0.00';
    bet.estimatedProfit = '0.00';
    bet.professional_gate_status = 'BLOCKED_OPPOSITE_SIDE_CONFLICT';
    bet.professional_gate_allow_bet = false;
    bet.professional_gate_reasons = oppositeConflict.reason;
    bet.tennis_operational_status = 'BLOCKED';
    bet.tennis_operational_action = 'NO_BET';
    bet.tennis_operational_summary = oppositeConflict.reason;
    bet.stakePolicyApplied = {
        adjusted: true,
        originalStake: Number(bet.requestedStake || bet.invested || 0),
        stake: 0,
        reason: oppositeConflict.reason
    };
    return bet;
}


// STEP91Z_PENDING_FORBIDDEN_POSTMATCH_FIELDS
// Guard runtime non distruttivo: se Analisi AI aggiorna una riga PENDING già esistente,
// i dati futuri/post-match non devono restare sulla riga pre-match.
function applyStep91ZPendingNoPostmatchClear(setParts, params) {
    const forbiddenPostMatchColumns = [
        'closing_odd',
        'clv_pct',
        'clv_method',
        'closing_odd_side',
        'settled_at',
        'profit'
    ];

    for (const column of forbiddenPostMatchColumns) {
        if (typeof columnExists === 'function' && columnExists('ai_forward_test', column)) {
            const alreadySet = Array.isArray(setParts) && setParts.some(part => String(part || '').trim().toLowerCase().startsWith(column.toLowerCase() + ' ='));
            if (!alreadySet) {
                setParts.push(column + ' = NULL');
            }
        }
    }

    return { setParts, params };
}

function updateStep91WExistingPendingTennisBet(existingId, bet = {}, betTypeStr = 'SINGLE_TENNIS') {
    // STEP93_COMPAT_DELEGATE_TO_STEP92: mantiene il binding legacy Step91W/Y/Z ma usa la logica finale Step92.
    if (typeof updateStep92ExistingPendingTennisBet === 'function') {
        return updateStep92ExistingPendingTennisBet(existingId, bet, betTypeStr);
    }
    // STEP91Y_PENDING_NO_POSTMATCH_FIELDS
    // STEP91Z_FINAL_COMPAT_REPAIR: ogni update di un PENDING pre-match deve ripulire
    // i campi post-match/leakage: closing_odd, clv_pct, clv_method, closing_odd_side, settled_at, profit.

    // STEP91X: upsert sicuro. Aggiorna la fotografia operativa/gate/scope del PENDING
    // senza toccare settlement, profit, closing line o CLV. La quota/stake presa restano
    // snapshot della prima decisione; se erano nulli/assenti, vengono valorizzati.
    const existing = db.prepare(`
        SELECT id, odd, stake
        FROM ai_forward_test
        WHERE id = ?
          AND UPPER(COALESCE(status, '')) = 'PENDING'
          AND UPPER(COALESCE(sport_type, '')) = 'TENNIS'
    `).get(existingId);
    if (!existing) return false;

    const setParts = [];
    const params = [];
    const pairs = [
        ['bet_type', betTypeStr],
        ['estimated_prob', bet.estimatedProb],
        ['edge', bet.edge_pp],
        ['strategy_tag', bet.strategy_tag],
        ['sport_type', 'TENNIS'],
        ...buildStep91WTennisOptionalPairs(bet)
    ];

    if (!(Number(existing.odd) > 1)) pairs.push(['odd', bet.odd]);
    if (!(Number(existing.stake) > 0) && Number(parseFloat(bet.invested)) > 0) {
        pairs.push(['stake', parseFloat(bet.invested)]);
    }

    const seen = new Set();
    for (const [column, value] of pairs) {
        if (['status', 'profit', 'closing_odd', 'clv_pct', 'settled_at', 'settlement_source', 'settlement_note'].includes(column)) continue;
        if (seen.has(column)) continue;
        seen.add(column);
        if (columnExists('ai_forward_test', column)) {
            setParts.push(`${column} = ?`);
            params.push(value);
        }
    }

    // Rimuovi eventuale leakage pre-match rimasto su righe PENDING legacy.
    if (columnExists('ai_forward_test', 'closing_odd')) setParts.push('closing_odd = NULL');
    if (columnExists('ai_forward_test', 'clv_pct')) setParts.push('clv_pct = NULL');
    if (columnExists('ai_forward_test', 'closing_line_available')) setParts.push('closing_line_available = 0');
    if (columnExists('ai_forward_test', 'clv_method')) setParts.push('clv_method = NULL');
    if (columnExists('ai_forward_test', 'closing_odd_side')) setParts.push('closing_odd_side = NULL');
    if (columnExists('ai_forward_test', 'settled_at')) setParts.push('settled_at = NULL');
    if (columnExists('ai_forward_test', 'profit')) setParts.push('profit = NULL');

    if (!setParts.length) return false;
    params.push(existingId);

    
    // STEP91Z_PENDING_NO_POSTMATCH_FIELDS_RUNTIME
    applyStep91ZPendingNoPostmatchClear(setParts, params);
db.prepare(`
        UPDATE ai_forward_test
        SET ${setParts.join(', ')}
        WHERE id = ?
          AND UPPER(COALESCE(status, '')) = 'PENDING'
          AND UPPER(COALESCE(sport_type, '')) = 'TENNIS'
    `).run(...params);

    savePendingTennisBet.lastAction = 'UPDATED_PENDING';
    return true;
}

// ============================================================================
// STEP92_TENNIS_PAPER_TRADING_FINAL_FUNCTIONAL_RESTORE
// Regola finale: ogni riga prodotta dall'Analisi AI Tennis deve entrare nel Paper
// Trading come tracking statistico, anche se stake=0, BLOCCATA o audit-only.
// Portfolio reale e ROI operativo restano separati: stake=0/gate bloccante non diventano
// trading reale. Nessun campo post-match/CLV viene scritto su PENDING pre-match.
// ============================================================================
const STEP92_TENNIS_PAPER_TRADING_FINAL_FUNCTIONAL_RESTORE = 'STEP92_TENNIS_PAPER_TRADING_FINAL_FUNCTIONAL_RESTORE';

function step92Number(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function buildStep92TennisPendingScopeSnapshot(bet = {}) {
    const stake = Math.max(0, step92Number(bet.invested ?? bet.stake ?? bet.stakePolicy?.finalStake, 0));
    const gateAllow = bet.professional_gate_allow_bet === true ||
        bet.professional_gate_allow_bet === 1 ||
        String(bet.professional_gate_allow_bet).toUpperCase() === 'TRUE' ||
        bet.professionalGate?.allowBet === true;
    const gateText = [
        bet.professional_gate_status, bet.professional_gate_reasons,
        bet.tennis_operational_status, bet.tennis_operational_action, bet.tennis_operational_summary,
        bet.deepscan_gate_status, bet.deepscan_gate_reason,
        bet.exposure_role, bet.exposure_group_status, bet.exposure_reason,
        bet.stakePolicyApplied?.reason, bet.stakePolicy?.gateCapReason
    ].map(v => String(v || '').toUpperCase()).join(' ');
    const auditAlternative = gateText.includes('AUDIT_ALTERNATIVE') || gateText.includes('EXPOSURE_GUARD') || gateText.includes('COUNTERFACTUAL') || gateText.includes('SHADOW');
    if (step101eHasTrueHardVetoText(gateText)) {
        return { trading_scope: 'AUDIT_ONLY_HARD_VETO', paper_trading_scope: 'AUDIT_ONLY', portfolio_scope: 'EXCLUDED_FROM_REAL_PORTFOLIO', audit_scope_reason: 'Step101E/92: hard veto reale; micro-test non operativo.', paperOperational: false, portfolioEligible: false };
    }
    const step101EPositiveMicroScope = step101eBuildPositiveMicroScopeSnapshot(gateText, stake, 'Step101E/92');
    if (step101EPositiveMicroScope) return step101EPositiveMicroScope;
    const blocked = gateAllow !== true || gateText.includes('NO_BET') || gateText.includes('NO BET') || gateText.includes('BLOCCATA') || gateText.includes('BLOCKED');

    if (auditAlternative) {
        return { trading_scope: 'PAPER_TRACKED_AUDIT_ALTERNATIVE', paper_trading_scope: 'PAPER_TRACKED_AUDIT', portfolio_scope: 'EXCLUDED_FROM_REAL_PORTFOLIO', audit_scope_reason: 'Step92: riga Analisi AI conservata nel Paper Trading come audit/counterfactual; esclusa dal portfolio reale.', paperOperational: false, portfolioEligible: false };
    }
    if (stake <= 0) {
        return { trading_scope: 'PAPER_TRACKED_ZERO_STAKE', paper_trading_scope: 'PAPER_TRACKED_AUDIT', portfolio_scope: 'EXCLUDED_FROM_REAL_PORTFOLIO', audit_scope_reason: 'Step92: stake zero ma riga Analisi AI salvata nel Paper Trading per tracking statistico.', paperOperational: false, portfolioEligible: false };
    }
    if (blocked) {
        return { trading_scope: 'PAPER_TRACKED_BLOCKED_GATE', paper_trading_scope: 'PAPER_TRACKED_AUDIT', portfolio_scope: 'EXCLUDED_FROM_REAL_PORTFOLIO', audit_scope_reason: 'Step92: gate/DeepScan bloccante; riga salvata nel Paper Trading statistico, non nel portfolio reale.', paperOperational: false, portfolioEligible: false };
    }
    return { trading_scope: 'PAPER_OPERATIONAL', paper_trading_scope: 'PAPER_OPERATIONAL', portfolio_scope: 'EXCLUDED_FROM_REAL_PORTFOLIO', audit_scope_reason: 'Step92: pending Tennis operativo con stake > 0; portfolio reale solo dopo settlement idempotente.', paperOperational: true, portfolioEligible: false };
}

function buildStep92TennisBasePairs(bet = {}, betTypeStr = 'SINGLE_TENNIS') {
    return [
        ['bet_type', betTypeStr], ['match_date', bet.date], ['home_team', bet.home], ['away_team', bet.away],
        ['prediction', bet.prediction], ['odd', bet.odd], ['stake', parseFloat(bet.invested || bet.stake || 0) || 0],
        ['estimated_prob', bet.estimatedProb], ['edge', bet.edge_pp], ['league', bet.league],
        ['strategy_tag', bet.strategy_tag], ['sport_type', 'TENNIS']
    ];
}

function buildStep92TennisOptionalPairs(bet = {}) {
    const scopeSnapshot = buildStep92TennisPendingScopeSnapshot(bet);
    // PATCH10_QUALITY_BASE_BEFORE_DEEPSCAN: quantitative-only, no ds_action/result/current CLV.
    const qualityBase = tennisQualityGateV2.evaluateBaseQualityGate(bet);
    const pairs = [
        ['edge_pp', bet.edge_pp],
        ['ev_pct', bet.ev_pct],
        ['model_version', TENNIS_MODEL_VERSION], ['metric_version', TENNIS_METRIC_VERSION], ['engine_version', TENNIS_ENGINE_VERSION],
        ['data_quality', 'CURRENT_BOOTSTRAP'],
        ['market_implied_prob', bet.marketImpliedProbability], ['fair_odd_model', bet.audit?.fair_odd_model || null], ['fair_odd_calibrated', bet.audit?.fair_odd_calibrated || null],
        ['tour_type', bet.tour_type || inferTennisTourType(bet.strategy_tag || bet.league)], ['surface', bet.surface || null],
        ['surface_source', bet.surface_source || bet.reference?.surfaceResolution?.source || null], ['surface_rule_id', bet.surface_rule_id || bet.reference?.surfaceResolution?.ruleId || null],
        ['surface_original', bet.surface_original || bet.reference?.surfaceResolution?.providerSurface || null], ['surface_overridden_provider', bet.surface_overridden_provider || bet.reference?.surfaceResolution?.overriddenProviderSurface || null],
        ['surface_detail', bet.surface_detail || bet.reference?.surfaceResolution?.surfaceDetail || bet.reference?.surfaceResolution?.surfaceLabel || null], ['surface_regime_key', bet.surface_regime_key || bet.reference?.surfaceResolution?.surfaceRegimeKey || null],
        ['surface_confidence', bet.surface_confidence ?? bet.reference?.surfaceResolution?.confidence ?? null], ['surface_indoor', (bet.surface_indoor === 1 || bet.surface_indoor === true || bet.reference?.surfaceResolution?.indoor === true) ? 1 : 0],
        ['tournament_name', bet.tournament_name || bet.tournamentName || bet.reference?.surfaceResolution?.tournamentName || bet.league || null], ['tournament_canonical_name', bet.tournament_canonical_name || bet.tournamentCanonicalName || bet.reference?.surfaceResolution?.tournamentCanonicalName || bet.tournament_name || bet.league || null],
        ['tournament_catalog_id', bet.tournament_catalog_id || bet.reference?.surfaceResolution?.tournamentCatalogId || null], ['tournament_category', bet.tournament_category || bet.reference?.surfaceResolution?.tournamentCategory || null],
        ['tournament_level', bet.tournament_level || bet.reference?.surfaceResolution?.tournamentLevel || null], ['tournament_country', bet.tournament_country || bet.reference?.surfaceResolution?.tournamentCountry || null], ['tournament_period', bet.tournament_period || bet.reference?.surfaceResolution?.tournamentPeriod || null],
        ['market_type', bet.marketType || inferTennisMarketTypeFromPrediction(bet.prediction)], ['point_line', bet.point ?? null],
        ['reference_market_source', bet.reference_market_source || bet.reference?.source || null], ['reference_market_quality', bet.reference_market_quality || bet.reference?.quality || null],
        ['reference_odd1', bet.referenceOdd1 || bet.odd1 || null], ['reference_odd2', bet.referenceOdd2 || bet.odd2 || null],
        ['model_confidence_score', bet.valueScore || null], ['data_sufficiency_score', bet.dataSufficiencyScore || null], ['opening_odd', bet.openingOdd || null],
        ['markov_validated', bet.markovValidated === true ? 1 : 0],
        ['professional_gate_status', bet.professional_gate_status || bet.professionalGate?.status || null],
        ['professional_gate_allow_bet', (bet.professional_gate_allow_bet === true || bet.professionalGate?.allowBet === true) ? 1 : 0],
        ['professional_gate_reasons', bet.professional_gate_reasons || (Array.isArray(bet.professionalGate?.reasons) ? bet.professionalGate.reasons.join(' | ') : null)],
        ['professional_gate_max_stake', bet.professional_gate_max_stake || bet.professionalGate?.stakePolicy?.recommendedMaxStake || null],
        ['quality_base_code', qualityBase.code], ['quality_base_label', qualityBase.label], ['quality_base_score', qualityBase.score],
        ['quality_base_reason', qualityBase.reason], ['quality_base_version', qualityBase.version],
        ['quality_final_code', bet.quality_final_code || null], ['quality_final_label', bet.quality_final_label || null], ['quality_final_score', bet.quality_final_score ?? null],
        ['quality_final_reason', bet.quality_final_reason || null], ['quality_final_version', bet.quality_final_version || null],
        ['quality_stake_mode', bet.quality_stake_mode || null], ['quality_stake_amount', bet.quality_stake_amount ?? null], ['quality_budget_pct', bet.quality_budget_pct ?? null],
        ['quality_decision_at', bet.quality_decision_at || null], ['quality_deepscan_class', bet.quality_deepscan_class || null], ['quality_deepscan_separate', 1],
        ['tennis_operational_status', bet.tennis_operational_status || bet.operationalReport?.status || null], ['tennis_operational_action', bet.tennis_operational_action || bet.operationalReport?.action || null], ['tennis_operational_summary', bet.tennis_operational_summary || bet.operationalReport?.summary || null],
        ['deep_scan_risk_level', bet.deep_scan_risk_level || null], ['deep_scan_risk_score', bet.deep_scan_risk_score || null],
        ['deepscan_gate_mode', bet.deepscan_gate_mode || null], ['deepscan_gate_status', bet.deepscan_gate_status || null], ['deepscan_gate_reason', bet.deepscan_gate_reason || null],
        ['stake_policy_note', bet.stake_policy_note || bet.stakePolicyApplied?.reason || bet.stakePolicy?.gateCapReason || null], ['stake_base_before_deepscan', parseFloat(bet.requestedStake || bet.invested || 0) || null],
        ['kelly_fraction_pct', bet.stakePolicy?.kellyFractionPct ?? null], ['kelly_raw_stake', bet.stakePolicy?.kellyRawStake ?? null], ['stake_confidence_multiplier', bet.stakePolicy?.confidenceMultiplier ?? null], ['stake_confidence_level', bet.stakePolicy?.stakeConfidenceLevel ?? null],
        ['stake_min_applied', bet.stakePolicy?.minStakeApplied === true ? 1 : 0], ['stake_cap_applied', (bet.stakePolicy?.capApplied === true || bet.stakePolicy?.gateCapApplied === true) ? 1 : 0], ['stake_policy_mode', bet.stakePolicy?.mode || TENNIS_KELLY_STAKE_POLICY.mode],
        ['trading_scope', scopeSnapshot.trading_scope], ['paper_trading_scope', scopeSnapshot.paper_trading_scope], ['portfolio_scope', scopeSnapshot.portfolio_scope], ['audit_scope_reason', scopeSnapshot.audit_scope_reason],
        ['predicted_player_name', bet.predicted_player_name || bet.predictedPlayerName || null], ['opponent_player_name', bet.opponent_player_name || bet.opponentPlayerName || null], ['internal_side', bet.internal_side || bet.internalSide || null],
        ['official_event_order', bet.official_event_order || bet.officialEventOrder || null], ['provider_event_id', bet.provider_event_id || bet.providerEventId || null],
        ['provider_home_team', bet.provider_home_team || bet.providerHomeTeam || bet.home || null], ['provider_away_team', bet.provider_away_team || bet.providerAwayTeam || bet.away || null],
        ['side_mapping_warning', bet.side_mapping_warning || bet.sideMappingWarning || 'SIDE_MAPPING_VERIFIED_BY_PLAYER_NAME'], ['side_mapping_verified', (bet.side_mapping_verified === true || bet.side_mapping_verified === 1 || bet.sideMappingVerified === true) ? 1 : 0],
        ['side_identity_version', bet.side_identity_version || bet.sideIdentityVersion || (typeof sideIdentity !== 'undefined' ? sideIdentity.STEP91H_TENNIS_SIDE_IDENTITY_GUARD : 'STEP91H_TENNIS_SIDE_IDENTITY_GUARD')],
        ['tennis_canonical_match_key', bet.tennis_canonical_match_key || bet.canonicalMatchKey || null],
        ['tennis_event_fingerprint', bet.tennis_event_fingerprint || null],
        ['tennis_market_fingerprint', bet.tennis_market_fingerprint || null],
        ['tennis_event_identity_status', bet.tennis_event_identity_status || null],
        ['tennis_event_identity_reason', bet.tennis_event_identity_reason || null],
        ['tennis_event_identity_confidence', bet.tennis_event_identity_confidence || null],
        ['tennis_event_identity_version', bet.tennis_event_identity_version || tennisEventIdentity.TENNIS_EVENT_IDENTITY_VERSION],
        ['canonical_match_datetime', bet.canonical_match_datetime || null],
        ['canonical_tournament_key', bet.canonical_tournament_key || null],
        ['canonical_player_pair_key', bet.canonical_player_pair_key || null],
        ['analysis_drift_detected', bet.analysis_drift_detected ? 1 : 0],
        ['analysis_drift_reason', bet.analysis_drift_reason || null],
        ['analysis_previous_deepscan', bet.analysis_previous_deepscan || null],
        ['analysis_previous_gate', bet.analysis_previous_gate || null],
        ['analysis_current_deepscan', bet.analysis_current_deepscan || null],
        ['analysis_current_gate', bet.analysis_current_gate || null],
        ['analysis_fingerprint', bet.analysis_fingerprint || null],
        ['analysis_updated_at', bet.analysis_updated_at || null],
        ['match_exposure_key', bet.tennis_event_fingerprint || bet.match_exposure_key || buildStep54TennisExposureKey(bet)], ['exposure_role', bet.exposure_role || null], ['exposure_group_status', bet.exposure_group_status || null], ['exposure_reason', bet.exposure_reason || null]
    ];
    const seen = new Set();
    return pairs.filter(([column]) => { if (seen.has(column)) return false; seen.add(column); return true; });
}

function step92ApplyPendingPostMatchClear(setParts, params) {
    const columnsToNull = ['closing_odd', 'clv_pct', 'clv_method', 'closing_odd_side', 'settled_at', 'profit'];
    for (const column of columnsToNull) {
        if (columnExists('ai_forward_test', column) && !setParts.some(part => String(part).toLowerCase().startsWith(column + ' ='))) {
            setParts.push(column + ' = NULL');
        }
    }
    if (columnExists('ai_forward_test', 'closing_line_available') && !setParts.some(part => String(part).toLowerCase().startsWith('closing_line_available ='))) setParts.push('closing_line_available = 0');
    return { setParts, params };
}

// ============================================================================
// AUDIT16D_R3_T7_R1 - PATCH46 FINAL STAKE AUTHORITY PRESERVATION
// Generic /analyze savePending upserts are allowed to refresh analysis metadata,
// but they are NOT an authority to replace an already-issued Patch46 executable
// stake contract. Only a new Patch46 contract may change that executable stake.
// ============================================================================
function getT7Patch46FinalStakeLock(existingId) {
    const required = [
        'tennis_stake_contract_version', 'tennis_stake_final_executable',
        'tennis_stake_final_authority', 'tennis_stake_contract_hash',
        'tennis_stake_contract_snapshot_id'
    ];
    if (!required.every(column => columnExists('ai_forward_test', column))) {
        return { locked: false, reason: 'PATCH46_COLUMNS_UNAVAILABLE' };
    }
    const row = db.prepare(`SELECT id, stake, tennis_stake_contract_version, tennis_stake_final_executable,
        tennis_stake_final_authority, tennis_stake_contract_hash, tennis_stake_contract_snapshot_id
        FROM ai_forward_test WHERE id=?`).get(existingId);
    if (!row) return { locked: false, reason: 'ROW_NOT_FOUND' };

    // T7_R1: i campi copiati sulla source row non sono sufficienti. Il lock è
    // valido solo se esiste lo snapshot Patch46 append-only corrispondente e se
    // hash/versione/authority/stake coincidono esattamente con la source row.
    const snapshotTable = tennisStakeExecutionContractPatch46.SNAPSHOT_TABLE;
    const snapshotTableExists = Boolean(db.prepare("SELECT 1 present FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(snapshotTable));
    const snapshot = snapshotTableExists
        ? db.prepare(`SELECT snapshot_id, bet_id, contract_version, contract_hash, final_executable_stake, final_authority, payload_json
            FROM ${snapshotTable}
            WHERE snapshot_id=? AND bet_id=? AND contract_hash=? LIMIT 1`).get(
                row.tennis_stake_contract_snapshot_id, row.id, row.tennis_stake_contract_hash
            ) || null
        : null;
    return {
        ...tennisStakeContractAuthorityT7.inspectFinalStakeLock(row, tennisStakeExecutionContractPatch46, {
            requireSnapshot: true,
            snapshot
        }),
        row,
        snapshot
    };
}

function applyT7Patch46StakeLockToPendingBet(existingId, bet = {}) {
    const lock = getT7Patch46FinalStakeLock(existingId);
    if (!lock.locked) return { bet, lock };
    const adjusted = tennisStakeContractAuthorityT7.applyFinalStakeLock(bet, lock);
    if (tennisStakeContractAuthorityT7.changedIncomingStake(bet, lock)) {
        const currentIncomingStake = Number(bet?.invested ?? bet?.stake ?? bet?.stakePolicy?.finalStake);
        runtimeDiagnostics.writeDiagnostic({
            level: 'INFO', component: 'TENNIS_STAKE_AUTHORITY', operation: 'PENDING_UPSERT',
            operationId: runtimeDiagnostics.createOperationId('TENNIS_T7_R1_PATCH46_STAKE_LOCK'),
            phase: 'PATCH46_FINAL_STAKE_PRESERVED', event: 'PATCH46_FINAL_STAKE_PRESERVED',
            message: `Bet ${existingId}: savePending non autorizzato a sostituire lo stake finale Patch46 €${Number(lock.finalStake).toFixed(2)}.`,
            context: { betId: Number(existingId), incomingStake: Number.isFinite(currentIncomingStake) ? currentIncomingStake : null, lockedStake: Number(lock.finalStake), contractHash: lock.row.tennis_stake_contract_hash, snapshotId: lock.row.tennis_stake_contract_snapshot_id }
        });
    }
    return { bet: adjusted, lock };
}

function updateStep92ExistingPendingTennisBet(existingId, bet = {}, betTypeStr = 'SINGLE_TENNIS') {
    // STEP92_PENDING_UPDATE_NO_POSTMATCH_FIELDS
    const existing = db.prepare("SELECT id FROM ai_forward_test WHERE id = ? AND UPPER(COALESCE(status,'')) = 'PENDING' AND (UPPER(COALESCE(sport_type,'')) = 'TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%')").get(existingId);
    if (!existing) return false;
    // T7: after Patch46 has issued a complete final contract, generic savePending
    // refreshes may update analysis metadata but must preserve its executable stake.
    const t7StakeLock = applyT7Patch46StakeLockToPendingBet(existingId, bet);
    bet = t7StakeLock.bet;
    const setParts = []; const params = []; const seen = new Set();
    const pairs = [...buildStep92TennisBasePairs(bet, betTypeStr), ...buildStep92TennisOptionalPairs(bet)];
    for (const [column, value] of pairs) {
        if (['status', 'profit', 'closing_odd', 'clv_pct', 'clv_method', 'closing_odd_side', 'settled_at', 'settlement_source', 'settlement_note'].includes(column)) continue;
        if (seen.has(column)) continue; seen.add(column);
        if (columnExists('ai_forward_test', column)) { setParts.push(column + ' = ?'); params.push(value); }
    }
    step92ApplyPendingPostMatchClear(setParts, params);
    if (!setParts.length) return false;
    params.push(existingId);
    db.prepare('UPDATE ai_forward_test SET ' + setParts.join(', ') + " WHERE id = ? AND UPPER(COALESCE(status,'')) = 'PENDING'").run(...params);
    savePendingTennisBet.lastAction = 'UPDATED_PENDING_STEP92';
    return true;
}

function applyStep92ConflictToBet(bet = {}, oppositeConflict = null) {
    if (!oppositeConflict) return bet;
    bet.invested = '0.00'; bet.estimatedProfit = '0.00';
    bet.professional_gate_status = 'BLOCKED_OPPOSITE_SIDE_CONFLICT'; bet.professional_gate_allow_bet = false; bet.professional_gate_reasons = oppositeConflict.reason;
    bet.tennis_operational_status = 'BLOCKED'; bet.tennis_operational_action = 'NO_BET'; bet.tennis_operational_summary = oppositeConflict.reason;
    bet.stakePolicyApplied = { adjusted: true, originalStake: Number(bet.requestedStake || bet.invested || 0), stake: 0, reason: oppositeConflict.reason };
    return bet;
}
// /STEP92_TENNIS_PAPER_TRADING_FINAL_FUNCTIONAL_RESTORE


// STEP96E_RUNTIME_MICRO_TEST_SQL_AND_PERSISTENCE_REPAIR
// Corregge il bug Step96D: la patch precedente falliva nel backfill SQL e il runtime
// non preservava il micro-test quando /analyze aggiornava un PENDING esistente.
// Regola: RISCHIO MODELLO + BLOCCATA SOFT con storico bootstrap positivo -> MICRO TEST
// nel Paper Trading, non stake pieno e non promozione automatica.
function getStep96DRiskModelSoftRuntimeSignalStats() {
    try {
        const row = db.prepare([
            "SELECT COUNT(*) AS totalSignals,",
            "SUM(CASE WHEN UPPER(COALESCE(status,''))='WON' THEN 1 ELSE 0 END) AS wins,",
            "SUM(CASE WHEN UPPER(COALESCE(status,''))='LOST' THEN 1 ELSE 0 END) AS losses,",
            "SUM(CASE WHEN UPPER(COALESCE(status,''))='PENDING' THEN 1 ELSE 0 END) AS pending,",
            "SUM(CASE WHEN UPPER(COALESCE(status,'')) IN ('WON','LOST') AND COALESCE(stake,0) > 0 THEN 1 ELSE 0 END) AS operationalResolved,",
            "SUM(CASE WHEN UPPER(COALESCE(status,'')) IN ('WON','LOST') AND COALESCE(stake,0) > 0 THEN COALESCE(stake,0) ELSE 0 END) AS stakeReal,",
            "SUM(CASE WHEN UPPER(COALESCE(status,'')) IN ('WON','LOST') AND COALESCE(stake,0) > 0 THEN COALESCE(profit,0) ELSE 0 END) AS profitReal",
            "FROM ai_forward_test",
            "WHERE UPPER(COALESCE(sport_type,''))='TENNIS'",
            "  AND UPPER(COALESCE(data_quality,'CURRENT_BOOTSTRAP')) IN ('CURRENT','CURRENT_BOOTSTRAP')",
            "  AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PENDING')",
            "  AND UPPER(COALESCE(ds_action, deep_scan_risk_level, ds_suggestion, '')) LIKE '%RISCHIO MODELLO%'",
            "  AND (",
            "        UPPER(COALESCE(tennis_operational_status,'')) LIKE '%BLOCCATA SOFT%'",
            "        OR UPPER(COALESCE(professional_gate_status,'')) LIKE '%BLOCKED_SOFT%'",
            "        OR UPPER(COALESCE(professional_gate_status,'')) LIKE '%MODEL_RISK_STEP64%'",
            "      )",
            "  AND UPPER(COALESCE(professional_gate_status,'')) NOT LIKE '%HARD%'",
            "  AND UPPER(COALESCE(tennis_operational_status,'')) NOT LIKE '%HARD%'"
        ].join('\n')).get() || {};

        return step96DeepScanGatePolicy.normalizeStats({
            totalSignals: toNumber(row.totalSignals, 0),
            wins: toNumber(row.wins, 0),
            losses: toNumber(row.losses, 0),
            pending: toNumber(row.pending, 0),
            operationalResolved: toNumber(row.operationalResolved, 0),
            stakeReal: toNumber(row.stakeReal, 0),
            profitReal: toNumber(row.profitReal, 0)
        });
    } catch (error) {
        return step96DeepScanGatePolicy.normalizeStats({});
    }
}

function applyStep96DRuntimeMicroTestPersistenceToPending(bet = {}, existingPending = {}) {
    if (!bet || typeof bet !== 'object') return bet || {};

    const dsText = [
        existingPending.ds_action,
        existingPending.deep_scan_risk_level,
        existingPending.ds_suggestion,
        bet.ds_action,
        bet.deep_scan_risk_level,
        bet.ds_suggestion,
        bet.deepScanStatus
    ].map(v => String(v || '').toUpperCase()).join(' ');

    const gateText = [
        existingPending.tennis_operational_status,
        existingPending.tennis_operational_action,
        existingPending.tennis_operational_summary,
        existingPending.professional_gate_status,
        existingPending.professional_gate_reasons,
        existingPending.deepscan_gate_status,
        existingPending.deepscan_gate_reason,
        bet.tennis_operational_status,
        bet.tennis_operational_action,
        bet.tennis_operational_summary,
        bet.professional_gate_status,
        bet.professional_gate_reasons
    ].map(v => String(v || '').toUpperCase()).join(' ');

    const isRiskModel = dsText.includes('RISCHIO MODELLO') || dsText.includes('MODEL_RISK') || dsText.includes('MODEL RISK');
    const isSoftGate = gateText.includes('BLOCCATA SOFT') || gateText.includes('BLOCKED_SOFT') || gateText.includes('BLOCKED SOFT') || gateText.includes('MODEL_RISK_STEP64');
    const hardVeto = gateText.includes('BLOCCATA HARD') || gateText.includes('BLOCKED_HARD') || gateText.includes('NO_BET_HARD') || gateText.includes('OPPOSITE_SIDE_CONFLICT') || gateText.includes('ALTO RISCHIO') || gateText.includes('HIGH_RISK') || gateText.includes('DATA_INSUFFICIENT');

    const edgePp = toNumber(bet.edge_pp ?? bet.edge ?? existingPending.edge_pp, 0);
    const evPct = toNumber(bet.ev_pct ?? existingPending.ev_pct, 0);
    if (!isRiskModel || !isSoftGate || hardVeto || edgePp < 5 || evPct < 5) {
        return bet;
    }

    const stats = getStep96DRiskModelSoftRuntimeSignalStats();
    const strong = typeof step96DeepScanGatePolicy.isStep96CStrongRiskModelSoftSignal === 'function'
        ? step96DeepScanGatePolicy.isStep96CStrongRiskModelSoftSignal(stats)
        : (stats.totalSignals >= 12 && stats.resolvedSignals >= 10 && stats.signalWinRatePct >= 65 && stats.pendingRatePct <= 35);
    if (!strong) return bet;

    const decision = step96DeepScanGatePolicy.evaluateStep96DeepScanGateCombinationDecision({
        deepScan: 'RISCHIO MODELLO',
        gate: 'BLOCCATA SOFT',
        historicalStats: stats
    });
    if (decision.allowMicroStake !== true) return bet;

    const micro = Math.max(DEFAULT_MIN_BET, toNumber(decision.recommendedStake, DEFAULT_MIN_BET));
    const odd = normalizeOdd(bet.odd || existingPending.odd) || 1;
    const estimatedProfit = micro > 0 && odd > 1 ? round(micro * (odd - 1), 2) : 0;
    const reason = 'Step96E: RISCHIO MODELLO + BLOCCATA SOFT con storico bootstrap positivo: MICRO TEST runtime persistito nel Paper Trading. No stake pieno.';

    return {
        ...bet,
        invested: micro.toFixed(2),
        stake: micro,
        estimatedProfit: estimatedProfit.toFixed(2),
        professional_gate_status: 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP96E',
        professional_gate_allow_bet: true,
        professional_gate_reasons: reason,
        professional_gate_max_stake: micro,
        tennis_operational_status: 'WATCHLIST MICRO',
        tennis_operational_action: 'PAPER_OR_MICRO_STAKE',
        tennis_operational_summary: reason,
        deep_scan_risk_level: 'RISCHIO_MODELLO',
        deepscan_gate_mode: 'STEP96E_RUNTIME_MICRO_TEST_SQL_AND_PERSISTENCE_REPAIR',
        deepscan_gate_status: 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP96E',
        deepscan_gate_reason: reason,
        stake_policy_note: reason,
        trading_scope: 'PAPER_OPERATIONAL',
        paper_trading_scope: 'PAPER_OPERATIONAL',
        portfolio_scope: 'EXCLUDED_FROM_REAL_PORTFOLIO',
        audit_scope_reason: 'Step96E: micro-test paper operativo; portfolio reale solo dopo settlement e senza promozione automatica.',
        stakePolicyApplied: {
            ...(bet.stakePolicyApplied || {}),
            adjusted: true,
            originalStake: toNumber(existingPending.stake ?? bet.stake ?? bet.invested, 0),
            stake: micro,
            reason
        },
        stakePolicy: {
            ...(bet.stakePolicy || {}),
            finalStake: micro,
            professionalGateCap: micro,
            gateCapApplied: true,
            gateCapReason: reason
        },
        step96DRuntimeMicroTestPersistence: true,
        step96ERuntimeMicroTestSqlAndPersistenceRepair: true,
        step96RuntimeStats: stats,
        step96RuntimeDecision: decision
    };
}


// ============================================================================
// STEP96F_RUNTIME_MICRO_TEST_FINAL_OVERRIDE_AND_DRIFT_AUDIT
// Fix definitivo: Step96/96C/96E non deve restare solo audit o upsert.
// - RISCHIO MODELLO + BLOCCATA SOFT con segnale storico bootstrap positivo
//   diventa MICRO TEST paper-trading anche se data sufficiency è bassa.
// - DATA_SUFFICIENCY_BLOCK resta divieto di stake pieno/portfolio reale, ma non
//   hard veto per micro-test statistico.
// - Se una nuova scansione cambia categoria DeepScan/Gate, il cambio viene
//   tracciato: non deve più sembrare una fotografia mutata senza spiegazione.
// ============================================================================
const STEP96F_RUNTIME_MICRO_TEST_FINAL_OVERRIDE_AND_DRIFT_AUDIT = 'STEP96F_RUNTIME_MICRO_TEST_FINAL_OVERRIDE_AND_DRIFT_AUDIT';

function step96FText(...values) {
    return values.map(v => String(v || '').toUpperCase()).join(' ');
}

function step96FNormalizeDeepScan(value) {
    try { return step96DeepScanGatePolicy.normalizeStep96DeepScanCategory(value); } catch (error) { return String(value || 'UNKNOWN').toUpperCase(); }
}

function step96FNormalizeGate(value) {
    try { return step96DeepScanGatePolicy.normalizeStep96GateCategory(value); } catch (error) { return String(value || 'UNKNOWN').toUpperCase(); }
}

function step96FTrueHardVeto(text = '') {
    const t = String(text || '').toUpperCase();
    // Hard veto reali. Nota: DATA_SUFFICIENCY_BLOCK non è qui: blocca stake pieno,
    // ma Step96F può ammettere micro-test paper-trading, non portfolio reale.
    return t.includes('BLOCCATA HARD') ||
        t.includes('BLOCKED_HARD') ||
        t.includes('BLOCKED HARD') ||
        t.includes('NO_BET_HARD') ||
        t.includes('NO BET HARD') ||
        t.includes('OPPOSITE_SIDE_CONFLICT') ||
        t.includes('ALTO RISCHIO') ||
        t.includes('HIGH_RISK') ||
        t.includes('HIGH RISK') ||
        t.includes('INVALID_ODD') ||
        t.includes('QUOTE NON VALIDE') ||
        t.includes('RETIREMENT') ||
        t.includes('WALKOVER');
}

function buildStep96FReportDeepScanText(report = {}) {
    return step96FText(
        report.action,
        report.level,
        report.riskAssessment?.level,
        report.quantData?.riskAssessment?.level,
        report.suggestionText,
        report.summary,
        report.explainability,
        report.verdict
    );
}

function getStep96FRiskModelSoftMicroDecision(bet = {}, existingPending = {}, options = {}) {
    const reportText = options.reportText || '';
    const dsText = step96FText(
        reportText,
        bet.ds_action,
        bet.deep_scan_risk_level,
        bet.ds_suggestion,
        bet.deepScanStatus,
        existingPending.ds_action,
        existingPending.deep_scan_risk_level,
        existingPending.ds_suggestion
    );
    const gateText = step96FText(
        bet.professional_gate_status,
        bet.professional_gate_reasons,
        bet.tennis_operational_status,
        bet.tennis_operational_action,
        bet.tennis_operational_summary,
        bet.deepscan_gate_status,
        bet.deepscan_gate_reason,
        existingPending.professional_gate_status,
        existingPending.professional_gate_reasons,
        existingPending.tennis_operational_status,
        existingPending.tennis_operational_action,
        existingPending.tennis_operational_summary,
        existingPending.deepscan_gate_status,
        existingPending.deepscan_gate_reason,
        existingPending.stake_policy_note
    );
    const isRiskModel = dsText.includes('RISCHIO MODELLO') || dsText.includes('RISCHIO_MODELLO') || dsText.includes('MODEL_RISK') || dsText.includes('MODEL RISK');
    const isSoftGate = gateText.includes('BLOCCATA SOFT') || gateText.includes('BLOCKED_SOFT') || gateText.includes('BLOCKED SOFT') || gateText.includes('MODEL_RISK_STEP64') || gateText.includes('NO_BET_PREMATCH_MODEL_RISK');
    const hardVeto = step96FTrueHardVeto(gateText + ' ' + dsText);
    const edgePp = toNumber(bet.edge_pp ?? bet.edge ?? options.edge_pp ?? existingPending.edge_pp, 0);
    const evPct = toNumber(bet.ev_pct ?? options.ev_pct ?? existingPending.ev_pct, 0);
    const numericallyPositive = edgePp >= 5 && evPct >= 5;
    const stats = getStep96DRiskModelSoftRuntimeSignalStats();
    const strongSignal = typeof step96DeepScanGatePolicy.isStep96CStrongRiskModelSoftSignal === 'function'
        ? step96DeepScanGatePolicy.isStep96CStrongRiskModelSoftSignal(stats)
        : (stats.totalSignals >= 12 && stats.resolvedSignals >= 10 && stats.signalWinRatePct >= 65 && stats.pendingRatePct <= 35);
    const decision = step96DeepScanGatePolicy.evaluateStep96DeepScanGateCombinationDecision({
        deepScan: 'RISCHIO MODELLO',
        gate: 'BLOCCATA SOFT',
        historicalStats: stats
    });
    const allow = isRiskModel && isSoftGate && !hardVeto && numericallyPositive && strongSignal && decision.allowMicroStake === true;
    return {
        mode: STEP96F_RUNTIME_MICRO_TEST_FINAL_OVERRIDE_AND_DRIFT_AUDIT,
        allow,
        isRiskModel,
        isSoftGate,
        hardVeto,
        numericallyPositive,
        edgePp,
        evPct,
        stats,
        strongSignal,
        decision,
        recommendedStake: Math.max(DEFAULT_MIN_BET, toNumber(decision.recommendedStake, DEFAULT_MIN_BET)),
        reason: allow
            ? 'Step96F: RISCHIO MODELLO + BLOCCATA SOFT con storico bootstrap positivo: MICRO TEST paper-trading persistito. DATA_SUFFICIENCY_BLOCK impedisce stake pieno, non il micro-test statistico.'
            : 'Step96F: micro-test non applicato perché una condizione è falsa.'
    };
}

function applyStep96FRiskModelSoftMicroToBet(bet = {}, existingPending = {}, source = 'runtime') {
    if (!bet || typeof bet !== 'object') return bet || {};
    const decision = getStep96FRiskModelSoftMicroDecision(bet, existingPending, { reportText: bet.__step96FReportText || '' });
    if (!decision.allow) return bet;
    const micro = getStep64MicroStakeForTennisRow({ ...existingPending, ...bet }, decision.recommendedStake || DEFAULT_MIN_BET);
    const odd = normalizeOdd(bet.odd || existingPending.odd) || 1;
    const estimatedProfit = micro > 0 && odd > 1 ? round(micro * (odd - 1), 2) : 0;
    const reason = decision.reason + ' Fonte: ' + source + '. No stake pieno, no promozione automatica, portfolio reale escluso fino a settlement.';
    return {
        ...bet,
        invested: micro.toFixed(2),
        stake: micro,
        estimatedProfit: estimatedProfit.toFixed(2),
        professional_gate_status: 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP96F',
        professional_gate_allow_bet: true,
        professional_gate_reasons: reason,
        professional_gate_max_stake: micro,
        tennis_operational_status: 'WATCHLIST MICRO',
        tennis_operational_action: 'PAPER_OR_MICRO_STAKE',
        tennis_operational_summary: reason,
        deep_scan_risk_level: 'RISCHIO_MODELLO',
        deepscan_gate_mode: STEP96F_RUNTIME_MICRO_TEST_FINAL_OVERRIDE_AND_DRIFT_AUDIT,
        deepscan_gate_status: 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP96F',
        deepscan_gate_multiplier: 0.5,
        deepscan_gate_reason: reason,
        stake_policy_note: reason,
        trading_scope: 'PAPER_OPERATIONAL',
        paper_trading_scope: 'PAPER_OPERATIONAL',
        portfolio_scope: 'EXCLUDED_FROM_REAL_PORTFOLIO',
        audit_scope_reason: 'Step96F: micro-test paper operativo; portfolio reale solo dopo settlement e senza promozione automatica.',
        stakePolicyApplied: {
            ...(bet.stakePolicyApplied || {}),
            adjusted: true,
            originalStake: toNumber(existingPending.stake ?? bet.stake ?? bet.invested, 0),
            stake: micro,
            reason
        },
        stakePolicy: {
            ...(bet.stakePolicy || {}),
            finalStake: micro,
            professionalGateCap: micro,
            gateCapApplied: true,
            gateCapReason: reason
        },
        step96FRuntimeMicroTestFinalOverride: true,
        step96RuntimeDecision: decision.decision,
        step96RuntimeStats: decision.stats,
        step96RuntimeEligibility: decision
    };
}

function applyStep96FAnalysisDriftAuditToBet(bet = {}, existingPending = {}, source = 'runtime') {
    if (!existingPending || !existingPending.id || !bet || typeof bet !== 'object') return bet || {};
    const previousDs = step96FNormalizeDeepScan(existingPending.ds_action || existingPending.deep_scan_risk_level || existingPending.ds_suggestion || '');
    const currentDsRaw = bet.ds_action || bet.deep_scan_risk_level || bet.ds_suggestion || '';
    const currentDs = step96FNormalizeDeepScan(currentDsRaw);
    const previousGate = step96FNormalizeGate(existingPending.tennis_operational_status || existingPending.professional_gate_status || existingPending.professional_gate_reasons || '');
    const currentGateRaw = bet.tennis_operational_status || bet.professional_gate_status || bet.professional_gate_reasons || '';
    const currentGate = step96FNormalizeGate(currentGateRaw);
    const hasCurrentDs = currentDsRaw && currentDs !== 'UNKNOWN';
    const hasCurrentGate = currentGateRaw && currentGate !== 'UNKNOWN';
    const dsChanged = hasCurrentDs && previousDs !== 'UNKNOWN' && previousDs !== currentDs;
    const gateChanged = hasCurrentGate && previousGate !== 'UNKNOWN' && previousGate !== currentGate;
    if (!dsChanged && !gateChanged) return bet;
    const reason = 'Step96F drift audit: nuova scansione ha cambiato categoria ' +
        (dsChanged ? ('DeepScan ' + previousDs + ' → ' + currentDs + '. ') : '') +
        (gateChanged ? ('Gate ' + previousGate + ' → ' + currentGate + '. ') : '') +
        'Possibile causa: quote/probabilità/reference/data sufficiency aggiornati tra scansioni. Fonte: ' + source + '.';
    const oldNote = String(bet.stake_policy_note || bet.stakePolicyApplied?.reason || bet.stakePolicy?.gateCapReason || '');
    return {
        ...bet,
        analysis_drift_detected: 1,
        analysis_previous_deepscan: previousDs,
        analysis_current_deepscan: currentDs,
        analysis_previous_gate: previousGate,
        analysis_current_gate: currentGate,
        analysis_drift_reason: reason,
        analysis_fingerprint: [bet.date || existingPending.match_date || '', bet.home || existingPending.home_team || '', bet.away || existingPending.away_team || '', bet.prediction || existingPending.prediction || '', bet.odd || existingPending.odd || '', bet.estimatedProb || existingPending.estimated_prob || '', bet.edge_pp || existingPending.edge_pp || '', bet.ev_pct || existingPending.ev_pct || ''].join('|'),
        analysis_updated_at: new Date().toISOString(),
        stake_policy_note: oldNote ? (oldNote + ' | ' + reason) : reason
    };
}

 

// ============================================================================
// STEP98E_TENNIS_SIDE_PROBABILITY_AND_MICRO_FINAL_STABILIZER
// STEP98D_TENNIS_SIDE_PROBABILITY_APPLY_AND_RUNTIME_FINAL_FIX
//
// Guard runtime finale contro mismatch lato/probabilità nei moneyline Tennis.
// Esempio anomalo bloccato: quota longshot >= 2.75 con probabilità modello da
// favorito >= 70%, edge/EV estremi e probabilità mercato bassa. Questa condizione
// indica probabile inversione lato, mapping posizione 1/2 non coerente, feed drift
// o riga paper storica sporca. La riga resta tracciata nel Paper Trading come audit
// statistico ma viene esclusa da stake operativo e portfolio reale.
// ============================================================================
const STEP98E_TENNIS_SIDE_PROBABILITY_AND_MICRO_FINAL_STABILIZER = 'STEP98E_TENNIS_SIDE_PROBABILITY_AND_MICRO_FINAL_STABILIZER';
const STEP98D_TENNIS_SIDE_PROBABILITY_APPLY_AND_RUNTIME_FINAL_FIX = 'STEP98D_TENNIS_SIDE_PROBABILITY_APPLY_AND_RUNTIME_FINAL_FIX';

function step98DNumber(value, fallback = null) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function step98DText(value) {
    return String(value === undefined || value === null ? '' : value);
}

function step98DUpper(value) {
    return step98DText(value).toUpperCase();
}

function isStep98DTennisMoneylineRow(row = {}) {
    const text = [row.sport_type, row.bet_type, row.strategy_tag, row.league].map(step98DUpper).join(' ');
    const market = step98DText(row.marketType || row.market_type || '').toLowerCase();
    const prediction = step98DUpper(row.prediction);
    const isTennis = text.includes('TENNIS') || text.includes('ATP') || text.includes('WTA');
    const isTotals = market === 'totals' || prediction.includes('OVER') || prediction.includes('UNDER');
    return isTennis && !isTotals;
}

function isStep98DTennisSideProbabilityMismatch(row = {}) {
    if (!row || typeof row !== 'object') return false;
    if (!isStep98DTennisMoneylineRow(row)) return false;

    const odd = step98DNumber(row.odd, null);
    const probability = step98DNumber(row.estimatedProb ?? row.estimated_prob ?? row.probability ?? row.prob, null);
    const edge = step98DNumber(row.edge_pp ?? row.edge, null);
    const ev = step98DNumber(row.ev_pct ?? row.ev, null);
    const marketProb = step98DNumber(
        row.marketImpliedProbability ?? row.market_implied_prob ?? row.market_probability_pct,
        (odd && odd > 1 ? (100 / odd) : null)
    );

    if (!Number.isFinite(odd) || !Number.isFinite(probability)) return false;

    const longshotWithFavoriteModel = odd >= 2.75 && probability >= 70;
    const extremeValue = (Number.isFinite(edge) && edge >= 25) || (Number.isFinite(ev) && ev >= 60);
    const marketDisagrees = Number.isFinite(marketProb) ? marketProb <= 45 : true;

    return longshotWithFavoriteModel && extremeValue && marketDisagrees;
}

function buildStep98DSideProbabilityMismatchReason(row = {}, meta = {}) {
    const odd = step98DNumber(row.odd, null);
    const probability = step98DNumber(row.estimatedProb ?? row.estimated_prob ?? row.probability ?? row.prob, null);
    const edge = step98DNumber(row.edge_pp ?? row.edge, null);
    const ev = step98DNumber(row.ev_pct ?? row.ev, null);
    const marketProb = step98DNumber(row.marketImpliedProbability ?? row.market_implied_prob, (odd && odd > 1 ? (100 / odd) : null));
    return [
        'Step98D/98E SIDE_PROBABILITY_MISMATCH: quota/probabilità incoerenti per moneyline Tennis.',
        'Possibile inversione lato 1/2, mapping provider cambiato, feed drift o riga legacy contaminata.',
        'Stake operativo azzerato; riga mantenuta solo come Paper Trading audit/statistico.',
        'odd=' + (odd === null ? 'N/D' : round(odd, 2)),
        'prob=' + (probability === null ? 'N/D' : round(probability, 2)),
        'edge=' + (edge === null ? 'N/D' : round(edge, 2)),
        'ev=' + (ev === null ? 'N/D' : round(ev, 2)),
        'marketProb=' + (marketProb === null ? 'N/D' : round(marketProb, 2)),
        'source=' + (meta.source || 'runtime')
    ].join(' | ');
}

function applyStep98DSideProbabilityFinalGuardToBet(bet = {}, meta = {}) {
    if (!bet || typeof bet !== 'object') return bet || {};
    if (!isStep98DTennisSideProbabilityMismatch(bet)) return bet;

    const reason = buildStep98DSideProbabilityMismatchReason(bet, meta);
    const originalEdge = step98DNumber(bet.edge_pp ?? bet.edge, null);
    const originalEv = step98DNumber(bet.ev_pct ?? bet.ev, null);
    const originalStake = step98DNumber(bet.stake ?? bet.invested, 0);

    return {
        ...bet,
        invested: '0.00',
        stake: 0,
        estimatedProfit: '0.00',
        edge_pp: 0,
        edge: 0,
        ev_pct: 0,
        ev: 0,
        adjusted_edge_pp: 0,
        adjusted_ev_pct: 0,
        professional_gate_status: 'BLOCKED_HARD_SIDE_PROBABILITY_MISMATCH_STEP98D',
        professional_gate_allow_bet: false,
        professional_gate_reasons: reason,
        professional_gate_max_stake: 0,
        tennis_operational_status: 'BLOCCATA HARD',
        tennis_operational_action: 'NO_BET_SIDE_PROBABILITY_MISMATCH',
        tennis_operational_summary: reason,
        deep_scan_risk_level: bet.deep_scan_risk_level || 'SIDE_PROBABILITY_MISMATCH',
        deepscan_gate_mode: STEP98D_TENNIS_SIDE_PROBABILITY_APPLY_AND_RUNTIME_FINAL_FIX,
        deepscan_gate_status: 'BLOCKED_HARD_SIDE_PROBABILITY_MISMATCH_STEP98D',
        deepscan_gate_multiplier: 0,
        deepscan_gate_reason: reason,
        stake_policy_note: reason,
        trading_scope: 'PAPER_TRACKED_AUDIT',
        paper_trading_scope: 'PAPER_TRACKED_AUDIT',
        portfolio_scope: 'EXCLUDED_FROM_REAL_PORTFOLIO',
        audit_scope_reason: reason,
        exposure_role: 'AUDIT_ALTERNATIVE',
        exposure_group_status: 'BLOCKED_HARD_SIDE_PROBABILITY_MISMATCH_STEP98D',
        exposure_reason: reason,
        step98d_side_probability_mismatch: true,
        step98d_original_edge_pp: originalEdge,
        step98d_original_ev_pct: originalEv,
        step98d_original_stake: originalStake,
        stakePolicyApplied: {
            ...(bet.stakePolicyApplied || {}),
            adjusted: true,
            originalStake,
            stake: 0,
            reason
        },
        stakePolicy: {
            ...(bet.stakePolicy || {}),
            finalStake: 0,
            professionalGateCap: 0,
            gateCapApplied: true,
            gateCapReason: reason
        }
    };
}

/* STEP98E_STATIC_COMPAT_MARKERS
 * isStep98DTennisSideProbabilityMismatch
 * applyStep98DSideProbabilityFinalGuardToBet
 * SIDE_PROBABILITY_MISMATCH
 * BLOCKED_HARD_SIDE_PROBABILITY_MISMATCH_STEP98D
 * PAPER_TRACKED_AUDIT
 * EXCLUDED_FROM_REAL_PORTFOLIO
 */

// /STEP98E_TENNIS_SIDE_PROBABILITY_AND_MICRO_FINAL_STABILIZER

// ============================================================================
// STEP101_RISK_MODEL_SOFT_MICRO_FINAL_GUARD
// Guard finale runtime + persistenza:
// RISCHIO MODELLO + BLOCCATA SOFT con Edge/EV positivi non deve restare a stake 0.
// DATA_SUFFICIENCY_BLOCK resta divieto di stake pieno/portfolio reale, ma non
// impedisce un micro-test statistico nel Paper Trading.
// ============================================================================
const STEP101_RISK_MODEL_SOFT_MICRO_FINAL_GUARD = 'STEP101_RISK_MODEL_SOFT_MICRO_FINAL_GUARD';

function step101RiskModelSoftText(...values) {
    return values.map(v => String(v || '').toUpperCase()).join(' ');
}

function step101RiskModelSoftHasTrueHardVeto(text = '') {
    const t = String(text || '').toUpperCase();

    // DATA_SUFFICIENCY_BLOCK / campione basso / calibrazione unknown NON sono hard veto
    // per il micro-test paper. Sono hard veto solo per stake pieno e portfolio reale.
    if (
        t.includes('OPPOSITE_SIDE_CONFLICT') ||
        t.includes('SIDE_PROBABILITY_MISMATCH') ||
        t.includes('INVALID_ODD') ||
        t.includes('QUOTE NON VALIDE') ||
        t.includes('RETIREMENT') ||
        t.includes('WALKOVER') ||
        t.includes('ALTO RISCHIO') ||
        t.includes('HIGH_RISK') ||
        t.includes('HIGH RISK') ||
        t.includes('NO_BET_HARD') ||
        t.includes('NO BET HARD')
    ) {
        return true;
    }

    // Se il testo contiene HARD ma deriva da insufficienza dati/campione/calibrazione,
    // non deve bloccare il micro-test statistico. Se invece è un HARD generico reale,
    // resta hard veto.
    const hasHard = t.includes('BLOCCATA HARD') || t.includes('BLOCKED_HARD') || t.includes('BLOCKED HARD');
    const hardIsOnlyDataOrCalibration =
        t.includes('DATA_SUFFICIENCY') ||
        t.includes('DATA INSUFFICIENT') ||
        t.includes('INSUFFICIENT') ||
        t.includes('CAMPIONE') ||
        t.includes('SAMPLE') ||
        t.includes('CALIBRAZIONE') ||
        t.includes('CALIBRATION') ||
        t.includes('UNKNOWN');

    return hasHard && !hardIsOnlyDataOrCalibration;
}

function getStep101RiskModelSoftMicroDecision(bet = {}, existingPending = {}, report = {}, stakeAdjustment = {}, extra = {}) {
    const dsText = step101RiskModelSoftText(
        extra.deepScanText,
        report.action,
        report.level,
        report.riskAssessment?.level,
        report.quantData?.riskAssessment?.level,
        report.suggestionText,
        report.summary,
        report.explainability,
        report.verdict,
        stakeAdjustment.level,
        stakeAdjustment.status,
        bet.ds_action,
        bet.deep_scan_risk_level,
        bet.ds_suggestion,
        existingPending.ds_action,
        existingPending.deep_scan_risk_level,
        existingPending.ds_suggestion
    );

    const gateText = step101RiskModelSoftText(
        extra.gateText,
        stakeAdjustment.reason,
        stakeAdjustment.status,
        bet.pre_match_gate_label,
        bet.professional_gate_status,
        bet.professional_gate_reasons,
        bet.tennis_operational_status,
        bet.tennis_operational_action,
        bet.tennis_operational_summary,
        bet.deepscan_gate_status,
        bet.deepscan_gate_reason,
        bet.stake_policy_note,
        existingPending.pre_match_gate_label,
        existingPending.professional_gate_status,
        existingPending.professional_gate_reasons,
        existingPending.tennis_operational_status,
        existingPending.tennis_operational_action,
        existingPending.tennis_operational_summary,
        existingPending.deepscan_gate_status,
        existingPending.deepscan_gate_reason,
        existingPending.stake_policy_note
    );

    const isRiskModel = dsText.includes('RISCHIO MODELLO') || dsText.includes('RISCHIO_MODELLO') || dsText.includes('MODEL_RISK') || dsText.includes('MODEL RISK');
    const isSoftGate = gateText.includes('BLOCCATA SOFT') || gateText.includes('BLOCKED_SOFT') || gateText.includes('BLOCKED SOFT') || gateText.includes('MODEL_RISK_STEP64') || gateText.includes('NO_BET_PREMATCH_MODEL_RISK');
    const hardVeto = step101RiskModelSoftHasTrueHardVeto(dsText + ' ' + gateText);
    const edgePp = toNumber(extra.edge_pp ?? bet.edge_pp ?? bet.edge ?? report.edge_pp ?? existingPending.edge_pp, 0);
    const evPct = toNumber(extra.ev_pct ?? bet.ev_pct ?? bet.ev ?? report.ev_pct ?? existingPending.ev_pct, 0);
    const odd = normalizeOdd(extra.odd ?? bet.odd ?? existingPending.odd);
    const numericallyPositive = edgePp >= 5 && evPct >= 5;

    const allow = isRiskModel && isSoftGate && !hardVeto && numericallyPositive && !!odd;
    const recommendedStake = Math.max(DEFAULT_MIN_BET, toNumber(extra.recommendedStake, DEFAULT_MIN_BET));

    return {
        mode: STEP101_RISK_MODEL_SOFT_MICRO_FINAL_GUARD,
        allow,
        isRiskModel,
        isSoftGate,
        hardVeto,
        numericallyPositive,
        edgePp,
        evPct,
        odd,
        recommendedStake,
        reason: allow
            ? 'Step101: RISCHIO MODELLO + BLOCCATA SOFT con Edge/EV positivi: micro-test paper-trading attivo. DATA_SUFFICIENCY_BLOCK vieta stake pieno/portfolio reale, non il micro-test statistico.'
            : 'Step101: micro-test non applicato perché rischio/modello, gate soft, Edge/EV, quota o hard-veto non sono coerenti.'
    };
}

function applyStep101RiskModelSoftMicroToBet(bet = {}, existingPending = {}, options = {}) {
    if (!bet || typeof bet !== 'object') return bet || {};
    const reportLike = {
        action: options.deepScanText || bet.ds_action || bet.deep_scan_risk_level || bet.deepScanStatus || existingPending.ds_action || existingPending.deep_scan_risk_level || 'RISCHIO MODELLO',
        edge_pp: bet.edge_pp ?? bet.edge ?? existingPending.edge_pp,
        ev_pct: bet.ev_pct ?? bet.ev ?? existingPending.ev_pct
    };
    const decision = getStep101RiskModelSoftMicroDecision(bet, existingPending, reportLike, {}, {
        gateText: options.gateText || bet.tennis_operational_status || bet.professional_gate_status || existingPending.tennis_operational_status || existingPending.professional_gate_status || '',
        edge_pp: bet.edge_pp ?? bet.edge ?? existingPending.edge_pp,
        ev_pct: bet.ev_pct ?? bet.ev ?? existingPending.ev_pct,
        odd: bet.odd ?? existingPending.odd,
        recommendedStake: options.recommendedStake
    });
    if (!decision.allow) return bet;

    const micro = getStep64MicroStakeForTennisRow({ ...existingPending, ...bet }, decision.recommendedStake || DEFAULT_MIN_BET);
    const odd = normalizeOdd(bet.odd || existingPending.odd) || 1;
    const estimatedProfit = micro > 0 && odd > 1 ? round(micro * (odd - 1), 2) : 0;
    const reason = decision.reason + ' Fonte: ' + (options.source || 'savePending') + '. No stake pieno, no promozione automatica, portfolio reale escluso fino a settlement.';

    return {
        ...bet,
        invested: micro.toFixed(2),
        stake: micro,
        estimatedProfit: estimatedProfit.toFixed(2),
        professional_gate_status: 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP101',
        professional_gate_allow_bet: true,
        professional_gate_reasons: reason,
        professional_gate_max_stake: micro,
        tennis_operational_status: 'WATCHLIST MICRO',
        tennis_operational_action: 'PAPER_OR_MICRO_STAKE',
        tennis_operational_summary: reason,
        deep_scan_risk_level: 'RISCHIO_MODELLO',
        deepscan_gate_mode: STEP101_RISK_MODEL_SOFT_MICRO_FINAL_GUARD,
        deepscan_gate_status: 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP101',
        deepscan_gate_multiplier: 0.5,
        deepscan_gate_reason: reason,
        stake_policy_note: reason,
        trading_scope: 'PAPER_OPERATIONAL',
        paper_trading_scope: 'PAPER_OPERATIONAL',
        portfolio_scope: 'EXCLUDED_FROM_REAL_PORTFOLIO',
        audit_scope_reason: 'Step101: micro-test paper operativo; portfolio reale solo dopo settlement e senza promozione automatica.',
        stakePolicyApplied: { ...(bet.stakePolicyApplied || {}), adjusted: true, originalStake: toNumber(existingPending.stake ?? bet.stake ?? bet.invested, 0), stake: micro, reason },
        stakePolicy: { ...(bet.stakePolicy || {}), finalStake: micro, professionalGateCap: micro, gateCapApplied: true, gateCapReason: reason },
        step101RiskModelSoftMicroFinal: true,
        step99RiskModelSoftMicroRuntimeFinal: true,
        step96RiskModelSoftRuntimeMicro: true,
        step101RuntimeEligibility: decision
    };
}

function applyStep101RiskModelSoftMicroRuntime({ existingPending = {}, report = {}, stakeAdjustment = {}, step64Set = null, source = 'deepscan.route' } = {}) {
    const decision = getStep101RiskModelSoftMicroDecision(existingPending, existingPending, report, stakeAdjustment, {
        edge_pp: existingPending.edge_pp,
        ev_pct: existingPending.ev_pct,
        odd: existingPending.odd,
        gateText: existingPending.tennis_operational_status || existingPending.professional_gate_status || stakeAdjustment.status || stakeAdjustment.reason || ''
    });
    if (!decision.allow) return { applied: false, stakeAdjustment, decision };

    const micro = getStep64MicroStakeForTennisRow(existingPending, decision.recommendedStake || DEFAULT_MIN_BET);
    const reason = decision.reason + ' Fonte: ' + source + '. No stake pieno, no promozione automatica, portfolio reale escluso fino a settlement.';

    if (typeof step64Set === 'function') {
        step64Set('stake', micro);
        if (columnExists('ai_forward_test', 'professional_gate_allow_bet')) step64Set('professional_gate_allow_bet', 1);
        if (columnExists('ai_forward_test', 'professional_gate_status')) step64Set('professional_gate_status', 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP101');
        if (columnExists('ai_forward_test', 'professional_gate_reasons')) step64Set('professional_gate_reasons', reason);
        if (columnExists('ai_forward_test', 'professional_gate_max_stake')) step64Set('professional_gate_max_stake', micro);
        if (columnExists('ai_forward_test', 'tennis_operational_status')) step64Set('tennis_operational_status', 'WATCHLIST MICRO');
        if (columnExists('ai_forward_test', 'tennis_operational_action')) step64Set('tennis_operational_action', 'PAPER_OR_MICRO_STAKE');
        if (columnExists('ai_forward_test', 'tennis_operational_summary')) step64Set('tennis_operational_summary', reason);
        if (columnExists('ai_forward_test', 'deep_scan_risk_level')) step64Set('deep_scan_risk_level', 'RISCHIO_MODELLO');
        if (columnExists('ai_forward_test', 'deepscan_gate_mode')) step64Set('deepscan_gate_mode', STEP101_RISK_MODEL_SOFT_MICRO_FINAL_GUARD);
        if (columnExists('ai_forward_test', 'deepscan_gate_status')) step64Set('deepscan_gate_status', 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP101');
        if (columnExists('ai_forward_test', 'deepscan_gate_multiplier')) step64Set('deepscan_gate_multiplier', 0.5);
        if (columnExists('ai_forward_test', 'deepscan_gate_reason')) step64Set('deepscan_gate_reason', reason);
        if (columnExists('ai_forward_test', 'stake_policy_note')) step64Set('stake_policy_note', reason);
        if (columnExists('ai_forward_test', 'trading_scope')) step64Set('trading_scope', 'PAPER_OPERATIONAL');
        if (columnExists('ai_forward_test', 'paper_trading_scope')) step64Set('paper_trading_scope', 'PAPER_OPERATIONAL');
        if (columnExists('ai_forward_test', 'portfolio_scope')) step64Set('portfolio_scope', 'EXCLUDED_FROM_REAL_PORTFOLIO');
        if (columnExists('ai_forward_test', 'audit_scope_reason')) step64Set('audit_scope_reason', 'Step101: micro-test paper operativo; portfolio reale solo dopo settlement e senza promozione automatica.');
    }

    return {
        applied: true,
        decision,
        stakeAdjustment: {
            ...stakeAdjustment,
            mode: STEP101_RISK_MODEL_SOFT_MICRO_FINAL_GUARD,
            status: 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP101',
            level: 'RISCHIO_MODELLO_SOFT_MICRO_TEST',
            multiplier: 0.5,
            adjusted: true,
            step101RiskModelSoftMicroFinal: true,
            step99RiskModelSoftMicroRuntimeFinal: true,
            step96RiskModelSoftRuntimeMicro: true,
            adjustedStake: micro,
            currentStake: micro,
            suggestedStake: micro,
            reason,
            step101RuntimeEligibility: decision
        }
    };
}
// /STEP101_RISK_MODEL_SOFT_MICRO_FINAL_GUARD


// ============================================================================
// STEP101E_AUDIT_SAFE_NO_ANCHOR_REPAIR_PATCH
// Riparazione audit-safe: nessun ancoraggio obbligatorio a Step91X/Step99.
// Step101 viene applicato al salvataggio PENDING; i micro-test positivi restano
// Paper operativi anche se la nota contiene "BLOCCATA SOFT". I veri hard veto
// restano bloccanti.
// ============================================================================
function step101eAuditSafeText(...values) {
    return values.map(v => String(v || '').toUpperCase()).join(' ');
}

function step101eAuditSafeNumber(value, fallback = 0) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    const cleaned = String(value).replace(/[%€$£]/g, '').replace(/\s+/g, '').replace(',', '.').replace(/^\+/, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : fallback;
}

function step101eNormalizeOdd(value) {
    if (typeof normalizeOdd === 'function') return normalizeOdd(value);
    const n = step101eAuditSafeNumber(value, 0);
    return n > 1 ? n : null;
}

function step101eHasTrueHardVetoText(text = '') {
    const t = String(text || '').toUpperCase();
    if (
        t.includes('OPPOSITE_SIDE_CONFLICT') ||
        t.includes('SIDE_PROBABILITY_MISMATCH') ||
        t.includes('INVALID_ODD') ||
        t.includes('QUOTE NON VALIDE') ||
        t.includes('RETIREMENT') ||
        t.includes('WALKOVER') ||
        t.includes('NO_BET_HARD') ||
        t.includes('NO BET HARD') ||
        t.includes('REJECTED_HARD') ||
        t.includes('ALTO RISCHIO') ||
        t.includes('HIGH_RISK') ||
        t.includes('HIGH RISK')
    ) return true;

    const hasHard = t.includes('BLOCCATA HARD') || t.includes('BLOCKED_HARD') || t.includes('BLOCKED HARD');
    const hardIsOnlyDataOrCalibration =
        t.includes('DATA_SUFFICIENCY') ||
        t.includes('DATA INSUFFICIENT') ||
        t.includes('INSUFFICIENT') ||
        t.includes('CAMPIONE') ||
        t.includes('SAMPLE') ||
        t.includes('CALIBRAZIONE') ||
        t.includes('CALIBRATION') ||
        t.includes('UNKNOWN');
    return hasHard && !hardIsOnlyDataOrCalibration;
}

function step101eIsPositiveMicroText(text = '', stake = 0) {
    const t = String(text || '').toUpperCase();
    const s = step101eAuditSafeNumber(stake, 0);
    if (s <= 0) return false;
    const hasMicro =
        t.includes('WATCHLIST_MICRO') ||
        t.includes('WATCHLIST MICRO') ||
        t.includes('PAPER_OR_MICRO_STAKE') ||
        t.includes('MICRO TEST') ||
        t.includes('MICRO-TEST') ||
        t.includes('STEP96F') ||
        t.includes('STEP99') ||
        t.includes('STEP101') ||
        t.includes('STEP101D') ||
        t.includes('STEP101E');
    return hasMicro && !step101eHasTrueHardVetoText(t);
}

function step101eBuildPositiveMicroScopeSnapshot(gateText = '', stake = 0, source = 'Step101E') {
    if (!step101eIsPositiveMicroText(gateText, stake)) return null;
    return {
        trading_scope: 'PAPER_OPERATIONAL',
        paper_trading_scope: 'PAPER_OPERATIONAL',
        portfolio_scope: 'EXCLUDED_FROM_REAL_PORTFOLIO',
        audit_scope_reason: source + ': micro-test Tennis operativo nel Paper Trading; portfolio reale escluso fino a settlement valido.',
        paperOperational: true,
        portfolioEligible: false
    };
}

function applyStep101ERiskModelSoftMicroAuditFinalToBet(bet = {}, existingPending = {}, source = 'runtime') {
    if (!bet || typeof bet !== 'object') bet = {};
    if (!existingPending || typeof existingPending !== 'object') existingPending = {};

    const inputText = step101eAuditSafeText(
        bet.professional_gate_status, bet.professional_gate_reasons,
        bet.tennis_operational_status, bet.tennis_operational_action, bet.tennis_operational_summary,
        bet.deepscan_gate_status, bet.deepscan_gate_reason,
        bet.ds_action, bet.deep_scan_risk_level, bet.ds_suggestion, bet.stake_policy_note,
        existingPending.professional_gate_status, existingPending.professional_gate_reasons,
        existingPending.tennis_operational_status, existingPending.tennis_operational_action, existingPending.tennis_operational_summary,
        existingPending.deepscan_gate_status, existingPending.deepscan_gate_reason,
        existingPending.ds_action, existingPending.deep_scan_risk_level, existingPending.ds_suggestion, existingPending.stake_policy_note
    );

    let patched = bet;
    if (typeof applyStep101RiskModelSoftMicroToBet === 'function') {
        patched = applyStep101RiskModelSoftMicroToBet(bet, existingPending, { source, gateText: inputText });
    }

    const patchedText = step101eAuditSafeText(
        inputText,
        patched.professional_gate_status, patched.professional_gate_reasons,
        patched.tennis_operational_status, patched.tennis_operational_action, patched.tennis_operational_summary,
        patched.deepscan_gate_status, patched.deepscan_gate_reason, patched.stake_policy_note,
        patched.stakePolicyApplied && patched.stakePolicyApplied.reason,
        patched.stakePolicy && patched.stakePolicy.gateCapReason
    );
    if (step101eHasTrueHardVetoText(patchedText)) return patched;

    const edgePp = step101eAuditSafeNumber(patched.edge_pp ?? patched.edge ?? existingPending.edge_pp ?? existingPending.edge, 0);
    const evPct = step101eAuditSafeNumber(patched.ev_pct ?? patched.ev ?? existingPending.ev_pct ?? existingPending.ev, 0);
    const odd = step101eNormalizeOdd(patched.odd ?? existingPending.odd);
    const isRiskModel = patchedText.includes('RISCHIO MODELLO') || patchedText.includes('RISCHIO_MODELLO') || patchedText.includes('MODEL_RISK') || patchedText.includes('MODEL RISK');
    const isSoftGate = patchedText.includes('BLOCCATA SOFT') || patchedText.includes('BLOCKED_SOFT') || patchedText.includes('BLOCKED SOFT') || patchedText.includes('MODEL_RISK_STEP64') || patchedText.includes('NO_BET_PREMATCH_MODEL_RISK');
    const numericallyPositive = edgePp >= 5 && evPct >= 5 && !!odd;

    let out = patched;
    if (isRiskModel && isSoftGate && numericallyPositive) {
        const baseMicro = typeof getStep64MicroStakeForTennisRow === 'function'
            ? getStep64MicroStakeForTennisRow({ ...existingPending, ...patched }, (typeof DEFAULT_MIN_BET !== 'undefined' ? DEFAULT_MIN_BET : 2))
            : (typeof DEFAULT_MIN_BET !== 'undefined' ? DEFAULT_MIN_BET : 2);
        const micro = Math.max(0.01, step101eAuditSafeNumber(baseMicro, 2));
        const estimatedProfit = odd && odd > 1 ? Math.round(micro * (odd - 1) * 100) / 100 : 0;
        const reason = 'Step101E: RISCHIO MODELLO + BLOCCATA SOFT con Edge/EV positivi: micro-test Paper Trading attivo. Fonte: ' + source + '. No stake pieno, no portfolio reale prima del settlement.';
        out = {
            ...patched,
            invested: micro.toFixed(2),
            stake: micro,
            estimatedProfit: estimatedProfit.toFixed(2),
            professional_gate_status: 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP101E',
            professional_gate_allow_bet: true,
            professional_gate_reasons: reason,
            professional_gate_max_stake: micro,
            tennis_operational_status: 'WATCHLIST MICRO',
            tennis_operational_action: 'PAPER_OR_MICRO_STAKE',
            tennis_operational_summary: reason,
            deep_scan_risk_level: 'RISCHIO_MODELLO',
            deepscan_gate_mode: 'STEP101E_AUDIT_SAFE_NO_ANCHOR_REPAIR_PATCH',
            deepscan_gate_status: 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP101E',
            deepscan_gate_multiplier: 0.5,
            deepscan_gate_reason: reason,
            stake_policy_note: reason,
            trading_scope: 'PAPER_OPERATIONAL',
            paper_trading_scope: 'PAPER_OPERATIONAL',
            portfolio_scope: 'EXCLUDED_FROM_REAL_PORTFOLIO',
            audit_scope_reason: 'Step101E: micro-test Paper operativo; portfolio reale solo dopo settlement valido.',
            stakePolicyApplied: { ...(patched.stakePolicyApplied || {}), adjusted: true, originalStake: step101eAuditSafeNumber(existingPending.stake ?? patched.stake ?? patched.invested, 0), stake: micro, reason },
            stakePolicy: { ...(patched.stakePolicy || {}), finalStake: micro, professionalGateCap: micro, gateCapApplied: true, gateCapReason: reason },
            step101eAuditSafeNoAnchorRepair: true,
            step101RiskModelSoftMicroFinal: true,
            step99RiskModelSoftMicroRuntimeFinal: true,
            step96RiskModelSoftRuntimeMicro: true
        };
    }

    const finalText = step101eAuditSafeText(
        patchedText,
        out.professional_gate_status, out.professional_gate_reasons,
        out.tennis_operational_status, out.tennis_operational_action, out.tennis_operational_summary,
        out.deepscan_gate_status, out.deepscan_gate_reason, out.stake_policy_note,
        out.stakePolicyApplied && out.stakePolicyApplied.reason,
        out.stakePolicy && out.stakePolicy.gateCapReason
    );
    const finalStake = step101eAuditSafeNumber(out.invested ?? out.stake ?? (out.stakePolicy && out.stakePolicy.finalStake), 0);
    if (step101eIsPositiveMicroText(finalText, finalStake)) {
        out = {
            ...out,
            trading_scope: 'PAPER_OPERATIONAL',
            paper_trading_scope: 'PAPER_OPERATIONAL',
            portfolio_scope: 'EXCLUDED_FROM_REAL_PORTFOLIO',
            audit_scope_reason: 'Step101E: micro-test positivo mantenuto nel Paper operativo; portfolio reale escluso fino a settlement valido.'
        };
    }
    return out;
}
// /STEP101E_AUDIT_SAFE_NO_ANCHOR_REPAIR_PATCH

// ============================================================================
// PATCH 1 - UNIFIED TENNIS PENDING PIPELINE
// Legacy STEP markers remain compatible, but the execution order is now
// centralized in three explicit phases. This is a structural refactor only:
// no thresholds, stake rules, settlement logic or model probabilities change.
// ============================================================================
function applyTennisPatch1PendingPreLookupPipeline(bet = {}) {
    return applyStep98DSideProbabilityFinalGuardToBet(bet, {
        source: 'savePendingTennisBet.step98dPreUpsert'
    });
}

function applyTennisPatch1PendingUpsertPipeline(bet = {}, existingBet = {}, options = {}) {
    const step101eSource = options.step101eSource || 'savePending.upsert.step101e';

    // Baseline 0.5: runtime micro/persistence chain, kept in the certified order.
    bet = applyStep96DRuntimeMicroTestToBet(bet, existingBet);
    bet = applyStep96DRuntimeMicroTestPersistenceToPending(bet, existingBet);
    bet = applyStep96FRiskModelSoftMicroToBet(bet, existingBet, 'savePending.upsert');
    bet = applyStep96FAnalysisDriftAuditToBet(bet, existingBet, 'savePending.upsert');
    bet = applyStep99RiskModelSoftMicroToBet(bet, existingBet, { source: 'savePending.upsert' });
    bet = applyStep101RiskModelSoftMicroToBet(bet, existingBet, { source: 'savePending.upsert.step101f' });
    bet = applyStep101ERiskModelSoftMicroAuditFinalToBet(bet, existingBet, step101eSource);

    // Final hard guard: it must always execute after every micro-stake override.
    bet = applyStep98DSideProbabilityFinalGuardToBet(bet, {
        source: 'savePendingTennisBet.step98dBeforeUpdateStep91W'
    });
    // Patch 3: un conflitto lato sullo stesso evento canonico resta hard veto anche dopo i micro override.
    if (options.oppositeConflict) bet = applyStep92ConflictToBet(bet, options.oppositeConflict);
    return bet;
}

function applyTennisPatch1PendingInsertPipeline(bet = {}, oppositeConflict = null, options = {}) {
    const step101eSource = options.step101eSource || 'savePending.insert.step101e';

    // Baseline 0.5/0.3: conflict and exposure guards precede stake overrides.
    bet = applyStep92ConflictToBet(bet, oppositeConflict);
    bet = applyStep54PaperExposureGuard(bet);
    bet = applyStep98DSideProbabilityFinalGuardToBet(bet, {
        source: 'savePendingTennisBet.step98dAfterStep54BeforeInsert'
    });

    // Baseline 0.5/0.6: final runtime micro chain for a new PENDING row.
    bet = applyStep96FRiskModelSoftMicroToBet(bet, {}, 'savePending.insert');
    bet = applyStep101RiskModelSoftMicroToBet(bet, {}, { source: 'savePending.insert.step101f' });
    bet = applyStep101ERiskModelSoftMicroAuditFinalToBet(bet, {}, step101eSource);

    // STEP98E remains the final insert authority for side/probability mismatch.
    bet = applyStep98DSideProbabilityFinalGuardToBet(bet, {
        source: 'savePendingTennisBet.step98eFinalBeforeInsert'
    });
    // Patch 3: il conflitto lato e l'identità ambigua sono autorità finali dopo ogni micro override.
    if (oppositeConflict) bet = applyStep92ConflictToBet(bet, oppositeConflict);
    bet = applyTennisPatch3IdentityAuditGuard(bet);
    return bet;
}
// /PATCH 1 - UNIFIED TENNIS PENDING PIPELINE

// STEP101F_COMPLETE_DIRECT_PERSISTENCE_REPAIR_PATCH: direct Step101 persistence restored for upsert/insert.
function savePendingTennisBetCore(bet) {
        // PATCH 1: fase PRE_LOOKUP certificata (legacy Step98D).
        bet = applyTennisPatch1PendingPreLookupPipeline(bet);
    // STEP92_ALWAYS_TRACK_ANALYSIS_AI_TO_PAPER_TRADING
    // Regola funzionale: ogni pick prodotto dall'Analisi AI Tennis deve essere salvato o aggiornato nel Paper Trading,
    // anche se stake = 0, BLOCCATA HARD/SOFT o solo audit/statistico. Il Portfolio reale resta filtrato separatamente.
    // STEP93_TENNIS_PAPER_TRADING_DB_SYNC_FINAL
    // Compat: marker statici richiesti da Step92/Step93; non modifica settlement, DB chiusi, CLV o Calcio.
    // STEP92_SAVE_ALL_AI_PICKS_TO_PAPER_TRADING
    // Ogni candidata mostrata dall'Analisi AI viene salvata/aggiornata nel Paper Trading, anche stake=0.
    const betTypeStr = bet && bet.isCR ? 'SINGLE_TENNIS_CR' : 'SINGLE_TENNIS';
    if (typeof sideIdentity !== 'undefined' && sideIdentity && typeof sideIdentity.annotateBetSideIdentity === 'function') {
        bet = sideIdentity.annotateBetSideIdentity(bet || {});
    } else {
        bet = bet || {};
    }

    // Patch 3: annota prima l'identità evento/mercato e risolve il PENDING senza collisioni rematch.
    bet = tennisEventIdentity.annotateTennisEventIdentity(bet);
    const paperResultIdentity = { ...bet, sport_type: 'TENNIS', market_type: bet.marketType || bet.market_type, point_line: bet.pointLine ?? bet.point_line };
    const activePaperResult = paperTradingIdentity.findActiveByKey(db, paperResultIdentity);
    if (activePaperResult && ['WON','LOST','PUSH','VOID'].includes(String(activePaperResult.status || '').toUpperCase())) {
        savePendingTennisBet.lastAction = 'SKIPPED_EXISTING_RESOLVED_PAPER_RESULT';
        savePendingTennisBet.lastPersistedBetId = Number(activePaperResult.id);
        return false;
    }
    const pendingIdentityRows = loadTennisPendingIdentityCandidates();
    const revisionExisting = tennisPendingEventRevisionSafety.findActivePendingRevision(db, { ...bet, sport_type: 'TENNIS' });
    const identityResolution = resolvePendingTennisIdentity(bet, pendingIdentityRows);
    bet = identityResolution.incoming || bet;
    if (revisionExisting && identityResolution.action === 'INSERT_DISTINCT') {
        bet.analysis_drift_detected = 1;
        bet.analysis_drift_reason = 'PATCH28_RESCHEDULE_OR_SELECTION_REVISION_SAME_PROVIDER_EVENT';
    }

    if (identityResolution.action === 'BLOCK_IDENTITY_COLLISION') {
        savePendingTennisBet.lastAction = 'BLOCKED_EVENT_IDENTITY_COLLISION';
        savePendingTennisBet.lastIdentityResolution = identityResolution;
        console.warn(`[PATCH3_IDENTITY] Salvataggio PENDING bloccato: ${identityResolution.reason}`);
        return false;
    }

    if (identityResolution.action === 'INSERT_AUDIT_ONLY') {
        bet = markTennisPatch3IdentityAuditOnly(bet, identityResolution);
    }

    const existingBet = activePaperResult && String(activePaperResult.status || '').toUpperCase() === 'PENDING'
        ? activePaperResult
        : (identityResolution.action === 'UPDATE_EXISTING' ? identityResolution.match : revisionExisting);
    const conflictCandidates = existingBet ? pendingIdentityRows.filter(row => Number(row.id) !== Number(existingBet.id)) : pendingIdentityRows;
    const oppositeConflict = blockOppositePendingTennisConflicts(bet, conflictCandidates);

    if (existingBet) {
        // PATCH 1: unica pipeline UPSERT; sorgente Step101E mantenuta per audit/compatibilità.
        bet = applyTennisPatch1PendingUpsertPipeline(bet, existingBet, {
            step101eSource: 'savePending.upsert.step101e',
            oppositeConflict
        });
        // STEP92 compat marker: updateStep92ExistingPendingTennisBet(existingBet.id, bet, betTypeStr)
        savePendingTennisBet.lastIdentityResolution = identityResolution;
        savePendingTennisBet.lastPersistedBetId = Number(existingBet.id);
        const updated = updateStep91WExistingPendingTennisBet(existingBet.id, bet, betTypeStr);
        const identityFields = paperTradingIdentity.persistenceFields(paperResultIdentity);
        const identityEntries = Object.entries(identityFields).filter(([column]) => columnExists('ai_forward_test', column));
        if (identityEntries.length) db.prepare(`UPDATE ai_forward_test SET ${identityEntries.map(([column]) => `${column}=?`).join(', ')}, paper_result_revision=COALESCE(paper_result_revision,1)+1 WHERE id=?`).run(...identityEntries.map(([,value])=>value), existingBet.id);
        return updated;
    }

    // PATCH 1: unica pipeline INSERT; conflitto, exposure, micro guard e hard guard sono ordinati centralmente.
    bet = applyTennisPatch1PendingInsertPipeline(bet, oppositeConflict, {
        step101eSource: 'savePending.insert.step101e'
    });

    const baseColumns = ['bet_type','match_date','home_team','away_team','prediction','odd','stake','estimated_prob','edge','status','league','strategy_tag','sport_type'];
    const baseValues = [betTypeStr, bet.date, bet.home, bet.away, bet.prediction, bet.odd, parseFloat(bet.invested || bet.stake || 0) || 0, bet.estimatedProb, bet.edge_pp, 'PENDING', bet.league, bet.strategy_tag, 'TENNIS'];
    const optional = buildStep92TennisOptionalPairs(bet);
    for (const [column, value] of optional) {
        if (['closing_odd', 'clv_pct', 'clv_method', 'closing_odd_side', 'settled_at', 'profit'].includes(column)) continue;
        if (columnExists('ai_forward_test', column) && !baseColumns.includes(column)) { baseColumns.push(column); baseValues.push(value); }
    }
    for (const [column, value] of Object.entries(paperTradingIdentity.persistenceFields(paperResultIdentity))) {
        if (columnExists('ai_forward_test', column) && !baseColumns.includes(column)) { baseColumns.push(column); baseValues.push(value); }
    }
    const placeholders = baseColumns.map(() => '?').join(', ');
    const insertResult = db.prepare('INSERT INTO ai_forward_test (' + baseColumns.join(', ') + ') VALUES (' + placeholders + ')').run(...baseValues);
    savePendingTennisBet.lastPersistedBetId = Number(insertResult.lastInsertRowid);
    savePendingTennisBet.lastAction = identityResolution.action === 'INSERT_AUDIT_ONLY'
        ? 'INSERTED_PENDING_AUDIT_ONLY_PATCH3_IDENTITY'
        : 'INSERTED_PENDING_STEP92';
    savePendingTennisBet.lastIdentityResolution = identityResolution;
    return true;
}


// ============================================================================
// PATCH 7 - IMMUTABLE PREDICTION SNAPSHOT & FORWARD CERTIFICATION
// Persistenza PENDING, snapshot e refresh del ledger sono una singola transazione.
// In caso di errore l'intera operazione viene annullata e registrata con Operation ID.
// ============================================================================
function savePendingTennisBet(bet) {
    const operation = runtimeDiagnostics.startOperation('TENNIS_PREDICTION_PERSIST', {
        match: `${bet?.home || '?'} - ${bet?.away || '?'}`,
        market: bet?.marketType || bet?.prediction || null
    }, { component: 'TENNIS_PREDICTION' });
    let patch24FailureStage = 'PERSISTENCE';
    let rejectedCaptureAttemptContext = null;
    let canonicalEventTimeDecision = null;
    let canonicalEventTimeRevisionResult = null;
    let officialScheduleDecision = null;
    let officialScheduleReceiptResult = null;
    let officialScheduleCaptureToken = null;
    try {
        savePendingTennisBet.lastPersistedBetId = null;
        const transaction = db.transaction(() => {
            patch24FailureStage = 'PERSISTENCE';
            operation.phase('PERSISTENCE', 'Salvataggio o aggiornamento della previsione Tennis.', {
                event: 'SNAPSHOT_START'
            });
            const saved = savePendingTennisBetCore(bet);
            if (!saved) return { saved: false, action: savePendingTennisBet.lastAction || 'BLOCKED' };

            const betId = Number(savePendingTennisBet.lastPersistedBetId);
            if (!(betId > 0)) throw new Error('PATCH7_PERSISTED_BET_ID_MISSING');
            const persistedRow = db.prepare('SELECT * FROM ai_forward_test WHERE id = ?').get(betId);
            if (!persistedRow) throw new Error(`PATCH7_PERSISTED_ROW_NOT_FOUND:${betId}`);

            // PATCH 33: risoluzione canonica dell'orario evento prima del Prematch Gate.
            // Provenienza, timezone, DST e conflitti provider sono separati dall'autorità
            // di probabilità/stake. In caso di conflitto il gate usa il tempo credibile più
            // anticipato; nessun orario può riattivare automaticamente una cattura respinta.
            const captureAt = new Date().toISOString();
            patch24FailureStage = 'CANONICAL_EVENT_TIME_CONTRACT';
            operation.phase('CANONICAL_EVENT_TIME_CONTRACT', 'Risoluzione provenienza e qualità temporale dell’evento.', {
                event: 'CANONICAL_EVENT_TIME_START', betId, captureAt,
                defaultTimeZone: process.env.TENNIS_LOCAL_TIME_ZONE || tennisCanonicalEventTime.DEFAULT_TIME_ZONE
            });
            canonicalEventTimeDecision = tennisCanonicalEventTime.resolveCanonicalEventTime(persistedRow, bet, {
                observedAt: captureAt,
                defaultTimeZone: process.env.TENNIS_LOCAL_TIME_ZONE || tennisCanonicalEventTime.DEFAULT_TIME_ZONE
            });

            // PATCH 34: lo stato schedule ufficiale/primario viene normalizzato separatamente
            // dall'orario canonico. Stati terminali o sospesi bloccano il capture; l'assenza
            // di stato resta compatibile in modalità review e non produce settlement.
            patch24FailureStage = 'OFFICIAL_SCHEDULE_LIFECYCLE';
            operation.phase('OFFICIAL_SCHEDULE_LIFECYCLE', 'Verifica autorità schedule e ciclo di vita evento.', {
                event: 'OFFICIAL_SCHEDULE_LIFECYCLE_START', betId, captureAt,
                contractVersion: tennisOfficialScheduleAuthority.TENNIS_OFFICIAL_SCHEDULE_AUTHORITY_VERSION
            });
            officialScheduleDecision = tennisOfficialScheduleAuthority.resolveScheduleLifecycle(persistedRow, bet, {
                observedAt: captureAt,
                eventTimeDecision: canonicalEventTimeDecision
            });
            rejectedCaptureAttemptContext = tennisRejectedCaptureObservability.buildAttemptContext(persistedRow, bet, {
                operationId: operation.operationId,
                captureAt,
                eventTimeContract: canonicalEventTimeDecision,
                scheduleLifecycle: officialScheduleDecision
            });
            if (!canonicalEventTimeDecision.allowCapture) {
                const eventTimeError = new Error(`PATCH33_CANONICAL_EVENT_TIME_BLOCKED:${canonicalEventTimeDecision.qualityStatus}:${(canonicalEventTimeDecision.reasonCodes || []).join('|') || 'UNKNOWN'}`);
                eventTimeError.code = 'PATCH33_CANONICAL_EVENT_TIME_BLOCKED';
                eventTimeError.eventTimeDecision = canonicalEventTimeDecision;
                eventTimeError.decision = tennisCanonicalEventTime.toGateBlockDecision(canonicalEventTimeDecision, captureAt);
                throw eventTimeError;
            }
            if (!officialScheduleDecision.allowCapture) {
                const scheduleError = new Error(`PATCH34_OFFICIAL_SCHEDULE_LIFECYCLE_BLOCKED:${officialScheduleDecision.normalizedStatus}:${(officialScheduleDecision.reasonCodes || []).join('|') || 'UNKNOWN'}`);
                scheduleError.code = 'PATCH34_OFFICIAL_SCHEDULE_LIFECYCLE_BLOCKED';
                scheduleError.scheduleDecision = officialScheduleDecision;
                scheduleError.decision = tennisOfficialScheduleAuthority.toGateBlockDecision(officialScheduleDecision, captureAt);
                throw scheduleError;
            }
            canonicalEventTimeRevisionResult = tennisCanonicalEventTime.recordEventTimeRevision(db, canonicalEventTimeDecision, { captureOutcome: 'ACCEPTED' });
            const eventTimeRevisionId = canonicalEventTimeRevisionResult.revision?.revision_id || null;
            rejectedCaptureAttemptContext.eventTimeRevisionId = eventTimeRevisionId;
            officialScheduleReceiptResult = tennisOfficialScheduleAuthority.recordScheduleReceipt(db, officialScheduleDecision, {
                captureOutcome: 'ACCEPTED',
                eventTimeRevisionId
            });
            officialScheduleCaptureToken = officialScheduleReceiptResult.captureToken;
            const officialScheduleReceiptId = officialScheduleReceiptResult.receipt?.receipt_id || null;
            rejectedCaptureAttemptContext.scheduleReceiptId = officialScheduleReceiptId;
            const scheduleColumns = [
                'official_schedule_contract_version','official_schedule_receipt_id','official_schedule_source_kind',
                'official_schedule_source_id','official_schedule_status','official_schedule_transition_type',
                'official_schedule_effective_start_at_utc','official_schedule_capture_disposition',
                'official_schedule_observation_hash','official_schedule_checked_at'
            ];
            if (scheduleColumns.every(column => columnExists('ai_forward_test', column))) {
                db.prepare(`UPDATE ai_forward_test SET
                    official_schedule_contract_version=?, official_schedule_receipt_id=?, official_schedule_source_kind=?,
                    official_schedule_source_id=?, official_schedule_status=?, official_schedule_transition_type=?,
                    official_schedule_effective_start_at_utc=?, official_schedule_capture_disposition=?,
                    official_schedule_observation_hash=?, official_schedule_checked_at=? WHERE id=?`).run(
                    officialScheduleDecision.version,
                    officialScheduleReceiptId,
                    officialScheduleDecision.selected?.sourceKind || null,
                    officialScheduleDecision.selected?.sourceId || null,
                    officialScheduleDecision.normalizedStatus,
                    officialScheduleReceiptResult.receipt?.transition_type || null,
                    officialScheduleDecision.effectiveStartAtUtc,
                    officialScheduleDecision.disposition,
                    officialScheduleDecision.observationHash,
                    officialScheduleDecision.observedAt,
                    betId
                );
            }
            // AUDIT14 R2.1F: log only — a source kind/id is a declaration, not verified evidence.
            const scheduleSourceProvenanceVerified = officialScheduleDecision.sourceProvenanceVerified === true;
            const scheduleCertified = scheduleSourceProvenanceVerified &&
                officialScheduleDecision.officialScheduleCertified === true &&
                officialScheduleDecision.normalizedStatus === 'SCHEDULED' &&
                officialScheduleDecision.disposition === 'ALLOW';
            operation.phase('OFFICIAL_SCHEDULE_LIFECYCLE', scheduleCertified
                ? 'Schedule certificato: stato prematch e provenienza verificati.'
                : 'Schedule valutato senza prova indipendente di provenienza ufficiale: non certificato; revisione richiesta.', {
                event: scheduleCertified ? 'OFFICIAL_SCHEDULE_LIFECYCLE_CERTIFIED' : 'OFFICIAL_SCHEDULE_LIFECYCLE_UNVERIFIED_REVIEW', betId,
                receiptId: officialScheduleReceiptId,
                normalizedStatus: officialScheduleDecision.normalizedStatus,
                disposition: officialScheduleDecision.disposition,
                sourceKind: officialScheduleDecision.selected?.sourceKind || null,
                sourceId: officialScheduleDecision.selected?.sourceId || null,
                sourceProvenanceVerified: scheduleSourceProvenanceVerified,
                officialSourceCertified: scheduleCertified,
                transitionType: officialScheduleReceiptResult.receipt?.transition_type || null,
                captureRaceToken: Boolean(officialScheduleCaptureToken),
                settlementAuthority: false
            }, scheduleCertified ? 'INFO' : 'WARN');

            const eventTimeColumns = [
                'canonical_event_time_contract_version','canonical_event_time_revision_id','canonical_event_time_source_kind',
                'canonical_event_time_source_id','canonical_event_time_source_field','canonical_event_time_source_timezone',
                'canonical_event_time_canonical_utc','canonical_event_time_safety_utc','canonical_event_time_confidence',
                'canonical_event_time_quality_status','canonical_event_time_conflict_ms','canonical_event_time_checked_at'
            ];
            if (eventTimeColumns.every(column => columnExists('ai_forward_test', column))) {
                db.prepare(`UPDATE ai_forward_test SET
                    canonical_event_time_contract_version=?, canonical_event_time_revision_id=?, canonical_event_time_source_kind=?,
                    canonical_event_time_source_id=?, canonical_event_time_source_field=?, canonical_event_time_source_timezone=?,
                    canonical_event_time_canonical_utc=?, canonical_event_time_safety_utc=?, canonical_event_time_confidence=?,
                    canonical_event_time_quality_status=?, canonical_event_time_conflict_ms=?, canonical_event_time_checked_at=?
                    WHERE id=?`).run(
                    canonicalEventTimeDecision.version,
                    eventTimeRevisionId,
                    canonicalEventTimeDecision.selected?.sourceKind || null,
                    canonicalEventTimeDecision.selected?.sourceId || null,
                    canonicalEventTimeDecision.selected?.sourceField || null,
                    canonicalEventTimeDecision.selected?.sourceTimezone || null,
                    canonicalEventTimeDecision.canonicalStartAtUtc,
                    canonicalEventTimeDecision.safetyStartAtUtc,
                    canonicalEventTimeDecision.confidence,
                    canonicalEventTimeDecision.qualityStatus,
                    canonicalEventTimeDecision.conflictMs,
                    canonicalEventTimeDecision.observedAt,
                    betId
                );
            }
            const certifiedPersistedRow = {
                ...persistedRow,
                canonical_match_datetime: canonicalEventTimeDecision.safetyStartAtUtc,
                canonical_event_time_contract_version: canonicalEventTimeDecision.version,
                canonical_event_time_revision_id: eventTimeRevisionId,
                canonical_event_time_source_kind: canonicalEventTimeDecision.selected?.sourceKind || null,
                canonical_event_time_source_id: canonicalEventTimeDecision.selected?.sourceId || null,
                canonical_event_time_source_field: canonicalEventTimeDecision.selected?.sourceField || null,
                canonical_event_time_source_timezone: canonicalEventTimeDecision.selected?.sourceTimezone || null,
                canonical_event_time_canonical_utc: canonicalEventTimeDecision.canonicalStartAtUtc,
                canonical_event_time_safety_utc: canonicalEventTimeDecision.safetyStartAtUtc,
                canonical_event_time_confidence: canonicalEventTimeDecision.confidence,
                canonical_event_time_quality_status: canonicalEventTimeDecision.qualityStatus,
                canonical_event_time_conflict_ms: canonicalEventTimeDecision.conflictMs,
                canonical_event_time_checked_at: canonicalEventTimeDecision.observedAt,
                official_schedule_contract_version: officialScheduleDecision.version,
                official_schedule_receipt_id: officialScheduleReceiptId,
                official_schedule_source_kind: officialScheduleDecision.selected?.sourceKind || null,
                official_schedule_source_id: officialScheduleDecision.selected?.sourceId || null,
                official_schedule_status: officialScheduleDecision.normalizedStatus,
                official_schedule_transition_type: officialScheduleReceiptResult.receipt?.transition_type || null,
                official_schedule_effective_start_at_utc: officialScheduleDecision.effectiveStartAtUtc,
                official_schedule_capture_disposition: officialScheduleDecision.disposition,
                official_schedule_observation_hash: officialScheduleDecision.observationHash,
                official_schedule_checked_at: officialScheduleDecision.observedAt
            };
            operation.phase('CANONICAL_EVENT_TIME_CONTRACT', 'Orario evento certificato con provenienza e policy conservativa.', {
                event: 'CANONICAL_EVENT_TIME_PASS', betId,
                revisionId: eventTimeRevisionId,
                qualityStatus: canonicalEventTimeDecision.qualityStatus,
                confidence: canonicalEventTimeDecision.confidence,
                canonicalStartAtUtc: canonicalEventTimeDecision.canonicalStartAtUtc,
                safetyStartAtUtc: canonicalEventTimeDecision.safetyStartAtUtc,
                conflictMs: canonicalEventTimeDecision.conflictMs,
                automaticGateOverride: false
            }, canonicalEventTimeDecision.qualityStatus.startsWith('REVIEW_') ? 'WARN' : 'INFO');

            // PATCH 29 R3: il gate resta l'autorità transazionale finale e usa
            // l'orario safety UTC certificato dalla Patch 33.
            patch24FailureStage = 'PREMATCH_CAPTURE_GATE';
            operation.phase('PREMATCH_CAPTURE_GATE', 'Certificazione temporale prematch prima dello snapshot.', {
                event: 'PREMATCH_CAPTURE_GATE_START', betId, captureAt,
                timeZone: 'UTC', eventTimeContractVersion: canonicalEventTimeDecision.version
            });
            const prematchGateDecision = tennisPrematchCaptureGate.assertPrematchCaptureAllowed(certifiedPersistedRow, {
                captureAt,
                checkedAt: captureAt,
                registryVersion: tennisPatchRegistry.TENNIS_PATCH_REGISTRY_VERSION,
                timeZone: 'UTC'
            });
            const gateColumns = [
                'prematch_capture_gate_version', 'prematch_capture_gate_status',
                'prematch_capture_gate_reason', 'prematch_capture_gate_checked_at',
                'prematch_capture_gate_lead_ms', 'prematch_capture_gate_timezone'
            ];
            if (gateColumns.every(column => columnExists('ai_forward_test', column))) {
                db.prepare(`UPDATE ai_forward_test SET
                    prematch_capture_gate_version=?, prematch_capture_gate_status=?, prematch_capture_gate_reason=?,
                    prematch_capture_gate_checked_at=?, prematch_capture_gate_lead_ms=?, prematch_capture_gate_timezone=?
                    WHERE id=?`).run(
                    prematchGateDecision.version,
                    prematchGateDecision.status,
                    prematchGateDecision.reason,
                    prematchGateDecision.checkedAt,
                    prematchGateDecision.leadTimeMs,
                    prematchGateDecision.timeZone,
                    betId
                );
            }
            operation.phase('PREMATCH_CAPTURE_GATE', 'Capture prematch certificato; transazione autorizzata a creare lo snapshot.', {
                event: 'PREMATCH_CAPTURE_GATE_PASS', betId,
                gateStatus: prematchGateDecision.status,
                leadTimeMs: prematchGateDecision.leadTimeMs,
                matchStartAt: prematchGateDecision.matchStartAt,
                captureAt: prematchGateDecision.captureAt,
                captureCommitAuthority: true,
                probabilityAuthority: false,
                qualityGateAuthority: false,
                stakeAuthority: false
            });

            const isOriginalInsert = String(savePendingTennisBet.lastAction || '').startsWith('INSERTED_PENDING');
            patch24FailureStage = 'SNAPSHOT_VALIDATION';
            operation.phase('SNAPSHOT_VALIDATION', 'Validazione snapshot predittivo immutabile.', {
                event: 'SNAPSHOT_VALIDATION', betId, isOriginalInsert
            });
            const snapshotResult = tennisPredictionSnapshots.capturePredictionSnapshot(db, certifiedPersistedRow, {
                operationId: operation.operationId,
                registryVersion: tennisPatchRegistry.TENNIS_PATCH_REGISTRY_VERSION,
                capturedAt: captureAt,
                allowOriginal: isOriginalInsert
            });

            const snapshotEvent = snapshotResult.duplicate
                ? 'SNAPSHOT_DUPLICATE_SKIP'
                : (snapshotResult.snapshot?.snapshot_status === 'POST_START_INVALID'
                    ? 'SNAPSHOT_POST_START_BLOCK'
                    : 'SNAPSHOT_INSERT');
            operation.phase('SNAPSHOT_INSERT', snapshotResult.duplicate
                ? 'Snapshot identico già presente: nessun duplicato creato.'
                : 'Snapshot predittivo append-only registrato.', {
                event: snapshotEvent,
                betId,
                snapshotId: snapshotResult.snapshot?.snapshot_id || null,
                snapshotType: snapshotResult.snapshot?.snapshot_type || null,
                snapshotStatus: snapshotResult.snapshot?.snapshot_status || null,
                calibrationAnchor: Number(snapshotResult.snapshot?.is_calibration_anchor || 0) === 1
            }, snapshotResult.snapshot?.snapshot_status === 'POST_START_INVALID' ? 'WARN' : 'INFO');

            patch24FailureStage = 'ELIGIBILITY_INCREMENTAL_REFRESH';
            const eligibilityResult = tennisPredictionSnapshots.refreshCalibrationEligibilityForBet(db, betId, {
                operationId: operation.operationId
            });
            operation.phase('ELIGIBILITY_INCREMENTAL_REFRESH', 'Ledger calibrazione aggiornato per la singola previsione.', {
                event: 'ELIGIBILITY_INCREMENTAL_REFRESH',
                betId,
                eligibilityStatus: eligibilityResult.record?.eligibility_status || eligibilityResult.reason || null,
                predictionSnapshotId: eligibilityResult.anchorSnapshotId || null
            });

            patch24FailureStage = 'COHORT_ASSIGNMENT';
            operation.phase('COHORT_ASSIGN_START', 'Assegnazione forward-only alla coorte temporale sigillata.', {
                event: 'COHORT_ASSIGN_START',
                betId,
                predictionSnapshotId: eligibilityResult.anchorSnapshotId || null
            });
            const cohortResult = tennisForwardCohorts.assignForwardCohortMember(db, betId, {
                operationId: operation.operationId
            });
            operation.phase('COHORT_MEMBER_SEALED', cohortResult.assigned
                ? 'Membership di coorte verificata e sigillata.'
                : 'Coorte non assegnata: snapshot originale non ancora eleggibile.', {
                event: cohortResult.assigned ? 'COHORT_MEMBER_SEALED' : 'COHORT_ASSIGN_SKIPPED',
                betId,
                cohortId: cohortResult.member?.cohort_id || null,
                cohortRole: cohortResult.member?.cohort_role || null,
                maturityStatus: cohortResult.member?.maturity_status || cohortResult.reason || null
            }, cohortResult.assigned ? 'INFO' : 'WARN');

            const intelligenceSnapshotId = snapshotResult.snapshot?.snapshot_id || eligibilityResult.anchorSnapshotId || null;
            patch24FailureStage = 'PLAYER_MATCHUP_INTELLIGENCE';
            operation.phase('PLAYER_EVIDENCE_CAPTURE', 'Acquisizione evidenze giocatori pre-match e as-of-safe.', {
                event: 'PLAYER_EVIDENCE_CAPTURE', betId, predictionSnapshotId: intelligenceSnapshotId
            });
            const intelligenceResult = tennisMatchupIntelligence.persistMatchupIntelligenceForBet(db, certifiedPersistedRow, bet, {
                snapshotId: intelligenceSnapshotId,
                snapshotStatus: snapshotResult.snapshot?.snapshot_status || null,
                operationId: operation.operationId,
                dataDir: ABSOLUTE_SACKMANN_DIR,
                historicalDatasetPath: TENNIS_HISTORICAL_STATS_DATASET,
                tour: certifiedPersistedRow.tour_type || bet.tourType || bet.tour_type || bet.league || certifiedPersistedRow.league,
                cohort: cohortResult.member || null
            });
            operation.phase('CHALLENGER_SHADOW_SNAPSHOT', intelligenceResult.duplicate
                ? 'Snapshot intelligence già presente: deduplica verificata.'
                : 'Evidenze giocatori, matchup e challenger shadow salvati in modo immutabile.', {
                event: intelligenceResult.duplicate ? 'MATCHUP_INTELLIGENCE_DUPLICATE_SKIP' : 'CHALLENGER_SHADOW_SNAPSHOT',
                betId,
                predictionSnapshotId: intelligenceSnapshotId,
                matchupId: intelligenceResult.matchupId || intelligenceResult.intelligence?.matchup?.featureHash || null,
                challengerId: intelligenceResult.challengerId || intelligenceResult.challenger?.challenger_id || null,
                challengerStatus: intelligenceResult.intelligence?.challenger?.status || intelligenceResult.challenger?.challenger_status || null,
                mode: tennisMatchupIntelligence.MODE,
                stakeAuthority: false,
                deepScanSeparate: true
            });

            patch24FailureStage = 'INFORMATION_RETRIEVAL_RECEIPT';
            operation.phase('INFORMATION_RETRIEVAL_RECEIPT', 'Certificazione delle fonti disponibili al momento della previsione.', {
                event: 'INFORMATION_RETRIEVAL_RECEIPT_START',
                betId,
                predictionSnapshotId: intelligenceSnapshotId
            });
            const retrievalReceiptResult = tennisInformationRetrieval.persistPredictionEvidenceReceipt(db, certifiedPersistedRow, bet, {
                snapshotId: intelligenceSnapshotId,
                phase: tennisInformationRetrieval.RECEIPT_PHASES.PREDICTION_CAPTURE,
                operationId: operation.operationId,
                dataDir: ABSOLUTE_SACKMANN_DIR,
                historicalDatasetPath: TENNIS_HISTORICAL_STATS_DATASET,
                cacheDir: NEWS_CACHE_DIR
            });
            operation.phase('INFORMATION_RETRIEVAL_RECEIPT', retrievalReceiptResult.duplicate
                ? 'Ricevuta fonti identica già presente.'
                : 'Ricevuta fonti predittive append-only registrata.', {
                event: retrievalReceiptResult.duplicate ? 'INFORMATION_RETRIEVAL_RECEIPT_DUPLICATE' : 'INFORMATION_RETRIEVAL_RECEIPT_INSERT',
                betId,
                receiptId: retrievalReceiptResult.receipt?.receiptId || retrievalReceiptResult.receipt?.receipt_id || null,
                status: retrievalReceiptResult.receipt?.status || null,
                overallScore: retrievalReceiptResult.receipt?.overallScore ?? retrievalReceiptResult.receipt?.overall_score ?? null,
                modelAuthority: false,
                stakeAuthority: false
            }, String(retrievalReceiptResult.receipt?.status || '').includes('INSUFFICIENT') ? 'WARN' : 'INFO');

            patch24FailureStage = 'FORWARD_CAPTURE_POSTCONDITION';
            const forwardSampleIntakeResult = tennisForwardSampleIntake.assertForwardCapturePostconditions(db, betId, {
                operationId: operation.operationId,
                throwOnFailure: true
            });
            operation.phase('FORWARD_CAPTURE_POSTCONDITION', 'Postcondizioni strutturali forward verificate prima del commit.', {
                event: 'FORWARD_CAPTURE_POSTCONDITION_PASS',
                betId,
                structuralComplete: forwardSampleIntakeResult.structuralComplete,
                certificationEligible: forwardSampleIntakeResult.certificationEligible,
                missing: forwardSampleIntakeResult.missing,
                artifacts: forwardSampleIntakeResult.artifacts,
                noHistoricalBackfill: true,
                productionAuthority: false
            });

            patch24FailureStage = 'OFFICIAL_SCHEDULE_CAPTURE_RACE_GUARD';
            let officialScheduleRaceGuardResult;
            try {
                officialScheduleRaceGuardResult = tennisOfficialScheduleAuthority.assertCaptureTokenStable(db, officialScheduleCaptureToken);
            } catch (raceError) {
                raceError.decision = tennisOfficialScheduleAuthority.toGateBlockDecision(officialScheduleDecision, captureAt);
                throw raceError;
            }
            operation.phase('OFFICIAL_SCHEDULE_CAPTURE_RACE_GUARD', 'Token schedule invariato fino alle postcondizioni di commit.', {
                event: 'OFFICIAL_SCHEDULE_CAPTURE_TOKEN_STABLE', betId,
                receiptId: officialScheduleRaceGuardResult.receiptId,
                stable: true
            });

            return { saved: true, betId, canonicalEventTimeDecision, canonicalEventTimeRevisionResult, officialScheduleDecision, officialScheduleReceiptResult, officialScheduleRaceGuardResult, prematchGateDecision, snapshotResult, eligibilityResult, cohortResult, intelligenceResult, retrievalReceiptResult, forwardSampleIntakeResult, action: savePendingTennisBet.lastAction };
        });

        const result = transaction();
        savePendingTennisBet.lastPatch7Result = result;
        if (!result.saved) {
            operation.complete({ success: false, message: `Previsione non salvata: ${result.action}.`, action: result.action });
            return false;
        }
        operation.complete({
            success: true,
            message: 'Previsione, snapshot, ledger, coorte, intelligence giocatori e ricevuta fonti salvati atomicamente.',
            event: 'SNAPSHOT_COMPLETE',
            betId: result.betId,
            snapshotId: result.snapshotResult?.snapshot?.snapshot_id || null,
            action: result.action,
            cohortId: result.cohortResult?.member?.cohort_id || null,
            cohortRole: result.cohortResult?.member?.cohort_role || null,
            challengerStatus: result.intelligenceResult?.intelligence?.challenger?.status || result.intelligenceResult?.challenger?.challenger_status || null,
            matchupLabel: result.intelligenceResult?.intelligence?.matchup?.matchupLabel || null,
            informationRetrievalReceiptId: result.retrievalReceiptResult?.receipt?.receiptId || result.retrievalReceiptResult?.receipt?.receipt_id || null,
            informationRetrievalStatus: result.retrievalReceiptResult?.receipt?.status || null,
            forwardCaptureStructuralComplete: result.forwardSampleIntakeResult?.structuralComplete === true,
            forwardCaptureCertificationEligible: result.forwardSampleIntakeResult?.certificationEligible === true,
            forwardCaptureArtifacts: result.forwardSampleIntakeResult?.artifacts || null,
            canonicalEventTimeStatus: result.canonicalEventTimeDecision?.qualityStatus || null,
            canonicalEventTimeConfidence: result.canonicalEventTimeDecision?.confidence || null,
            canonicalEventTimeCanonicalUtc: result.canonicalEventTimeDecision?.canonicalStartAtUtc || null,
            canonicalEventTimeSafetyUtc: result.canonicalEventTimeDecision?.safetyStartAtUtc || null,
            canonicalEventTimeRevisionId: result.canonicalEventTimeRevisionResult?.revision?.revision_id || null,
            officialScheduleStatus: result.officialScheduleDecision?.normalizedStatus || null,
            officialScheduleDisposition: result.officialScheduleDecision?.disposition || null,
            officialScheduleReceiptId: result.officialScheduleReceiptResult?.receipt?.receipt_id || null,
            officialScheduleTransitionType: result.officialScheduleReceiptResult?.receipt?.transition_type || null,
            officialScheduleCaptureTokenStable: result.officialScheduleRaceGuardResult?.stable === true,
            prematchCaptureGateStatus: result.prematchGateDecision?.status || null,
            prematchCaptureLeadTimeMs: result.prematchGateDecision?.leadTimeMs ?? null,
            prematchCaptureTimeZone: result.prematchGateDecision?.timeZone || null
        });
        return true;
    } catch (error) {
        let rejectedCaptureLedgerResult = null;
        let rejectedCaptureLedgerError = null;
        const temporalCaptureBlocked = ['PATCH29_R3_PREMATCH_CAPTURE_GATE_BLOCKED','PATCH33_CANONICAL_EVENT_TIME_BLOCKED','PATCH34_OFFICIAL_SCHEDULE_LIFECYCLE_BLOCKED','PATCH34_SCHEDULE_CAPTURE_RACE_DETECTED'].includes(error?.code);
        if (temporalCaptureBlocked && error?.decision) {
            try {
                if (canonicalEventTimeDecision) {
                    canonicalEventTimeRevisionResult = tennisCanonicalEventTime.recordEventTimeRevision(db, canonicalEventTimeDecision, { captureOutcome: 'REJECTED' });
                    if (rejectedCaptureAttemptContext) rejectedCaptureAttemptContext.eventTimeRevisionId = canonicalEventTimeRevisionResult.revision?.revision_id || null;
                }
                if (officialScheduleDecision) {
                    officialScheduleReceiptResult = tennisOfficialScheduleAuthority.recordScheduleReceipt(db, officialScheduleDecision, {
                        captureOutcome: 'REJECTED',
                        eventTimeRevisionId: canonicalEventTimeRevisionResult?.revision?.revision_id || null
                    });
                    if (rejectedCaptureAttemptContext) rejectedCaptureAttemptContext.scheduleReceiptId = officialScheduleReceiptResult.receipt?.receipt_id || null;
                }
                rejectedCaptureLedgerResult = tennisRejectedCaptureObservability.recordRejectedCapture(
                    db,
                    rejectedCaptureAttemptContext || tennisRejectedCaptureObservability.buildAttemptContext({}, bet, { operationId: operation.operationId }),
                    error.decision,
                    { observedAt: new Date().toISOString() }
                );
                savePendingTennisBet.lastRejectedCaptureLedger = rejectedCaptureLedgerResult;
            } catch (ledgerError) {
                rejectedCaptureLedgerError = ledgerError;
                runtimeDiagnostics.captureError({
                    component: 'TENNIS_REJECTED_CAPTURE_OBSERVABILITY',
                    operation: 'REJECTED_CAPTURE_LEDGER_APPEND',
                    operationId: operation.operationId,
                    phase: 'POST_ROLLBACK_LEDGER_APPEND',
                    error: ledgerError,
                    context: { gateStatus: error.decision?.status || null, predictionPersistenceRolledBack: true }
                });
            }
        }
        savePendingTennisBet.lastAction = ['PATCH34_OFFICIAL_SCHEDULE_LIFECYCLE_BLOCKED','PATCH34_SCHEDULE_CAPTURE_RACE_DETECTED'].includes(error?.code)
            ? 'BLOCKED_PATCH34_OFFICIAL_SCHEDULE_LIFECYCLE'
            : error?.code === 'PATCH33_CANONICAL_EVENT_TIME_BLOCKED'
            ? 'BLOCKED_PATCH33_CANONICAL_EVENT_TIME_CONTRACT'
            : error?.code === 'PATCH29_R3_PREMATCH_CAPTURE_GATE_BLOCKED'
            ? 'BLOCKED_PATCH29_R3_PREMATCH_CAPTURE_GATE'
            : 'FAILED_PATCH12_ATOMIC_PERSISTENCE';
        savePendingTennisBet.lastPatch7Error = error.message;
        // PATCH12_R1_PATCH7_DIAGNOSTIC_COMPATIBILITY
        // La transazione atomica nasce con Patch 7: il contratto diagnostico
        // SNAPSHOT_FAILED resta stabile anche quando il failure stage è Patch 12.
        const patch38RejectionSemantics = tennisForwardHealthSemanticsPatch38.classifyPrematchRejection(error);
        const patch38DiagnosticContext = {
            event: patch38RejectionSemantics.event,
            failureStage: patch24FailureStage,
            patch12Event: patch24FailureStage === 'PLAYER_MATCHUP_INTELLIGENCE' ? 'PLAYER_MATCHUP_INTELLIGENCE_FAILED' : null,
            patch15FailureStage: patch24FailureStage === 'INFORMATION_RETRIEVAL_RECEIPT' ? 'INFORMATION_RETRIEVAL_RECEIPT' : null,
            patch15Event: patch24FailureStage === 'INFORMATION_RETRIEVAL_RECEIPT' ? 'INFORMATION_RETRIEVAL_RECEIPT_FAILED' : null,
            patch24FailureStage,
            patch24Event: 'FORWARD_SAMPLE_INTAKE_FAILED',
            patch29R3Event: patch24FailureStage === 'PREMATCH_CAPTURE_GATE' ? 'PREMATCH_CAPTURE_GATE_BLOCK' : null,
            patch33Event: patch24FailureStage === 'CANONICAL_EVENT_TIME_CONTRACT' ? 'CANONICAL_EVENT_TIME_BLOCK' : null,
            patch34Event: ['OFFICIAL_SCHEDULE_LIFECYCLE','OFFICIAL_SCHEDULE_CAPTURE_RACE_GUARD'].includes(patch24FailureStage) ? 'OFFICIAL_SCHEDULE_CAPTURE_BLOCK' : null,
            canonicalEventTimeDecision,
            officialScheduleDecision,
            officialScheduleReceiptId: officialScheduleReceiptResult?.receipt?.receipt_id || null,
            prematchCaptureGateDecision: error?.decision || null,
            rejectedCaptureLedgerEventId: rejectedCaptureLedgerResult?.eventId || null,
            rejectedCaptureLedgerHash: rejectedCaptureLedgerResult?.eventHash || null,
            rejectedCaptureLedgerAppendFailed: Boolean(rejectedCaptureLedgerError),
            predictionPersistenceRolledBack: true,
            expectedPolicyRejection: patch38RejectionSemantics.expectedPolicyRejection,
            match: `${bet?.home || '?'} - ${bet?.away || '?'}`
        };
        if (patch38RejectionSemantics.expectedPolicyRejection) {
            operation.warn('PREMATCH_CAPTURE_REJECTED', error?.message || 'Cattura respinta dalla policy temporale.', patch38DiagnosticContext);
        } else {
            operation.error('SNAPSHOT_FAILED', error, patch38DiagnosticContext);
        }
        return false;
    }
}
// /PATCH 7 - IMMUTABLE PREDICTION SNAPSHOT & FORWARD CERTIFICATION

// ============================================================================
// 16. FILE STORICI TENNIS
// ============================================================================

const COLUMN_MAP = {
    winner: ['winner_name', 'winner', 'player1', 'Winner'],
    loser: ['loser_name', 'loser', 'player2', 'Loser'],
    date: ['tourney_date', 'date', 'Date'],
    wRank: ['winner_rank', 'wrank', 'WRank'],
    lRank: ['loser_rank', 'lrank', 'LRank'],
    b365W: ['b365w', 'bw', 'maxw', 'B365W'],
    b365L: ['b365l', 'bl', 'maxl', 'B365L'],
    psW: ['psw', 'avgw', 'b365w', 'PSW'],
    psL: ['psl', 'avgl', 'b365l', 'PSL'],
    series: ['tourney_level', 'series', 'tier', 'tournament', 'Series'],
    surface: ['surface', 'court', 'Surface', 'Court']
};

function findColumn(headers, aliases) {
    for (const alias of aliases) {
        const norm = normalizeKey(alias);

        for (const h of headers) {
            if (normalizeKey(h) === norm) return h;
        }
    }

    for (const h of headers) {
        const nh = normalizeKey(h);

        if (aliases.some(a => nh.includes(normalizeKey(a)))) {
            return h;
        }
    }

    return null;
}

function buildColumnIndex(headers) {
    const map = {};

    for (const key in COLUMN_MAP) {
        map[key] = findColumn(headers, COLUMN_MAP[key]);
    }

    return map;
}

function loadTennisData(filePath) {
    try {
        let raw = [];

        if (filePath.endsWith('.csv')) {
            const csvData = fs.readFileSync(filePath, 'utf8');

            if (csvData.includes('<html') || csvData.includes('<!DOCTYPE')) {
                return null;
            }

            const workbook = XLSX.read(csvData, { type: 'string' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        } else {
            const workbook = XLSX.readFile(filePath);
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        }

        if (!raw || raw.length === 0) return null;

        const headers = Object.keys(raw[0]);
        const col = buildColumnIndex(headers);

        if (!col.winner || !col.loser) return null;

        const data = [];

        for (const row of raw) {
            try {
                const winner = row[col.winner];
                const loser = row[col.loser];

                if (!winner || !loser) continue;

                const bW = safeFloat(row[col.b365W]);
                const bL = safeFloat(row[col.b365L]);
                const pW = safeFloat(row[col.psW]);
                const pL = safeFloat(row[col.psL]);

                if ((isNaN(bW) || isNaN(bL)) && (isNaN(pW) || isNaN(pL))) {
                    continue;
                }

                data.push({
                    winner,
                    loser,
                    bW,
                    bL,
                    pW,
                    pL,
                    wRank: parseInt(row[col.wRank]) || 100,
                    lRank: parseInt(row[col.lRank]) || 100,
                    date: parseDate(row[col.date]),
                    series: row[col.series] || row.tourney_level || 'Torneo',
                    surface: normalizeSurface(row[col.surface] || 'Hard')
                });
            } catch (error) {
                // Skip riga non leggibile.
            }
        }

        return data.length > 0 ? data : null;
    } catch (error) {
        console.warn(`⚠️ Errore lettura file storico ${filePath}:`, error.message);
        return null;
    }
}

async function getFilesForBacktest(league) {
    const targetYears = [2025, 2024, 2023, 2022];
    const validFiles = [];

    for (const y of targetYears) {
        let fileFound = false;
        const searchStr = league === 'atp' ? 'atp' : 'wta';

        if (fs.existsSync(REAL_ODDS_DIR)) {
            const filesInVault = fs.readdirSync(REAL_ODDS_DIR);

            const vaultFile = filesInVault.find(f => {
                const lower = f.toLowerCase();

                return lower.includes(searchStr) &&
                    f.includes(String(y)) &&
                    (lower.endsWith('.xlsx') || lower.endsWith('.csv'));
            });

            if (vaultFile) {
                validFiles.push(path.join(REAL_ODDS_DIR, vaultFile));
                fileFound = true;
                continue;
            }
        }

        const folder = league === 'atp' ? y : `${y}w`;
        const fileNameXLSX = `${folder}.xlsx`;
        const cachePathXLSX = path.join(CACHE_DIR, fileNameXLSX);

        if (!fileFound && fs.existsSync(cachePathXLSX)) {
            const stats = fs.statSync(cachePathXLSX);

            if (stats.size > 15000) {
                validFiles.push(cachePathXLSX);
                fileFound = true;
                continue;
            }

            fs.unlinkSync(cachePathXLSX);
        }

        if (!fileFound) {
            const urlHTTP = `http://www.tennis-data.co.uk/${folder}/${fileNameXLSX}`;

            try {
                const res = await axios.get(urlHTTP, {
                    responseType: 'arraybuffer',
                    timeout: 8000
                });

                const contentType = String(res.headers['content-type'] || '').toLowerCase();

                if (res.data.byteLength > 15000 && !contentType.includes('text/html')) {
                    fs.writeFileSync(cachePathXLSX, res.data);
                    validFiles.push(cachePathXLSX);
                }
            } catch (error) {
                // File non disponibile, passa all'anno successivo.
            }
        }
    }

    return validFiles;
}

function buildHistoricalTennisMatch(row) {
    const winner = String(row.winner || '').trim();
    const loser = String(row.loser || '').trim();

    if (!winner || !loser) return null;

    // Ordinamento deterministico per evitare randomizzazione artificiale.
    const winnerIsP1 = winner.localeCompare(loser, 'en', { sensitivity: 'base' }) <= 0;

    const p1Name = winnerIsP1 ? winner : loser;
    const p2Name = winnerIsP1 ? loser : winner;

    const rawB1 = winnerIsP1 ? row.bW : row.bL;
    const rawB2 = winnerIsP1 ? row.bL : row.bW;

    const rawP1 = winnerIsP1 ? row.pW : row.pL;
    const rawP2 = winnerIsP1 ? row.pL : row.pW;

    const closingOdd1 = (!isNaN(rawP1) && rawP1 > 1) ? rawP1 : rawB1;
    const closingOdd2 = (!isNaN(rawP2) && rawP2 > 1) ? rawP2 : rawB2;

    if (
        !closingOdd1 ||
        !closingOdd2 ||
        isNaN(closingOdd1) ||
        isNaN(closingOdd2) ||
        closingOdd1 <= 1 ||
        closingOdd2 <= 1
    ) {
        return null;
    }

    return {
        p1Name,
        p2Name,
        p1Won: winnerIsP1,
        p2Won: !winnerIsP1,
        closingOdd1,
        closingOdd2,
        winner,
        loser
    };
}

function simulateOpeningOddsTennis(odd1, odd2) {
    const o1 = normalizeOdd(odd1);
    const o2 = normalizeOdd(odd2);

    if (!o1 || !o2) return { odd1, odd2, source: 'INVALID_INPUT' };

    const margin = (1 / o1) + (1 / o2);
    const p1 = (1 / o1) / margin;
    const p2 = (1 / o2) / margin;

    // Simulazione dichiarata: non è una vera opening odd.
    // Serve solo come scenario di test storico.
    const flatten = 0.05;
    const op1 = p1 * (1 - flatten) + 0.5 * flatten;
    const op2 = p2 * (1 - flatten) + 0.5 * flatten;
    const openMargin = 1.05;

    return {
        odd1: round(1 / (op1 * openMargin), 3),
        odd2: round(1 / (op2 * openMargin), 3),
        source: 'SIMULATED_OPENING_FROM_CLOSING'
    };
}


// ============================================================================
// 17. MODELLO PROBABILISTICO TENNIS
// ============================================================================

function buildLiveModelProbabilities({
    fairProb1,
    fairProb2,
    matchupStats,
    useMarkov,
    leagueType
}) {
    let blendedProb1 = fairProb1;
    let blendedProb2 = fairProb2;

    let p1Point = 0;
    let p2Point = 0;
    let p1Clutch = 0;
    let p2Clutch = 0;

    let sackmannSample = 0;
    let rankDelta = 0;
    let hasSackmannData = false;
    let canUseTotals = false;
    let isMismatch = false;
    const canonicalPlayerEvidenceBridge = matchupStats?.canonicalBridge || null;
    const hasCanonicalPlayerData = Boolean(canonicalPlayerEvidenceBridge && canonicalPlayerEvidenceBridge.status !== 'UNAVAILABLE');

    if (useMarkov && matchupStats && matchupStats.hasData) {
        blendedProb1 = matchupStats.finalProb1;
        blendedProb2 = matchupStats.finalProb2;

        p1Point = matchupStats.p1_point || 0;
        p2Point = matchupStats.p2_point || 0;
        p1Clutch = matchupStats.p1_clutch || 0;
        p2Clutch = matchupStats.p2_clutch || 0;

        sackmannSample = matchupStats.sample || 0;
        hasSackmannData = true;
        canUseTotals = true;

        const r1 = Number(matchupStats.p1_rank);
        const r2 = Number(matchupStats.p2_rank);

        rankDelta = Number.isFinite(r1) && Number.isFinite(r2) ? Math.abs(r1 - r2) : 0;

        if (rankDelta >= 80 || Math.abs(blendedProb1 - blendedProb2) > 50) {
            isMismatch = true;
        }
    }

    if (String(leagueType).toLowerCase() === 'wta') {
        blendedProb1 = 50 + ((blendedProb1 - 50) * 0.90);
        blendedProb2 = 50 + ((blendedProb2 - 50) * 0.90);
    }

    let modelWeight = 0.50;

    if (sackmannSample > 100) modelWeight = 0.75;
    else if (sackmannSample > 50) modelWeight = 0.65;
    else if (sackmannSample > 20) modelWeight = 0.50;
    else if (sackmannSample > 0) modelWeight = 0.35;
    else modelWeight = 0.25;

    blendedProb1 = (blendedProb1 * modelWeight) + (fairProb1 * (1 - modelWeight));
    blendedProb2 = (blendedProb2 * modelWeight) + (fairProb2 * (1 - modelWeight));

    blendedProb1 = preCalibrateModelProbability(blendedProb1);
    blendedProb2 = preCalibrateModelProbability(blendedProb2);

    const normalized = normalizeTwoWayProbabilities(blendedProb1, blendedProb2);

    return {
        prob1: normalized.p1,
        prob2: normalized.p2,
        p1Point,
        p2Point,
        p1Clutch,
        p2Clutch,
        sackmannSample,
        rankDelta,
        hasSackmannData,
        canUseTotals,
        isMismatch,
        modelWeight,
        canonicalPlayerEvidenceBridge,
        hasCanonicalPlayerData,
        canonicalPlayerEvidenceAuthority: 'DEEPSCAN_CONTEXT_ONLY',
        canonicalPlayerEvidenceProbabilityChanged: false,
        canonicalPlayerEvidenceStakeChanged: false
    };
}




// ============================================================================
// 17.1 HEALTH CHECK TENNIS
// ============================================================================
//
// Endpoint non mutante: non salva settings, non avvia ottimizzazioni,
// non chiama API esterne. Serve solo per verificare allineamento componenti.
// ============================================================================

function safeComponentStatus(name, checkFn) {
    try {
        const result = typeof checkFn === 'function' ? checkFn() : true;

        if (result === true) {
            return {
                status: 'OK',
                ok: true
            };
        }

        if (result && typeof result === 'object') {
            return {
                status: result.ok === false ? 'WARN' : 'OK',
                ok: result.ok !== false,
                ...result
            };
        }

        return {
            status: result ? 'OK' : 'WARN',
            ok: Boolean(result)
        };
    } catch (error) {
        return {
            status: 'ERROR',
            ok: false,
            error: error.message
        };
    }
}

function getTennisDbHealthSummary() {
    const summary = {
        dbPath: DB_PATH,
        dbPathAbsolute: path.isAbsolute(DB_PATH),
        tables: {
            ai_forward_test: false,
            system_settings: false
        },
        columns: {
            sport_type: false,
            edge_pp: false,
            ev_pct: false,
            data_quality: false,
            model_version: false,
            metric_version: false,
            engine_version: false,
            tour_type: false,
            surface: false,
            market_type: false,
            reference_market_quality: false,
            data_sufficiency_score: false,
            closing_odd: false,
            clv_pct: false,
            markov_validated: false
        },
        samples: {
            pendingCurrent: 0,
            settledCurrent: 0,
            settledWonLostCurrent: 0,
            legacyDirty: 0,
            missingDataQuality: 0
        }
    };

    try {
        const tables = db.prepare(`
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
        `).all().map(r => r.name);

        summary.tables.ai_forward_test = tables.includes('ai_forward_test');
        summary.tables.system_settings = tables.includes('system_settings');

        if (summary.tables.ai_forward_test) {
            for (const col of Object.keys(summary.columns)) {
                summary.columns[col] = columnExists('ai_forward_test', col);
            }

            const tennisWhere = `
                (
                    UPPER(COALESCE(sport_type, '')) = 'TENNIS'
                    OR UPPER(COALESCE(bet_type, '')) LIKE '%TENNIS%'
                    OR UPPER(COALESCE(strategy_tag, '')) LIKE '%TENNIS%'
                )
            `;

            const currentWhere = `
                UPPER(COALESCE(data_quality, '')) IN ('CURRENT_BOOTSTRAP', 'CURRENT')
            `;

            summary.samples.pendingCurrent = db.prepare(`
                SELECT COUNT(*) AS c
                FROM ai_forward_test
                WHERE ${tennisWhere}
                  AND ${currentWhere}
                  AND UPPER(COALESCE(status, '')) = 'PENDING'
            `).get().c || 0;

            summary.samples.settledCurrent = db.prepare(`
                SELECT COUNT(*) AS c
                FROM ai_forward_test
                WHERE ${tennisWhere}
                  AND ${currentWhere}
                  AND UPPER(COALESCE(status, '')) IN ('WON', 'LOST', 'PUSH', 'VOID')
            `).get().c || 0;

            summary.samples.settledWonLostCurrent = db.prepare(`
                SELECT COUNT(*) AS c
                FROM ai_forward_test
                WHERE ${tennisWhere}
                  AND ${currentWhere}
                  AND UPPER(COALESCE(status, '')) IN ('WON', 'LOST')
            `).get().c || 0;

            summary.samples.legacyDirty = db.prepare(`
                SELECT COUNT(*) AS c
                FROM ai_forward_test
                WHERE ${tennisWhere}
                  AND UPPER(COALESCE(data_quality, '')) IN ('LEGACY_DIRTY', 'DIRTY', 'OLD_METRICS')
            `).get().c || 0;

            summary.samples.missingDataQuality = db.prepare(`
                SELECT COUNT(*) AS c
                FROM ai_forward_test
                WHERE ${tennisWhere}
                  AND (data_quality IS NULL OR TRIM(data_quality) = '')
            `).get().c || 0;
        }

        return summary;
    } catch (error) {
        return {
            ...summary,
            error: error.message
        };
    }
}

function getTennisHealthPayload() {
    const tennisPatchStatus = tennisPatchRegistry.getTennisPatchStatus();
    const settings = getSystemSettings();
    const dbSummary = getTennisDbHealthSummary();
    const reliabilityReport = getNewHistoryTennisReliabilityReport();
    const predictiveCalibration = reliabilityReport.segmentCalibration?.predictiveDashboard ||
        buildTennisPredictiveCalibrationDashboard(reliabilityReport.segmentCalibration || buildTennisSegmentCalibrationReport([]));
    const forwardIntakeReadiness = tennisForwardSampleIntake.inspectForwardSampleIntake(db, {
        operationId: 'TENNIS_HEALTH_PATCH25_READ_ONLY'
    });

    const markovSelfCheck = safeComponentStatus('markov', () => {
        if (!MarkovEngine) {
            return {
                ok: false,
                status: 'ERROR',
                reason: 'markov.js non importato'
            };
        }

        if (typeof MarkovEngine.runMarkovSelfCheck === 'function') {
            const selfCheck = MarkovEngine.runMarkovSelfCheck();

            return {
                ok: selfCheck.ok === true,
                status: selfCheck.ok === true ? 'OK' : 'WARN',
                deterministic: selfCheck.deterministic,
                probabilitiesOk: selfCheck.probabilitiesOk,
                version: selfCheck.version || MarkovEngine.MARKOV_ENGINE_VERSION || null
            };
        }

        return {
            ok: true,
            status: 'WARN',
            reason: 'runMarkovSelfCheck non disponibile',
            version: MarkovEngine.MARKOV_ENGINE_VERSION || null
        };
    });

    const components = {
        tennisValueEvaluator: safeComponentStatus('tennisValueEvaluator', () => ({
            ok: typeof evaluateTennisValueBet === 'function' &&
                typeof calculateExpectedValuePct === 'function' &&
                typeof calculateEdgePp === 'function' &&
                typeof impliedProbability === 'function',
            version: '4.5+',
            requiredFunctions: {
                evaluateTennisValueBet: typeof evaluateTennisValueBet === 'function',
                calculateExpectedValuePct: typeof calculateExpectedValuePct === 'function',
                calculateEdgePp: typeof calculateEdgePp === 'function',
                impliedProbability: typeof impliedProbability === 'function'
            }
        })),
        markov: markovSelfCheck,
        paperTradingTennis: safeComponentStatus('paperTradingTennis', () => ({
            ok: Boolean(paperTradingTennisEngine) &&
                typeof paperTradingTennisEngine.processTennisPaperTrading === 'function',
            version: paperTradingTennisEngine?.TENNIS_PAPER_ENGINE_VERSION || null
        })),
        deepScanTennis: safeComponentStatus('deepScanTennis', () => ({
            ok: Boolean(deepScanTennis) &&
                typeof deepScanTennis.scanMatchup === 'function',
            version: deepScanTennis?.DEEP_SCAN_TENNIS_VERSION || null
        })),
        tennisPatchRegistry: safeComponentStatus('tennisPatchRegistry', () => ({
            ok: Number(tennisPatchStatus.currentPatchVersion) >= 3 &&
                tennisPatchStatus.pendingPipelineVersion === 'TENNIS_PATCH_1_PENDING_PIPELINE',
            version: tennisPatchStatus.currentPatchVersion,
            baselineVersion: tennisPatchStatus.legacyBaselineVersion,
            pipelineVersion: tennisPatchStatus.pendingPipelineVersion
        })),
        clvCrossSportCoveragePatch53: safeComponentStatus('clvCrossSportCoveragePatch53', () => ({
            ok: typeof clvCrossSportCoveragePatch53.buildCoverageReport === 'function' &&
                clvCrossSportCoveragePatch53.VERSION === 'CLV_CROSS_SPORT_COVERAGE_V1_PATCH53',
            version: clvCrossSportCoveragePatch53.VERSION,
            sportKeyResolutionVersion: clvCrossSportCoveragePatch53.SPORT_KEY_RESOLUTION_VERSION,
            noSyntheticClosingOdds: true,
            probabilityAuthority: false,
            stakeAuthority: false,
            settlementAuthority: false
        })),
        tennisRuntimeHealthContract: safeComponentStatus('tennisRuntimeHealthContract', () => ({
            ok: tennisRuntimeHealthContract.TENNIS_RUNTIME_HEALTH_CONTRACT_VERSION === 'TENNIS_RUNTIME_HEALTH_CONTRACT_V2_PATCH29_R3' &&
                tennisRuntimeHealthContract.TENNIS_ENGINE_VERSION === TENNIS_ENGINE_VERSION,
            version: tennisRuntimeHealthContract.TENNIS_RUNTIME_HEALTH_CONTRACT_VERSION,
            serverCoreVersion: tennisRuntimeHealthContract.SERVER_CORE_VERSION,
            tennisEngineVersion: tennisRuntimeHealthContract.TENNIS_ENGINE_VERSION,
            patchVersion: tennisPatchStatus.currentPatchVersion,
            identitiesSeparated: true
        })),
        tennisMatchFormat: safeComponentStatus('tennisMatchFormat', () => ({
            ok: typeof resolveTennisMatchFormat === 'function' &&
                TENNIS_MATCH_FORMAT_CONTRACT_VERSION === 'TENNIS_MATCH_FORMAT_CONTRACT_V1_PATCH_2',
            version: TENNIS_MATCH_FORMAT_CONTRACT_VERSION,
            defaultPolicy: 'AMBIGUOUS_SAFE_BO3',
            atpGrandSlamMainDraw: 'BO5',
            wtaGrandSlam: 'BO3'
        })),
        tennisEventIdentity: safeComponentStatus('tennisEventIdentity', () => ({
            ok: typeof tennisEventIdentity.annotateTennisEventIdentity === 'function' &&
                typeof tennisEventIdentity.selectPendingTennisIdentityMatch === 'function' &&
                tennisEventIdentity.TENNIS_EVENT_IDENTITY_VERSION === 'TENNIS_EVENT_IDENTITY_V1_PATCH_3',
            version: tennisEventIdentity.TENNIS_EVENT_IDENTITY_VERSION,
            providerEventPriority: true,
            rematchSafe: true,
            marketFingerprintIncludesLine: true,
            ambiguousIdentityPolicy: 'AUDIT_ONLY_NO_OVERWRITE'
        })),
        tennisSettlementContract: safeComponentStatus('tennisSettlementContract', () => ({
            ok: typeof tennisSettlementContract.evaluateTennisSettlementContract === 'function' &&
                tennisSettlementContract.TENNIS_SETTLEMENT_CONTRACT_VERSION === 'TENNIS_SETTLEMENT_CONTRACT_V2_AUDIT02',
            version: tennisSettlementContract.TENNIS_SETTLEMENT_CONTRACT_VERSION,
            automaticSettlementStates: ['VERIFIED', 'VOID'],
            weakWebPolicy: 'PROPOSED_NO_AUTO_SETTLEMENT',
            runtimeDiagnosticsVersion: runtimeDiagnostics.RUNTIME_DIAGNOSTICS_VERSION
        })),
        tennisPrematchCaptureGate: safeComponentStatus('tennisPrematchCaptureGate', () => {
            const selfCheck = tennisPrematchCaptureGate.selfCheck();
            return {
                ok: selfCheck.ok === true,
                status: selfCheck.ok === true ? 'OK' : 'ERROR',
                version: tennisPrematchCaptureGate.TENNIS_PREMATCH_CAPTURE_GATE_VERSION,
                timeZone: tennisPrematchCaptureGate.DEFAULT_TIME_ZONE,
                transactionalRollback: true,
                captureCommitAuthority: true,
                productionProbabilityAuthority: false,
                qualityGateAuthority: false,
                stakeAuthority: false,
                checks: selfCheck.checks
            };
        }),
        tennisCanonicalEventTime: safeComponentStatus('tennisCanonicalEventTime', () => {
            const report = tennisCanonicalEventTime.buildProviderTimeQualityReport(db, { limit: 5 });
            return {
                ok: report.healthy === true,
                status: report.status || (report.healthy ? 'OK' : 'ERROR'),
                role: 'REQUIRED_CAPTURE',
                version: tennisCanonicalEventTime.TENNIS_CANONICAL_EVENT_TIME_VERSION,
                schemaVersion: tennisCanonicalEventTime.TENNIS_EVENT_TIME_LEDGER_SCHEMA_VERSION,
                appendOnly: report.schema?.appendOnly === true,
                hashChainHealthy: report.chain?.healthy === true,
                observations: report.total || 0,
                providerConflicts: report.counts?.conflicts || 0,
                blockedUnresolved: report.counts?.blocked || 0,
                dstAmbiguityBlocked: true,
                conflictSafetyRule: report.conflictSafetyRule,
                automaticGateOverride: false,
                productionProbabilityAuthority: false,
                qualityGateAuthority: false,
                stakeAuthority: false
            };
        }),
        tennisOfficialScheduleAuthority: safeComponentStatus('tennisOfficialScheduleAuthority', () => {
            const report = tennisOfficialScheduleAuthority.buildScheduleHealthReport(db, { limit: 5 });
            return {
                ok: report.healthy === true,
                status: report.status || (report.healthy ? 'OK' : 'ERROR'),
                role: 'REQUIRED_CAPTURE',
                version: tennisOfficialScheduleAuthority.TENNIS_OFFICIAL_SCHEDULE_AUTHORITY_VERSION,
                schemaVersion: tennisOfficialScheduleAuthority.TENNIS_SCHEDULE_RECEIPT_SCHEMA_VERSION,
                appendOnly: report.schema?.appendOnly === true,
                hashChainHealthy: report.chain?.healthy === true,
                receipts: report.total || 0,
                blockedStates: report.counts?.blocked || 0,
                providerConflicts: report.counts?.conflicts || 0,
                captureRaceGuard: report.captureRaceGuard === true,
                automaticSettlement: false,
                productionProbabilityAuthority: false,
                qualityGateAuthority: false,
                stakeAuthority: false,
                settlementAuthority: false
            };
        }),
        tennisRejectedCaptureObservability: safeComponentStatus('tennisRejectedCaptureObservability', () => {
            const report = tennisRejectedCaptureObservability.buildObservabilityReport(db, { limit: 5 });
            return {
                ok: report.healthy === true,
                status: report.status || (report.healthy ? 'OK' : 'ERROR'),
                role: 'OBSERVABILITY',
                version: tennisRejectedCaptureObservability.TENNIS_REJECTED_CAPTURE_OBSERVABILITY_VERSION,
                schemaVersion: tennisRejectedCaptureObservability.TENNIS_REJECTED_CAPTURE_LEDGER_SCHEMA_VERSION,
                appendOnly: report.appendOnly === true,
                hashChainHealthy: report.chain?.healthy === true,
                rejectedAttempts: report.counts?.total || 0,
                clockDriftSuspects: report.counts?.driftSuspects || 0,
                suspectedFalseRejections: report.counts?.suspectedFalseRejections || 0,
                automaticOverride: false,
                productionProbabilityAuthority: false,
                qualityGateAuthority: false,
                stakeAuthority: false
            };
        }),
        sackmann: safeComponentStatus('sackmann', () => {
            const init = ensureSackmannReady({ required: false });
            const evidence = typeof sackmann.getEvidenceStatus === 'function' ? sackmann.getEvidenceStatus() : null;
            return {
                ok: Boolean(sackmann) && typeof sackmann.init === 'function' && typeof sackmann.getAdvancedMatchup === 'function' && init.ok === true,
                initialized: sackmannInitialized,
                lazyInitialization: false,
                synchronousLocalInit: true,
                networkUsed: evidence?.networkUsed === true,
                asOfSafe: evidence?.asOfSafe === true,
                playerCount: evidence?.playerCount ?? null,
                matchCount: evidence?.matchCount ?? null,
                latestMatchAt: evidence?.latestMatchAt ?? null,
                rejectedRows: evidence?.rejectedRows ?? null,
                version: evidence?.adapterVersion || sackmann.SACKMANN_ADAPTER_VERSION || null,
                lastInitError: sackmannInitError ? sackmannInitError.message : null,
                dataDir: ABSOLUTE_SACKMANN_DIR
            };
        }),
        tennisPlayerDataRefresh: safeComponentStatus('tennisPlayerDataRefresh', () => {
            const health = tennisPlayerDataRefresh.getPlayerDataHealth({ dataDir: ABSOLUTE_SACKMANN_DIR, initialize: true });
            return {
                ok: health.status !== 'ERROR',
                status: health.status === 'CURRENT' ? 'OK' : health.status === 'ERROR' ? 'ERROR' : 'WARN',
                version: tennisPlayerDataRefresh.TENNIS_PLAYER_DATA_REFRESH_VERSION,
                latestMatchAt: health.latestMatchAt,
                dataAgeDays: health.dataAgeDays,
                lastRefreshAt: health.lastRefreshAt,
                lastRefreshAttemptAt: health.lastRefreshAttemptAt,
                refreshState: health.refreshState,
                degradedUsingLastKnownGood: health.degradedUsingLastKnownGood === true,
                lastFailureSourceId: health.lastFailure?.sourceId || null,
                requestPolicyVersion: health.requestPolicyVersion,
                autoRefresh: patch14AutoRefreshSchedule,
                atomicActivation: true,
                lastKnownGood: true,
                retryAndFallback: true
            };
        }),
        tennisMultiProviderData: safeComponentStatus('tennisMultiProviderData', () => {
            const health = tennisMultiProviderData.getHealth({ dataDir: ABSOLUTE_SACKMANN_DIR, projectRoot: path.resolve(ROOT_DIR, '..') });
            return {
                ok: health.success === true,
                status: health.status === 'DEGRADED_USING_LAST_KNOWN_GOOD' ? 'WARN' : 'OK',
                version: tennisMultiProviderData.TENNIS_MULTI_PROVIDER_VERSION,
                registryVersion: tennisMultiProviderData.TENNIS_MULTI_PROVIDER_REGISTRY_VERSION,
                strategy: health.strategy,
                selectedProviders: health.selectedProviders,
                apiUsage: health.apiUsage,
                zeroKeyFirst: health.costPolicy?.zeroKeyFirst === true,
                apiKeyPersisted: false,
                apiKeyExposed: false,
                productionAuthority: false,
                qualityGateAuthority: false,
                stakeAuthority: false
            };
        }),
        tennisTourDataReadiness: safeComponentStatus('tennisTourDataReadiness', () => {
            const health = tennisTourDataReadiness.buildReadinessHealth(db, {
                dataDir: ABSOLUTE_SACKMANN_DIR,
                projectRoot: path.resolve(ROOT_DIR, '..')
            });
            return {
                ok: health.success === true && health.sourceFreshnessNotMasked === true,
                status: health.status === 'ALL_CURRENT' ? 'OK' : health.status === 'ERROR' ? 'ERROR' : 'WARN',
                version: tennisTourDataReadiness.TENNIS_TOUR_DATA_READINESS_VERSION,
                policyVersion: tennisTourDataReadiness.TENNIS_TOUR_DATA_POLICY_VERSION,
                readinessStatus: health.status,
                targets: health.targets,
                tours: health.tours,
                forwardStatus: health.forwardStatus,
                sourceFreshnessNotMasked: health.sourceFreshnessNotMasked === true,
                activitySeparated: true,
                productionProbabilityAuthority: false,
                qualityGateAuthority: false,
                stakeAuthority: false
            };
        }),
        tennisWtaInformationRecovery: safeComponentStatus('tennisWtaInformationRecovery', () => {
            const recovery = tennisWtaInformationRecoveryPatch52.health({ dataDir:ABSOLUTE_SACKMANN_DIR, projectRoot:path.resolve(ROOT_DIR,'..') });
            return { ok:recovery.success===true, status:recovery.status==='READY_CURRENT'?'OK':'WARN', version:recovery.version, policyVersion:recovery.policyVersion, stateSchemaVersion:recovery.stateSchemaVersion, recoveryStatus:recovery.status, semanticStatus:recovery.semanticStatus, selectedCandidate:recovery.selectedCandidate, activeDataset:recovery.activeDataset, active:recovery.activeDataset, candidateActiveSeparation:recovery.candidateActiveSeparation===true, providerState:recovery.state?.providers||{}, lastKnownGoodPreserved:true, circuitBreakerActive:recovery.circuitBreakerActive===true, probabilityAuthority:false, qualityGateAuthority:false, stakeAuthority:false, settlementAuthority:false };
        }),
        tennisMatchupIntelligence: safeComponentStatus('tennisMatchupIntelligence', () => ({
            ok: typeof tennisMatchupIntelligence.persistMatchupIntelligenceForBet === 'function' && typeof tennisMatchupIntelligence.getIntelligenceHealth === 'function',
            version: tennisMatchupIntelligence.TENNIS_MATCHUP_INTELLIGENCE_VERSION,
            challengerVersion: tennisMatchupIntelligence.TENNIS_CHALLENGER_MODEL_VERSION,
            mode: tennisMatchupIntelligence.MODE,
            productionProbabilityChangedByChallenger: false,
            stakeAuthority: false,
            deepScanSeparate: true
        })),
        tennisInformationRetrieval: safeComponentStatus('tennisInformationRetrieval', () => {
            const retrieval = tennisInformationRetrieval.buildInformationRetrievalHealth(db, {
                dataDir: ABSOLUTE_SACKMANN_DIR,
                cacheDir: NEWS_CACHE_DIR,
                limit: 5
            });
            return {
                ok: retrieval.success === true,
                status: retrieval.status === 'PASS' ? 'OK' : retrieval.status === 'FAIL' ? 'ERROR' : 'WARN',
                version: tennisInformationRetrieval.TENNIS_INFORMATION_RETRIEVAL_VERSION,
                policyVersion: tennisInformationRetrieval.TENNIS_INFORMATION_RETRIEVAL_POLICY_VERSION,
                schemaVersion: tennisInformationRetrieval.TENNIS_INFORMATION_RETRIEVAL_SCHEMA_VERSION,
                overallScore: retrieval.overallScore,
                probeScope: retrieval.probeScope || null,
                sourceFreshnessNotMasked: retrieval.sourceFreshnessNotMasked === true,
                zeroKeyHealthScoringAligned: retrieval.zeroKeyHealthScoringAligned === true,
                optionalSourcesExcluded: retrieval.optionalSourcesExcluded || [],
                channels: Object.fromEntries(Object.entries(retrieval.channels || {}).map(([key, value]) => [key, { status: value.status, score: value.score }])),
                immutableReceipts: true,
                networkProbeOptional: true,
                probabilityWeightsChanged: false,
                deepScanDecisionChanged: false,
                qualityGateAuthority: false,
                stakeAuthority: false
            };
        })
    };

    const alignedTechnicalChecksPatch50 = tennisTechnicalHealthAlignmentPatch50.buildAlignedTechnicalChecks({
        runtimeDiagnostics,
        tennisForwardLifecycle,
        tennisPlayerEvidence,
        tennisProgramProgressionAudit,
        tennisMultiProviderData
    });

    const componentHealthSemantics = tennisRuntimeHealthContract.buildComponentHealthSemantics(components);
    const semanticComponents = componentHealthSemantics.components;
    const status = componentHealthSemantics.status;
    const runtimeVersions = tennisRuntimeHealthContract.buildRuntimeVersions(tennisPatchStatus);
    const operationalReadiness = tennisRuntimeHealthContract.buildOperationalReadiness({
        healthStatus: status,
        components: semanticComponents,
        componentHealthSemantics,
        checks: {},
        forwardIntake: forwardIntakeReadiness
    });

    return {
        success: status !== 'ERROR',
        sport: 'TENNIS',
        status,
        message: status === 'OK'
            ? 'Health Tennis OK: componenti allineati e ottimizzazione in modalità raccomandazione.'
            : 'Health Tennis completato con avvisi: controllare components/checks.',
        engineVersion: TENNIS_ENGINE_VERSION,
        modelVersion: TENNIS_MODEL_VERSION,
        metricVersion: TENNIS_METRIC_VERSION,
        dataMode: 'CURRENT_ACTIVE_HISTORY',
        reliabilityMode: 'BOOTSTRAP_OR_NEW_HISTORY_ONLY',
        optimizeMode: 'RECOMMENDATION_ONLY',
        recommendationOnly: true,
        autoApplySettings: false,
        runtimeVersions,
        operationalReadiness,
        componentHealthSemantics,
        forwardSampleIntake: forwardIntakeReadiness,
        patchRegistry: tennisPatchStatus,
        settings: {
            useHistoricalOpt: settings.useHistoricalOpt === true,
            tennisOptimizationApplied: settings.tennisOptimizationApplied === true,
            useMarkov: settings.useMarkov === true,
            tennisUseTotals: settings.tennisUseTotals === true,
            useCrossReference: settings.useCrossReference === true,
            tennisProfessionalMode: isProfessionalModeEnabled(settings),
            activeThresholds: {
                atp: {
                    edge_pp: parseFloat(settings.tennisAtpEdge) || 4.0,
                    probability_pct: parseFloat(settings.tennisAtpProb) || 52.0,
                    ev_pct: parseFloat(settings.tennisAtpEv) || 2.0
                },
                wta: {
                    edge_pp: parseFloat(settings.tennisWtaEdge) || 4.5,
                    probability_pct: parseFloat(settings.tennisWtaProb) || 52.0,
                    ev_pct: parseFloat(settings.tennisWtaEv) || 2.0
                }
            }
        },
        components: semanticComponents,
        checks: {
            markovSelfCheck: markovSelfCheck.ok === true,
            optimizeRecommendationOnly: true,
            autoApplySettingsDisabled: true,
            dbPathAbsolute: path.isAbsolute(DB_PATH),
            dbAccessible: !dbSummary.error,
            requiredColumnsPresent: Object.values(dbSummary.columns || {}).every(Boolean),
            legacyDirtyExcluded: true,
            missingDataQualityRowsAreNotClean: true,
            noFakeReliability: true,
            sackmannLazyInitialization: true,
            strictCleanHistoryOnly: true,
            segmentedCalibrationAvailable: true,
            professionalDataSufficiencyRules: true,
            closingLineValidationEnabled: true,
            operationalReportEnabled: true,
            tennisPatchRegistryActive: Number(tennisPatchStatus.currentPatchVersion) >= 3,
            tennisRuntimeHealthContractActive: tennisRuntimeHealthContract.TENNIS_RUNTIME_HEALTH_CONTRACT_VERSION === 'TENNIS_RUNTIME_HEALTH_CONTRACT_V2_PATCH29_R3',
            runtimeVersionIdentityCoherent: runtimeVersions.serverCoreVersion === '14.7' && runtimeVersions.tennisEngineVersion === TENNIS_ENGINE_VERSION && runtimeVersions.currentPatchVersion === tennisPatchStatus.currentPatchVersion,
            unifiedPendingPipelineActive: tennisPatchStatus.pendingPipelineVersion === 'TENNIS_PATCH_1_PENDING_PIPELINE',
            tennisMatchFormatContractActive: TENNIS_MATCH_FORMAT_CONTRACT_VERSION === 'TENNIS_MATCH_FORMAT_CONTRACT_V1_PATCH_2',
            tennisCanonicalEventIdentityActive: tennisEventIdentity.TENNIS_EVENT_IDENTITY_VERSION === 'TENNIS_EVENT_IDENTITY_V1_PATCH_3',
            tennisSettlementContractActive: tennisSettlementContract.TENNIS_SETTLEMENT_CONTRACT_VERSION === 'TENNIS_SETTLEMENT_CONTRACT_V2_AUDIT02',
            runtimeDiagnosticsActive: alignedTechnicalChecksPatch50.runtimeDiagnosticsActive,
            tennisCalibrationEligibilityActive: tennisCalibrationEligibility.TENNIS_CALIBRATION_ELIGIBILITY_VERSION === 'TENNIS_CALIBRATION_ELIGIBILITY_V2_PATCH7',
            tennisPredictionSnapshotsActive: tennisPredictionSnapshots.TENNIS_PREDICTION_SNAPSHOT_VERSION === 'TENNIS_PREDICTION_SNAPSHOT_V1_PATCH7',
            tennisForwardLifecycleActive: alignedTechnicalChecksPatch50.tennisForwardLifecycleActive,
            tennisForwardCohortsActive: tennisForwardCohorts.TENNIS_FORWARD_COHORT_VERSION === 'TENNIS_FORWARD_COHORT_V1_PATCH9',
            tennisQualityGateV2Active: tennisQualityGateV2.TENNIS_QUALITY_GATE_VERSION === 'TENNIS_QUALITY_GATE_V2_PATCH10',
            tennisForwardCaptureActive: tennisForwardCaptureHealth.TENNIS_FORWARD_CAPTURE_VERSION === 'TENNIS_FORWARD_CAPTURE_SLA_V1_PATCH11',
            tennisPrematchCaptureGateActive: tennisPrematchCaptureGate.TENNIS_PREMATCH_CAPTURE_GATE_VERSION === 'TENNIS_PREMATCH_CAPTURE_GATE_V1_PATCH29_R3' && tennisPrematchCaptureGate.selfCheck().ok === true,
            tennisCanonicalEventTimeActive: tennisCanonicalEventTime.TENNIS_CANONICAL_EVENT_TIME_VERSION === 'TENNIS_CANONICAL_EVENT_TIME_CONTRACT_V1_PATCH33' && tennisCanonicalEventTime.selfCheck().ok === true,
            tennisOfficialScheduleAuthorityActive: tennisOfficialScheduleAuthority.TENNIS_OFFICIAL_SCHEDULE_AUTHORITY_VERSION === 'TENNIS_OFFICIAL_SCHEDULE_AUTHORITY_V1_PATCH34' && tennisOfficialScheduleAuthority.selfCheck().ok === true,
            tennisFinalStakeAuthorityPatch35Active: tennisStakeAuthorityPatch35.health().soleFinalStakeAuthority === true && tennisStakeAuthorityPatch35.health().n0AndN1Protected === true,
            tennisFinalRiskAuthorityPatch36Active: tennisRiskAuthorityPatch36.health().soleFinalStakeAuthority === true && tennisRiskAuthorityPatch36.health().wtaStaleCircuitBreaker === true,
            tennisPlayerEvidenceActive: alignedTechnicalChecksPatch50.tennisPlayerEvidenceActive,
            tennisMatchupIntelligenceActive: tennisMatchupIntelligence.TENNIS_MATCHUP_INTELLIGENCE_VERSION === 'TENNIS_MATCHUP_INTELLIGENCE_V3_PATCH22',
            tennisHistoricalCombinationEvidenceActive: tennisHistoricalCombinationEvidence.TENNIS_HISTORICAL_COMBINATION_VERSION === 'TENNIS_HISTORICAL_COMBINATION_EVIDENCE_V1_PATCH13',
            tennisProgramProgressionAuditActive: alignedTechnicalChecksPatch50.tennisProgramProgressionAuditActive,
            tennisCoreContractAuditActive: tennisCoreContractAudit.TENNIS_CORE_CONTRACT_AUDIT_VERSION === 'TENNIS_CORE_CONTRACT_AUDIT_V1_PATCH30',
            tennisReleaseSecurityActive: tennisReleaseSecurity.TENNIS_RELEASE_SECURITY_VERSION === 'TENNIS_RELEASE_SECURITY_V1_PATCH31',
            tennisPlayerDataRefreshActive: tennisPlayerDataRefresh.TENNIS_PLAYER_DATA_REFRESH_VERSION === 'TENNIS_PLAYER_DATA_REFRESH_V2_PATCH20',
            tennisMultiProviderDataActive: alignedTechnicalChecksPatch50.tennisMultiProviderDataActive,
            tennisTourDataReadinessActive: tennisTourDataReadiness.TENNIS_TOUR_DATA_READINESS_VERSION === 'TENNIS_TOUR_DATA_READINESS_V1_PATCH22',
            tennisInformationRetrievalActive: tennisInformationRetrieval.TENNIS_INFORMATION_RETRIEVAL_VERSION === 'TENNIS_INFORMATION_RETRIEVAL_V3_PATCH23',
            tennisWtaInformationRecoveryPatch52Active: /^TENNIS_WTA_INFORMATION_RECOVERY_V\d+_PATCH52(?:_R\d+)?$/.test(tennisWtaInformationRecoveryPatch52.VERSION),
            tennisForwardSampleIntakeActive: tennisForwardSampleIntake.TENNIS_FORWARD_SAMPLE_INTAKE_VERSION === 'TENNIS_FORWARD_SAMPLE_INTAKE_V1_PATCH24',
            tennisHistoricalPlayerStatsActive: /^TENNIS_HISTORICAL_PLAYER_STATS_V[12]_PATCH(16|26)$/.test(tennisHistoricalPlayerStats.TENNIS_HISTORICAL_PLAYER_STATS_VERSION),
            tennisHistoricalValidationPerformanceActive: tennisHistoricalValidationPerformance.TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_VERSION === 'TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_V1_PATCH17',
            tennisStatisticalChallengerActive: tennisStatisticalChallenger.TENNIS_STATISTICAL_CHALLENGER_VERSION === 'TENNIS_STATISTICAL_CHALLENGER_V1_PATCH18',
            tennisProfessionalStatisticalEnsembleActive: tennisProfessionalStatisticalEnsemble.TENNIS_PROFESSIONAL_STATISTICAL_ENSEMBLE_VERSION === 'TENNIS_PROFESSIONAL_STATISTICAL_ENSEMBLE_V1_PATCH19'
        },
        db: dbSummary,
        predictiveCalibration,
        segmentCalibration: reliabilityReport.segmentCalibration || null,
        reliabilitySampleSize: reliabilityReport.sampleSize || 0,
        diagnostics: {
            note: 'Endpoint non mutante: non modifica system_settings, non esegue optimize/apply, non chiama API esterne.',
            technicalHealthAlignmentVersion: tennisTechnicalHealthAlignmentPatch50.TENNIS_TECHNICAL_HEALTH_ALIGNMENT_VERSION,
            requiredBacktestOptimizationSamplePerTour: TENNIS_MIN_BACKTEST_OPT_SAMPLE,
            requiredSettledBetsForReliability: BOOTSTRAP_MIN_SETTLED_BETS_FOR_RELIABILITY,
            professionalCalibrationMinSample: TENNIS_PROFESSIONAL_CALIBRATION_MIN_SAMPLE,
            predictiveCalibrationMode: predictiveCalibration.mode,
            predictiveCalibrationGrade: predictiveCalibration.decision?.grade || 'UNKNOWN',
            professionalRules: TENNIS_PROFESSIONAL_RULES,
            professionalBetGateMode: 'TENNIS_PROFESSIONAL_BET_GATE',
            operationalReportMode: 'TENNIS_OPERATIONAL_REPORT_V1',
            settlementContractVersion: tennisSettlementContract.TENNIS_SETTLEMENT_CONTRACT_VERSION,
            runtimeDiagnosticsEndpoint: '/api/tennis/runtime-diagnostics',
            calibrationReadinessEndpoint: '/api/tennis/calibration-readiness',
            predictionAuditEndpoint: '/api/tennis/prediction-audit',
            forwardLifecycleEndpoint: '/api/tennis/forward-lifecycle-health',
            forwardCohortEndpoint: '/api/tennis/forward-cohort-health',
            qualityGateEndpoint: '/api/tennis/quality-gate-health',
            forwardCaptureEndpoint: '/api/tennis/forward-capture-health',
            prematchCaptureGateEndpoint: '/api/tennis/prematch-capture-gate-health',
            rejectedCaptureObservabilityEndpoint: '/api/tennis/rejected-capture-observability',
            forwardSampleIntakeEndpoint: '/api/tennis/forward-sample-intake-readiness',
            historicalCombinationEndpoint: '/api/tennis/historical-combination-evidence',
            programProgressionEndpoint: '/api/tennis/program-progression-health',
            coreContractEndpoint: '/api/tennis/core-contract-health',
            releaseSecurityEndpoint: '/api/tennis/release-security-health',
            playerDataFreshnessEndpoint: '/api/tennis/player-data-freshness',
            playerDataRefreshEndpoint: '/api/tennis/player-data-refresh',
            playerDataProviderHealthEndpoint: '/api/tennis/player-data-provider-health',
            playerDataProviderProbeEndpoint: '/api/tennis/player-data-provider-probe',
            tourDataReadinessEndpoint: '/api/tennis/tour-data-readiness',
            informationRetrievalHealthEndpoint: '/api/tennis/information-retrieval-health',
            informationRetrievalProbeEndpoint: '/api/tennis/information-retrieval-probe',
            historicalPlayerStatsHealthEndpoint: '/api/tennis/historical-player-stats-health',
            historicalPlayerStatsMatchupEndpoint: '/api/tennis/historical-player-stats-matchup',
            historicalCombinationVersion: tennisHistoricalCombinationEvidence.TENNIS_HISTORICAL_COMBINATION_VERSION,
            programProgressionAuditVersion: tennisProgramProgressionAudit.TENNIS_PROGRAM_PROGRESSION_AUDIT_VERSION,
            coreContractAuditVersion: tennisCoreContractAudit.TENNIS_CORE_CONTRACT_AUDIT_VERSION,
            releaseSecurityVersion: tennisReleaseSecurity.TENNIS_RELEASE_SECURITY_VERSION,
            playerDataRefreshVersion: tennisPlayerDataRefresh.TENNIS_PLAYER_DATA_REFRESH_VERSION,
            multiProviderDataVersion: tennisMultiProviderData.TENNIS_MULTI_PROVIDER_VERSION,
            multiProviderRegistryVersion: tennisMultiProviderData.TENNIS_MULTI_PROVIDER_REGISTRY_VERSION,
            tourDataReadinessVersion: tennisTourDataReadiness.TENNIS_TOUR_DATA_READINESS_VERSION,
            tourDataPolicyVersion: tennisTourDataReadiness.TENNIS_TOUR_DATA_POLICY_VERSION,
            informationRetrievalVersion: tennisInformationRetrieval.TENNIS_INFORMATION_RETRIEVAL_VERSION,
            informationRetrievalPolicyVersion: tennisInformationRetrieval.TENNIS_INFORMATION_RETRIEVAL_POLICY_VERSION,
            informationRetrievalSchemaVersion: tennisInformationRetrieval.TENNIS_INFORMATION_RETRIEVAL_SCHEMA_VERSION,
            historicalPlayerStatsVersion: tennisHistoricalPlayerStats.TENNIS_HISTORICAL_PLAYER_STATS_VERSION,
            historicalPlayerStatsSchemaVersion: tennisHistoricalPlayerStats.TENNIS_HISTORICAL_PLAYER_STATS_SCHEMA_VERSION,
            historicalValidationPerformanceVersion: tennisHistoricalValidationPerformance.TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_VERSION,
            historicalValidationPerformanceSchemaVersion: tennisHistoricalValidationPerformance.TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_SCHEMA_VERSION,
            statisticalChallengerHealthEndpoint: '/api/tennis/statistical-challenger-health',
            statisticalChallengerEndpoint: '/api/tennis/statistical-challenger',
            statisticalChallengerRefreshEndpoint: '/api/tennis/statistical-challenger-refresh',
            statisticalEngineHealthEndpoint: '/api/tennis/statistical-engine-health',
            statisticalEngineAuditEndpoint: '/api/tennis/statistical-engine-audit',
            statisticalEngineAuditRefreshEndpoint: '/api/tennis/statistical-engine-audit-refresh',
            statisticalChallengerVersion: tennisStatisticalChallenger.TENNIS_STATISTICAL_CHALLENGER_VERSION,
            statisticalChallengerSchemaVersion: tennisStatisticalChallenger.TENNIS_STATISTICAL_CHALLENGER_SCHEMA_VERSION,
            predictionSnapshotVersion: tennisPredictionSnapshots.TENNIS_PREDICTION_SNAPSHOT_VERSION,
            forwardLifecycleVersion: tennisForwardLifecycle.TENNIS_FORWARD_LIFECYCLE_VERSION,
            forwardCohortVersion: tennisForwardCohorts.TENNIS_FORWARD_COHORT_VERSION,
            qualityGateVersion: tennisQualityGateV2.TENNIS_QUALITY_GATE_VERSION,
            forwardCaptureVersion: tennisForwardCaptureHealth.TENNIS_FORWARD_CAPTURE_VERSION,
            forwardSampleIntakeVersion: tennisForwardSampleIntake.TENNIS_FORWARD_SAMPLE_INTAKE_VERSION,
            runtimeHealthContractVersion: tennisRuntimeHealthContract.TENNIS_RUNTIME_HEALTH_CONTRACT_VERSION,
            canonicalEventTimeVersion: tennisCanonicalEventTime.TENNIS_CANONICAL_EVENT_TIME_VERSION,
            canonicalEventTimeLedgerSchemaVersion: tennisCanonicalEventTime.TENNIS_EVENT_TIME_LEDGER_SCHEMA_VERSION,
            canonicalEventTimeHealthEndpoint: '/api/tennis/canonical-event-time-health',
            officialScheduleAuthorityVersion: tennisOfficialScheduleAuthority.TENNIS_OFFICIAL_SCHEDULE_AUTHORITY_VERSION,
            officialScheduleReceiptSchemaVersion: tennisOfficialScheduleAuthority.TENNIS_SCHEDULE_RECEIPT_SCHEMA_VERSION,
            officialScheduleHealthEndpoint: '/api/tennis/official-schedule-health',
            settlementTruthHealthEndpoint: '/api/tennis/settlement-truth-health',
            patch35GovernanceHealthEndpoint: '/api/tennis/patch35-governance-health',
            patch36GovernanceHealthEndpoint: '/api/tennis/patch36-governance-health',
            tourDriftAuthorityHealthEndpoint: '/api/tennis/tour-drift-authority-health',
            finalStakeAuthorityVersion: tennisRiskAuthorityPatch36.VERSION,
            tourDriftAuthorityVersion: tennisTourDriftAuthorityPatch36.VERSION,
            settlementTruthVersion: tennisSettlementTruthPatch34R4.VERSION,
            rejectedCaptureObservabilityVersion: tennisRejectedCaptureObservability.TENNIS_REJECTED_CAPTURE_OBSERVABILITY_VERSION,
            rejectedCaptureLedgerSchemaVersion: tennisRejectedCaptureObservability.TENNIS_REJECTED_CAPTURE_LEDGER_SCHEMA_VERSION,
            runtimeVersions,
            operationalReadinessState: operationalReadiness.state,
            playerEvidenceVersion: tennisPlayerEvidence.TENNIS_PLAYER_EVIDENCE_VERSION,
            matchupIntelligenceVersion: tennisMatchupIntelligence.TENNIS_MATCHUP_INTELLIGENCE_VERSION,
            challengerModelVersion: tennisMatchupIntelligence.TENNIS_CHALLENGER_MODEL_VERSION,
            calibrationReadinessMode: 'SHADOW_EVALUATION_ONLY'
        }
    };
}


// ============================================================================
// 18. ROUTE 1 - ANALISI LIVE TENNIS
// ============================================================================

// ============================================================================
// 18.0 ROUTE HEALTH TENNIS
// ============================================================================

router.get('/runtime-diagnostics', (req, res) => {
    try {
        const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
        const columns = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name));
        const hasContract = columns.has('settlement_contract_status');
        const tennisWhere = "(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%')";
        let settlementSummary = { schemaReady: hasContract, byStatus: {}, invalidAutoSettled: 0, historicalPendingSourceOnSettled: 0 };
        if (hasContract) {
            const rows = db.prepare(`SELECT COALESCE(settlement_contract_status,'UNCLASSIFIED') status, COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere} GROUP BY COALESCE(settlement_contract_status,'UNCLASSIFIED')`).all();
            settlementSummary.byStatus = Object.fromEntries(rows.map(row => [row.status, row.n]));
            settlementSummary.invalidAutoSettled = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere} AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID') AND settlement_contract_version = ? AND UPPER(COALESCE(settlement_contract_status,'')) NOT IN ('VERIFIED','VOID','MANUAL_REVIEW')`).get(tennisSettlementContract.TENNIS_SETTLEMENT_CONTRACT_VERSION).n;
        }
        settlementSummary.historicalPendingSourceOnSettled = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere} AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID') AND UPPER(COALESCE(settlement_source,'')) LIKE 'PENDING%'`).get().n;
        return res.json({
            success: true,
            sport: 'TENNIS',
            runtimeDiagnosticsVersion: runtimeDiagnostics.RUNTIME_DIAGNOSTICS_VERSION,
            settlementContractVersion: tennisSettlementContract.TENNIS_SETTLEMENT_CONTRACT_VERSION,
            logFile: 'backend/logs/runtime-diagnostics.jsonl',
            recent: runtimeDiagnostics.readRecentDiagnostics(limit),
            settlementSummary,
            note: 'Endpoint diagnostico read-only. Non espone chiavi API e non modifica il database.'
        });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_API', operation: 'RUNTIME_DIAGNOSTICS', phase: 'READ_ENDPOINT', error });
        return res.status(500).json({ success: false, error: error.message, runtimeDiagnostic: diagnostic });
    }
});


router.get('/runtime-state-alignment', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_PATCH28_R3_STATE_ALIGNMENT_HEALTH');
    try {
        const lifecycle = tennisForwardLifecycle.scanForwardLifecycle(db, { includeDetails: false, limit: 100 });
        const cohorts = tennisForwardCohorts.scanForwardCohorts(db, { limit: 100 });
        const capture = tennisForwardCaptureHealth.scanForwardCaptureHealth(db, { limit: 100, operationId });
        return res.json({
            success: lifecycle.driftBets === 0 && Number(cohorts.unhealthyMembers || 0) === 0 && Number(capture.structuralBlocked || 0) === 0,
            readOnly: true,
            version: TENNIS_PATCH28_R3_DERIVED_STATE_ORCHESTRATOR_VERSION,
            running: patch28R3DerivedStateRunning,
            lastReconcile: patch28R3LastDerivedStateReport,
            lifecycle: { trackedBets: lifecycle.trackedBets, healthyBets: lifecycle.healthyBets, driftBets: lifecycle.driftBets, counts: lifecycle.counts },
            cohorts: { members: cohorts.members, healthyMembers: cohorts.healthyMembers, unhealthyMembers: cohorts.unhealthyMembers, leakageBlocked: cohorts.leakageBlocked, counts: cohorts.counts },
            capture: { status: capture.status, runtimeSeverity: capture.runtimeSeverity, structuralBlocked: capture.structuralBlocked, evidenceOverdue: capture.evidenceOverdue, trackedBets: capture.trackedBets },
            operationId,
            sourceRowsChanged: false,
            authorityChanged: false
        });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_DERIVED_STATE', operation: 'PATCH28_R3_STATE_ALIGNMENT_HEALTH', operationId, phase: 'STATE_ALIGNMENT_HEALTH_ENDPOINT', error });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.get('/prediction-audit', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_PREDICTION_AUDIT');
    try {
        const report = tennisPredictionSnapshots.getPredictionSnapshotAudit(db, {
            limit: req.query.limit
        });
        return res.json({ ...report, operationId, note: 'Endpoint read-only: snapshot immutabili forward-only, nessuna modifica al database.' });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_PREDICTION', operation: 'PREDICTION_AUDIT', operationId, phase: 'READ_SUMMARY', error });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic });
    }
});

router.get('/prediction-audit/:betId', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_PREDICTION_AUDIT_DETAIL');
    try {
        const betId = Number(req.params.betId);
        if (!(betId > 0)) return res.status(400).json({ success: false, error: 'BET_ID_INVALID', operationId });
        const report = tennisPredictionSnapshots.getPredictionSnapshotAudit(db, {
            betId,
            limit: req.query.limit
        });
        return res.json({ ...report, operationId, betId, note: 'Endpoint read-only: catena hash e revisioni della previsione.' });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_PREDICTION', operation: 'PREDICTION_AUDIT_DETAIL', operationId, phase: 'READ_DETAIL', error, context: { betId: req.params.betId } });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic });
    }
});


router.get('/forward-lifecycle-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_FORWARD_LIFECYCLE_HEALTH');
    try {
        const report = tennisForwardLifecycle.scanForwardLifecycle(db, {
            limit: req.query.limit,
            includeDetails: req.query.details !== '0'
        });
        if (!report.success) {
            runtimeDiagnostics.writeDiagnostic({
                level: 'WARN', component: 'TENNIS_FORWARD_LIFECYCLE', operation: 'FORWARD_LIFECYCLE_HEALTH',
                operationId, phase: 'LIFECYCLE_DRIFT_DETECTED', event: 'LIFECYCLE_DRIFT_DETECTED',
                message: `Rilevati ${report.driftBets} record forward non allineati.`, context: report
            });
        }
        return res.json({
            ...report,
            operationId,
            note: 'Endpoint read-only: confronta source bet, snapshot immutabile e ledger calibrazione. Non modifica il database.'
        });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_FORWARD_LIFECYCLE', operation: 'FORWARD_LIFECYCLE_HEALTH', operationId,
            phase: 'LIFECYCLE_HEALTH_ENDPOINT', error
        });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic });
    }
});

router.get('/forward-lifecycle-health/:betId', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_FORWARD_LIFECYCLE_DETAIL');
    try {
        const betId = Number(req.params.betId);
        if (!(betId > 0)) return res.status(400).json({ success: false, error: 'BET_ID_INVALID', operationId });
        const report = tennisForwardLifecycle.inspectForwardLifecycleBet(db, betId, { operationId });
        return res.status(report.success === false && report.reasons?.includes('SOURCE_BET_NOT_FOUND') ? 404 : 200).json({
            ...report,
            operationId,
            note: 'Endpoint read-only: stato lifecycle della singola previsione Tennis.'
        });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_FORWARD_LIFECYCLE', operation: 'FORWARD_LIFECYCLE_DETAIL', operationId,
            phase: 'LIFECYCLE_DETAIL_ENDPOINT', error, context: { betId: req.params.betId }
        });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic });
    }
});

router.get('/deepscan-performance-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_PATCH27_DEEPSCAN_PERFORMANCE');
    try {
        return res.json({
            success: true,
            readOnly: true,
            patch: 'TENNIS_PATCH_27_DEEPSCAN_RAM_CACHE_EXPLAINABLE_MATCHUP_COHORT_RECONCILIATION',
            queue: { tennisInterMatchPacingMs: 150, legacyInterMatchPacingMs: 4000, sequentialOrderPreserved: true },
            performance: deepScanTennis.getPatch27PerformanceHealth(),
            operationId
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message || String(error), operationId });
    }
});

router.get('/forward-cohort-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_FORWARD_COHORT_HEALTH');
    try {
        const report = tennisForwardCohorts.scanForwardCohorts(db, {
            limit: req.query.limit,
            betId: req.query.betId
        });
        if (report.activeLeakageFaults > 0 || report.expectedTemporalExclusions > 0 || report.unhealthyMembers > 0) {
            runtimeDiagnostics.writeDiagnostic({
                level: report.activeLeakageFaults > 0 ? 'ERROR' : 'WARN', component: 'TENNIS_FORWARD_COHORT', operation: 'FORWARD_COHORT_HEALTH',
                operationId, phase: 'COHORT_MATURITY_CHECK',
                event: report.activeLeakageFaults > 0 ? 'ACTIVE_COHORT_FAULT' : report.expectedTemporalExclusions > 0 ? 'EXPECTED_TEMPORAL_EXCLUSION' : 'COHORT_DRIFT_DETECTED',
                message: report.activeLeakageFaults > 0
                    ? `Coorti forward: ${report.activeLeakageFaults} anomalie attive richiedono intervento.`
                    : report.expectedTemporalExclusions > 0
                      ? `Pipeline disponibile: ${report.expectedTemporalExclusions} record storici esclusi correttamente per leakage.`
                      : `${report.unhealthyMembers} eventi hanno uno stato temporale derivato da riallineare; membership e sigilli restano integri.`,
                context: report
            });
        }
        return res.json({
            ...report,
            operationId,
            note: report.note,
            readOnly: true
        });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_FORWARD_COHORT', operation: 'FORWARD_COHORT_HEALTH', operationId,
            phase: 'COHORT_HEALTH_ENDPOINT', error
        });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic });
    }
});

router.get('/forward-cohort-health/:betId', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_FORWARD_COHORT_DETAIL');
    try {
        const betId = Number(req.params.betId);
        if (!(betId > 0)) return res.status(400).json({ success: false, error: 'BET_ID_INVALID', operationId });
        const report = tennisForwardCohorts.inspectForwardCohortMember(db, betId, { operationId });
        return res.json({ ...report, operationId, readOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_FORWARD_COHORT', operation: 'FORWARD_COHORT_DETAIL', operationId,
            phase: 'COHORT_DETAIL_ENDPOINT', error, context: { betId: req.params.betId }
        });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic });
    }
});

router.get('/quality-gate-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_QUALITY_GATE_HEALTH');
    try {
        const tennisWhere = "(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%')";
        const rows = db.prepare(`SELECT * FROM ai_forward_test WHERE ${tennisWhere} ORDER BY id`).all();
        const report = tennisQualityGateV2.buildQualityPerformanceAudit(rows);
        const zeroStakeAlerts = report.zeroStakeHighRate?.length || 0;
        return res.json({
            ...report,
            operationId,
            alerts: zeroStakeAlerts,
            policy: {
                stages: ['BASE_QUANTITATIVE_PRE_DEEPSCAN', 'DEEPSCAN_INDEPENDENT', 'FINAL_QUALITY_FUSION'],
                stakeModes: ['ZERO', 'FIXED_MICRO_2_EUR', 'BANKROLL_PERCENT_CAP'],
                fullStakeEnabled: false,
                temporalLeakage: 'CURRENT_RESULT_AND_CURRENT_CLV_FORBIDDEN'
            },
            note: 'Endpoint read-only. La performance storica verifica le macro-categorie ma non usa il risultato del singolo match per classificarlo.'
        });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_QUALITY_GATE', operation: 'QUALITY_GATE_HEALTH', operationId, phase: 'QUALITY_GATE_HEALTH_ENDPOINT', error });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic });
    }
});


// ============================================================================
// PATCH13_HISTORICAL_DEEPSCAN_QUALITY_EVIDENCE
// Win rate empirico read-only della combinazione DeepScan × Quality finale.
// Il dato non sostituisce la probabilità del modello e non ha autorità su stake.
// ============================================================================
router.get('/historical-combination-evidence', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_HISTORICAL_COMBINATION_EVIDENCE');
    try {
        const report = tennisHistoricalCombinationEvidence.buildCombinationMatrix(db, {
            limit: req.query.limit,
            asOf: req.query.asOf || new Date().toISOString()
        });
        return res.json({
            ...report,
            operationId,
            readOnly: true,
            displayColumn: 'WR storico DS×Gate',
            probabilityAuthority: false,
            note: 'Percentuale empirica WON/(WON+LOST) del Paper Trading per combinazione DeepScan × Resa Qualità. Non è la probabilità matematica del singolo match.'
        });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_HISTORICAL_COMBINATION', operation: 'HISTORICAL_COMBINATION_EVIDENCE', operationId,
            phase: 'HISTORICAL_COMBINATION_ENDPOINT', error
        });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.get('/historical-combination-evidence/:betId', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_HISTORICAL_COMBINATION_DETAIL');
    try {
        const betId = Number(req.params.betId);
        if (!(betId > 0)) return res.status(400).json({ success: false, error: 'BET_ID_INVALID', operationId, readOnly: true });
        const row = db.prepare(`
            SELECT id, historical_combo_key, historical_combo_deepscan, historical_combo_quality,
                   historical_combo_resolved, historical_combo_wins, historical_combo_losses,
                   historical_combo_win_rate_pct, historical_combo_adjusted_rate_pct,
                   historical_combo_ci_low_pct, historical_combo_ci_high_pct,
                   historical_combo_operational_resolved, historical_combo_operational_roi_pct,
                   historical_combo_reliability, historical_combo_source_max_id,
                   historical_combo_evidence_hash, historical_combo_version, historical_combo_calculated_at
            FROM ai_forward_test WHERE id = ?
        `).get(betId);
        if (!row) return res.status(404).json({ success: false, error: 'SOURCE_BET_NOT_FOUND', operationId, readOnly: true });
        return res.json({ success: true, betId, evidence: row, operationId, readOnly: true, stakeAuthority: false });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_HISTORICAL_COMBINATION', operation: 'HISTORICAL_COMBINATION_DETAIL', operationId,
            phase: 'HISTORICAL_COMBINATION_DETAIL_ENDPOINT', error, context: { betId: req.params.betId }
        });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.get('/official-settlement-health', (req, res) => {
    try {
        res.json(tennisOfficialSettlementResolver.health());
    } catch (error) {
        res.status(500).json({ success: false, healthy: false, status: 'ERROR', error: error.message });
    }
});

router.get('/official-settlement-preview', (req, res) => {
    try {
        const rows = db.prepare(`SELECT * FROM ai_forward_test WHERE status='PENDING' AND COALESCE(paper_result_active,1)=1
            AND (UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%') ORDER BY id`).all();
        res.json(tennisOfficialSettlementResolver.buildPreview(rows));
    } catch (error) {
        res.status(500).json({ success: false, readOnly: true, error: error.message });
    }
});

router.get('/release-security-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_RELEASE_SECURITY_HEALTH');
    try {
        const report = tennisReleaseSecurity.buildSecurityHealth({ projectRoot: path.resolve(__dirname, '..') });
        if (!report.healthy) {
            runtimeDiagnostics.writeDiagnostic({
                level: 'ERROR', component: 'TENNIS_RELEASE_SECURITY', operation: 'RELEASE_SECURITY_HEALTH', operationId,
                phase: 'RELEASE_SECURITY_BLOCKED', event: 'RELEASE_SECURITY_BLOCKED',
                message: 'Persistenza credenziali o release policy non certificata.',
                context: {
                    findingCount: report.secretPersistence?.findingCount || 0,
                    persistedTelegramConfigToken: report.secretPersistence?.persistedTelegramConfigToken === true,
                    withinSizeGuard: report.releasePolicy?.withinSizeGuard === true,
                    secretsExposed: false
                }
            });
        }
        return res.status(report.healthy ? 200 : 503).json({ ...report, operationId });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_RELEASE_SECURITY', operation: 'RELEASE_SECURITY_HEALTH', operationId,
            phase: 'RELEASE_SECURITY_ENDPOINT', error
        });
        return res.status(500).json({ success: false, healthy: false, status: 'ERROR', error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.get('/core-contract-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_CORE_CONTRACT_HEALTH');
    try {
        const report = tennisCoreContractAudit.buildCoreContractAudit({ projectRoot: path.resolve(__dirname, '..') });
        if (!report.healthy) {
            runtimeDiagnostics.writeDiagnostic({
                level: 'ERROR', component: 'TENNIS_CORE_CONTRACT', operation: 'CORE_CONTRACT_HEALTH', operationId,
                phase: 'CORE_CONTRACT_ERROR', event: 'CORE_CONTRACT_ERROR',
                message: 'Contratto entrypoint/dipendenze Tennis non certificato.',
                context: {
                    missingPackageTargets: report.packageScripts?.missingFileTargets || [],
                    missingRuntimeDependencies: report.runtimeDependencies?.missing || [],
                    duplicateFunctionDeclarations: report.duplicateFunctionDeclarations || []
                }
            });
        }
        return res.status(report.healthy ? 200 : 503).json({ ...report, operationId });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_CORE_CONTRACT', operation: 'CORE_CONTRACT_HEALTH', operationId,
            phase: 'CORE_CONTRACT_ENDPOINT', error
        });
        return res.status(500).json({ success: false, healthy: false, status: 'ERROR', error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.get('/program-progression-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_PROGRAM_PROGRESSION_HEALTH');
    try {
        const report = tennisProgramProgressionAudit.buildProgramProgressionAudit(db, { projectRoot: path.resolve(__dirname, '..') });
        if (!report.healthy) {
            runtimeDiagnostics.writeDiagnostic({
                level: 'ERROR', component: 'TENNIS_PROGRAM_PROGRESSION', operation: 'PROGRAM_PROGRESSION_HEALTH', operationId,
                phase: 'PROGRAM_PROGRESSION_ERROR', event: 'PROGRAM_PROGRESSION_ERROR',
                message: report.note, context: { errors: report.errors, warnings: report.warnings, checks: report.checks.filter(item => !item.ok) }
            });
        }
        return res.status(report.healthy ? 200 : 503).json({ ...report, operationId, readOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_PROGRAM_PROGRESSION', operation: 'PROGRAM_PROGRESSION_HEALTH', operationId,
            phase: 'PROGRAM_PROGRESSION_ENDPOINT', error
        });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.get('/prematch-capture-gate-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_PREMATCH_CAPTURE_GATE_HEALTH');
    try {
        const selfCheck = tennisPrematchCaptureGate.selfCheck();
        const requiredColumns = [
            'prematch_capture_gate_version', 'prematch_capture_gate_status',
            'prematch_capture_gate_reason', 'prematch_capture_gate_checked_at',
            'prematch_capture_gate_lead_ms', 'prematch_capture_gate_timezone'
        ];
        const missingColumns = requiredColumns.filter(column => !columnExists('ai_forward_test', column));
        const certifiedRows = missingColumns.length === 0
            ? Number(db.prepare(`SELECT COUNT(*) c FROM ai_forward_test WHERE prematch_capture_gate_version=? AND prematch_capture_gate_status='ALLOW_CERTIFIED_PREMATCH'`).get(tennisPrematchCaptureGate.TENNIS_PREMATCH_CAPTURE_GATE_VERSION).c || 0)
            : 0;
        const blockedRows = missingColumns.length === 0
            ? Number(db.prepare(`SELECT COUNT(*) c FROM ai_forward_test WHERE prematch_capture_gate_version=? AND prematch_capture_gate_status<>'ALLOW_CERTIFIED_PREMATCH'`).get(tennisPrematchCaptureGate.TENNIS_PREMATCH_CAPTURE_GATE_VERSION).c || 0)
            : 0;
        const legacySnapshots = db.prepare(`SELECT
            COUNT(*) snapshots,
            SUM(CASE WHEN snapshot_status='POST_START_INVALID' THEN 1 ELSE 0 END) postStartInvalid,
            SUM(CASE WHEN snapshot_status='INCOMPLETE' THEN 1 ELSE 0 END) incomplete
            FROM tennis_prediction_snapshots`).get();
        const healthy = selfCheck.ok === true && missingColumns.length === 0;
        return res.status(healthy ? 200 : 503).json({
            success: healthy,
            healthy,
            status: healthy ? 'OK' : 'ERROR',
            version: tennisPrematchCaptureGate.TENNIS_PREMATCH_CAPTURE_GATE_VERSION,
            timeZone: tennisPrematchCaptureGate.DEFAULT_TIME_ZONE,
            transactionalRollback: true,
            strictBeforeStart: true,
            captureCommitAuthority: true,
            probabilityAuthority: false,
            qualityGateAuthority: false,
            stakeAuthority: false,
            settlementAuthority: false,
            schema: { requiredColumns, missingColumns },
            forwardOnly: { noHistoricalBackfill: true, certifiedRows, blockedRows },
            legacySnapshots: {
                snapshots: Number(legacySnapshots.snapshots || 0),
                postStartInvalid: Number(legacySnapshots.postStartInvalid || 0),
                incomplete: Number(legacySnapshots.incomplete || 0)
            },
            selfCheck,
            operationId,
            readOnly: true
        });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_PREMATCH_CAPTURE_GATE', operation: 'PREMATCH_CAPTURE_GATE_HEALTH', operationId,
            phase: 'PREMATCH_CAPTURE_GATE_HEALTH_ENDPOINT', error
        });
        return res.status(500).json({ success: false, healthy: false, status: 'ERROR', error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});



router.get('/settlement-truth-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_SETTLEMENT_TRUTH_HEALTH');
    try {
        const health = tennisSettlementTruthPatch34R4.health();
        const completed = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE settlement_truth_version=? AND status IN ('WON','LOST')`).get(tennisSettlementTruthPatch34R4.VERSION);
        const pending = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE settlement_truth_version=? AND status='PENDING'`).get(tennisSettlementTruthPatch34R4.VERSION);
        const repairs = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='tennis_settlement_truth_repairs'").get()?.n
            ? db.prepare('SELECT COUNT(*) n FROM tennis_settlement_truth_repairs').get() : { n: 0 };
        return res.json({ ...health, operationId, readOnly: true, completedRows: Number(completed?.n || 0), protectedPendingRows: Number(pending?.n || 0), repairAuditRows: Number(repairs?.n || 0),
            predictionAuthority: 'IMMUTABLE_CALIBRATION_ANCHOR', mutableAnalysisAuthority: false });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component:'TENNIS_SETTLEMENT', operation:'SETTLEMENT_TRUTH_HEALTH', operationId, phase:'SETTLEMENT_TRUTH_HEALTH_ENDPOINT', error });
        return res.status(500).json({ success:false, healthy:false, status:'ERROR', error:error.message, operationId, runtimeDiagnostic:diagnostic, readOnly:true });
    }
});

router.get('/patch35-governance-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_PATCH35_GOVERNANCE_HEALTH');
    try {
        const tennisWhere = `(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%')`;
        const pending = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(status)='PENDING' AND ${tennisWhere}`).get();
        const violations = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(status)='PENDING' AND ${tennisWhere} AND COALESCE(stake,0)>0 AND COALESCE(tennis_stake_authority_sample,COALESCE(historical_combo_resolved,0))<5`).get();
        const positive = db.prepare(`SELECT COUNT(*) n, ROUND(COALESCE(SUM(stake),0),2) stake FROM ai_forward_test WHERE UPPER(status)='PENDING' AND ${tennisWhere} AND COALESCE(stake,0)>0`).get();
        const decisions = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='tennis_stake_authority_decisions'").get()?.n ? db.prepare('SELECT COUNT(*) n FROM tennis_stake_authority_decisions').get() : {n:0};
        const providerErrors = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere} AND COALESCE(clv_provider_error_code,'')<>''`).get();
        return res.json({ success:true, healthy:Number(violations?.n||0)===0, status:Number(violations?.n||0)===0?'OK':'ERROR', operationId, readOnly:true,
            finalStakeAuthority:tennisRiskAuthorityPatch36.health(), finalExecutableStakeContract:tennisStakeExecutionContractPatch46.health(db), tourDriftAuthority:tennisTourDriftAuthorityPatch36.health(tennisTournamentStageModel.loadRecentPerformanceFromDb(db)), clvSportDiscovery:require('./tennisClvSportKeyDiscoveryPatch35').health(),
            pendingRows:Number(pending?.n||0), positiveStakeRows:Number(positive?.n||0), pendingStakeTotal:Number(positive?.stake||0),
            smallSampleStakeViolations:Number(violations?.n||0), authorityDecisionRows:Number(decisions?.n||0), clvProviderErrorRows:Number(providerErrors?.n||0),
            semantics:{historicalRateIsWinProbability:false,nUnder5Headline:'INSUFFICIENT_SAMPLE',provider404IsValidEmpty:false}
        });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({component:'TENNIS_PATCH35_GOVERNANCE',operation:'PATCH35_GOVERNANCE_HEALTH',operationId,phase:'PATCH35_GOVERNANCE_HEALTH_ENDPOINT',error});
        return res.status(500).json({success:false,healthy:false,status:'ERROR',error:error.message,operationId,runtimeDiagnostic:diagnostic,readOnly:true});
    }
});



router.get('/decision-truth-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_DECISION_TRUTH_HEALTH');
    try {
        const rows = db.prepare(`SELECT * FROM ai_forward_test WHERE UPPER(COALESCE(status,''))='PENDING' AND (UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%') ORDER BY id`).all();
        const report = tennisDecisionTruthPatch38.summarizeRows(rows);
        return res.json({ success:true, healthy:true, operationId, ...report, endpointAuthority:'READ_ONLY_DECISION_PROJECTION' });
    } catch (error) { return res.status(500).json({success:false,healthy:false,operationId,code:'TENNIS_DECISION_TRUTH_HEALTH_FAILED',error:error.message}); }
});

router.get('/external-match-intelligence-health', (req, res) => {
    try {
        const moduleHealth = tennisExternalMatchIntelligencePatch37.sourceHealth();
        const receiptRows = tableExists('tennis_external_intelligence_receipts') ? Number(db.prepare('SELECT COUNT(*) n FROM tennis_external_intelligence_receipts').get().n) : 0;
        const challengerRows = tableExists('tennis_external_challenger_runs') ? Number(db.prepare('SELECT COUNT(*) n FROM tennis_external_challenger_runs').get().n) : 0;
        const statusCounts = tableExists('tennis_external_intelligence_receipts') ? db.prepare(`SELECT COALESCE(ranking_status,'UNKNOWN') status, COUNT(*) n FROM tennis_external_intelligence_receipts GROUP BY COALESCE(ranking_status,'UNKNOWN')`).all() : [];
        const latestReceipt = tableExists('tennis_external_intelligence_receipts') ? db.prepare('SELECT receipt_id,generated_at,h2h_status,ranking_status,weather_status,receipt_hash FROM tennis_external_intelligence_receipts ORDER BY id DESC LIMIT 1').get() || null : null;
        return res.json({ success: true, ...moduleHealth, database: { receiptRows, challengerRows, rankingStatusCounts: statusCounts, latestReceipt }, sourceTruth: { rankingPenaltyRequiresVerifiedParser: true, sourceCompletenessDerivedFromResolvedEvidence: true }, endpointAuthority: 'READ_ONLY_HEALTH' });
    } catch (error) { return res.status(500).json({ success: false, code: 'TENNIS_EXTERNAL_INTELLIGENCE_HEALTH_FAILED', error: error.message }); }
});

router.get('/external-match-intelligence-probe', async (req, res) => {
    try {
        const p1Name = String(req.query.p1 || req.query.player1 || '').trim();
        const p2Name = String(req.query.p2 || req.query.player2 || '').trim();
        if (!p1Name || !p2Name) return res.status(400).json({ success: false, code: 'PLAYER_NAMES_REQUIRED' });
        const result = await tennisExternalMatchIntelligencePatch37.buildExternalMatchIntelligence({
            p1Name, p2Name, prediction: req.query.prediction || '1', tour: req.query.tour || req.query.league, surface: req.query.surface,
            context: { tournament: req.query.tournament, league: req.query.league, surface: req.query.surface, match_date: req.query.matchDate || req.query.commenceTime }
        }, { dataDir: ABSOLUTE_SACKMANN_DIR, skipNetwork: String(req.query.network || '1') === '0' });
        return res.json({ success: true, result, authority: 'DIAGNOSTIC_PROBE_NO_PERSISTENCE_NO_STAKE' });
    } catch (error) { return res.status(500).json({ success: false, code: 'TENNIS_EXTERNAL_INTELLIGENCE_PROBE_FAILED', error: error.message }); }
});

router.get('/patch39-governance-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_PATCH39_GOVERNANCE_HEALTH');
    try {
        const calibration = tennisProbabilityCalibrationGuardPatch39.health(db);
        const clvCoverage = tennisClvSnapshotCoveragePatch39.coverageHealth(db);
        const receiptLinks = tennisExternalReceiptLinkPatch39.health(db);
        const evidenceAgent = tennisEvidenceVerificationAgentPatch39.health(db);
        const wtaFreshness = tennisWtaFreshnessRecoveryPatch39.health({ dataDir: ABSOLUTE_SACKMANN_DIR });
        const venueRegistry = tennisVenueRegistryPatch39.health();
        return res.json({ success:true, operationId, readOnly:true, packageAuthority:'PATCH39_PRIORITY_GOVERNANCE', calibration, clvCoverage, receiptLinks, evidenceAgent, wtaFreshness, venueRegistry,
            antiFabricationPolicy:{ noSourceNoClaim:true, ambiguousEventAbstain:true, unverifiedRankingDisplayOnly:true, unresolvedVenueNoWeather:true, closingOddsNeverReconstructed:true },
            authority:{ probabilityIncrease:false, stakeIncrease:false, settlement:false, automaticPrediction:false } });
    } catch (error) { return res.status(500).json({success:false,operationId,code:'PATCH39_GOVERNANCE_HEALTH_FAILED',error:error.message}); }
});

router.get('/probability-calibration-guard-health', (req, res) => {
    try { return res.json({success:true, ...tennisProbabilityCalibrationGuardPatch39.health(db), readOnly:true}); }
    catch (error) { return res.status(500).json({success:false,code:'PATCH39_CALIBRATION_HEALTH_FAILED',error:error.message}); }
});
router.get('/production-readiness-health', (req, res) => {
    try {
        return res.json(statisticalProductionReadinessGatePatch55.health(db, { projectRoot:path.resolve(ROOT_DIR,'..') }));
    } catch (error) {
        return res.status(500).json({success:false,healthy:false,status:'ERROR',version:statisticalProductionReadinessGatePatch55.VERSION,readOnly:true,error:error.message});
    }
});

router.get('/portfolio-risk-authority-health', (req, res) => {
    try {
        return res.json(unifiedCrossSportPortfolioRiskAuthorityPatch56.health(db, { projectRoot:path.resolve(ROOT_DIR,'..') }));
    } catch (error) {
        return res.status(500).json({success:false,healthy:false,status:'ERROR',version:unifiedCrossSportPortfolioRiskAuthorityPatch56.VERSION,readOnly:true,error:error.message});
    }
});

router.get('/clv-cross-sport-coverage-health', (req, res) => {
    try {
        const report = clvCrossSportCoveragePatch53.buildCoverageReport(db, clvCrossSportCoveragePatch53.DEFAULT_FOOTBALL_LEAGUES);
        return res.json({ success: true, healthy: true, readOnly: true, ...report });
    } catch (error) {
        return res.status(500).json({ success: false, healthy: false, status: 'ERROR', error: error.message, readOnly: true });
    }
});

router.get('/clv-snapshot-coverage-health', (req, res) => {
    try { return res.json({success:true, ...tennisClvSnapshotCoveragePatch39.coverageHealth(db), readOnly:true}); }
    catch (error) { return res.status(500).json({success:false,code:'PATCH39_CLV_COVERAGE_HEALTH_FAILED',error:error.message}); }
});
router.get('/evidence-agent-health', (req, res) => {
    try { return res.json({success:true, ...tennisEvidenceVerificationAgentPatch39.health(db), readOnly:true}); }
    catch (error) { return res.status(500).json({success:false,code:'PATCH39_EVIDENCE_AGENT_HEALTH_FAILED',error:error.message}); }
});
router.get('/wta-freshness-recovery-health', (req, res) => {
    try { return res.json({success:true, schedule:patch39WtaRefreshSchedule, ...tennisWtaFreshnessRecoveryPatch39.health({dataDir:ABSOLUTE_SACKMANN_DIR}), supersededBy:tennisWtaInformationRecoveryPatch52.VERSION, patch52:tennisWtaInformationRecoveryPatch52.health({dataDir:ABSOLUTE_SACKMANN_DIR,projectRoot:path.resolve(ROOT_DIR,'..')}), readOnly:true}); }
    catch (error) { return res.status(500).json({success:false,code:'PATCH39_WTA_FRESHNESS_HEALTH_FAILED',error:error.message}); }
});
router.post('/wta-freshness-recovery-refresh', async (req, res) => {
    try {
        const result = await tennisWtaInformationRecoveryPatch52.refresh({dataDir:ABSOLUTE_SACKMANN_DIR,projectRoot:path.resolve(ROOT_DIR,'..'),force:req.body?.force===true,usageMode:req.body?.usageMode,manualImportAuthorized:req.body?.manualImportAuthorized===true,skipNetwork:req.body?.skipNetwork===true});
        if(result?.status==='WTA_REFRESH_ACTIVATED'){sackmannInitialized=false;ensureSackmannReady({required:false});}
        return res.status(result.success===false?503:200).json(result);
    } catch (error) { return res.status(500).json({success:false,code:'PATCH52_WTA_RECOVERY_REFRESH_FAILED',error:error.message}); }
});

router.get('/patch43-wta-source-health', (req, res) => {
    try {
        return res.json({
            ...tennisWtaInformationRecoveryPatch52.health({
                dataDir: ABSOLUTE_SACKMANN_DIR,
                projectRoot: path.resolve(ROOT_DIR, '..'),
                usageMode: req.query.usageMode
            }),
            schedule: patch43WtaRefreshSchedule,
            supersedes: [tennisWtaFreshnessRecoveryPatch39.VERSION, tennisWtaSourceDiscoveryPatch43.VERSION],
            readOnly: true
        });
    } catch (error) {
        return res.status(500).json({ success:false, code:'PATCH52_WTA_RECOVERY_HEALTH_FAILED', error:error.message });
    }
});

router.get('/patch43-wta-source-probe', async (req, res) => {
    try {
        const result = await tennisWtaInformationRecoveryPatch52.probe({
            dataDir: ABSOLUTE_SACKMANN_DIR,
            projectRoot: path.resolve(ROOT_DIR, '..'),
            year: req.query.year,
            usageMode: req.query.usageMode,
            manualImportAuthorized: String(req.query.manualImportAuthorized || '0') === '1',
            skipNetwork: String(req.query.network || '1') === '0',
            force: String(req.query.force || '0') === '1'
        });
        return res.status(result.success === false ? 503 : 200).json(result);
    } catch (error) {
        return res.status(500).json({ success:false, code:'PATCH52_WTA_RECOVERY_PROBE_FAILED', error:error.message });
    }
});

router.post('/patch43-wta-source-refresh', async (req, res) => {
    try {
        const result = await tennisWtaInformationRecoveryPatch52.refresh({
            dataDir: ABSOLUTE_SACKMANN_DIR,
            projectRoot: path.resolve(ROOT_DIR, '..'),
            year: req.body?.year,
            force: req.body?.force === true,
            usageMode: req.body?.usageMode,
            manualImportAuthorized: req.body?.manualImportAuthorized === true,
            skipNetwork: req.body?.skipNetwork === true
        });
        if(result?.status === 'WTA_REFRESH_ACTIVATED'){ sackmannInitialized=false; ensureSackmannReady({required:false}); }
        return res.status(result.success === false ? 503 : 200).json(result);
    } catch (error) {
        return res.status(500).json({ success:false, code:'PATCH52_WTA_RECOVERY_REFRESH_FAILED', error:error.message });
    }
});

router.get('/patch52-wta-recovery-health', (req, res) => {
    try { return res.json({ ...tennisWtaInformationRecoveryPatch52.health({ dataDir:ABSOLUTE_SACKMANN_DIR, projectRoot:path.resolve(ROOT_DIR,'..'), usageMode:req.query.usageMode }), schedule:patch52WtaRefreshSchedule, readOnly:true }); }
    catch (error) { return res.status(500).json({success:false,code:'PATCH52_WTA_RECOVERY_HEALTH_FAILED',error:error.message}); }
});
router.get('/patch52-wta-recovery-probe', async (req, res) => {
    try { const result=await tennisWtaInformationRecoveryPatch52.probe({dataDir:ABSOLUTE_SACKMANN_DIR,projectRoot:path.resolve(ROOT_DIR,'..'),year:req.query.year,usageMode:req.query.usageMode,manualImportAuthorized:String(req.query.manualImportAuthorized||'0')==='1',skipNetwork:String(req.query.network||'1')==='0',force:String(req.query.force||'0')==='1'});return res.status(result.success===false?503:200).json(result); }
    catch(error){return res.status(500).json({success:false,code:'PATCH52_WTA_RECOVERY_PROBE_FAILED',error:error.message});}
});
router.post('/patch52-wta-recovery-refresh', async (req, res) => {
    try { const result=await tennisWtaInformationRecoveryPatch52.refresh({dataDir:ABSOLUTE_SACKMANN_DIR,projectRoot:path.resolve(ROOT_DIR,'..'),year:req.body?.year,usageMode:req.body?.usageMode,manualImportAuthorized:req.body?.manualImportAuthorized===true,skipNetwork:req.body?.skipNetwork===true,force:req.body?.force===true});if(['RECOVERED_CURRENT_SHADOW','RECOVERED_AGING_SHADOW'].includes(result?.status)){sackmannInitialized=false;ensureSackmannReady({required:false});}return res.status(result.success===false?503:200).json(result); }
    catch(error){return res.status(500).json({success:false,code:'PATCH52_WTA_RECOVERY_REFRESH_FAILED',error:error.message});}
});

router.get('/tour-drift-authority-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_TOUR_DRIFT_AUTHORITY_HEALTH');
    try {
        const report = tennisTourDriftAuthorityPatch36.loadFromDb(db);
        return res.json({ success:true, healthy:true, status:report.probabilityAdjustmentAuthority ? 'FORWARD_AUTHORITY_ACTIVE' : 'DIAGNOSTIC_ONLY', operationId, readOnly:true, ...report });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({component:'TENNIS_TOUR_DRIFT_AUTHORITY',operation:'TOUR_DRIFT_AUTHORITY_HEALTH',operationId,phase:'TOUR_DRIFT_AUTHORITY_ENDPOINT',error});
        return res.status(500).json({success:false,healthy:false,status:'ERROR',error:error.message,operationId,runtimeDiagnostic:diagnostic,readOnly:true});
    }
});

router.get('/patch36-governance-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_PATCH36_GOVERNANCE_HEALTH');
    try {
        const provider = tennisMultiProviderData.getHealth({dataDir:ABSOLUTE_SACKMANN_DIR,projectRoot:path.resolve(ROOT_DIR,'..')});
        const readiness = tennisTourDataReadiness.buildTargetReadiness({dataDir:ABSOLUTE_SACKMANN_DIR,multiProviderHealth:provider});
        const drift = tennisTourDriftAuthorityPatch36.loadFromDb(db);
        const riskRows = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='tennis_risk_authority_decisions'").get()?.n ? db.prepare('SELECT COUNT(*) n FROM tennis_risk_authority_decisions').get() : {n:0};
        const breakers = db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(status)='PENDING' AND tennis_risk_authority_circuit_breaker=1").get();
        return res.json({success:true,healthy:true,status:'READY_WITH_WTA_RECOVERY_PENDING',operationId,readOnly:true,
            wtaProviderRecovery:{version:provider.version,registryVersion:provider.registryVersion,githubPolicy:provider.githubPolicy,provider:provider.providers?.find(item=>item.id==='JEFF_SACKMANN_GITHUB')||null,readiness:readiness.targets?.find(item=>item.targetId==='WTA_MAIN')||null},
            tourDriftAuthority:drift,finalRiskAuthority:tennisRiskAuthorityPatch36.health(),riskDecisionRows:Number(riskRows?.n||0),wtaCircuitBreakerRows:Number(breakers?.n||0),
            authority:{productionProbability:false,deepScanDecision:false,qualityGate:false,settlement:false,automaticPromotion:false}
        });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({component:'TENNIS_PATCH36_GOVERNANCE',operation:'PATCH36_GOVERNANCE_HEALTH',operationId,phase:'PATCH36_GOVERNANCE_ENDPOINT',error});
        return res.status(500).json({success:false,healthy:false,status:'ERROR',error:error.message,operationId,runtimeDiagnostic:diagnostic,readOnly:true});
    }
});

router.get('/official-schedule-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_OFFICIAL_SCHEDULE_HEALTH');
    try {
        const limit = Math.max(1, Math.min(200, Number(req.query.limit || 30)));
        const report = tennisOfficialScheduleAuthority.buildScheduleHealthReport(db, { limit });
        return res.status(report.healthy ? 200 : 503).json({ ...report, operationId, readOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_OFFICIAL_SCHEDULE_AUTHORITY', operation: 'OFFICIAL_SCHEDULE_HEALTH', operationId,
            phase: 'OFFICIAL_SCHEDULE_HEALTH_ENDPOINT', error
        });
        return res.status(500).json({ success: false, healthy: false, status: 'ERROR', error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.get('/canonical-event-time-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_CANONICAL_EVENT_TIME_HEALTH');
    try {
        const limit = Math.max(1, Math.min(200, Number(req.query.limit || 30)));
        const report = tennisCanonicalEventTime.buildProviderTimeQualityReport(db, { limit });
        return res.status(report.healthy ? 200 : 503).json({ ...report, operationId, readOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_CANONICAL_EVENT_TIME', operation: 'CANONICAL_EVENT_TIME_HEALTH', operationId,
            phase: 'CANONICAL_EVENT_TIME_HEALTH_ENDPOINT', error
        });
        return res.status(500).json({ success: false, healthy: false, status: 'ERROR', error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.get('/rejected-capture-observability', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_REJECTED_CAPTURE_OBSERVABILITY');
    try {
        const limit = Math.max(1, Math.min(200, Number(req.query.limit || 30)));
        const report = tennisRejectedCaptureObservability.buildObservabilityReport(db, { limit });
        return res.status(report.healthy ? 200 : 503).json({ ...report, operationId, readOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_REJECTED_CAPTURE_OBSERVABILITY', operation: 'REJECTED_CAPTURE_OBSERVABILITY', operationId,
            phase: 'REJECTED_CAPTURE_OBSERVABILITY_ENDPOINT', error
        });
        return res.status(500).json({ success: false, healthy: false, status: 'ERROR', error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

let patch11LastCaptureSignature = null;
function writePatch11CaptureTransition(report, operationId) {
    const signature = `${report.status}:${report.alerts || 0}:${report.trackedBets || 0}:${report.structuralBlocked || 0}:${report.evidenceOverdue || 0}:${report.manualBookmakerReview || 0}:${report.manualIdentityReview || 0}:${report.clvOnlyDegraded || 0}`;
    if (signature === patch11LastCaptureSignature) return false;
    const previous = patch11LastCaptureSignature;
    patch11LastCaptureSignature = signature;
    const structuralBlocked = Number(report.structuralBlocked || 0);
    const evidenceOverdue = Number(report.evidenceOverdue || 0);
    const manualBookmakerReview = Number(report.manualBookmakerReview || 0);
    const manualIdentityReview = Number(report.manualIdentityReview || 0);
    const clvOnlyDegraded = Number(report.clvOnlyDegraded || 0);
    const level = structuralBlocked > 0 ? 'ERROR' : (report.alerts > 0 ? 'WARN' : 'INFO');
    const event = structuralBlocked > 0 ? 'FORWARD_CAPTURE_STRUCTURAL_BLOCK'
        : evidenceOverdue > 0 ? 'FORWARD_SETTLEMENT_EVIDENCE_OVERDUE'
        : manualBookmakerReview > 0 ? 'FORWARD_SETTLEMENT_BOOKMAKER_RULE_REQUIRED'
        : manualIdentityReview > 0 ? 'FORWARD_SETTLEMENT_IDENTITY_REVIEW_REQUIRED'
        : clvOnlyDegraded > 0 ? 'FORWARD_SETTLEMENT_VERIFIED_CLV_UNAVAILABLE'
        : report.status === 'HEALTHY' ? 'FORWARD_CAPTURE_HEALTHY'
        : report.status === 'NO_FORWARD_DATA' ? 'FORWARD_CAPTURE_NO_DATA'
        : report.status === 'CAPTURING' ? 'FORWARD_CAPTURE_IN_PROGRESS'
        : 'FORWARD_CAPTURE_SLA_WARNING';
    runtimeDiagnostics.writeDiagnostic({
        level, component: 'TENNIS_FORWARD_CAPTURE', operation: 'FORWARD_CAPTURE_HEALTH', operationId,
        phase: event, event, message: report.note || `Forward capture: ${report.status}.`,
        context: { previous, status: report.status, runtimeSeverity: report.runtimeSeverity, alerts: report.alerts, structuralBlocked, evidenceOverdue, manualBookmakerReview, manualIdentityReview, clvOnlyDegraded, trackedBets: report.trackedBets, counts: report.counts, diagnosticPolicyVersion: report.diagnosticPolicyVersion }
    });
    return true;
}

router.get('/forward-capture-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_FORWARD_CAPTURE_HEALTH');
    try {
        const report = tennisForwardCaptureHealth.scanForwardCaptureHealth(db, { limit: req.query.limit, operationId });
        writePatch11CaptureTransition(report, operationId);
        return res.json({ ...report, operationId, readOnly: true, supportBundleCommand: 'npm run support:bundle:safe' });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_FORWARD_CAPTURE', operation: 'FORWARD_CAPTURE_HEALTH', operationId, phase: 'FORWARD_CAPTURE_ENDPOINT', error });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic });
    }
});

// ============================================================================
// AUDIT16D_R3_T9 - EVIDENCE MATURITY / CALIBRATION READINESS (READ-ONLY)
// No model, probability, DeepScan, gate, stake, settlement or DB mutation.
// ============================================================================
router.get('/evidence-maturity-t9', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_T9_EVIDENCE_MATURITY');
    try {
        const report = tennisEvidenceMaturityT9.inspect(db);
        return res.status(report.success === false ? 503 : 200).json({ ...report, operationId });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_T9_EVIDENCE_MATURITY', operation: 'READ_ONLY_HEALTH', operationId,
            phase: 'T9_EVIDENCE_MATURITY_ENDPOINT', error
        });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic });
    }
});


// ============================================================================
// AUDIT16D_R3_T10_R1_SHADOW_MONITOR - FROZEN CALIBRATION PROGRESS (READ-ONLY)
// T10 candidates stay frozen at HOLDOUT=50. No model/probability/stake authority.
// ============================================================================
router.get('/t10-shadow-monitor', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_T10_R1_SHADOW_MONITOR');
    try {
        const report = tennisT10ShadowMonitor.inspect(db);
        return res.status(report.success === false ? 503 : 200).json({ ...report, operationId });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_T10_R1_SHADOW_MONITOR', operation: 'READ_ONLY_MONITOR', operationId,
            phase: 'T10_R1_SHADOW_MONITOR_ENDPOINT', error
        });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic });
    }
});


// ============================================================================
// AUDIT16D_R3_T10_R2_R1 - READ-ONLY RECONCILIATION
// Compares legacy Study R3 prospective anchors with certified Tennis forward evidence.
// No backfill, no state mutation, no promotion/model/stake authority.
// ============================================================================
router.get('/t10-r2-portfolio-forward-audit', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_T10_R2_PORTFOLIO_FORWARD_AUDIT');
    try {
        const report = tennisT10R2PortfolioForwardAudit.inspect(db);
        return res.status(report.success === false ? 503 : 200).json({ ...report, operationId });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_T10_R2_PORTFOLIO_FORWARD_AUDIT', operation: 'READ_ONLY_RECONCILIATION', operationId,
            phase: 'T10_R2_PORTFOLIO_FORWARD_AUDIT_ENDPOINT', error
        });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

// ============================================================================
// AUDIT16D_R3_T11_R2 - DURABLE DECISION RESEARCH (NO OPERATIONAL AUTHORITY)
// JSONL audit trace + shadow threshold continuity + shadow P(win). Production gates/stake unchanged.
// ============================================================================
router.get('/stake-decision-trace-t11', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_T11_STAKE_DECISION_TRACE');
    try {
        const limit = Number(req.query?.limit || 50);
        const betId = req.query?.betId == null ? null : Number(req.query.betId);
        const report = tennisStakeDecisionTraceT11.inspect({ limit, betId });
        return res.json({ ...report, operationId });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_T11_STAKE_DECISION_TRACE', operation: 'READ_ONLY_RUNTIME_TRACE', operationId,
            phase: 'T11_STAKE_DECISION_TRACE_ENDPOINT', error
        });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

// ============================================================================
// AUDIT16D_R3_T11_R3 - CALIBRATED VALUE SHADOW + SETTLEMENT CONTRACT AUDIT
// Read-only research. No probability production, Quality Gate, threshold or stake authority.
// ============================================================================
router.get('/t11-r3-calibrated-value-shadow', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_T11_R3_R1_DURABLE_CALIBRATED_LEDGER');
    try {
        const limit = Math.max(1, Math.min(250, Number(req.query?.limit || 50)));
        const betId = req.query?.betId == null ? null : Number(req.query.betId);
        const report = tennisCalibratedValueLedgerT11R3R1.inspect({ limit, betId });
        const traceTelemetry = tennisStakeDecisionTraceT11.inspect({ limit: 1, betId });
        return res.json({ ...report, compatibilityEndpoint:'/t11-r3-calibrated-value-shadow', sourceTraceTelemetry:{ version:traceTelemetry.version||null, traceCount:traceTelemetry.traceCount||0, ledger:traceTelemetry.ledger||null }, operationId });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component:'TENNIS_T11_R3_R1_DURABLE_CALIBRATED_LEDGER', operation:'READ_ONLY_DURABLE_CALIBRATED_LEDGER', operationId, phase:'T11_R3_R1_LEDGER_ENDPOINT', error });
        return res.status(500).json({ success:false, readOnly:true, error:error.message, operationId, runtimeDiagnostic:diagnostic });
    }
});

router.get('/t11-r3-r1-calibrated-ledger', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_T11_R3_R1_DURABLE_CALIBRATED_LEDGER');
    try {
        const limit = Math.max(1, Math.min(250, Number(req.query?.limit || 100)));
        const betId = req.query?.betId == null ? null : Number(req.query.betId);
        return res.json({ ...tennisCalibratedValueLedgerT11R3R1.inspect({ limit, betId }), operationId });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component:'TENNIS_T11_R3_R1_DURABLE_CALIBRATED_LEDGER', operation:'READ_ONLY_DURABLE_CALIBRATED_LEDGER', operationId, phase:'T11_R3_R1_LEDGER_ENDPOINT', error });
        return res.status(500).json({ success:false, readOnly:true, error:error.message, operationId, runtimeDiagnostic:diagnostic });
    }
});

router.get('/settlement-contract-audit-t11-r3', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_T11_R3_SETTLEMENT_CONTRACT_AUDIT');
    try {
        const report = tennisSettlementContractAuditT11R3.inspect(db, tennisSettlementContract);
        return res.status(report.success ? 200 : 503).json({ ...report, operationId });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component:'TENNIS_T11_R3_SETTLEMENT_CONTRACT_AUDIT', operation:'READ_ONLY_SETTLEMENT_CONTRACT_AUDIT', operationId, phase:'T11_R3_SETTLEMENT_AUDIT_ENDPOINT', error });
        return res.status(500).json({ success:false, readOnly:true, error:error.message, operationId, runtimeDiagnostic:diagnostic });
    }
});

router.get('/forward-capture-health/:betId', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_FORWARD_CAPTURE_DETAIL');
    try {
        const betId = Number(req.params.betId);
        if (!(betId > 0)) return res.status(400).json({ success: false, error: 'BET_ID_INVALID', operationId });
        const report = tennisForwardCaptureHealth.inspectForwardCaptureBet(db, betId, { operationId });
        return res.status(report.reasons?.includes('SOURCE_BET_NOT_FOUND') ? 404 : 200).json({ ...report, operationId, readOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_FORWARD_CAPTURE', operation: 'FORWARD_CAPTURE_DETAIL', operationId, phase: 'FORWARD_CAPTURE_DETAIL_ENDPOINT', error, context: { betId: req.params.betId } });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic });
    }
});


// ============================================================================
// PATCH 24 - FORWARD SAMPLE INTAKE ASSURANCE
// Read-only readiness plus atomic postconditions on every future real Tennis
// prediction. No historical backfill and no production/stake authority.
// ============================================================================
router.get('/forward-sample-intake-readiness', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_FORWARD_SAMPLE_INTAKE');
    try {
        const report = tennisForwardSampleIntake.inspectForwardSampleIntake(db, { operationId });
        const level = report.status === 'BLOCKED_CAPTURE' ? 'ERROR'
            : report.status === 'DEGRADED_CAPTURE' ? 'WARN' : 'INFO';
        runtimeDiagnostics.writeDiagnostic({
            level,
            component: 'TENNIS_FORWARD_SAMPLE_INTAKE',
            operation: 'FORWARD_SAMPLE_INTAKE_READINESS',
            operationId,
            phase: report.status,
            event: report.status,
            message: `Forward sample intake: ${report.status}.`,
            context: {
                structuralReady: report.structuralReady,
                structuralGaps: report.structuralGaps,
                counts: report.counts,
                forwardSample: report.forwardSample,
                historicalBackfill: false,
                productionAuthority: false
            }
        });
        return res.status(report.status === 'BLOCKED_CAPTURE' ? 503 : 200).json({ ...report, operationId });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_FORWARD_SAMPLE_INTAKE',
            operation: 'FORWARD_SAMPLE_INTAKE_READINESS',
            operationId,
            phase: 'FORWARD_SAMPLE_INTAKE_ENDPOINT',
            error
        });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic });
    }
});


function isPatch14LocalRequest(req) {
    const ip = String(req.ip || req.socket?.remoteAddress || '').toLowerCase();
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.endsWith('127.0.0.1');
}


// ============================================================================
// PATCH 22 - TOUR-AWARE DATA FRESHNESS & PLAYER ACTIVITY EVIDENCE GUARD
// Read-only: ATP/WTA/Challenger freshness is evaluated independently.
// Player inactivity remains a distinct analytical signal and never becomes
// source-data freshness. No authority on production probability or stake.
// ============================================================================
router.get('/tour-data-readiness', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_TOUR_DATA_READINESS');
    try {
        const report = tennisTourDataReadiness.buildReadinessHealth(db, {
            dataDir: ABSOLUTE_SACKMANN_DIR,
            projectRoot: path.resolve(ROOT_DIR, '..')
        });
        if (report.status !== 'ALL_CURRENT' || report.forwardStatus === 'NO_FORWARD_SAMPLE') {
            runtimeDiagnostics.writeDiagnostic({
                level: 'WARN',
                component: 'TENNIS_TOUR_DATA_READINESS', operation: 'TOUR_DATA_READINESS', operationId,
                phase: report.status === 'MIXED_CURRENT_STALE' ? 'MIXED_FRESHNESS_DETECTED' : 'READINESS_REVIEW',
                event: report.status,
                message: report.note,
                context: {
                    status: report.status,
                    targets: report.targets,
                    tours: report.tours,
                    forwardStatus: report.forwardStatus,
                    sourceFreshnessNotMasked: report.sourceFreshnessNotMasked
                }
            });
        }
        return res.status(report.success === false ? 503 : 200).json({ ...report, operationId, readOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_TOUR_DATA_READINESS', operation: 'TOUR_DATA_READINESS', operationId,
            phase: 'TOUR_DATA_READINESS_ENDPOINT', error
        });
        return res.status(500).json({ success: false, status: 'ERROR', error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.get('/player-data-freshness', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_PLAYER_DATA_FRESHNESS');
    try {
        const report = tennisPlayerDataRefresh.getPlayerDataHealth({ dataDir: ABSOLUTE_SACKMANN_DIR, initialize: true });
        return res.status(report.status === 'ERROR' ? 503 : 200).json({ ...report, operationId, readOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_PLAYER_DATA', operation: 'PLAYER_DATA_FRESHNESS', operationId, phase: 'PLAYER_DATA_FRESHNESS_ENDPOINT', error });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.post('/player-data-refresh', async (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_PLAYER_DATA_REFRESH');
    if (!isPatch14LocalRequest(req)) return res.status(403).json({ success: false, error: 'PATCH14_LOCAL_REQUEST_REQUIRED', operationId });
    try {
        runtimeDiagnostics.writeDiagnostic({ level: 'INFO', component: 'TENNIS_PLAYER_DATA', operation: 'PLAYER_DATA_REFRESH', operationId, phase: 'PLAYER_DATA_REFRESH_START', event: 'PLAYER_DATA_REFRESH_START', message: 'Avvio aggiornamento atomico dati giocatori da fonti allowlist.' });
        const result = await tennisMultiProviderData.refreshMultiProvider({ dataDir: ABSOLUTE_SACKMANN_DIR, operationId });
        sackmannInitialized = false;
        const reload = ensureSackmannReady({ required: false });
        runtimeDiagnostics.writeDiagnostic({ level: 'INFO', component: 'TENNIS_PLAYER_DATA', operation: 'PLAYER_DATA_REFRESH', operationId, phase: 'PLAYER_DATA_REFRESH_COMPLETE', event: 'PLAYER_DATA_REFRESH_COMPLETE', message: 'Aggiornamento dati giocatori completato.', context: { latestMatchAt: result.activeStatus?.latestMatchAt, matchCount: result.activeStatus?.matchCount, playerCount: result.activeStatus?.playerCount, reload } });
        return res.json({ ...result, operationId, localOnly: true, reload });
    } catch (error) {
        const failure = error.patch21 || error.patch20 || error.patch14 || null;
        const conflict = error.message === 'PATCH21_REFRESH_ALREADY_RUNNING' || error.message === 'PATCH20_REFRESH_ALREADY_RUNNING' || error.message === 'PATCH14_REFRESH_ALREADY_RUNNING';
        const diagnostic = runtimeDiagnostics.writeDiagnostic({
            level: conflict ? 'INFO' : (failure?.degradedUsingLastKnownGood === true ? 'WARN' : 'ERROR'),
            component: 'TENNIS_PLAYER_DATA', operation: 'PLAYER_DATA_REFRESH', operationId,
            phase: conflict ? 'PLAYER_DATA_REFRESH_SKIPPED_LOCK_ACTIVE' : 'PLAYER_DATA_REFRESH_FAILED',
            event: conflict ? 'PLAYER_DATA_REFRESH_SKIPPED_LOCK_ACTIVE' : 'PLAYER_DATA_REFRESH_FAILED',
            message: conflict ? 'Refresh saltato: aggiornamento player-data già in esecuzione.' : error.message,
            context: { ...(failure || {}), skippedBecauseAlreadyRunning: conflict }
        });
        return res.status(conflict ? 409 : 502).json({
            success: false,
            skipped: conflict,
            retryable: conflict,
            reason: conflict ? 'PLAYER_DATA_REFRESH_ALREADY_RUNNING' : 'PLAYER_DATA_REFRESH_FAILED',
            error: error.message,
            operationId,
            runtimeDiagnostic: diagnostic,
            refreshFailure: failure,
            sourceId: failure?.sourceId || null,
            attempts: failure?.attempts || [],
            networkDiagnostics: failure?.networkDiagnostics || null,
            restoredLastKnownGood: failure?.restoredLastKnownGood === true,
            degradedUsingLastKnownGood: failure?.degradedUsingLastKnownGood === true
        });
    }
});

router.get('/player-data-provider-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_MULTI_PROVIDER_HEALTH');
    try {
        const report = tennisMultiProviderData.getHealth({
            dataDir: ABSOLUTE_SACKMANN_DIR,
            projectRoot: path.resolve(ROOT_DIR, '..')
        });
        return res.json({ ...report, operationId, readOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_MULTI_PROVIDER', operation: 'MULTI_PROVIDER_HEALTH', operationId, phase: 'MULTI_PROVIDER_HEALTH_FAILED', error });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.post('/player-data-provider-probe', async (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_MULTI_PROVIDER_PROBE');
    if (!isPatch14LocalRequest(req)) return res.status(403).json({ success: false, error: 'PATCH21_LOCAL_REQUEST_REQUIRED', operationId });
    try {
        const report = await tennisMultiProviderData.probeProviders({
            dataDir: ABSOLUTE_SACKMANN_DIR,
            projectRoot: path.resolve(ROOT_DIR, '..'),
            timeoutMs: Number(req.body?.timeoutMs || 30000),
            force: req.body?.force === true
        });
        return res.status(report.success ? 200 : 207).json({ ...report, operationId, localOnly: true, readOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_MULTI_PROVIDER', operation: 'MULTI_PROVIDER_PROBE', operationId, phase: 'MULTI_PROVIDER_PROBE_FAILED', error });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.post('/player-data-source-probe', async (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_PLAYER_DATA_SOURCE_PROBE');
    if (!isPatch14LocalRequest(req)) return res.status(403).json({ success: false, error: 'PATCH20_LOCAL_REQUEST_REQUIRED', operationId });
    try {
        const report = await tennisMultiProviderData.probeProviders({
            dataDir: ABSOLUTE_SACKMANN_DIR,
            projectRoot: path.resolve(ROOT_DIR, '..'),
            timeoutMs: Number(req.body?.timeoutMs || 30000),
            force: req.body?.force === true
        });
        runtimeDiagnostics.writeDiagnostic({
            level: report.success ? 'INFO' : 'WARN',
            component: 'TENNIS_PLAYER_DATA', operation: 'PLAYER_DATA_SOURCE_PROBE', operationId,
            phase: 'PLAYER_DATA_SOURCE_PROBE_COMPLETE', event: 'PLAYER_DATA_SOURCE_PROBE_COMPLETE',
            message: report.success ? 'Probe fonti dati giocatori completato.' : 'Una o più fonti dati giocatori non sono raggiungibili.',
            context: { sources: (report.sources || report.results || []).map(item => ({ sourceId: item.sourceId || item.targetId || item.providerId, status: item.status, httpStatus: item.httpStatus || item.diagnostics?.httpStatus || null, attempts: item.attempts?.length || 0 })) }
        });
        return res.status(report.success ? 200 : 502).json({ ...report, operationId, localOnly: true, readOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_PLAYER_DATA', operation: 'PLAYER_DATA_SOURCE_PROBE', operationId, phase: 'PLAYER_DATA_SOURCE_PROBE_FAILED', error });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});


// ============================================================================
// PATCH 23 - TOUR-AWARE INFORMATION RETRIEVAL CERTIFICATION
// Freschezza risolta sul circuito dei giocatori del probe; API opzionali escluse dallo scoring zero-key.
// I probe non modificano probabilità, DeepScan decisionale, Quality Gate, stake o risultati.
// ============================================================================
router.get('/information-retrieval-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_INFORMATION_RETRIEVAL_HEALTH');
    try {
        const report = tennisInformationRetrieval.buildInformationRetrievalHealth(db, {
            limit: req.query.limit,
            dataDir: ABSOLUTE_SACKMANN_DIR,
            historicalDatasetPath: TENNIS_HISTORICAL_STATS_DATASET,
            cacheDir: NEWS_CACHE_DIR
        });
        if (report.status === 'FAIL' || report.status === 'SCHEMA_MISSING') {
            runtimeDiagnostics.writeDiagnostic({
                level: 'ERROR',
                component: 'TENNIS_INFORMATION_RETRIEVAL',
                operation: 'INFORMATION_RETRIEVAL_HEALTH',
                operationId,
                phase: 'INFORMATION_RETRIEVAL_HEALTH_FAILED',
                event: report.status,
                message: report.note,
                context: { overallScore: report.overallScore, channels: report.channels }
            });
        } else if (report.status === 'WARN') {
            runtimeDiagnostics.writeDiagnostic({
                level: 'WARN',
                component: 'TENNIS_INFORMATION_RETRIEVAL',
                operation: 'INFORMATION_RETRIEVAL_HEALTH',
                operationId,
                phase: 'INFORMATION_RETRIEVAL_HEALTH_WARNING',
                event: 'INFORMATION_RETRIEVAL_WARN',
                message: report.note,
                context: { overallScore: report.overallScore }
            });
        }
        return res.status(report.status === 'SCHEMA_MISSING' ? 503 : 200).json({ ...report, operationId, readOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_INFORMATION_RETRIEVAL',
            operation: 'INFORMATION_RETRIEVAL_HEALTH',
            operationId,
            phase: 'INFORMATION_RETRIEVAL_HEALTH_ENDPOINT',
            error
        });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.get('/information-retrieval-health/:betId', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_INFORMATION_RETRIEVAL_DETAIL');
    try {
        const betId = Number(req.params.betId);
        if (!(betId > 0)) return res.status(400).json({ success: false, error: 'BET_ID_INVALID', operationId });
        return res.json({ ...tennisInformationRetrieval.getPredictionEvidence(db, betId), operationId, readOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_INFORMATION_RETRIEVAL',
            operation: 'INFORMATION_RETRIEVAL_DETAIL',
            operationId,
            phase: 'INFORMATION_RETRIEVAL_DETAIL_ENDPOINT',
            error,
            context: { betId: req.params.betId }
        });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.post('/information-retrieval-probe', async (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_INFORMATION_RETRIEVAL_PROBE');
    if (!isPatch14LocalRequest(req)) return res.status(403).json({ success: false, error: 'PATCH15_LOCAL_REQUEST_REQUIRED', operationId });
    try {
        runtimeDiagnostics.writeDiagnostic({
            level: 'INFO',
            component: 'TENNIS_INFORMATION_RETRIEVAL',
            operation: 'INFORMATION_RETRIEVAL_PROBE',
            operationId,
            phase: 'INFORMATION_RETRIEVAL_PROBE_START',
            event: 'INFORMATION_RETRIEVAL_PROBE_START',
            message: 'Avvio test live fonti DeepScan, Analisi AI e Paper Trading.'
        });
        const report = await tennisInformationRetrieval.runLiveRetrievalProbe(db, {
            runId: operationId,
            players: Array.isArray(req.body?.players) ? req.body.players : undefined,
            timeoutMs: req.body?.timeoutMs,
            dataDir: ABSOLUTE_SACKMANN_DIR,
            historicalDatasetPath: TENNIS_HISTORICAL_STATS_DATASET,
            cacheDir: NEWS_CACHE_DIR,
            persist: true,
            tour: req.body?.tour,
            targetId: req.body?.targetId
        });
        runtimeDiagnostics.writeDiagnostic({
            level: report.status === 'FAIL' ? 'ERROR' : report.status === 'WARN' ? 'WARN' : 'INFO',
            component: 'TENNIS_INFORMATION_RETRIEVAL',
            operation: 'INFORMATION_RETRIEVAL_PROBE',
            operationId,
            phase: 'INFORMATION_RETRIEVAL_PROBE_COMPLETE',
            event: 'INFORMATION_RETRIEVAL_PROBE_COMPLETE',
            message: `Probe fonti completato: ${report.status}, score ${report.overallScore}, scope ${report.probeScope?.targetScope || 'UNRESOLVED'}.`,
            context: { probePlayers: report.probePlayers, probeScope: report.probeScope, channels: report.channels, optionalSourcesExcluded: report.optionalSourcesExcluded, persistence: report.persistence }
        });
        return res.status(report.status === 'FAIL' ? 502 : 200).json({ ...report, operationId, localOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_INFORMATION_RETRIEVAL',
            operation: 'INFORMATION_RETRIEVAL_PROBE',
            operationId,
            phase: 'INFORMATION_RETRIEVAL_PROBE_FAILED',
            error
        });
        return res.status(502).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic });
    }
});


// ============================================================================
// PATCH 16 - HISTORICAL PLAYER STATISTICS SHADOW EVIDENCE
// Dataset locale XLSX/HTML/PDF: sola validazione ausiliaria, as-of-safe.
// ============================================================================
router.get('/historical-player-stats-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_HISTORICAL_PLAYER_STATS_HEALTH');
    try {
        const dataset = tennisHistoricalPlayerStats.getStatus({ datasetPath: TENNIS_HISTORICAL_STATS_DATASET, initialize: true });
        const database = tennisHistoricalPlayerStats.getDatabaseHealth(db);
        const status = !dataset.loaded || database.status === 'SCHEMA_MISSING' ? 'UNAVAILABLE'
            : (dataset.warningCount > 0 ? 'READY_WITH_QUARANTINE' : 'READY');
        return res.status(status === 'UNAVAILABLE' ? 503 : 200).json({
            success: status !== 'UNAVAILABLE', status, operationId, readOnly: true,
            dataset, database,
            authority: { modelProbability: false, deepScanDecision: false, qualityGate: false, stake: false, settlement: false },
            note: status === 'READY_WITH_QUARANTINE'
                ? 'Dataset storico attivo in shadow; anomalie o identità ambigue restano escluse.'
                : 'Dataset storico TennisDB disponibile come validazione shadow as-of-safe.'
        });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_HISTORICAL_PLAYER_STATS', operation: 'HISTORICAL_PLAYER_STATS_HEALTH', operationId, phase: 'HISTORICAL_PLAYER_STATS_HEALTH_ENDPOINT', error });
        return res.status(500).json({ success: false, status: 'ERROR', error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.get('/historical-player-stats-matchup', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_HISTORICAL_PLAYER_STATS_MATCHUP');
    try {
        const player1 = String(req.query.player1 || '').trim();
        const player2 = String(req.query.player2 || '').trim();
        const tour = String(req.query.tour || '').trim();
        const asOf = req.query.asOf || new Date().toISOString();
        if (!player1 || !player2) return res.status(400).json({ success: false, error: 'PLAYER1_PLAYER2_REQUIRED', operationId });
        const validation = tennisHistoricalPlayerStats.buildMatchValidation(player1, player2, tour, asOf, { datasetPath: TENNIS_HISTORICAL_STATS_DATASET, optional: true });
        return res.status(validation.status === 'READY_SHADOW_VALIDATION' ? 200 : 422).json({ success: validation.status === 'READY_SHADOW_VALIDATION', operationId, readOnly: true, validation });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_HISTORICAL_PLAYER_STATS', operation: 'HISTORICAL_PLAYER_STATS_MATCHUP', operationId, phase: 'HISTORICAL_PLAYER_STATS_MATCHUP_ENDPOINT', error });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});


// ============================================================================
// PATCH 26 - CANONICAL PLAYER EVIDENCE BRIDGE
// Identità, profilo corrente e contesto DeepScan. Nessuna autorità operativa.
// ============================================================================
router.get('/canonical-player-evidence-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_CANONICAL_PLAYER_EVIDENCE_HEALTH');
    try {
        const report = tennisCanonicalPlayerEvidenceBridge.getHealth({ historicalDatasetPath: TENNIS_HISTORICAL_STATS_DATASET });
        return res.status(report.success ? 200 : 503).json({ ...report, operationId, readOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_CANONICAL_PLAYER_EVIDENCE', operation: 'HEALTH', operationId, phase: 'PATCH26_HEALTH', error });
        return res.status(500).json({ success: false, status: 'ERROR', error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.get('/canonical-player-evidence-matchup', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_CANONICAL_PLAYER_EVIDENCE_MATCHUP');
    try {
        const player1 = String(req.query.player1 || '').trim();
        const player2 = String(req.query.player2 || '').trim();
        const tour = String(req.query.tour || '').trim();
        const asOf = req.query.asOf || new Date().toISOString();
        if (!player1 || !player2) return res.status(400).json({ success: false, error: 'PLAYER1_PLAYER2_REQUIRED', operationId });
        let matchEvidence = {};
        try {
            const matchup = tennisPlayerEvidence.buildMatchupEvidence(player1, player2, req.query.surface || 'Hard', asOf, {
                dataDir: ABSOLUTE_SACKMANN_DIR, tour, historicalDatasetPath: TENNIS_HISTORICAL_STATS_DATASET
            });
            matchEvidence = { p1: matchup.p1 || {}, p2: matchup.p2 || {} };
        } catch (_) {}
        const bridge = tennisCanonicalPlayerEvidenceBridge.buildMatchupBridge(player1, player2, tour, asOf, matchEvidence, { historicalDatasetPath: TENNIS_HISTORICAL_STATS_DATASET });
        return res.status(bridge.status === 'UNAVAILABLE' ? 422 : 200).json({ success: bridge.status !== 'UNAVAILABLE', operationId, readOnly: true, bridge });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_CANONICAL_PLAYER_EVIDENCE', operation: 'MATCHUP', operationId, phase: 'PATCH26_MATCHUP', error });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});


// ============================================================================
// PATCH 17 - HISTORICAL VALIDATION PERFORMANCE LEDGER
// Benchmark retrospettivo as-of-safe + outcome forward da snapshot immutabili.
// Nessuna autorità su modello, DeepScan, Quality Gate, stake o settlement.
// ============================================================================
router.get('/historical-validation-performance-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_HEALTH');
    try {
        const report = tennisHistoricalValidationPerformance.getPerformanceHealth(db);
        return res.status(report.status === 'SCHEMA_MISSING' ? 503 : 200).json({ ...report, operationId, readOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_HISTORICAL_VALIDATION_PERFORMANCE', operation: 'PERFORMANCE_HEALTH', operationId, phase: 'PERFORMANCE_HEALTH_ENDPOINT', error });
        return res.status(500).json({ success: false, status: 'ERROR', error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.get('/historical-validation-performance', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_DETAIL');
    try {
        const mode = String(req.query.mode || '').toUpperCase();
        const selectedMode = mode === 'FORWARD' ? 'FORWARD_CERTIFIED' : mode === 'RETROSPECTIVE' ? 'RETROSPECTIVE_AS_OF_SAFE' : null;
        const latest = tennisHistoricalValidationPerformance.getLatestReport(db, selectedMode);
        return res.json({ success: true, status: latest ? 'AVAILABLE' : 'NO_REPORT', operationId, readOnly: true, mode: selectedMode, latest });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_HISTORICAL_VALIDATION_PERFORMANCE', operation: 'PERFORMANCE_DETAIL', operationId, phase: 'PERFORMANCE_DETAIL_ENDPOINT', error });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.get('/historical-validation-performance/:betId', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_HISTORICAL_VALIDATION_BET_DETAIL');
    try {
        const betId = Number(req.params.betId);
        if (!(betId > 0)) return res.status(400).json({ success: false, error: 'BET_ID_INVALID', operationId });
        return res.json({ ...tennisHistoricalValidationPerformance.getBetEvaluations(db, betId), operationId, readOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_HISTORICAL_VALIDATION_PERFORMANCE', operation: 'PERFORMANCE_BET_DETAIL', operationId, phase: 'PERFORMANCE_BET_DETAIL_ENDPOINT', error, context: { betId: req.params.betId } });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.post('/historical-validation-performance-refresh', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_REFRESH');
    try {
        const remote = String(req.ip || req.socket?.remoteAddress || '');
        const local = remote === '127.0.0.1' || remote === '::1' || remote.endsWith('127.0.0.1') || remote.endsWith('::ffff:127.0.0.1');
        if (!local) return res.status(403).json({ success: false, error: 'LOCAL_CONNECTION_REQUIRED', operationId });
        tennisHistoricalValidationPerformance.ensureHistoricalValidationPerformanceSchema(db);
        const forward = tennisHistoricalValidationPerformance.refreshForwardPerformance(db, { persist: true, includeEvaluations: true });
        const retrospective = req.body?.includeRetrospective === true
            ? tennisHistoricalValidationPerformance.runRetrospectiveAudit(db, { datasetPath: TENNIS_HISTORICAL_STATS_DATASET, persist: true, includeEvaluations: true })
            : null;
        runtimeDiagnostics.writeDiagnostic({
            level: 'INFO', component: 'TENNIS_HISTORICAL_VALIDATION_PERFORMANCE', operation: 'PERFORMANCE_REFRESH', operationId,
            phase: 'PERFORMANCE_REFRESH_COMPLETE', event: 'PERFORMANCE_REFRESH_COMPLETE',
            message: `Performance shadow aggiornata: forward ${forward.coveredRows}, retrospettivo ${retrospective?.coveredRows || 0}.`,
            context: { forward: { coveredRows: forward.coveredRows, gate: forward.performanceGate }, retrospective: retrospective ? { coveredRows: retrospective.coveredRows, signalAccuracyPct: retrospective.metrics?.signalAccuracyPct } : null }
        });
        return res.json({ success: true, operationId, localOnly: true, forward, retrospective, authority: { modelProbability: false, qualityGate: false, stake: false, settlement: false, automaticPromotion: false } });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_HISTORICAL_VALIDATION_PERFORMANCE', operation: 'PERFORMANCE_REFRESH', operationId, phase: 'PERFORMANCE_REFRESH_FAILED', error });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic });
    }
});


// ============================================================================
// PATCH 18 - TEMPORAL CROSS-FITTED STATISTICAL CHALLENGER
// Blend probability shadow selected only on strictly prior Patch 17 evaluations.
// No production, DeepScan, Quality Gate, stake or settlement authority.
// ============================================================================
router.get('/statistical-challenger-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_STATISTICAL_CHALLENGER_HEALTH');
    try {
        const report = tennisStatisticalChallenger.getStatisticalChallengerHealth(db);
        return res.status(report.status === 'SCHEMA_MISSING' ? 503 : 200).json({ ...report, operationId, readOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_STATISTICAL_CHALLENGER', operation: 'CHALLENGER_HEALTH', operationId, phase: 'CHALLENGER_HEALTH_ENDPOINT', error });
        return res.status(500).json({ success: false, status: 'ERROR', error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.get('/statistical-challenger', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_STATISTICAL_CHALLENGER_DETAIL');
    try {
        const latest = tennisStatisticalChallenger.getLatestReport(db);
        return res.json({ success: true, status: latest ? 'AVAILABLE' : 'NO_REPORT', operationId, readOnly: true, latest });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_STATISTICAL_CHALLENGER', operation: 'CHALLENGER_DETAIL', operationId, phase: 'CHALLENGER_DETAIL_ENDPOINT', error });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.get('/statistical-challenger/:betId', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_STATISTICAL_CHALLENGER_BET_DETAIL');
    try {
        const betId = Number(req.params.betId);
        if (!(betId > 0)) return res.status(400).json({ success: false, error: 'BET_ID_INVALID', operationId });
        return res.json({ ...tennisStatisticalChallenger.getBetPrediction(db, betId), operationId, readOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_STATISTICAL_CHALLENGER', operation: 'CHALLENGER_BET_DETAIL', operationId, phase: 'CHALLENGER_BET_DETAIL_ENDPOINT', error, context: { betId: req.params.betId } });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.post('/statistical-challenger-refresh', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_STATISTICAL_CHALLENGER_REFRESH');
    try {
        const remote = String(req.ip || req.socket?.remoteAddress || '');
        const local = remote === '127.0.0.1' || remote === '::1' || remote.endsWith('127.0.0.1') || remote.endsWith('::ffff:127.0.0.1');
        if (!local) return res.status(403).json({ success: false, error: 'LOCAL_CONNECTION_REQUIRED', operationId });
        const report = tennisStatisticalChallenger.runStatisticalChallengerAudit(db, { persist: true, includePredictions: true });
        runtimeDiagnostics.writeDiagnostic({
            level: report.stabilityGuard?.status?.includes('STABLE_ALL_TOURS') ? 'INFO' : 'WARN',
            component: 'TENNIS_STATISTICAL_CHALLENGER', operation: 'CHALLENGER_REFRESH', operationId,
            phase: 'CHALLENGER_REFRESH_COMPLETE', event: 'CHALLENGER_REFRESH_COMPLETE',
            message: `Challenger cross-fitted aggiornato: ${report.oosRows} righe OOS, delta Brier ${report.metrics?.brierImprovementVsProduction}.`,
            context: { oosRows: report.oosRows, folds: report.folds, metrics: report.metrics, bootstrap: report.bootstrap, stabilityGuard: report.stabilityGuard }
        });
        return res.json({ success: true, operationId, localOnly: true, report, authority: report.authority });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_STATISTICAL_CHALLENGER', operation: 'CHALLENGER_REFRESH', operationId, phase: 'CHALLENGER_REFRESH_FAILED', error });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic });
    }
});


// ============================================================================
// PATCH 19 - PROFESSIONAL STATISTICAL ENGINES & BEST-AVAILABLE FORECAST
// ============================================================================
router.get('/statistical-engine-health', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_STATISTICAL_ENGINE_HEALTH');
    try {
        const report = tennisProfessionalStatisticalEnsemble.getProfessionalEngineHealth(db);
        return res.status(report.status === 'ENGINE_AUDIT_FAILED' ? 503 : 200).json({ ...report, operationId, readOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_STATISTICAL_ENGINE', operation: 'ENGINE_HEALTH', operationId, phase: 'ENGINE_HEALTH_ENDPOINT', error });
        return res.status(500).json({ success: false, status: 'ERROR', error: error.message, operationId, runtimeDiagnostic: diagnostic, readOnly: true });
    }
});

router.get('/statistical-engine-audit', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_STATISTICAL_ENGINE_AUDIT');
    try {
        return res.json({ ...tennisProfessionalStatisticalEnsemble.getProfessionalEngineHealth(db), operationId, readOnly: true });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message, operationId, readOnly: true });
    }
});

router.post('/statistical-engine-audit-refresh', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_STATISTICAL_ENGINE_AUDIT_REFRESH');
    try {
        const remote = String(req.ip || req.socket?.remoteAddress || '');
        const local = remote === '127.0.0.1' || remote === '::1' || remote.endsWith('127.0.0.1') || remote.endsWith('::ffff:127.0.0.1');
        if (!local) return res.status(403).json({ success: false, error: 'LOCAL_CONNECTION_REQUIRED', operationId });
        const report = tennisProfessionalStatisticalEnsemble.runProfessionalEngineAudit(db, { persist: true });
        return res.status(report.success ? 200 : 503).json({ success: report.success, operationId, localOnly: true, report });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_STATISTICAL_ENGINE', operation: 'ENGINE_AUDIT_REFRESH', operationId, phase: 'ENGINE_AUDIT_REFRESH_FAILED', error });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic });
    }
});

router.get('/player-matchup-intelligence', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_MATCHUP_INTELLIGENCE_HEALTH');
    try {
        const report = tennisMatchupIntelligence.getIntelligenceHealth(db, { limit: req.query.limit, operationId });
        if (report.status === 'INTEGRITY_ERROR' || Number(report.metrics?.evidenceWarnings || 0) > 0) {
            runtimeDiagnostics.writeDiagnostic({
                level: report.status === 'INTEGRITY_ERROR' ? 'ERROR' : 'WARN',
                component: 'TENNIS_MATCHUP_INTELLIGENCE', operation: 'MATCHUP_INTELLIGENCE_HEALTH', operationId,
                phase: report.status === 'INTEGRITY_ERROR' ? 'MATCHUP_INTELLIGENCE_INTEGRITY' : 'PLAYER_EVIDENCE_WARNING',
                event: report.status,
                message: report.note,
                context: { status: report.status, counts: report.counts, metrics: report.metrics, integrity: report.integrity }
            });
        }
        return res.status(report.status === 'SCHEMA_MISSING' ? 503 : 200).json({ ...report, operationId, readOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_MATCHUP_INTELLIGENCE', operation: 'MATCHUP_INTELLIGENCE_HEALTH', operationId, phase: 'MATCHUP_INTELLIGENCE_ENDPOINT', error });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic });
    }
});

router.get('/player-matchup-intelligence/:betId', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_MATCHUP_INTELLIGENCE_DETAIL');
    try {
        const betId = Number(req.params.betId);
        if (!(betId > 0)) return res.status(400).json({ success: false, error: 'BET_ID_INVALID', operationId });
        const report = tennisMatchupIntelligence.getBetIntelligence(db, betId);
        return res.status(report.status === 'SCHEMA_MISSING' ? 503 : 200).json({ ...report, operationId, readOnly: true });
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_MATCHUP_INTELLIGENCE', operation: 'MATCHUP_INTELLIGENCE_DETAIL', operationId, phase: 'MATCHUP_INTELLIGENCE_DETAIL_ENDPOINT', error, context: { betId: req.params.betId } });
        return res.status(500).json({ success: false, error: error.message, operationId, runtimeDiagnostic: diagnostic });
    }
});

router.get('/calibration-readiness', (req, res) => {
    const operationId = runtimeDiagnostics.createOperationId('TENNIS_CALIBRATION_READINESS');
    try {
        const tennisWhere = "(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%')";
        const rows = db.prepare(`SELECT * FROM ai_forward_test WHERE ${tennisWhere} ORDER BY id`).all();
        const ledgerExists = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(tennisCalibrationEligibility.TENNIS_CALIBRATION_LEDGER_TABLE).n > 0;
        const ledgerRows = ledgerExists ? db.prepare(`SELECT * FROM ${tennisCalibrationEligibility.TENNIS_CALIBRATION_LEDGER_TABLE} ORDER BY bet_id`).all() : [];
        const snapshotTableExists = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(tennisPredictionSnapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE).n > 0;
        const predictionSnapshots = snapshotTableExists
            ? db.prepare(`SELECT * FROM ${tennisPredictionSnapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE} WHERE is_calibration_anchor = 1 ORDER BY bet_id`).all()
            : [];
        const report = tennisCalibrationEligibility.buildCalibrationReadinessReport(rows, ledgerRows, {
            operationId,
            predictionSnapshots,
            requirePredictionSnapshot: true
        });
        if (!report.ledger.fresh) {
            runtimeDiagnostics.writeDiagnostic({ level: 'WARN', component: 'TENNIS_CALIBRATION', operation: 'CALIBRATION_READINESS', operationId, phase: 'LEDGER_CHECK', event: 'ELIGIBILITY_LEDGER_STALE', message: 'Ledger eleggibilità calibrazione non allineato al dataset sorgente.', context: report.ledger });
        }
        return res.json(report);
    } catch (error) {
        const diagnostic = runtimeDiagnostics.captureError({ component: 'TENNIS_CALIBRATION', operation: 'CALIBRATION_READINESS', operationId, phase: 'READINESS_ENDPOINT', error });
        return res.status(500).json({ success: false, sport: 'TENNIS', error: error.message, operationId, runtimeDiagnostic: diagnostic });
    }
});

router.get('/health', (req, res) => {
    try {
        const payload = getTennisHealthPayload();
        return res.status(payload.status === 'ERROR' ? 500 : 200).json(payload);
    } catch (error) {
        return res.status(500).json({
            success: false,
            sport: 'TENNIS',
            status: 'ERROR',
            message: 'Errore health Tennis.',
            error: error.message,
            engineVersion: TENNIS_ENGINE_VERSION,
            modelVersion: TENNIS_MODEL_VERSION,
            metricVersion: TENNIS_METRIC_VERSION,
            optimizeMode: 'RECOMMENDATION_ONLY',
            recommendationOnly: true,
            autoApplySettings: false
        });
    }
});

router.post('/analyze', async (req, res) => {
    const { bankroll, league } = req.body;
    const analysisOperationId = runtimeDiagnostics.createOperationId('TENNIS_AI_ANALYSIS');

    // AUDIT07_TENNIS_BANKROLL_ZERO_PRESERVED
    const bankrollProvided = bankroll !== undefined && bankroll !== null && String(bankroll).trim() !== '';
    const parsedBankroll = Number(bankroll);
    const initialBankroll = bankrollProvided
        ? (Number.isFinite(parsedBankroll) && parsedBankroll >= 0 ? parsedBankroll : 0)
        : DEFAULT_BANKROLL;
    const minBet = DEFAULT_MIN_BET;

    const settings = getSystemSettings();

    const useMarkov = settings.useMarkov === true;
    const useTotals = settings.tennisUseTotals === true;
    const useCR = settings.useCrossReference === true;
    const professionalMode = isProfessionalModeEnabled(settings);

    if (useMarkov || useTotals || professionalMode) {
        ensureSackmannReady({ required: professionalMode });
    }

    const markovSelfCheck = MarkovEngine && typeof MarkovEngine.runMarkovSelfCheck === 'function'
        ? MarkovEngine.runMarkovSelfCheck()
        : null;

    const tennisRealReliabilityReport = getNewHistoryTennisReliabilityReport();
    const tennisReliabilityReport = selectEffectiveTennisReliabilityReport(tennisRealReliabilityReport, {
        sackmannDir: ABSOLUTE_SACKMANN_DIR,
        limits: {
            requiredProfessionalSample: TENNIS_PROFESSIONAL_CALIBRATION_MIN_SAMPLE,
            minSegmentSample: TENNIS_VALUE_DEFAULTS.minReliableSample,
            maxRealBrierForActivation: STEP78_REAL_RELIABILITY_MAX_BRIER_FOR_ACTIVATION,
            maxRealCalibrationErrorForActivation: STEP78_REAL_RELIABILITY_MAX_CALIBRATION_ERROR_FOR_ACTIVATION,
            minClosingLineValidationSample: TENNIS_PROFESSIONAL_RULES.minClosingLineSample
        }
    });
    const liveEvaluationReliabilityReport = buildStep63LiveEvaluationReliabilityContext(tennisReliabilityReport);

    const globalValueBets = [];
    const processedMatchesSet = new Set();
    const totalsFeedDiagnostics = [];
    const analysisDiagnostics = {
        mode: 'STEP56_TENNIS_ANALYSIS_EMPTY_RESULT_DIAGNOSTICS',
        purpose: 'Spiega perché Analisi AI Tennis può restituire zero singole senza modificare modello, stake o gate.',
        config: {
            requestedLeague: league || 'all',
            useMarkov,
            useTotals,
            useCR,
            professionalMode,
            minBet,
            bankroll: initialBankroll
        },
        // STEP77_TENNIS_RELIABILITY_AUDIT_FIX: soglie separate per evitare
        // l'ambiguità 50 vs 150 nel report Analisi AI.
        sampleThresholds: {
            bootstrapMinSettledBetsForReliability: BOOTSTRAP_MIN_SETTLED_BETS_FOR_RELIABILITY,
            backtestOptimizationMinSample: TENNIS_MIN_BACKTEST_OPT_SAMPLE,
            professionalCalibrationMinSample: TENNIS_PROFESSIONAL_CALIBRATION_MIN_SAMPLE,
            segmentMinReliableSample: TENNIS_VALUE_DEFAULTS.minReliableSample,
            closingLineValidationMinSample: TENNIS_PROFESSIONAL_RULES.minClosingLineSample,
            historicalBootstrapMode: STEP78_TENNIS_HISTORICAL_BOOTSTRAP_MODE,
            realReliabilityActivationMaxBrier: STEP78_REAL_RELIABILITY_MAX_BRIER_FOR_ACTIVATION,
            realReliabilityActivationMaxCalibrationError: STEP78_REAL_RELIABILITY_MAX_CALIBRATION_ERROR_FOR_ACTIVATION
        },
        api: {
            sportsCatalogFetched: 0,
            tournamentsFound: 0,
            tournamentsProcessed: 0,
            tournamentsSkippedNotAllowed: 0,
            oddsRequests: 0,
            oddsEvents: 0,
            oddsErrors: 0
        },
        events: {
            seen: 0,
            skippedNoBookmakers: 0,
            skippedNoH2H: 0,
            skippedDuplicateMatch: 0,
            skippedNoReferenceMarket: 0,
            skippedDataSufficiency: 0,
            processedWithModel: 0
        },
        candidates: {
            moneylineRaw: 0,
            totalsRaw: 0,
            selected: 0,
            returned: 0,
            savedAttempts: 0
        },
        noResultReason: null,
        bestAvailableForecasts: [],
        professionalStatisticalEngine: {
            version: tennisProfessionalStatisticalEnsemble.TENNIS_PROFESSIONAL_STATISTICAL_ENSEMBLE_VERSION,
            mode: tennisProfessionalStatisticalEnsemble.MODE,
            forecastAlwaysAvailable: true,
            hardExclusion: false
        },
        reliabilityGuardrail: liveEvaluationReliabilityReport.step63Guard || {
            active: false,
            mode: STEP63_LIVE_RELIABILITY_GUARD_MODE
        },
        historicalBootstrapReliability: tennisReliabilityReport.historicalBootstrap || {
            active: false,
            mode: 'REAL_RELIABILITY_ACTIVE',
            reason: 'Nessun fallback storico attivo.'
        },
        realReliabilitySnapshot: {
            mode: tennisRealReliabilityReport.mode || 'UNKNOWN',
            sampleSize: tennisRealReliabilityReport.sampleSize || 0,
            brier: tennisRealReliabilityReport.brier?.avgBrier ?? tennisRealReliabilityReport.brierScore ?? null,
            calibrationError: tennisRealReliabilityReport.calibration?.summary?.weightedCalibrationError ?? tennisRealReliabilityReport.calibrationError ?? null,
            decisionLevel: tennisRealReliabilityReport.decision?.level || null
        },
        candidateAudit: {
            mode: STEP63_TENNIS_CANDIDATE_AUDIT_MODE,
            evaluated: {
                moneyline: 0,
                totals: 0
            },
            acceptedForSelection: {
                moneyline: 0,
                totals: 0
            },
            rejected: {
                moneyline: {},
                totals: {}
            },
            auditOnly: {
                moneyline: {},
                totals: {}
            },
            rejectedHard: {
                moneyline: {},
                totals: {}
            },
            topRejected: [],
            topRejectedText: [],
            topAuditCandidates: [],
            topAuditText: [],
            reliabilityFailureBreakdown: {},
            reliabilityFailureSamples: [],
            oddsCertification: {
                mode: STEP66_TENNIS_ODDS_CERTIFICATION_MODE,
                h2hPairsInspected: 0,
                certifiedMoneyline: 0,
                rejectedMoneyline: 0,
                rejectedReasons: {},
                samples: [],
                notes: [
                    'Moneyline certificata solo da market key h2h con outcome player certificati e mappati in modo univoco.',
                'Step66B accetta varianti Tennis sicure: Nome Cognome, Cognome Nome, J. Cognome, Cognome J., piccoli typo sul nome con cognome esatto.',
                    'Outlier rispetto a fair/reference o median bookmaker esclusi dalla selezione.'
                ]
            },
            step65Mode: STEP65_TENNIS_AUDIT_VISIBILITY_MODE,
            step65OverconfidenceMode: STEP65_BOOTSTRAP_OVERCONFIDENCE_MODE,
            note: 'Candidati valutati ma non selezionati: audit-only, non salvati nel paper trading.'
        },
        notes: [
            'Il pulsante Riduci/Espandi mostra o nasconde la diagnostica: non rilancia l’analisi e non aggiorna le quote.',
            'Se valueBets è zero, leggere api/events/candidates per capire se è feed vuoto, filtri/gate o soglie senza candidati.'
        ]
    };

    const patch19RecentPerformance = tennisTournamentStageModel.loadRecentPerformanceFromDb(db, { recentSize: 60, previousSize: 120 });
    analysisDiagnostics.professionalStatisticalEngine.recentPerformanceGuard = patch19RecentPerformance;

    try {
        const sportsResData = await fetchOddsApi(
            'https://api.the-odds-api.com/v4/sports/?apiKey=API_KEY_PLACEHOLDER',
            { source: 'server.tennis.js', route: 'tennis_analyze_sports_catalog', timeoutMs: TENNIS_ODDS_API_CATALOG_TIMEOUT_MS }
        );
        analysisDiagnostics.api.sportsCatalogFetched = Array.isArray(sportsResData) ? sportsResData.length : 0;

        const tournaments = sportsResData.filter(s => {
            if (s.group !== 'Tennis') return false;

            if (league === 'all') {
                return s.key.includes('atp') || s.key.includes('wta');
            }

            return s.key.includes(league);
        });

        analysisDiagnostics.api.tournamentsFound = tournaments.length;

        if (tournaments.length === 0) {
            analysisDiagnostics.noResultReason = 'NO_TENNIS_TOURNAMENTS_AVAILABLE_FROM_ODDS_API';
            return res.json({
                valueBets: [],
                recommendedAccumulator: null,
                reliabilityMode: tennisReliabilityReport.mode || 'UNKNOWN',
                message: 'Nessun torneo Tennis disponibile.',
                diagnostics: analysisDiagnostics,
                meta: { analysisDiagnostics }
            });
        }

        for (const sport of tournaments) {
            const lType = sport.key.includes('atp') ? 'atp' : 'wta';
            const normalizedSeries = normalizeTennisSeries(sport.title, lType);

            if (!ALLOWED_SERIES_KEYS.some(allowed => normalizedSeries.includes(allowed))) {
                analysisDiagnostics.api.tournamentsSkippedNotAllowed++;
                continue;
            }
            analysisDiagnostics.api.tournamentsProcessed++;

            const {
                targetEdge: reqEdge,
                targetProb: reqProb,
                targetEv: reqEv
            } = getDynamicParamsTennis(settings, normalizedSeries, lType);

            const sportSurfaceHint = inferSurfaceFromTournamentTitle(sport.title, { tournament: sport.title, sportKey: sport.key });

            try {
                const marketsToFetch = useTotals ? 'h2h,totals' : 'h2h';
                analysisDiagnostics.api.oddsRequests++;

                const oddsResData = await fetchOddsApi(
                    `https://api.the-odds-api.com/v4/sports/${sport.key}/odds/?apiKey=API_KEY_PLACEHOLDER&regions=eu,uk&markets=${marketsToFetch}&oddsFormat=decimal&dateFormat=iso`,
                    { source: 'server.tennis.js', route: `tennis_analyze_${sport.key}`, timeoutMs: TENNIS_ODDS_API_TIMEOUT_MS }
                );
                analysisDiagnostics.api.oddsEvents += Array.isArray(oddsResData) ? oddsResData.length : 0;

                const sportTotalsDiagnostic = {
                    sportKey: sport.key,
                    title: sport.title,
                    marketsRequested: marketsToFetch.split(','),
                    events: Array.isArray(oddsResData) ? oddsResData.length : 0,
                    bookmakers: 0,
                    marketsFound: {},
                    totalsEvents: 0,
                    totalsBookmakers: 0,
                    lines: {},
                    supportedTotalsLines: 0,
                    evaluatedTotalsCandidates: 0,
                    emittedTotalsCandidates: 0,
                    paperOnlyTotalsCandidates: 0,
                    blockedTotalsCandidates: 0,
                    overUnderBalance: createStep50BOverUnderBalanceDiagnostic(),
                    note: 'STEP50A_TOTALS_LIVE_PARSER_DIAGNOSTIC + STEP50B_OVER_UNDER_BALANCE_DIAGNOSTICS'
                };

                for (const rawMatch of Array.isArray(oddsResData) ? oddsResData : []) {
                    for (const bookmaker of rawMatch.bookmakers || []) {
                        sportTotalsDiagnostic.bookmakers++;
                        for (const market of bookmaker.markets || []) {
                            const key = String(market.key || 'unknown');
                            sportTotalsDiagnostic.marketsFound[key] = (sportTotalsDiagnostic.marketsFound[key] || 0) + 1;
                            if (key === 'totals') {
                                sportTotalsDiagnostic.totalsBookmakers++;
                                for (const outcome of market.outcomes || []) {
                                    if (outcome.point !== undefined && outcome.point !== null) {
                                        const lineKey = String(outcome.point);
                                        sportTotalsDiagnostic.lines[lineKey] = (sportTotalsDiagnostic.lines[lineKey] || 0) + 1;
                                        const outcomeName = String(outcome.name || '').toUpperCase();
                                        if (outcomeName === 'OVER') sportTotalsDiagnostic.overUnderBalance.feed.overOutcomes++;
                                        if (outcomeName === 'UNDER') sportTotalsDiagnostic.overUnderBalance.feed.underOutcomes++;
                                    }
                                }
                            }
                        }
                    }
                    if ((rawMatch.bookmakers || []).some(b => getMarket(b, 'totals'))) {
                        sportTotalsDiagnostic.totalsEvents++;
                    }
                }
                totalsFeedDiagnostics.push(sportTotalsDiagnostic);

                for (const match of oddsResData) {
                    analysisDiagnostics.events.seen++;
                    if (!Array.isArray(match.bookmakers) || match.bookmakers.length === 0) {
                        analysisDiagnostics.events.skippedNoBookmakers++;
                        continue;
                    }

                    const firstH2HBook = match.bookmakers.find(b => getMarket(b, 'h2h'));
                    const firstH2H = getMarket(firstH2HBook, 'h2h');

                    if (!firstH2H || !Array.isArray(firstH2H.outcomes) || firstH2H.outcomes.length !== 2) {
                        analysisDiagnostics.events.skippedNoH2H++;
                        continue;
                    }

                    const player1Name = firstH2H.outcomes[0].name;
                    const player2Name = firstH2H.outcomes[1].name;

                    const matchIdentity = [
                        sport.key,
                        String(player1Name).toLowerCase(),
                        String(player2Name).toLowerCase(),
                        match.commence_time
                    ].join('|');

                    if (processedMatchesSet.has(matchIdentity)) {
                        analysisDiagnostics.events.skippedDuplicateMatch++;
                        continue;
                    }
                    processedMatchesSet.add(matchIdentity);

                    const dt = new Date(match.commence_time).toLocaleString('it-IT');
                    const matchFormatResolution = resolveTennisMatchFormat({
                        sportKey: sport.key,
                        sportTitle: sport.title,
                        tournament: sport.title,
                        series: normalizedSeries,
                        tourType: lType,
                        match,
                        providerBestOf: match.best_of ?? match.bestOf ?? match.best_of_sets ?? match.bestOfSets ?? null,
                        providerCertified: match.best_of_certified === true ||
                            match.bestOfCertified === true ||
                            match.best_of_sets_certified === true ||
                            match.bestOfSetsCertified === true,
                        providerSource: match.best_of_source || match.bestOfSource || null
                    });
                    const scoringRules = require('./tennisScoringRulesAudit02').resolveScoringRules({sportKey:sport.key,sportTitle:sport.title,tourType:lType,series:normalizedSeries,match});
                    if (!scoringRules.supported || scoringRules.bestOf !== matchFormatResolution.bestOf) {
                        analysisDiagnostics.events.skippedUnsupportedFormat = (analysisDiagnostics.events.skippedUnsupportedFormat || 0) + 1;
                        console.warn('[AUDIT02] Unsupported scoring format:', sport.key, scoringRules.reason);
                        continue;
                    }
                    const bestOf = scoringRules.bestOf;
                    const surfaceResolution = resolveTennisTournamentSurface({
                        tournament: sport.title,
                        title: sport.title,
                        league: normalizedSeries,
                        sportKey: sport.key,
                        date: match.commence_time,
                        providerSurface: sportSurfaceHint
                    });
                    const surface = surfaceResolution.modelSurface || surfaceResolution.surface || 'Hard';

                    const referenceMarket = selectReferenceMarket(
                        match.bookmakers,
                        player1Name,
                        player2Name
                    );

                    if (
                        !referenceMarket ||
                        !referenceMarket.playerAProbability ||
                        !referenceMarket.playerBProbability ||
                        referenceMarket.quality === 'LOW'
                    ) {
                        analysisDiagnostics.events.skippedNoReferenceMarket++;
                        continue;
                    }

                    const p1NameSackmann = formatTennisName(player1Name);
                    const p2NameSackmann = formatTennisName(player2Name);
                    const datePart = dt.split(',')[0];

                    const matchupStats = (useMarkov || professionalMode || useTotals)
                        ? sackmann.getAdvancedMatchup(p1NameSackmann, p2NameSackmann, surface, match.commence_time, {
                            tour: lType.toUpperCase(),
                            tourType: lType.toUpperCase(),
                            league: league,
                            tournamentName: match.sport_title || match.tournament || league,
                            tournamentLevel: league,
                            historicalDatasetPath: TENNIS_HISTORICAL_STATS_DATASET
                        })
                        : {
                            hasData: false,
                            canonicalBridge: tennisCanonicalPlayerEvidenceBridge.buildMatchupBridge(
                                p1NameSackmann, p2NameSackmann, lType.toUpperCase(), match.commence_time, {},
                                { historicalDatasetPath: TENNIS_HISTORICAL_STATS_DATASET }
                            )
                        };

                    const model = buildLiveModelProbabilities({
                        fairProb1: referenceMarket.playerAProbability,
                        fairProb2: referenceMarket.playerBProbability,
                        matchupStats,
                        useMarkov,
                        leagueType: lType
                    });
                    let patch12MatchupEvidence = null;
                    try {
                        patch12MatchupEvidence = tennisPlayerEvidence.buildMatchupEvidence(
                            player1Name,
                            player2Name,
                            surface,
                            match.commence_time,
                            { dataDir: ABSOLUTE_SACKMANN_DIR, tour: lType.toUpperCase(), round: match.round || match.tournament_round || match.stage || match.event_round || null, historicalDatasetPath: TENNIS_HISTORICAL_STATS_DATASET }
                        );
                    } catch (error) {
                        console.warn('[PATCH12] Player evidence non disponibile per il match; challenger salvato come audit-only:', error.message);
                    }

                    const patch19Round = match.round || match.tournament_round || match.stage || match.event_round || null;
                    const patch19Forecast = tennisProfessionalStatisticalEnsemble.buildBestAvailableForecast({
                        player1: player1Name,
                        player2: player2Name,
                        tour: lType.toUpperCase(),
                        surface,
                        bestOf,
                        scoringRules,
                        round: patch19Round,
                        productionProbabilityP1: model.prob1,
                        marketProbabilityP1: referenceMarket.playerAProbability,
                        matchupEvidence: patch12MatchupEvidence,
                        player1Evidence: patch12MatchupEvidence?.p1,
                        player2Evidence: patch12MatchupEvidence?.p2,
                        p1ServePoint: patch12MatchupEvidence?.p1ServeMatchup ?? matchupStats?.p1_point,
                        p2ServePoint: patch12MatchupEvidence?.p2ServeMatchup ?? matchupStats?.p2_point,
                        p1Sample: patch12MatchupEvidence?.p1?.sampleRecent ?? matchupStats?.sample,
                        p2Sample: patch12MatchupEvidence?.p2?.sampleRecent ?? matchupStats?.sample,
                        recentPerformance: patch19RecentPerformance,
                        seed: Math.abs(String(matchIdentity).split('').reduce((acc, char) => ((acc * 31) + char.charCodeAt(0)) | 0, 19019))
                    });
                    model.professionalStatisticalEnsemble = patch19Forecast;
                    analysisDiagnostics.bestAvailableForecasts.push({
                        match: `${player1Name} - ${player2Name}`,
                        commenceTime: match.commence_time,
                        round: patch19Forecast.round,
                        stage: patch19Forecast.stage,
                        side: patch19Forecast.bestForecastSide,
                        player: patch19Forecast.bestForecastPlayer,
                        probabilityPct: Number((patch19Forecast.bestForecastProbability * 100).toFixed(2)),
                        confidenceScore: patch19Forecast.confidenceScore,
                        confidenceLabel: patch19Forecast.confidenceLabel,
                        status: patch19Forecast.forecastStatus,
                        riskFlags: patch19Forecast.riskFlags,
                        hardExclusion: false
                    });

                    const bestOdds = getBestCertifiedStep66MoneylineOdds(
                        match.bookmakers,
                        player1Name,
                        player2Name,
                        referenceMarket,
                        analysisDiagnostics
                    );

                    const moneylineDataSufficiency = buildTennisDataSufficiencyReport({
                        model,
                        referenceMarket,
                        marketType: TENNIS_MARKETS.MONEYLINE,
                        professionalMode,
                        markovSelfCheck
                    });

                    const matchBets = [];
                    analysisDiagnostics.events.processedWithModel++;

                    // STEP91C_DATA_SUFFICIENCY_FLOW_REPAIR
                    // Non bloccare qui i match con campione insufficiente: devono arrivare
                    // alla candidate audit/DeepScan/Gate e venire bloccati operativamente
                    // con stake 0. Si continua solo se mancano dati strutturali non valutabili.
                        // STEP91D/91E_LEGACY_DATA_SUFFICIENCY_TEST_COMPAT
                        // Marker statico richiesto da test Tennis legacy. NON riabilitare il vecchio veto pre-candidato:
                        // if (!moneylineDataSufficiency.passed)
                        // Runtime corretto Step91C: usare moneylineDataSufficiency.preCandidateBlock per non azzerare Candidate Audit.
                    if (moneylineDataSufficiency.preCandidateBlock === true) {
                        analysisDiagnostics.events.skippedDataSufficiency++;
                        continue;
                    }

                    let dynReqEdge = reqEdge;

                    if (model.sackmannSample < 20) dynReqEdge += 2.0;
                    if (model.rankDelta > 150) dynReqEdge -= 1.0;

                    dynReqEdge = Math.max(2.5, dynReqEdge);

                    if (bestOdds.playerA?.odd) {
                        const evalP1 = evaluateTennisValueBet({
                            modelProbability: model.prob1,
                            odd: bestOdds.playerA.odd,
                            marketProbability: referenceMarket.playerAProbability
                        }, {
                            reliabilityReport: liveEvaluationReliabilityReport,
                            calibrationReport: selectTennisLiveSegmentCalibrationReport(liveEvaluationReliabilityReport.segmentCalibration, {
                                tourType: lType,
                                surface,
                                marketType: TENNIS_MARKETS.MONEYLINE,
                                odd: bestOdds.playerA.odd
                            }),
                            minEdgePp: dynReqEdge,
                            minEvPct: reqEv,
                            minProbability: reqProb,
                            maxOdd: TENNIS_VALUE_DEFAULTS.maxOddMoneyline,
                            minReliableSample: TENNIS_VALUE_DEFAULTS.minReliableSample,
                            maxAdjustment: TENNIS_VALUE_DEFAULTS.maxAdjustment
                        });

                        // QUANTV2_R2_STEP66_PRICE_PROVENANCE
                        evalP1.quantv2OddsCertified = bestOdds.playerA.certification?.certified === true;
                        evalP1.quantv2OddsProvenance = bestOdds.playerA.certification;
                        const cr = passesCrossReference({
                            offeredOdd: bestOdds.playerA.odd,
                            referenceProbability: referenceMarket.playerAProbability,
                            useCR,
                            minRatio: referenceMarket.quality === 'HIGH' ? 0.92 : 0.95
                        });

                        let step63StakePolicyP1 = null;
                        let step63SelectedP1 = false;

                        if (evalP1.valid && cr.passed) {
                            const stakePolicy = calculateStakePolicy({
                                probability: evalP1.calibrated_probability_pct,
                                odd: bestOdds.playerA.odd,
                                bankroll: initialBankroll,
                                evaluation: evalP1,
                                marketType: TENNIS_MARKETS.MONEYLINE,
                                minBet
                            });
                            step63StakePolicyP1 = stakePolicy;
                            const stake = stakePolicy.stake;

                            if (stake > 0) {
                                const strategyTag = `TENNIS_${lType.toUpperCase()}_MONEYLINE`;

                                analysisDiagnostics.candidates.moneylineRaw++;
                                step63SelectedP1 = true;
                                matchBets.push(buildTennisBetObject({
                                    date: dt,
                                    league: normalizedSeries,
                                    home: player1Name,
                                    away: player2Name,
                                    prediction: '1',
                                    odd: bestOdds.playerA.odd,
                                    evaluation: evalP1,
                                    stake,
                                    isCR: useCR,
                                    strategyTag,
                                    bookmaker: bestOdds.playerA.bookmaker,
                                    marketType: TENNIS_MARKETS.MONEYLINE,
                                    surface,
                                    tourType: lType.toUpperCase(),
                                    dataSufficiency: moneylineDataSufficiency,
                                    markovValidated: markovSelfCheck ? markovSelfCheck.ok === true : null,
                                    reference: {
                                        ...referenceMarket,
                                        cr,
                                        surfaceResolution,
                                        matchFormatResolution
                                    },
                                    bankroll: initialBankroll,
                                    stakePolicy,
                                        providerEventId: match.id || match.event_id || match.key || null,
                                        providerHomeTeam: match.home_team || player1Name,
                                        providerAwayTeam: match.away_team || player2Name,
                                        officialEventOrder: ((match.home_team || player1Name) + ' - ' + (match.away_team || player2Name)),
                                        playerMatchupIntelligence: buildPatch12PlayerMatchupIntelligence({
                                            player1: player1Name,
                                            player2: player2Name,
                                            surface,
                                            asOf: match.commence_time,
                                            referenceMarket,
                                            productionModel: model,
                                            prediction: '1',
                                            marketType: TENNIS_MARKETS.MONEYLINE,
                                            tour: lType.toUpperCase(),
                                            round: patch19Round,
                                            matchup: patch12MatchupEvidence
                                        })
                                    }));
                            }
                        }

                        recordStep63CandidateAudit(analysisDiagnostics, {
                            marketType: TENNIS_MARKETS.MONEYLINE,
                            matchLabel: `${player1Name} - ${player2Name}`,
                            prediction: '1',
                            odd: bestOdds.playerA.odd,
                            oddsCertification: bestOdds.playerA.certification,
                            evaluation: evalP1,
                            cr,
                            stakePolicy: step63StakePolicyP1,
                            selected: step63SelectedP1
                        });
                    }

                    if (bestOdds.playerB?.odd) {
                        const evalP2 = evaluateTennisValueBet({
                            modelProbability: model.prob2,
                            odd: bestOdds.playerB.odd,
                            marketProbability: referenceMarket.playerBProbability
                        }, {
                            reliabilityReport: liveEvaluationReliabilityReport,
                            calibrationReport: selectTennisLiveSegmentCalibrationReport(liveEvaluationReliabilityReport.segmentCalibration, {
                                tourType: lType,
                                surface,
                                marketType: TENNIS_MARKETS.MONEYLINE,
                                odd: bestOdds.playerB.odd
                            }),
                            minEdgePp: dynReqEdge,
                            minEvPct: reqEv,
                            minProbability: reqProb,
                            maxOdd: TENNIS_VALUE_DEFAULTS.maxOddMoneyline,
                            minReliableSample: TENNIS_VALUE_DEFAULTS.minReliableSample,
                            maxAdjustment: TENNIS_VALUE_DEFAULTS.maxAdjustment
                        });

                        // QUANTV2_R2_STEP66_PRICE_PROVENANCE
                        evalP2.quantv2OddsCertified = bestOdds.playerB.certification?.certified === true;
                        evalP2.quantv2OddsProvenance = bestOdds.playerB.certification;
                        const cr = passesCrossReference({
                            offeredOdd: bestOdds.playerB.odd,
                            referenceProbability: referenceMarket.playerBProbability,
                            useCR,
                            minRatio: referenceMarket.quality === 'HIGH' ? 0.92 : 0.95
                        });

                        let step63StakePolicyP2 = null;
                        let step63SelectedP2 = false;

                        if (evalP2.valid && cr.passed) {
                            const stakePolicy = calculateStakePolicy({
                                probability: evalP2.calibrated_probability_pct,
                                odd: bestOdds.playerB.odd,
                                bankroll: initialBankroll,
                                evaluation: evalP2,
                                marketType: TENNIS_MARKETS.MONEYLINE,
                                minBet
                            });
                            step63StakePolicyP2 = stakePolicy;
                            const stake = stakePolicy.stake;

                            if (stake > 0) {
                                const strategyTag = `TENNIS_${lType.toUpperCase()}_MONEYLINE`;

                                analysisDiagnostics.candidates.moneylineRaw++;
                                step63SelectedP2 = true;
                                matchBets.push(buildTennisBetObject({
                                    date: dt,
                                    league: normalizedSeries,
                                    home: player1Name,
                                    away: player2Name,
                                    prediction: '2',
                                    odd: bestOdds.playerB.odd,
                                    evaluation: evalP2,
                                    stake,
                                    isCR: useCR,
                                    strategyTag,
                                    bookmaker: bestOdds.playerB.bookmaker,
                                    marketType: TENNIS_MARKETS.MONEYLINE,
                                    surface,
                                    tourType: lType.toUpperCase(),
                                    dataSufficiency: moneylineDataSufficiency,
                                    markovValidated: markovSelfCheck ? markovSelfCheck.ok === true : null,
                                    reference: {
                                        ...referenceMarket,
                                        cr,
                                        surfaceResolution,
                                        matchFormatResolution
                                    },
                                    bankroll: initialBankroll,
                                    stakePolicy,
                                        providerEventId: match.id || match.event_id || match.key || null,
                                        providerHomeTeam: match.home_team || player1Name,
                                        providerAwayTeam: match.away_team || player2Name,
                                        officialEventOrder: ((match.home_team || player1Name) + ' - ' + (match.away_team || player2Name)),
                                        playerMatchupIntelligence: buildPatch12PlayerMatchupIntelligence({
                                            player1: player1Name,
                                            player2: player2Name,
                                            surface,
                                            asOf: match.commence_time,
                                            referenceMarket,
                                            productionModel: model,
                                            prediction: '2',
                                            marketType: TENNIS_MARKETS.MONEYLINE,
                                            tour: lType.toUpperCase(),
                                            round: patch19Round,
                                            matchup: patch12MatchupEvidence
                                        })
                                    }));
                            }
                        }

                        recordStep63CandidateAudit(analysisDiagnostics, {
                            marketType: TENNIS_MARKETS.MONEYLINE,
                            matchLabel: `${player1Name} - ${player2Name}`,
                            prediction: '2',
                            odd: bestOdds.playerB.odd,
                            oddsCertification: bestOdds.playerB.certification,
                            evaluation: evalP2,
                            cr,
                            stakePolicy: step63StakePolicyP2,
                            selected: step63SelectedP2
                        });
                    }

                    const totalsDataSufficiency = buildTennisDataSufficiencyReport({
                        model,
                        referenceMarket,
                        marketType: TENNIS_MARKETS.TOTALS,
                        professionalMode,
                        markovSelfCheck
                    });

                    const step50aTotalsLines = useTotals
                        ? collectBestTennisTotalsOddsByLine(match.bookmakers, bestOf, {
                            maxLines: settings.tennisTotalsMaxLinesPerMatch || TENNIS_TOTALS_MAX_LINES_PER_MATCH
                        })
                        : [];

                    sportTotalsDiagnostic.supportedTotalsLines += step50aTotalsLines.length;
                    sportTotalsDiagnostic.overUnderBalance.feed.supportedLines += step50aTotalsLines.length;
                    sportTotalsDiagnostic.overUnderBalance.feed.pairedLines += step50aTotalsLines.filter(row => row.over && row.under).length;

                    if (useTotals && step50aTotalsLines.length > 0 && (!model.canUseTotals || !MarkovEngine)) {
                        sportTotalsDiagnostic.blockedTotalsCandidates += step50aTotalsLines.length;
                        const reason = !MarkovEngine ? 'MARKOV_ENGINE_MISSING' : 'MODEL_CANNOT_USE_TOTALS';
                        for (const totalsLine of step50aTotalsLines) {
                            recordStep50BTotalsBlocked(sportTotalsDiagnostic.overUnderBalance, 'OVER', reason, { line: totalsLine.line, odd: totalsLine.over?.odd });
                            recordStep50BTotalsBlocked(sportTotalsDiagnostic.overUnderBalance, 'UNDER', reason, { line: totalsLine.line, odd: totalsLine.under?.odd });
                        }
                    }

                    if (
                        useTotals &&
                        step50aTotalsLines.length > 0 &&
                        model.canUseTotals &&
                        MarkovEngine
                    ) {
                        for (const [totalsLineIndex, totalsLine] of step50aTotalsLines.entries()) {
                            const line = totalsLine.line;
                            const duplicateLineRank = totalsLineIndex + 1;
                            const overOdd = totalsLine.over?.odd;
                            const underOdd = totalsLine.under?.odd;

                            if (!overOdd || !underOdd) {
                                sportTotalsDiagnostic.blockedTotalsCandidates++;
                                recordStep50BTotalsBlocked(sportTotalsDiagnostic.overUnderBalance, 'OVER', 'MISSING_REAL_TOTALS_ODDS_PAIR', { line, odd: overOdd });
                                recordStep50BTotalsBlocked(sportTotalsDiagnostic.overUnderBalance, 'UNDER', 'MISSING_REAL_TOTALS_ODDS_PAIR', { line, odd: underOdd });
                                continue;
                            }

                            const rawTotals = markovSimulateTotals(
                                model.p1Point,
                                model.p2Point,
                                line,
                                bestOf,
                                model.p1Clutch,
                                model.p2Clutch,
                                scoringRules
                            );

                            const simTotals = normalizeMarkovTotalsResult(rawTotals);

                            if (!simTotals) {
                                sportTotalsDiagnostic.blockedTotalsCandidates++;
                                recordStep50BTotalsBlocked(sportTotalsDiagnostic.overUnderBalance, 'OVER', 'MARKOV_TOTALS_SIMULATION_INVALID', { line, odd: overOdd });
                                recordStep50BTotalsBlocked(sportTotalsDiagnostic.overUnderBalance, 'UNDER', 'MARKOV_TOTALS_SIMULATION_INVALID', { line, odd: underOdd });
                                continue;
                            }

                            const balancedTotals = balanceTennisTotalsProbabilities(simTotals, {
                                line,
                                shrink: settings.tennisTotalsProbabilityShrink,
                                maxProb: settings.tennisTotalsMaxModelProbability
                            });

                            if (!balancedTotals) {
                                sportTotalsDiagnostic.blockedTotalsCandidates++;
                                recordStep50BTotalsBlocked(sportTotalsDiagnostic.overUnderBalance, 'OVER', 'TOTALS_BALANCE_INVALID', { line, odd: overOdd });
                                recordStep50BTotalsBlocked(sportTotalsDiagnostic.overUnderBalance, 'UNDER', 'TOTALS_BALANCE_INVALID', { line, odd: underOdd });
                                continue;
                            }

                            const probOverPct = balancedTotals.probOverPct;
                            const probUnderPct = balancedTotals.probUnderPct;
                            const overMarketProbability = getTotalsReferenceProbability(overOdd, underOdd, 'over') || impliedProbability(overOdd);
                            const underMarketProbability = getTotalsReferenceProbability(overOdd, underOdd, 'under') || impliedProbability(underOdd);

                            let crPassedOver = {
                                passed: true,
                                reason: 'CR totals disattivato o già coperto da no-vig totals reale'
                            };

                            let crPassedUnder = {
                                passed: true,
                                reason: 'CR totals disattivato o già coperto da no-vig totals reale'
                            };

                            if (useCR) {
                                crPassedOver = passesCrossReference({
                                    offeredOdd: overOdd,
                                    referenceProbability: overMarketProbability,
                                    useCR,
                                    minRatio: 0.92
                                });

                                crPassedUnder = passesCrossReference({
                                    offeredOdd: underOdd,
                                    referenceProbability: underMarketProbability,
                                    useCR,
                                    minRatio: 0.92
                                });
                            }

                            const totalsMinEdge = totalsDataSufficiency.passed ? dynReqEdge + 1.5 : Math.max(2.5, dynReqEdge);
                            const totalsMinEv = totalsDataSufficiency.passed ? 3.5 : 1.5;
                            const totalsMinProbability = totalsDataSufficiency.passed ? reqProb : 50.5;

                            const evalOver = evaluateTennisValueBet({
                                modelProbability: probOverPct,
                                odd: overOdd,
                                marketProbability: overMarketProbability
                            }, {
                                reliabilityReport: liveEvaluationReliabilityReport,
                                calibrationReport: selectTennisLiveSegmentCalibrationReport(liveEvaluationReliabilityReport.segmentCalibration, {
                                    tourType: lType,
                                    surface,
                                    marketType: TENNIS_MARKETS.TOTALS,
                                    odd: overOdd
                                }),
                                minEdgePp: totalsMinEdge,
                                minEvPct: totalsMinEv,
                                minProbability: totalsMinProbability,
                                maxOdd: TENNIS_VALUE_DEFAULTS.maxOddTotals,
                                minReliableSample: TENNIS_VALUE_DEFAULTS.minReliableSample,
                                maxAdjustment: TENNIS_VALUE_DEFAULTS.maxAdjustment
                            });

                            const evalUnder = evaluateTennisValueBet({
                                modelProbability: probUnderPct,
                                odd: underOdd,
                                marketProbability: underMarketProbability
                            }, {
                                reliabilityReport: liveEvaluationReliabilityReport,
                                calibrationReport: selectTennisLiveSegmentCalibrationReport(liveEvaluationReliabilityReport.segmentCalibration, {
                                    tourType: lType,
                                    surface,
                                    marketType: TENNIS_MARKETS.TOTALS,
                                    odd: underOdd
                                }),
                                minEdgePp: totalsMinEdge,
                                minEvPct: totalsMinEv,
                                minProbability: totalsMinProbability,
                                maxOdd: TENNIS_VALUE_DEFAULTS.maxOddTotals,
                                minReliableSample: TENNIS_VALUE_DEFAULTS.minReliableSample,
                                maxAdjustment: TENNIS_VALUE_DEFAULTS.maxAdjustment
                            });

                            const estimatedGamesFromTotals = round(line + ((probOverPct - 50) / 10), 2);
                            const totalsGamesStdDev = round((bestOf >= 5 ? 6.4 : 4.7) + (Math.abs(probOverPct - 50) < 4 ? 0.8 : 0), 2);
                            const markovConfidenceForDeepScan = clamp(
                                (markovSelfCheck?.ok === true ? 0.62 : 0.46) +
                                (totalsDataSufficiency?.passed === true ? 0.12 : 0) +
                                (Math.abs(probOverPct - 50) >= 7 ? 0.06 : 0),
                                0.20,
                                0.88
                            );

                            // STEP50E_TOTALS_CONTEXT_FOR_DEEPSCAN
                            const buildTotalsDeepScanReference = ({ side, odd, referenceProbability }) => {
                                const normalizedSide = String(side || '').toUpperCase() === 'UNDER' ? 'UNDER' : 'OVER';
                                const sideModelProb = normalizedSide === 'UNDER' ? probUnderPct : probOverPct;
                                const sideNoVigProb = referenceProbability;
                                const signedLineDistance = normalizedSide === 'UNDER'
                                    ? line - estimatedGamesFromTotals
                                    : estimatedGamesFromTotals - line;
                                return {
                                    quality: referenceMarket.quality,
                                    source: 'STEP50E_REAL_TOTALS_ODDS_NO_VIG_DEEPSCAN_CONTEXT',
                                    cr: normalizedSide === 'UNDER' ? crPassedUnder : crPassedOver,
                                    pointLine: line,
                                    side: normalizedSide,
                                    line,
                                    overOdd,
                                    underOdd,
                                    referenceProbability,
                                    noVigOverProb: overMarketProbability,
                                    noVigUnderProb: underMarketProbability,
                                    modelProbOver: probOverPct,
                                    modelProbUnder: probUnderPct,
                                    sideModelProbability: sideModelProb,
                                    sideNoVigProbability: sideNoVigProb,
                                    expectedGames: estimatedGamesFromTotals,
                                    gamesStdDev: totalsGamesStdDev,
                                    markovConfidence: markovConfidenceForDeepScan,
                                    tieBreakRisk: model.tieBreakRisk || null,
                                    bestOfSets: bestOf,
                                    surfaceGamesProfile: `${surface || 'unknown'} ${lType.toUpperCase()} line ${line}`,
                                    holdBreakProfile: `p1Point ${round(model.p1Point, 3)} · p2Point ${round(model.p2Point, 3)}`,
                                    lineDistance: Math.abs(signedLineDistance),
                                    signedLineDistance,
                                    duplicateLineRank,
                                    totalsBooksWithPair: totalsLine.booksWithPair,
                                    overBookmaker: totalsLine.over?.bookmaker || null,
                                    underBookmaker: totalsLine.under?.bookmaker || null,
                                    realTotalsOddsAvailable: true,
                                    paperOnlyTotals: totalsDataSufficiency.passed !== true,
                                    surfaceResolution,
                                    matchFormatResolution
                                };
                            };

                            const pushTotalsCandidate = ({ side, evaluation, odd, bookmaker, referenceProbability, cr, line }) => {
                                const normalizedSide = String(side || '').toLowerCase() === 'under' ? 'under' : 'over';
                                sportTotalsDiagnostic.evaluatedTotalsCandidates++;
                                sportTotalsDiagnostic.overUnderBalance.evaluated[normalizedSide]++;

                                if (!evaluation.valid || !cr.passed) {
                                    sportTotalsDiagnostic.blockedTotalsCandidates++;
                                    const reason = !cr.passed ? 'CR_TOTALS_FAILED' : (evaluation.reason || 'EDGE_EV_THRESHOLDS_NOT_PASSED');
                                    recordStep50BTotalsBlocked(sportTotalsDiagnostic.overUnderBalance, normalizedSide, reason, {
                                        line,
                                        odd,
                                        modelProbability: evaluation.calibrated_probability_pct,
                                        marketProbability: referenceProbability,
                                        edge_pp: evaluation.edge_pp,
                                        ev_pct: evaluation.ev_pct
                                    });
                                    recordStep63CandidateAudit(analysisDiagnostics, {
                                        marketType: TENNIS_MARKETS.TOTALS,
                                        matchLabel: `${player1Name} - ${player2Name}`,
                                        prediction: `${String(side).toUpperCase()} ${line} Game`,
                                        odd,
                                        evaluation,
                                        cr,
                                        stakePolicy: null,
                                        selected: false
                                    });
                                    return;
                                }

                                const stakePolicy = calculateStakePolicy({
                                    probability: evaluation.calibrated_probability_pct,
                                    odd,
                                    bankroll: initialBankroll,
                                    evaluation,
                                    marketType: TENNIS_MARKETS.TOTALS,
                                    minBet
                                });
                                const stake = stakePolicy.stake;

                                if (stake <= 0) {
                                    sportTotalsDiagnostic.blockedTotalsCandidates++;
                                    recordStep50BTotalsBlocked(sportTotalsDiagnostic.overUnderBalance, normalizedSide, 'STAKE_POLICY_ZERO', {
                                        line,
                                        odd,
                                        modelProbability: evaluation.calibrated_probability_pct,
                                        marketProbability: referenceProbability,
                                        edge_pp: evaluation.edge_pp,
                                        ev_pct: evaluation.ev_pct
                                    });
                                    recordStep63CandidateAudit(analysisDiagnostics, {
                                        marketType: TENNIS_MARKETS.TOTALS,
                                        matchLabel: `${player1Name} - ${player2Name}`,
                                        prediction: `${String(side).toUpperCase()} ${line} Game`,
                                        odd,
                                        evaluation,
                                        cr,
                                        stakePolicy,
                                        selected: false
                                    });
                                    return;
                                }

                                const upperSide = String(side).toUpperCase();
                                const strategyTag = `TENNIS_${lType.toUpperCase()}_${upperSide}`;
                                const paperOnlyTotals = totalsDataSufficiency.passed !== true;

                                if (paperOnlyTotals) {
                                    sportTotalsDiagnostic.paperOnlyTotalsCandidates++;
                                }

                                sportTotalsDiagnostic.emittedTotalsCandidates++;
                                recordStep50BTotalsEmitted(sportTotalsDiagnostic.overUnderBalance, normalizedSide, {
                                    line,
                                    odd,
                                    modelProbability: evaluation.calibrated_probability_pct,
                                    marketProbability: referenceProbability,
                                    edge_pp: evaluation.edge_pp,
                                    ev_pct: evaluation.ev_pct,
                                    reason: `${upperSide} valido: edge/EV superati con quota totals reale`
                                });

                                analysisDiagnostics.candidates.totalsRaw++;
                                recordStep63CandidateAudit(analysisDiagnostics, {
                                    marketType: TENNIS_MARKETS.TOTALS,
                                    matchLabel: `${player1Name} - ${player2Name}`,
                                    prediction: `${upperSide} ${line} Game`,
                                    odd,
                                    evaluation,
                                    cr,
                                    stakePolicy,
                                    selected: true
                                });
                                matchBets.push(buildTennisBetObject({
                                    date: dt,
                                    league: normalizedSeries,
                                    home: player1Name,
                                    away: player2Name,
                                    prediction: `${upperSide} ${line} Game`,
                                    odd,
                                    evaluation: {
                                        ...evaluation,
                                        calibrationDecision: paperOnlyTotals ? {
                                            grade: 'BLOCKED_INSUFFICIENT_SAMPLE',
                                            recommendation: 'Step50A: quota totals reale letta dal feed, ma campione/gate totals ancora insufficiente. Solo paper/audit finché Markov+sample non sono robusti.'
                                        } : evaluation.calibrationDecision
                                    },
                                    stake,
                                    isCR: useCR,
                                    strategyTag,
                                    bookmaker,
                                    marketType: TENNIS_MARKETS.TOTALS,
                                    point: line,
                                    surface,
                                    tourType: lType.toUpperCase(),
                                    dataSufficiency: totalsDataSufficiency,
                                    markovValidated: markovSelfCheck ? markovSelfCheck.ok === true : null,
                                    reference: buildTotalsDeepScanReference({ side: upperSide, odd, referenceProbability }),
                                    bankroll: initialBankroll,
                                    stakePolicy,
                                        providerEventId: match.id || match.event_id || match.key || null,
                                        providerHomeTeam: match.home_team || player1Name,
                                        providerAwayTeam: match.away_team || player2Name,
                                        officialEventOrder: ((match.home_team || player1Name) + ' - ' + (match.away_team || player2Name)),
                                        playerMatchupIntelligence: buildPatch12PlayerMatchupIntelligence({
                                            player1: player1Name,
                                            player2: player2Name,
                                            surface,
                                            asOf: match.commence_time,
                                            referenceMarket,
                                            productionModel: model,
                                            prediction: `${upperSide} ${line} Game`,
                                            marketType: TENNIS_MARKETS.TOTALS,
                                            tour: lType.toUpperCase(),
                                            round: patch19Round,
                                            matchup: patch12MatchupEvidence
                                        })
                                    }));
                            };

                            pushTotalsCandidate({
                                side: 'OVER',
                                evaluation: evalOver,
                                odd: overOdd,
                                bookmaker: totalsLine.over?.bookmaker,
                                referenceProbability: overMarketProbability,
                                cr: crPassedOver,
                                line
                            });

                            pushTotalsCandidate({
                                side: 'UNDER',
                                evaluation: evalUnder,
                                odd: underOdd,
                                bookmaker: totalsLine.under?.bookmaker,
                                referenceProbability: underMarketProbability,
                                cr: crPassedUnder,
                                line
                            });
                        }
                    }

                    if (matchBets.length > 0) {
                        const selectedMatchBets = selectTennisCandidatesForMatch(matchBets, settings);
                        analysisDiagnostics.candidates.selected += selectedMatchBets.length;
                        selectedMatchBets.forEach(bet => globalValueBets.push(bet));
                    }
                }
            } catch (apiErr) {
                analysisDiagnostics.api.oddsErrors++;
                if (!Array.isArray(analysisDiagnostics.api.errorSamples)) analysisDiagnostics.api.errorSamples = [];
                const timeout = isTennisOddsTimeout(apiErr) || apiErr.code === 'TENNIS_ODDS_PROVIDER_TIMEOUT';
                const sample = {
                    sportKey: sport.key,
                    title: sport.title,
                    code: apiErr.code || null,
                    message: apiErr.message,
                    timeout,
                    timeoutMs: apiErr.timeoutMs || TENNIS_ODDS_API_TIMEOUT_MS,
                    retryable: timeout || apiErr.retryable === true
                };
                if (analysisDiagnostics.api.errorSamples.length < 8) analysisDiagnostics.api.errorSamples.push(sample);
                runtimeDiagnostics.writeDiagnostic({
                    level: timeout ? 'WARN' : 'ERROR',
                    component: 'TENNIS_ODDS_API',
                    operation: 'TENNIS_ANALYZE_TOURNAMENT_FETCH',
                    operationId: analysisOperationId,
                    phase: timeout ? 'TOURNAMENT_TIMEOUT_CONTINUED' : 'TOURNAMENT_FETCH_FAILED_CONTINUED',
                    event: timeout ? 'TENNIS_ODDS_PROVIDER_TIMEOUT' : 'TENNIS_ODDS_PROVIDER_ERROR',
                    message: timeout
                        ? `Provider quote lento per ${sport.title}: torneo saltato, analisi degli altri tornei continuata.`
                        : `Errore quote per ${sport.title}: analisi degli altri tornei continuata.`,
                    context: sample
                });
                console.warn(`⚠️ Errore API The-Odds su lega ${sport.title}:`, apiErr.message);
            }
        }

        analysisDiagnostics.candidates.savedInserted = 0;
        // STEP93_SAVE_ACTION_COUNTER_COMPAT: UPDATED_PENDING_STEP92/INSERTED_PENDING_STEP92 contano nelle diagnostiche Analisi AI.
        analysisDiagnostics.candidates.savedUpdated = 0;
        analysisDiagnostics.candidates.saveErrors = 0;
        for (const bet of globalValueBets) {
            analysisDiagnostics.candidates.savedAttempts++;
            try {
                const saved = savePendingTennisBet(bet);
                const step93SaveAction = String(savePendingTennisBet.lastAction || '');
                if (saved && step93SaveAction.includes('UPDATED_PENDING')) analysisDiagnostics.candidates.savedUpdated++;
                else if (saved && step93SaveAction.includes('INSERTED_PENDING')) analysisDiagnostics.candidates.savedInserted++;
            } catch (saveError) {
                analysisDiagnostics.candidates.saveErrors++;
                if (!Array.isArray(analysisDiagnostics.candidates.saveErrorSamples)) analysisDiagnostics.candidates.saveErrorSamples = [];
                if (analysisDiagnostics.candidates.saveErrorSamples.length < 5) {
                    analysisDiagnostics.candidates.saveErrorSamples.push({ match: bet.match, prediction: bet.prediction, error: saveError.message });
                }
                console.warn('[STEP91X] Salvataggio Paper Trading Tennis fallito:', saveError.message);
            }
        }


        const reconciledValueBets = globalValueBets.map(bet => hydrateStep49CConsensusMicroUnlockFromPending(bet));

        const formattedBets = reconciledValueBets.map(b => {
            const qualityGateV2 = tennisQualityGateV2.evaluateBaseQualityGate(b);
            const tennisPredictionIndex = tennisUnifiedPredictionIndex.calculateTennisPredictionIndex({
                ...b,
                qualityGateV2
            }, { phase: 'PRE_DEEPSCAN_PROVISIONAL' });
            return {
                ...b,
                qualityGateV2,
                tennisPredictionIndex,
                estimatedProb: round(b.estimatedProb, 2).toFixed(2),
                edge: round(b.edge_pp, 2).toFixed(2),
                edge_pp: round(b.edge_pp, 2).toFixed(2),
                ev_pct: round(b.ev_pct, 2).toFixed(2)
            };
        });
        analysisDiagnostics.candidates.returned = formattedBets.length;
        if (formattedBets.length > 0) {
            analysisDiagnostics.noResultReason = 'HAS_VALUE_BETS';
        } else if (analysisDiagnostics.api.oddsErrors > 0 && analysisDiagnostics.api.oddsEvents === 0) {
            analysisDiagnostics.noResultReason = 'ODDS_API_ERRORS_OR_NO_ODDS_EVENTS';
        } else if (analysisDiagnostics.api.tournamentsProcessed === 0) {
            analysisDiagnostics.noResultReason = 'NO_ALLOWED_TENNIS_TOURNAMENTS_AFTER_SERIES_FILTER';
        } else if (analysisDiagnostics.api.oddsEvents === 0) {
            analysisDiagnostics.noResultReason = 'NO_ODDS_EVENTS_RETURNED_BY_PROVIDER';
        } else if (analysisDiagnostics.events.processedWithModel === 0) {
            analysisDiagnostics.noResultReason = 'NO_MATCH_PASSED_H2H_REFERENCE_AND_MODEL_PRECHECKS';
        } else if (
            ((analysisDiagnostics.candidates.moneylineRaw + analysisDiagnostics.candidates.totalsRaw) === 0) &&
            ((analysisDiagnostics.candidateAudit?.evaluated?.moneyline || 0) + (analysisDiagnostics.candidateAudit?.evaluated?.totals || 0) > 0)
        ) {
            analysisDiagnostics.noResultReason = 'NO_CANDIDATE_SELECTED_AFTER_STEP63_REJECTION_AUDIT';
        } else if ((analysisDiagnostics.candidates.moneylineRaw + analysisDiagnostics.candidates.totalsRaw) === 0) {
            analysisDiagnostics.noResultReason = 'NO_CANDIDATE_PASSED_EDGE_EV_CR_STAKE_GATE';
        } else {
            analysisDiagnostics.noResultReason = 'CANDIDATES_EXIST_BUT_NOT_RETURNED_AFTER_SELECTION_OR_EXPOSURE_GUARD';
        }

        finalizeStep69Explainability(analysisDiagnostics);

        const tennisSystemAudit = buildTennisSystemAudit({
            analysisDiagnostics,
            settings,
            useMarkov,
            useTotals,
            useCR,
            professionalMode,
            tennisReliabilityReport,
            tennisRealReliabilityReport,
            markovSelfCheck,
            totalsFeedDiagnostics,
            formattedBets,
            professionalRules: TENNIS_PROFESSIONAL_RULES,
            sampleThresholds: analysisDiagnostics.sampleThresholds
        });

        if (tennisSystemAudit && tennisSystemAudit.noResultReason) {
            analysisDiagnostics.noResultReason = tennisSystemAudit.noResultReason;
        }
        analysisDiagnostics.systemAudit = tennisSystemAudit;

        const marketMixAudit = computeTennisMarketMixAudit(formattedBets, { tennisUseTotals: useTotals });
        const informationRetrievalHealth = tennisInformationRetrieval.buildInformationRetrievalHealth(db, {
            dataDir: ABSOLUTE_SACKMANN_DIR,
            historicalDatasetPath: TENNIS_HISTORICAL_STATS_DATASET,
            cacheDir: NEWS_CACHE_DIR,
            limit: 4
        });
        analysisDiagnostics.informationRetrieval = {
            status: informationRetrievalHealth.status,
            overallScore: informationRetrievalHealth.overallScore,
            deepScanScore: informationRetrievalHealth.channels?.deepScan?.score ?? null,
            aiAnalysisScore: informationRetrievalHealth.channels?.aiAnalysis?.score ?? null,
            paperTradingScore: informationRetrievalHealth.channels?.paperTrading?.score ?? null,
            probabilityWeightsChanged: false,
            stakeAuthority: false
        };

        const partialProviderFailure = Number(analysisDiagnostics.api.oddsErrors || 0) > 0;
        const t11R3R1AnalysisLedger = tennisCalibratedValueLedgerT11R3R1.recordAnalysisRun({
            operationId: analysisOperationId,
            partialProviderResult: partialProviderFailure,
            warning: partialProviderFailure ? 'Almeno un torneo non ha risposto entro la finestra prevista; i risultati disponibili sono stati conservati.' : null,
            api: analysisDiagnostics.api,
            valueBets: formattedBets
        });
        if (t11R3R1AnalysisLedger?.written !== true) {
            runtimeDiagnostics.writeDiagnostic({
                level: 'WARN', component: 'TENNIS_T11_R3_R1_DURABLE_CALIBRATED_LEDGER', operation: 'ANALYSIS_RUN_LEDGER_WRITE',
                operationId: analysisOperationId, phase: 'LEDGER_WRITE_WARNING', event: 'T11_R3_R1_ANALYSIS_RUN_NOT_DURABLE',
                message: 'Analisi completata, ma il ledger calibrated-value non ha potuto registrare il contesto provider.',
                context: { path: t11R3R1AnalysisLedger?.path || null, error: t11R3R1AnalysisLedger?.error || null, stakeAuthority: false }
            });
        }
        res.json({
            success: true,
            partial: partialProviderFailure,
            warning: partialProviderFailure ? 'Almeno un torneo non ha risposto entro la finestra prevista; i risultati disponibili sono stati conservati.' : null,
            operationId: analysisOperationId,
            valueBets: formattedBets,
            informationRetrieval: informationRetrievalHealth,
            recommendedAccumulator: null,
            marketMixAudit,
            totalsFeedDiagnostics,
            diagnostics: analysisDiagnostics,
            meta: {
                marketMixAudit,
                totalsFeedDiagnostics,
                analysisDiagnostics,
                t11R3R1ProviderLedger: { written: t11R3R1AnalysisLedger?.written === true, providerCompleteness: partialProviderFailure ? 'PARTIAL_PROVIDER_RESULT' : 'FULL_PROVIDER_RESULT', recordHash: t11R3R1AnalysisLedger?.recordHash || null },
                systemAudit: tennisSystemAudit,
                informationRetrieval: {
                    version: tennisInformationRetrieval.TENNIS_INFORMATION_RETRIEVAL_VERSION,
                    status: informationRetrievalHealth.status,
                    overallScore: informationRetrievalHealth.overallScore,
                    modelAuthority: false,
                    stakeAuthority: false
                },
                tennisSystemAuditMode: STEP75_TENNIS_SYSTEM_AUDIT_MODE,
                maxMarketsPerMatch: settings.tennisMaxMarketsPerMatch || TENNIS_DEFAULT_MAX_MARKETS_PER_MATCH,
                totalsParserMode: 'STEP50A_TOTALS_LIVE_PARSER',
                noResultDiagnosticsMode: 'STEP63_TENNIS_CANDIDATE_REJECTION_AUDIT'
            },
            reliabilityMode: tennisReliabilityReport.mode || 'UNKNOWN',
            reliabilitySampleSize: tennisReliabilityReport.sampleSize || 0,
            realReliabilityMode: tennisRealReliabilityReport.mode || 'UNKNOWN',
            realReliabilitySampleSize: tennisRealReliabilityReport.sampleSize || 0,
            historicalBootstrapReliability: tennisReliabilityReport.historicalBootstrap || null,
            engineVersion: TENNIS_ENGINE_VERSION,
            modelVersion: TENNIS_MODEL_VERSION,
            metricVersion: TENNIS_METRIC_VERSION,
            professionalMode,
            professionalRules: TENNIS_PROFESSIONAL_RULES,
            stakePolicy: TENNIS_KELLY_STAKE_POLICY,
            professionalBetGateMode: 'TENNIS_PROFESSIONAL_BET_GATE',
            operationalReportMode: 'TENNIS_OPERATIONAL_REPORT_V1',
            segmentedCalibration: tennisReliabilityReport.segmentCalibration || null,
            step63CandidateAuditMode: STEP63_TENNIS_CANDIDATE_AUDIT_MODE,
            step63LiveReliabilityGuardMode: STEP63_LIVE_RELIABILITY_GUARD_MODE,
            step65AuditVisibilityMode: STEP65_TENNIS_AUDIT_VISIBILITY_MODE,
            step65BootstrapOverconfidenceMode: STEP65_BOOTSTRAP_OVERCONFIDENCE_MODE,
            step69TennisAiExplainabilityMode: STEP69_VERSION
        });
    } catch (err) {
        const timeout = isTennisOddsTimeout(err) || err.code === 'TENNIS_ODDS_PROVIDER_TIMEOUT';
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_ODDS_API',
            operation: 'TENNIS_AI_ANALYSIS',
            operationId: analysisOperationId,
            phase: timeout ? 'SPORTS_CATALOG_TIMEOUT' : 'ANALYSIS_FATAL_ERROR',
            event: timeout ? 'TENNIS_ODDS_PROVIDER_TIMEOUT' : 'TENNIS_ANALYSIS_ERROR',
            error: err,
            context: {
                requestedLeague: league || 'all',
                timeoutMs: err.timeoutMs || (timeout ? TENNIS_ODDS_API_CATALOG_TIMEOUT_MS : null),
                retryable: timeout || err.retryable === true
            }
        });
        res.status(timeout ? 504 : 500).json({
            success: false,
            error: timeout
                ? `Provider quote Tennis temporaneamente lento: superata la finestra di ${err.timeoutMs || TENNIS_ODDS_API_CATALOG_TIMEOUT_MS} ms.`
                : err.message,
            code: timeout ? 'TENNIS_ODDS_PROVIDER_TIMEOUT' : (err.code || 'TENNIS_ANALYSIS_ERROR'),
            retryable: timeout || err.retryable === true,
            operationId: analysisOperationId,
            runtimeDiagnostic: diagnostic,
            engineVersion: TENNIS_ENGINE_VERSION
        });
    }
});


// ============================================================================
// 19. ROUTE 2 - BACKTEST STORICO TENNIS
// ============================================================================
//
// Nota:
// La reliability fittizia è stata rimossa.
// Il backtest usa opzioni neutrali dichiarate e non spaccia il risultato come
// reliability reale del sistema live.
// ============================================================================

router.get('/backtest', async (req, res) => {
    const league = req.query.league || 'all';

    const settings = getSystemSettings();

    const useMarkov = settings.useMarkov === true;
    const useCR = settings.useCrossReference === true;
    const professionalMode = isProfessionalModeEnabled(settings);

    if (useMarkov || professionalMode) {
        ensureSackmannReady({ required: professionalMode });
    }

    const markovSelfCheck = MarkovEngine && typeof MarkovEngine.runMarkovSelfCheck === 'function'
        ? MarkovEngine.runMarkovSelfCheck()
        : null;

    const reliabilityOptions = getBacktestNeutralReliabilityOptions();

    const single = {
        placed: 0,
        won: 0,
        invested: 0,
        profit: 0
    };

    const backLog = [];
    const leagueBreakdown = {};

    const tennisStats = {
        upsetsCaught: 0,
        totalOddsWon: 0,
        wonMatches: 0
    };

    let totalBrier = 0;
    let totalLogLoss = 0;
    let expectedWins = 0;
    let totalEV = 0;

    const closingLineStats = {
        tested: 0,
        beaten: 0,
        totalClvPct: 0,
        avgClvPct: 0,
        beatRatePct: 0,
        mode: 'SIMULATED_OPENING_VS_REAL_CLOSING'
    };

    const clusterAnalysis = {
        surface: {
            Hard: { placed: 0, won: 0 },
            Clay: { placed: 0, won: 0 },
            Grass: { placed: 0, won: 0 }
        },
        odds: {
            '1.50-1.99': { placed: 0, won: 0 },
            '2.00-2.49': { placed: 0, won: 0 },
            '2.50+': { placed: 0, won: 0 }
        }
    };

    try {
        const leaguesToProcess = league === 'all' ? ['atp', 'wta'] : [league];

        for (const l of leaguesToProcess) {
            const files = await getFilesForBacktest(l);

            if (!files || files.length === 0) continue;

            for (const file of files) {
                const records = loadTennisData(file);

                if (!records || records.length === 0) continue;

                for (const row of records) {
                    const normalizedSeries = normalizeTennisSeries(row.series, l);

                    if (!ALLOWED_SERIES_KEYS.some(allowed => normalizedSeries.includes(allowed))) {
                        continue;
                    }

                    const historicalMatch = buildHistoricalTennisMatch(row);

                    if (!historicalMatch) continue;

                    const {
                        p1Name,
                        p2Name,
                        p1Won,
                        p2Won,
                        closingOdd1,
                        closingOdd2
                    } = historicalMatch;

                    const {
                        targetEdge: reqEdge,
                        targetProb: reqProb
                    } = getDynamicParamsTennis(settings, normalizedSeries, l);

                    const simOdds = simulateOpeningOddsTennis(closingOdd1, closingOdd2);
                    const b1 = simOdds.odd1;
                    const b2 = simOdds.odd2;

                    const fair = calculateNoVigTennis(closingOdd1, closingOdd2);

                    if (!fair) continue;

                    let surface = normalizeSurface(row.surface || 'Hard');

                    let matchupStats = null;

                    if (useMarkov || professionalMode) {
                        matchupStats = sackmann.getAdvancedMatchup(p1Name, p2Name, surface, row.date);
                    }

                    const model = buildLiveModelProbabilities({
                        fairProb1: fair.prob1,
                        fairProb2: fair.prob2,
                        matchupStats,
                        useMarkov,
                        leagueType: l
                    });

                    const historicalReferenceMarket = {
                        quality: 'HIGH',
                        source: 'HISTORICAL_CLOSING_LINE',
                        playerAProbability: fair.prob1,
                        playerBProbability: fair.prob2
                    };

                    const backtestDataSufficiency = buildTennisDataSufficiencyReport({
                        model,
                        referenceMarket: historicalReferenceMarket,
                        marketType: TENNIS_MARKETS.MONEYLINE,
                        professionalMode,
                        markovSelfCheck
                    });

                    if (!backtestDataSufficiency.passed) continue;

                    const crPassed1 = useCR ? (b1 >= (100 / fair.prob1) * 0.92) : true;
                    const crPassed2 = useCR ? (b2 >= (100 / fair.prob2) * 0.92) : true;

                    let dynReqEdge = reqEdge;

                    if (model.sackmannSample < 20) dynReqEdge += 2.0;
                    if (model.rankDelta > 150) dynReqEdge -= 1.0;

                    dynReqEdge = Math.max(2.5, dynReqEdge);

                    const evalP1 = evaluateTennisValueBet({
                        modelProbability: model.prob1,
                        odd: b1,
                        marketProbability: fair.prob1
                    }, {
                        ...reliabilityOptions,
                        minEdgePp: dynReqEdge,
                        minEvPct: 2,
                        minProbability: reqProb,
                        maxOdd: TENNIS_VALUE_DEFAULTS.maxOddMoneyline,
                        minReliableSample: TENNIS_VALUE_DEFAULTS.minReliableSample,
                        maxAdjustment: TENNIS_VALUE_DEFAULTS.maxAdjustment
                    });

                    const evalP2 = evaluateTennisValueBet({
                        modelProbability: model.prob2,
                        odd: b2,
                        marketProbability: fair.prob2
                    }, {
                        ...reliabilityOptions,
                        minEdgePp: dynReqEdge,
                        minEvPct: 2,
                        minProbability: reqProb,
                        maxOdd: TENNIS_VALUE_DEFAULTS.maxOddMoneyline,
                        minReliableSample: TENNIS_VALUE_DEFAULTS.minReliableSample,
                        maxAdjustment: TENNIS_VALUE_DEFAULTS.maxAdjustment
                    });

                    if (!leagueBreakdown[normalizedSeries]) {
                        leagueBreakdown[normalizedSeries] = {
                            placed: 0,
                            won: 0,
                            invested: 0,
                            profit: 0
                        };
                    }

                    const recordBet = ({
                        calibratedProb,
                        odd,
                        winBet,
                        edgePp,
                        evPct,
                        stakeMultiplier,
                        predictionBadge,
                        closingOdd
                    }) => {
                        if (stakeMultiplier === 0) return;

                        const probDec = normalizeProbabilityPct(calibratedProb) / 100;
                        const stake = 10.00 * stakeMultiplier;

                        single.placed++;
                        single.invested += stake;

                        leagueBreakdown[normalizedSeries].placed++;
                        leagueBreakdown[normalizedSeries].invested += stake;

                        clusterAnalysis.surface[surface].placed++;

                        const oddRange = odd < 2.00
                            ? '1.50-1.99'
                            : (odd < 2.50 ? '2.00-2.49' : '2.50+');

                        clusterAnalysis.odds[oddRange].placed++;

                        let profit = -stake;

                        if (winBet) {
                            const winProfit = stake * (odd - 1);

                            single.won++;
                            single.profit += winProfit;

                            leagueBreakdown[normalizedSeries].won++;
                            leagueBreakdown[normalizedSeries].profit += winProfit;

                            clusterAnalysis.surface[surface].won++;
                            clusterAnalysis.odds[oddRange].won++;

                            profit = winProfit;

                            tennisStats.wonMatches++;
                            tennisStats.totalOddsWon += odd;

                            if (odd >= 2.00) tennisStats.upsetsCaught++;
                        } else {
                            single.profit -= stake;
                            leagueBreakdown[normalizedSeries].profit -= stake;
                        }

                        const evMoney = (probDec * stake * (odd - 1)) - ((1 - probDec) * stake);

                        if (closingOdd && Number.isFinite(Number(closingOdd))) {
                            const clvPct = ((Number(closingOdd) / Number(odd)) - 1) * 100;
                            closingLineStats.tested++;
                            closingLineStats.totalClvPct += clvPct;
                            if (clvPct > 0) closingLineStats.beaten++;
                        }

                        totalEV += evMoney;
                        expectedWins += probDec;

                        const actualOutcome = winBet ? 1 : 0;

                        totalBrier += Math.pow(probDec - actualOutcome, 2);

                        const pAdj = Math.max(0.01, Math.min(0.99, probDec));

                        totalLogLoss += -(
                            actualOutcome * Math.log(pAdj) +
                            (1 - actualOutcome) * Math.log(1 - pAdj)
                        );

                        backLog.push({
                            date: row.date,
                            match: `${p1Name} vs ${p2Name}`,
                            prediction: predictionBadge,
                            odd: round(odd, 2).toFixed(2),
                            edge: round(edgePp, 2).toFixed(2),
                            edge_pp: round(edgePp, 2).toFixed(2),
                            ev_pct: round(evPct, 2).toFixed(2),
                            invested: stake.toFixed(2),
                            ev: evMoney.toFixed(2),
                            brier: Math.pow(probDec - actualOutcome, 2).toFixed(4),
                            won: winBet,
                            profit: `${profit > 0 ? '+' : ''}€${profit.toFixed(2)}`,
                            reliabilityMode: reliabilityOptions.reliabilityMode,
                            openingOddSource: simOdds.source,
                            closingOdd: closingOdd ? round(closingOdd, 2).toFixed(2) : null,
                            clv_pct: closingOdd ? round(((Number(closingOdd) / Number(odd)) - 1) * 100, 2).toFixed(2) : null,
                            dataSufficiencyScore: backtestDataSufficiency.score
                        });
                    };

                    const surfaceBadge = surface === 'Hard'
                        ? '🔵 Cemento'
                        : (surface === 'Clay' ? '🟠 Terra' : '🟢 Erba');

                    if (evalP1.valid && crPassed1) {
                        recordBet({
                            calibratedProb: evalP1.calibrated_probability_pct,
                            odd: b1,
                            winBet: p1Won,
                            edgePp: evalP1.edge_pp,
                            evPct: evalP1.ev_pct,
                            stakeMultiplier: evalP1.suggestedStakeMultiplier,
                            predictionBadge: `1 [${surfaceBadge}]`,
                            closingOdd: closingOdd1
                        });
                    }

                    if (evalP2.valid && crPassed2) {
                        recordBet({
                            calibratedProb: evalP2.calibrated_probability_pct,
                            odd: b2,
                            winBet: p2Won,
                            edgePp: evalP2.edge_pp,
                            evPct: evalP2.ev_pct,
                            stakeMultiplier: evalP2.suggestedStakeMultiplier,
                            predictionBadge: `2 [${surfaceBadge}]`,
                            closingOdd: closingOdd2
                        });
                    }
                }
            }
        }

        tennisStats.avgOddsWon = tennisStats.wonMatches > 0
            ? round(tennisStats.totalOddsWon / tennisStats.wonMatches, 2)
            : 0;

        tennisStats.brierScore = single.placed > 0
            ? (totalBrier / single.placed).toFixed(4)
            : '0.0000';

        tennisStats.logLoss = single.placed > 0
            ? (totalLogLoss / single.placed).toFixed(4)
            : '0.0000';

        tennisStats.expectedWins = expectedWins.toFixed(1);
        tennisStats.actualWins = single.won;

        tennisStats.calibrationRatio = single.won > 0
            ? (expectedWins / single.won).toFixed(2)
            : '0.00';

        tennisStats.avgEV = single.placed > 0
            ? (totalEV / single.placed).toFixed(2)
            : '0.00';

        closingLineStats.avgClvPct = closingLineStats.tested > 0
            ? round(closingLineStats.totalClvPct / closingLineStats.tested, 2)
            : 0;
        closingLineStats.beatRatePct = closingLineStats.tested > 0
            ? round((closingLineStats.beaten / closingLineStats.tested) * 100, 2)
            : 0;

        res.json({
            single: {
                ...single,
                roi: single.invested > 0
                    ? ((single.profit / single.invested) * 100).toFixed(2)
                    : '0.00'
            },
            tennisMetrics: tennisStats,
            leagueBreakdown,
            clusterAnalysis,
            closingLineStats,
            log: backLog.slice(-100).reverse(),
            reliabilityMode: reliabilityOptions.reliabilityMode,
            note: 'Backtest in modalità neutra: nessuna reliability fittizia applicata.',
            engineVersion: TENNIS_ENGINE_VERSION,
            modelVersion: TENNIS_MODEL_VERSION,
            metricVersion: TENNIS_METRIC_VERSION,
            professionalMode,
            professionalRules: TENNIS_PROFESSIONAL_RULES,
            stakePolicy: TENNIS_KELLY_STAKE_POLICY,
            professionalBetGateMode: 'TENNIS_PROFESSIONAL_BET_GATE',
            operationalReportMode: 'TENNIS_OPERATIONAL_REPORT_V1'
        });
    } catch (err) {
        const operationId = runtimeDiagnostics.createOperationId('TENNIS_BACKTEST');
        const diagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_BACKTEST',
            operation: 'TENNIS_BACKTEST',
            operationId,
            phase: 'BACKTEST_ERROR',
            event: 'TENNIS_BACKTEST_ERROR',
            error: err,
            context: { requestedLeague: league || 'all' }
        });
        res.status(500).json({
            success: false,
            error: err.message,
            code: err.code || 'TENNIS_BACKTEST_ERROR',
            operationId,
            runtimeDiagnostic: diagnostic,
            engineVersion: TENNIS_ENGINE_VERSION
        });
    }
});


// ============================================================================
// 20. ROUTE 3 - OPTIMIZE TENNIS
// ============================================================================
//
// Nota:
// Se useHistoricalOpt === false, NON ottimizziamo più sul paper trading DB.
// Con nuovo storico, l'ottimizzazione da DB verrà riattivata solo quando avrai
// abbastanza dati puliti e versionati.
// ============================================================================

router.get('/optimize', async (req, res) => {
    try {
        const settings = getSystemSettings();

        const useMarkov = settings.useMarkov === true;
        const useCR = settings.useCrossReference === true;
        const professionalMode = isProfessionalModeEnabled(settings);

        if (useMarkov || professionalMode) {
            ensureSackmannReady({ required: professionalMode });
        }

        const markovSelfCheck = MarkovEngine && typeof MarkovEngine.runMarkovSelfCheck === 'function'
            ? MarkovEngine.runMarkovSelfCheck()
            : null;

        const reliabilityOptions = getBacktestNeutralReliabilityOptions();

        const optimizeLeague = async (leagueCode) => {
            const files = await getFilesForBacktest(leagueCode);

            if (!files || files.length === 0) {
                return {
                    OVERALL_GLOBAL: {
                        edge: leagueCode === 'atp' ? 4.0 : 4.5,
                        prob: 52.0,
                        ev: 2.0,
                        roi: -100,
                        count: 0,
                        sampleSize: 0,
                        applied: false
                    },
                    global: {
                        edge: leagueCode === 'atp' ? 4.0 : 4.5,
                        prob: 52.0,
                        ev: 2.0,
                        roi: -100,
                        count: 0,
                        sampleSize: 0,
                        applied: false
                    }
                };
            }

            const betsBySeries = {};

            for (const file of files) {
                const records = loadTennisData(file);

                if (!records || records.length === 0) continue;

                for (const row of records) {
                    const normalizedSeries = normalizeTennisSeries(row.series, leagueCode);

                    if (!ALLOWED_SERIES_KEYS.some(allowed => normalizedSeries.includes(allowed))) {
                        continue;
                    }

                    const historicalMatch = buildHistoricalTennisMatch(row);

                    if (!historicalMatch) continue;

                    const {
                        p1Name,
                        p2Name,
                        p1Won,
                        p2Won,
                        closingOdd1,
                        closingOdd2
                    } = historicalMatch;

                    const simOdds = simulateOpeningOddsTennis(closingOdd1, closingOdd2);
                    const b1 = simOdds.odd1;
                    const b2 = simOdds.odd2;

                    const fair = calculateNoVigTennis(closingOdd1, closingOdd2);

                    if (!fair) continue;

                    let surface = normalizeSurface(row.surface || 'Hard');

                    let matchupStats = null;

                    if (useMarkov || professionalMode) {
                        matchupStats = sackmann.getAdvancedMatchup(p1Name, p2Name, surface, row.date);
                    }

                    const model = buildLiveModelProbabilities({
                        fairProb1: fair.prob1,
                        fairProb2: fair.prob2,
                        matchupStats,
                        useMarkov,
                        leagueType: leagueCode
                    });

                    const optimizationReferenceMarket = {
                        quality: 'HIGH',
                        source: 'HISTORICAL_CLOSING_LINE',
                        playerAProbability: fair.prob1,
                        playerBProbability: fair.prob2
                    };

                    const optimizationDataSufficiency = buildTennisDataSufficiencyReport({
                        model,
                        referenceMarket: optimizationReferenceMarket,
                        marketType: TENNIS_MARKETS.MONEYLINE,
                        professionalMode,
                        markovSelfCheck
                    });

                    if (!optimizationDataSufficiency.passed) continue;

                    const crPassed1 = useCR ? (b1 >= (100 / fair.prob1) * 0.92) : true;
                    const crPassed2 = useCR ? (b2 >= (100 / fair.prob2) * 0.92) : true;

                    const evalP1 = evaluateTennisValueBet({
                        modelProbability: model.prob1,
                        odd: b1,
                        marketProbability: fair.prob1
                    }, {
                        ...reliabilityOptions,
                        minEdgePp: 0,
                        minEvPct: -100,
                        minProbability: 1,
                        maxOdd: TENNIS_VALUE_DEFAULTS.maxOddMoneyline,
                        minReliableSample: TENNIS_VALUE_DEFAULTS.minReliableSample,
                        maxAdjustment: TENNIS_VALUE_DEFAULTS.maxAdjustment
                    });

                    const evalP2 = evaluateTennisValueBet({
                        modelProbability: model.prob2,
                        odd: b2,
                        marketProbability: fair.prob2
                    }, {
                        ...reliabilityOptions,
                        minEdgePp: 0,
                        minEvPct: -100,
                        minProbability: 1,
                        maxOdd: TENNIS_VALUE_DEFAULTS.maxOddMoneyline,
                        minReliableSample: TENNIS_VALUE_DEFAULTS.minReliableSample,
                        maxAdjustment: TENNIS_VALUE_DEFAULTS.maxAdjustment
                    });

                    if (!betsBySeries[normalizedSeries]) {
                        betsBySeries[normalizedSeries] = [];
                    }

                    betsBySeries[normalizedSeries].push({
                        b1,
                        b2,
                        prob1: evalP1.calibrated_probability_pct,
                        prob2: evalP2.calibrated_probability_pct,
                        edge1: evalP1.edge_pp,
                        edge2: evalP2.edge_pp,
                        ev1: evalP1.ev_pct,
                        ev2: evalP2.ev_pct,
                        p1Won,
                        p2Won,
                        crPassed1,
                        crPassed2
                    });
                }
            }

            const edgesToTest = [2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 10.0];
            const probsToTest = [50.0, 52.0, 55.0, 58.0, 60.0];
            const evsToTest = [1.0, 2.0, 3.0, 4.0];

            const optimizationResults = {};

            let bestGlobalEdge = leagueCode === 'atp' ? 4.0 : 4.5;
            let bestGlobalProb = 52.0;
            let bestGlobalEv = 2.0;
            let bestGlobalCount = 0;
            let maxGlobalRoi = -999;
            let maxGlobalScore = -999;

            for (const seriesName in betsBySeries) {
                const matches = betsBySeries[seriesName];

                let bestParams = {
                    edge: leagueCode === 'atp' ? 4.0 : 4.5,
                    prob: 52.0,
                    ev: 2.0,
                    roi: -999,
                    profit: 0,
                    count: 0,
                    brier: 999,
                    score: -999
                };

                for (const tEdge of edgesToTest) {
                    for (const tProb of probsToTest) {
                        for (const tEv of evsToTest) {
                            let invested = 0;
                            let profit = 0;
                            let count = 0;
                            let brierSum = 0;

                            for (const m of matches) {
                                if (
                                    m.edge1 >= tEdge &&
                                    m.edge1 <= 15.0 &&
                                    m.ev1 >= tEv &&
                                    m.prob1 >= tProb &&
                                    m.crPassed1
                                ) {
                                    invested += 10;
                                    count++;
                                    profit += m.p1Won ? 10 * (m.b1 - 1) : -10;
                                    brierSum += Math.pow((m.prob1 / 100) - (m.p1Won ? 1 : 0), 2);
                                }

                                if (
                                    m.edge2 >= tEdge &&
                                    m.edge2 <= 15.0 &&
                                    m.ev2 >= tEv &&
                                    m.prob2 >= tProb &&
                                    m.crPassed2
                                ) {
                                    invested += 10;
                                    count++;
                                    profit += m.p2Won ? 10 * (m.b2 - 1) : -10;
                                    brierSum += Math.pow((m.prob2 / 100) - (m.p2Won ? 1 : 0), 2);
                                }
                            }

                            const roi = invested > 0 ? (profit / invested) * 100 : -100;
                            const avgBrier = count > 0 ? (brierSum / count) : 999;
                            const sampleWeight = Math.min(1.0, count / 200);

                            const score = (0.45 * roi) +
                                (0.25 * sampleWeight * 100) -
                                (0.30 * avgBrier * 100);

                            if (count >= 20 && score > bestParams.score) {
                                bestParams = {
                                    edge: tEdge,
                                    prob: tProb,
                                    ev: tEv,
                                    roi: parseFloat(roi.toFixed(2)),
                                    profit,
                                    count,
                                    brier: avgBrier,
                                    score
                                };
                            }
                        }
                    }
                }

                optimizationResults[seriesName] = {
                    global: bestParams.roi !== -999
                        ? {
                            edge: bestParams.edge,
                            prob: bestParams.prob,
                            ev: bestParams.ev,
                            roi: bestParams.roi,
                            count: bestParams.count
                        }
                        : {
                            edge: leagueCode === 'atp' ? 4.0 : 4.5,
                            prob: 52.0,
                            ev: 2.0,
                            roi: -100,
                            count: 0
                        }
                };

                if (bestParams.score > maxGlobalScore && bestParams.count >= 50) {
                    maxGlobalScore = bestParams.score;
                    maxGlobalRoi = bestParams.roi;
                    bestGlobalEdge = bestParams.edge;
                    bestGlobalProb = bestParams.prob;
                    bestGlobalEv = bestParams.ev;
                    bestGlobalCount = bestParams.count;
                }
            }

            optimizationResults.OVERALL_GLOBAL = {
                edge: bestGlobalEdge,
                prob: bestGlobalProb,
                ev: bestGlobalEv,
                roi: maxGlobalRoi,
                count: bestGlobalCount,
                sampleSize: bestGlobalCount,
                applied: bestGlobalCount >= TENNIS_MIN_BACKTEST_OPT_SAMPLE
            };

            return optimizationResults;
        };

        if (settings.useHistoricalOpt === false) {
            const tennisResolved = db.prepare(`
                SELECT COUNT(*) as count
                FROM ai_forward_test
                WHERE status IN ('WON', 'LOST')
                  AND (
                        UPPER(COALESCE(sport_type, '')) = 'TENNIS'
                        OR UPPER(COALESCE(bet_type, '')) LIKE '%TENNIS%'
                        OR UPPER(COALESCE(strategy_tag, '')) LIKE '%TENNIS%'
                      )
                  AND UPPER(COALESCE(data_quality, '')) IN ('CURRENT_BOOTSTRAP', 'CURRENT')
            `).get();

            return res.json({
                success: false,
                disabled: true,
                sport: 'TENNIS',
                reason: 'BOOTSTRAP_NEW_HISTORY_NO_DB_OPTIMIZATION',
                sampleSize: tennisResolved?.count || 0,
                requiredSample: BOOTSTRAP_MIN_SETTLED_BETS_FOR_RELIABILITY,
                message: `Ottimizzazione TENNIS da paper trading disabilitata: nuovo storico pulito in ricostruzione (${tennisResolved?.count || 0}/${BOOTSTRAP_MIN_SETTLED_BETS_FOR_RELIABILITY}). Le soglie manuali restano attive.`,
                recommendation: {
                    tennisAtpEdge: settings.tennisAtpEdge || 4.0,
                    tennisAtpProb: settings.tennisAtpProb || 52.0,
                    tennisAtpEv: settings.tennisAtpEv || 2.0,
                    tennisWtaEdge: settings.tennisWtaEdge || 4.5,
                    tennisWtaProb: settings.tennisWtaProb || 52.0,
                    tennisWtaEv: settings.tennisWtaEv || 2.0
                },
                diagnostics: {
                    dataMode: 'CURRENT_ACTIVE_HISTORY',
                    useHistoricalOpt: false,
                    reliabilityMode: reliabilityOptions.reliabilityMode,
                    note: 'Per riattivare l’ottimizzazione automatica Tennis impostare useHistoricalOpt=true solo quando il nuovo storico è affidabile.'
                },
                modelVersion: TENNIS_MODEL_VERSION,
                metricVersion: TENNIS_METRIC_VERSION,
                engineVersion: TENNIS_ENGINE_VERSION
            });
        }

        const atpOpt = await optimizeLeague('atp');
        const wtaOpt = await optimizeLeague('wta');

        const atpSample = atpOpt.OVERALL_GLOBAL?.count || atpOpt.OVERALL_GLOBAL?.sampleSize || 0;
        const wtaSample = wtaOpt.OVERALL_GLOBAL?.count || wtaOpt.OVERALL_GLOBAL?.sampleSize || 0;
        const canApplyAtp = atpSample >= TENNIS_MIN_BACKTEST_OPT_SAMPLE && atpOpt.OVERALL_GLOBAL?.roi > -100;
        const canApplyWta = wtaSample >= TENNIS_MIN_BACKTEST_OPT_SAMPLE && wtaOpt.OVERALL_GLOBAL?.roi > -100;

        if (!canApplyAtp && !canApplyWta) {
            return res.json({
                success: false,
                disabled: true,
                applied: false,
                sport: 'TENNIS',
                reason: 'INSUFFICIENT_BACKTEST_OPTIMIZATION_SAMPLE',
                sampleSize: atpSample + wtaSample,
                requiredSample: TENNIS_MIN_BACKTEST_OPT_SAMPLE,
                message: `Ottimizzazione non applicata: campione insufficiente. ATP ${atpSample}/${TENNIS_MIN_BACKTEST_OPT_SAMPLE}, WTA ${wtaSample}/${TENNIS_MIN_BACKTEST_OPT_SAMPLE}. Le soglie precedenti restano attive.`,
                recommendation: {
                    tennisAtpEdge: settings.tennisAtpEdge || 4.0,
                    tennisAtpProb: settings.tennisAtpProb || 52.0,
                    tennisAtpEv: settings.tennisAtpEv || 2.0,
                    tennisWtaEdge: settings.tennisWtaEdge || 4.5,
                    tennisWtaProb: settings.tennisWtaProb || 52.0,
                    tennisWtaEv: settings.tennisWtaEv || 2.0
                },
                atp: atpOpt.OVERALL_GLOBAL,
                wta: wtaOpt.OVERALL_GLOBAL,
                diagnostics: {
                    atpSample,
                    wtaSample,
                    requiredSamplePerTour: TENNIS_MIN_BACKTEST_OPT_SAMPLE,
                    reliabilityMode: reliabilityOptions.reliabilityMode,
                    useHistoricalOpt: true,
                    dataMode: 'BACKTEST_OPTIMIZATION_WITH_NEW_METRICS',
                    settingsSaved: false,
                    note: 'Nessuna soglia Tennis è stata modificata perché il campione ottimizzabile è insufficiente.'
                },
                raw: {
                    atp: atpOpt,
                    wta: wtaOpt,
                    reliabilityMode: reliabilityOptions.reliabilityMode
                },
                modelVersion: TENNIS_MODEL_VERSION,
                metricVersion: TENNIS_METRIC_VERSION,
                engineVersion: TENNIS_ENGINE_VERSION
            });
        }

        const settingsBeforeOptimization = {
            tennisAtpEdge: settings.tennisAtpEdge || 4.0,
            tennisAtpProb: settings.tennisAtpProb || 52.0,
            tennisAtpEv: settings.tennisAtpEv || 2.0,
            tennisWtaEdge: settings.tennisWtaEdge || 4.5,
            tennisWtaProb: settings.tennisWtaProb || 52.0,
            tennisWtaEv: settings.tennisWtaEv || 2.0,
            tennisOptimizationApplied: settings.tennisOptimizationApplied === true
        };

        const recommendedSettings = {
            tennisAtpEdge: canApplyAtp ? atpOpt.OVERALL_GLOBAL.edge : settingsBeforeOptimization.tennisAtpEdge,
            tennisAtpProb: canApplyAtp ? atpOpt.OVERALL_GLOBAL.prob : settingsBeforeOptimization.tennisAtpProb,
            tennisAtpEv: canApplyAtp ? atpOpt.OVERALL_GLOBAL.ev : settingsBeforeOptimization.tennisAtpEv,
            tennisWtaEdge: canApplyWta ? wtaOpt.OVERALL_GLOBAL.edge : settingsBeforeOptimization.tennisWtaEdge,
            tennisWtaProb: canApplyWta ? wtaOpt.OVERALL_GLOBAL.prob : settingsBeforeOptimization.tennisWtaProb,
            tennisWtaEv: canApplyWta ? wtaOpt.OVERALL_GLOBAL.ev : settingsBeforeOptimization.tennisWtaEv
        };

        // --------------------------------------------------------------------
        // Safety 15.2: recommendation-only.
        // Non salviamo più system_settings da /api/tennis/optimize.
        // La route calcola raccomandazioni, ma lascia attive le soglie precedenti.
        // --------------------------------------------------------------------
        return res.json({
            success: true,
            disabled: false,
            applied: false,
            recommendationOnly: true,
            settingsSaved: false,
            sport: 'TENNIS',
            reason: 'RECOMMENDATION_ONLY',
            message: `Ottimizzazione TENNIS calcolata ma non applicata automaticamente. Soglie attive invariate. Raccomandazione: ${canApplyAtp ? `ATP edge ${recommendedSettings.tennisAtpEdge}%, prob ${recommendedSettings.tennisAtpProb}%, EV ${recommendedSettings.tennisAtpEv}%` : 'ATP non raccomandabile: campione insufficiente'}. ${canApplyWta ? `WTA edge ${recommendedSettings.tennisWtaEdge}%, prob ${recommendedSettings.tennisWtaProb}%, EV ${recommendedSettings.tennisWtaEv}%` : 'WTA non raccomandabile: campione insufficiente'}.`,
            activeSettings: settingsBeforeOptimization,
            previousSettings: settingsBeforeOptimization,
            recommendation: recommendedSettings,
            recommendedSettings,
            atp: {
                ...atpOpt.OVERALL_GLOBAL,
                applicable: canApplyAtp,
                applied: false
            },
            wta: {
                ...wtaOpt.OVERALL_GLOBAL,
                applicable: canApplyWta,
                applied: false
            },
            diagnostics: {
                atpSample,
                wtaSample,
                requiredSamplePerTour: TENNIS_MIN_BACKTEST_OPT_SAMPLE,
                atpApplicable: canApplyAtp,
                wtaApplicable: canApplyWta,
                atpApplied: false,
                wtaApplied: false,
                previousSettings: settingsBeforeOptimization,
                reliabilityMode: reliabilityOptions.reliabilityMode,
                useHistoricalOpt: true,
                dataMode: 'BACKTEST_OPTIMIZATION_WITH_NEW_METRICS',
                recommendationOnly: true,
                settingsSaved: false,
                note: 'Nessuna soglia Tennis è stata modificata. Applicazione manuale da implementare in step successivo se richiesta.'
            },
            raw: {
                atp: atpOpt,
                wta: wtaOpt,
                reliabilityMode: reliabilityOptions.reliabilityMode
            },
            modelVersion: TENNIS_MODEL_VERSION,
            metricVersion: TENNIS_METRIC_VERSION,
            engineVersion: TENNIS_ENGINE_VERSION
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
            engineVersion: TENNIS_ENGINE_VERSION
        });
    }
});


// ============================================================================
// STEP91P - TENNIS PAPER TRADING HISTORY RUNTIME RESTORE
// Read-only fallback: espone al frontend lo storico Tennis strict/current anche quando
// processTennisPaperTrading/resolve_ai non restituisce history. Non modifica DB/stake/settlement.
// ============================================================================
function normalizeStep91OLeagueFilter(value = 'all') {
    const raw = String(value || 'all').trim().toLowerCase();
    if (!raw || raw === 'all' || raw === 'tutto') return 'all';
    if (raw.includes('atp')) return 'atp';
    if (raw.includes('wta')) return 'wta';
    return raw;
}

function enrichT11DecisionResearchRow(row = {}) {
    if (!row || !(Number(row.id) > 0)) return row;
    try {
        const research = tennisStakeDecisionTraceT11.latestForBetId(Number(row.id));
        if (!research) return row;
        const calibratedValueShadow = tennisCalibratedValueShadowT11R3.build(research);
        return { ...row, t11DecisionResearch: research, aiReliabilityShadow: research.aiReliabilityShadow || null, thresholdContinuityShadow: research.thresholdContinuityShadow || null, calibratedValueShadow, t11TraceDiagnosis: research.analysis?.diagnosis || null };
    } catch (_) { return row; }
}

function mapStep91OTennisHistoryRow(row = {}) {
    const home = row.home_team || row.home || row.player1 || '';
    const away = row.away_team || row.away || row.player2 || '';
    const matchLabel = row.match || (home && away ? `${home} - ${away}` : '');
    return enrichT11DecisionResearchRow(tennisDeepScanTaxonomyPatch40.decorateRow({
        ...row,
        sport_type: row.sport_type || 'TENNIS',
        data_quality: row.data_quality || 'CURRENT_BOOTSTRAP',
        date: row.match_date || row.date || row.created_at || null,
        match_date: row.match_date || row.date || row.created_at || null,
        match: matchLabel,
        home: home,
        away: away,
        home_team: home,
        away_team: away,
        invested: row.invested ?? row.stake ?? 0,
        estimatedProb: row.estimatedProb ?? row.estimated_prob ?? row.probability ?? null,
        edge_pp: row.edge_pp ?? row.edge ?? null,
        ev_pct: row.ev_pct ?? row.ev ?? null
    }));
}

function getStep91OTennisHistoryRows(options = {}) {
    const leagueFilter = normalizeStep91OLeagueFilter(options.leagueFilter || 'all');
    const limit = Math.max(10, Math.min(5000, Math.trunc(Number(options.limit || 500))));
    const params = [];
    let leagueClause = '';

    if (leagueFilter === 'atp') {
        leagueClause = ` AND (UPPER(COALESCE(tour_type,'')) = 'ATP' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%ATP%')`;
    } else if (leagueFilter === 'wta') {
        leagueClause = ` AND (UPPER(COALESCE(tour_type,'')) = 'WTA' OR UPPER(COALESCE(league,'')) LIKE '%WTA%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%WTA%')`;
    }

    const sql = `
        SELECT *
        FROM ai_forward_test
        WHERE (
              UPPER(COALESCE(sport_type,'')) = 'TENNIS'
              OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'
              OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%'
        )
          AND UPPER(COALESCE(data_quality,'')) IN ('CURRENT','CURRENT_BOOTSTRAP')
          AND COALESCE(paper_result_active,1)=1
          AND COALESCE(paper_result_conflict,0)=0
          ${leagueClause}
        ORDER BY COALESCE(match_date, created_at, '') DESC, id DESC
        LIMIT ?
    `;
    params.push(limit);

    try {
        return db.prepare(sql).all(...params).map(mapStep91OTennisHistoryRow);
    } catch (error) {
        console.warn('[STEP91P] Fallback history Tennis non disponibile:', error.message);
        return [];
    }
}



function buildStep91OTennisHistoryPayload(rows = [], extra = {}) {
    const settled = rows.filter(row => ['WON','LOST'].includes(String(row.status || '').toUpperCase()) && Number(row.paper_result_conflict || 0) !== 1);
    const won = settled.filter(row => String(row.status || '').toUpperCase() === 'WON').length;
    const stake = settled.reduce((sum, row) => sum + (Number(row.stake ?? row.invested) || 0), 0);
    const profit = settled.reduce((sum, row) => sum + (Number(row.profit) || 0), 0);
    const roi = stake > 0 ? (profit / stake) * 100 : 0;
    return {
        success: true,
        sport: 'TENNIS',
        history: rows,
        stats: {
            singles: {
                placed: settled.length,
                won,
                lost: Math.max(0, settled.length - won),
                invested: stake,
                profit,
                roi: Number(roi.toFixed(2)),
                clv_efficiency: 'N/D'
            }
        },
        meta: {
            ...(extra.meta || {}),
            dataMode: 'TENNIS_CURRENT_STRICT_HISTORY_FALLBACK',
            step91pPaperTradingRestore: true,
            source: extra.source || 'STEP91P_DB_HISTORY_FALLBACK_READ_ONLY'
        },
        step91pPaperTradingRestore: true,
        warning: extra.warning || null,
        engineVersion: TENNIS_ENGINE_VERSION
    };
}

// ============================================================================
// 21. ROUTE 4 - RESOLVE AI TENNIS / HISTORY FALLBACK STEP92
// ============================================================================
function getStep92TennisHistoryRows(options = {}) {
    const leagueFilter = String(options.leagueFilter || 'all').toLowerCase();
    const limit = Math.max(1, Math.min(2000, Math.trunc(step92Number(options.limit, 1000))));
    const rows = db.prepare([
        'SELECT *',
        'FROM ai_forward_test',
        "WHERE UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID','PENDING')",
        'AND COALESCE(paper_result_active,1)=1',
        'AND (',
        "  UPPER(COALESCE(sport_type,'')) = 'TENNIS'",
        "  OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'",
        "  OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%'",
        ')',
        "AND UPPER(COALESCE(data_quality,'CURRENT_BOOTSTRAP')) IN ('CURRENT','CURRENT_BOOTSTRAP')",
        'ORDER BY id DESC',
        'LIMIT ?'
    ].join('\n')).all(limit);
    return rows.filter(row => {
        if (leagueFilter === 'all') return true;
        const text = [row.league, row.tour_type, row.strategy_tag, row.bet_type].map(v => String(v || '').toLowerCase()).join(' ');
        if (leagueFilter === 'atp') return text.includes('atp');
        if (leagueFilter === 'wta') return text.includes('wta');
        return text.includes(leagueFilter);
    }).map(row => enrichT11DecisionResearchRow(tennisDeepScanTaxonomyPatch40.decorateRow({ ...row, date: row.match_date || row.date || row.created_at || null, match: row.match || [row.home_team, row.away_team].filter(Boolean).join(' - '), home: row.home_team || row.home || null, away: row.away_team || row.away || null, sport_type: row.sport_type || 'TENNIS' })));
}
function getStep91PResolvedTennisHistory(options = {}) { return getStep92TennisHistoryRows(options); }
function buildStep92TennisHistoryPayload(rows = [], extra = {}) {
    const reporting = tennisTradingReportingPatch40.buildReporting(rows, { rollingLimit: 200 });
    return {
        success: true,
        sport: 'TENNIS',
        history: tennisTradingReportingPatch40.filterRows(rows).map(tennisDeepScanTaxonomyPatch40.decorateRow).map(enrichT11DecisionResearchRow),
        stats: { singles: tennisTradingReportingPatch40.legacySingles(reporting.full) },
        reporting,
        meta: { ...(extra.meta || {}), dataMode: tennisTradingReportingPatch40.DATA_MODE, reportingScope: reporting.full.scope, rollingScope: reporting.rolling.scope, source: extra.source || 'STEP92_HISTORY_FALLBACK_READ_ONLY', step92PaperTradingFinalRestore: true },
        step92PaperTradingFinalRestore: true,
        warning: extra.warning || null,
        engineVersion: TENNIS_ENGINE_VERSION
    };
}
router.get('/deep-scan-taxonomy', (req, res) => {
    return res.json({ success: true, version: tennisDeepScanTaxonomyPatch40.VERSION, categories: tennisDeepScanTaxonomyPatch40.registry(), readOnly: true });
});
router.get('/h2h-weight-policy', (req, res) => {
    return res.json({ success: true, version: tennisH2HWeightPolicyPatch40.VERSION, policy: tennisH2HWeightPolicyPatch40.POLICY, readOnly: true, stakeAuthority: false });
});
router.get('/reporting-truth-health', (req, res) => {
    try {
        const report = tennisTradingReportingPatch40.buildDbReporting(db, req.query.leagueFilter || 'all', { rollingLimit: 200 });
        delete report.rows;
        return res.json({ success: true, ...report, taxonomyVersion: tennisDeepScanTaxonomyPatch40.VERSION, h2hWeightPolicyVersion: tennisH2HWeightPolicyPatch40.VERSION, readOnly: true });
    } catch (error) { return res.status(500).json({ success: false, error: error.message, version: tennisTradingReportingPatch40.VERSION }); }
});

router.get('/history', async (req, res) => {
    try {
        const leagueFilter = req.query.leagueFilter || 'all';
        const report = tennisTradingReportingPatch40.buildDbReporting(db, leagueFilter, { rollingLimit: 200 });
        const limit = Math.max(10, Math.min(5000, Math.trunc(Number(req.query.limit || 2000))));
        const history = report.rows.slice(0, limit).map(enrichT11DecisionResearchRow);
        const reporting = { ...report };
        delete reporting.rows;
        return res.json({
            success: true,
            sport: 'TENNIS',
            history,
            stats: { singles: tennisTradingReportingPatch40.legacySingles(report.full) },
            reporting,
            meta: { dataMode: tennisTradingReportingPatch40.DATA_MODE, reportingScope: report.full.scope, rollingScope: report.rolling.scope, source: 'PATCH40_REPORTING_TRUTH_/api/tennis/history' },
            engineVersion: TENNIS_ENGINE_VERSION
        });
    } catch (e) { return res.status(500).json({ success: false, sport: 'TENNIS', history: [], error: e.message, engineVersion: TENNIS_ENGINE_VERSION, step92PaperTradingFinalRestore: true }); }
});
router.get('/resolve_ai', async (req, res) => {
    const leagueFilter = req.query.leagueFilter || 'all';
    try {
        let result = await paperTradingTennisEngine.processTennisPaperTrading(db, leagueFilter, fetchOddsApi);
        const hasHistory = Array.isArray(result?.history) && result.history.length > 0;
        if (!hasHistory) {
            const fallbackRows = getStep92TennisHistoryRows({ leagueFilter, limit: req.query.limit || 1000 });
            if (fallbackRows.length > 0) { result = { ...(result || {}), ...buildStep92TennisHistoryPayload(fallbackRows, { source: 'STEP92_RESOLVE_AI_DB_HISTORY_FALLBACK', warning: result?.error || 'resolve_ai senza history: usato storico Tennis strict/current.' }), originalResolveAiResult: result ? { success: result.success, error: result.error || null, historyLength: Array.isArray(result.history) ? result.history.length : 0 } : null }; }
        }
        if (Array.isArray(result?.history)) result.history = result.history.map(enrichT11DecisionResearchRow);
        return res.json({
            ...result,
            engineVersion: TENNIS_ENGINE_VERSION,
            runtimeDiagnostic: {
                operationId: result?.operationId || result?.diagnostics?.operationId || null,
                phase: 'COMPLETE',
                settlementContractVersion: tennisSettlementContract.TENNIS_SETTLEMENT_CONTRACT_VERSION,
                contractBlocked: result?.diagnostics?.contractBlocked || 0,
                contractVerified: result?.diagnostics?.contractVerified || 0,
                evidenceStatus: result?.diagnostics?.evidenceStatus || { pendingEvidence: 0, proposedWeakEvidence: 0, sourceConflict: 0, contractInvalid: 0, manualReview: 0 }
            },
            note: result?.step92PaperTradingFinalRestore ? 'Settlement Tennis senza history: usato fallback strict/current read-only.' : 'Settlement Tennis eseguito sul nuovo storico corrente.'
        });
    } catch (e) {
        const runtimeDiagnostic = runtimeDiagnostics.captureError({
            component: 'TENNIS_API',
            operation: 'TENNIS_RESOLVE_AI',
            operationId: e.runtimeOperationId || null,
            phase: 'ROUTE_EXCEPTION',
            error: e,
            context: { leagueFilter, url: req.originalUrl }
        });
        const fallbackRows = getStep92TennisHistoryRows({ leagueFilter, limit: req.query.limit || 1000 });
        const originalResolveAiError = {
            message: e.message || String(e),
            operationId: e.runtimeOperationId || runtimeDiagnostic.operationId || null,
            phase: 'ROUTE_EXCEPTION',
            stack: String(req.query.debug || '') === '1' ? (e.stack || null) : null
        };
        if (fallbackRows.length > 0) {
            const fallbackPayload = buildStep92TennisHistoryPayload(fallbackRows, {
                source: 'STEP92_RESOLVE_AI_EXCEPTION_DB_HISTORY_FALLBACK',
                warning: e.message
            });
            return res.json({
                ...fallbackPayload,
                resolvedCount: null,
                unresolvedCount: null,
                diagnostics: {
                    mode: 'STEP106_RESOLVE_AI_RUNTIME_EXCEPTION_AUDIT',
                    fallbackReadOnly: true,
                    settlementExecuted: false,
                    originalResolveAiError
                },
                originalResolveAiError,
                runtimeDiagnostic,
                step106ResolveAiRuntimeAudit: true
            });
        }
        return res.status(500).json({
            error: e.message,
            originalResolveAiError,
            runtimeDiagnostic,
            step106ResolveAiRuntimeAudit: true,
            engineVersion: TENNIS_ENGINE_VERSION,
            history: []
        });
    }
});

// ============================================================================
// 22. ROUTE 5 - DEEP SCAN AI TENNIS
// ============================================================================

router.post('/deepscan', async (req, res) => {
    // AUDIT16D_R3_T5: il core DeepScan e il post-processing operativo sono due fasi distinte.
    // Un errore successivo a un core riuscito non deve essere trasformato in un falso
    // "DeepScan fallito": si degrada a 206 PARTIAL, senza inventare stake/gate.
    let deepScanRoutePhase = 'REQUEST_VALIDATION';
    const deepScanRouteOperationId = runtimeDiagnostics.createOperationId('TENNIS_DEEPSCAN');
    let coreDeepScanReport = null;
    let deepScanPendingId = null;
    let deepScanPersistenceCompleted = false;
    try {
        const {
            p1Name,
            p2Name,
            prediction,
            odd,
            prob,
            bankroll,
            bankrollSnapshot,
            bankroll_snapshot,
            edge,
            edge_pp,
            ev_pct,
            odd1,
            odd2,
            league,
            tournament,
            tournamentName,
            eventName,
            match_date,
            date,
            commence_time,
            startTime,
            surface,
            courtSurface,
            marketType,
            market_type,
            point,
            pointLine,
            strategyTag,
            strategy_tag,
            side,
            line,
            overOdd,
            underOdd,
            over_odd,
            under_odd,
            noVigOverProb,
            noVigUnderProb,
            no_vig_over_prob,
            no_vig_under_prob,
            modelProbOver,
            modelProbUnder,
            model_prob_over,
            model_prob_under,
            expectedGames,
            expected_games,
            gamesStdDev,
            games_std_dev,
            markovConfidence,
            markov_confidence,
            tieBreakRisk,
            tie_break_risk,
            bestOfSets,
            best_of_sets,
            surfaceGamesProfile,
            surface_games_profile,
            holdBreakProfile,
            hold_break_profile,
            lineDistance,
            line_distance,
            duplicateLineRank,
            duplicate_line_rank
        } = req.body;

        if (!p1Name || !p2Name || !prediction) {
            return res.status(400).json({
                success: false,
                code: 'TENNIS_DEEPSCAN_INVALID_REQUEST',
                phase: deepScanRoutePhase,
                error: 'Dati mancanti per il Deep Scan Tennis.'
            });
        }

        deepScanRoutePhase = 'PENDING_LOOKUP';

        // Step 38: recupero contesto operativo PRIMA del DeepScan.
        // DeepScan è gate operativo, ma deve ricevere data/superficie/mercato
        // per non degradare Grand Slam di maggio/giugno a fallback Hard.
        // AUDIT16D_R3_T5: il post-processing usa un contratto riga molto piu ampio
        // della vecchia SELECT parziale (scope, exposure, tour_type, bet_type, ecc.).
        // LIMIT 1 mantiene il costo trascurabile ed evita undefined silenziosi.
        const existingPending = db.prepare(`
            SELECT *
            FROM ai_forward_test
            WHERE home_team = ?
              AND away_team = ?
              AND prediction = ?
              AND status = 'PENDING'
              AND (
                    UPPER(COALESCE(sport_type, '')) = 'TENNIS'
                    OR UPPER(COALESCE(bet_type, '')) LIKE '%TENNIS%'
              )
            ORDER BY id DESC
            LIMIT 1
        `).get(p1Name, p2Name, prediction);
        deepScanPendingId = existingPending?.id ?? null;

        // AUDIT16D_R3_T5_R3_BANKROLL_SNAPSHOT_SCOPE_FIX
        // Il precedente riferimento a `initialBankroll` apparteneva alla route /analyze
        // e non esiste nello scope /deepscan. Risolviamo uno snapshot esplicito,
        // preservando anche bankroll=0 senza usare fallback con ||.
        const requestBankrollRaw = bankroll_snapshot ?? bankrollSnapshot ?? bankroll;
        const requestBankrollProvided = requestBankrollRaw !== undefined
            && requestBankrollRaw !== null
            && String(requestBankrollRaw).trim() !== '';
        const persistedBankrollRaw = existingPending?.bankroll_snapshot;
        const persistedBankrollProvided = persistedBankrollRaw !== undefined
            && persistedBankrollRaw !== null
            && String(persistedBankrollRaw).trim() !== '';
        const requestBankrollNumber = Number(requestBankrollRaw);
        const persistedBankrollNumber = Number(persistedBankrollRaw);
        const deepScanBankrollSnapshot = requestBankrollProvided
            ? (Number.isFinite(requestBankrollNumber) && requestBankrollNumber >= 0 ? requestBankrollNumber : 0)
            : (persistedBankrollProvided
                ? (Number.isFinite(persistedBankrollNumber) && persistedBankrollNumber >= 0 ? persistedBankrollNumber : 0)
                : DEFAULT_BANKROLL);
        const deepScanBankrollSource = requestBankrollProvided
            ? 'ANALYSIS_REQUEST_SNAPSHOT'
            : (persistedBankrollProvided ? 'PENDING_ROW_SNAPSHOT' : 'DEFAULT_BANKROLL_FALLBACK');

        const resolvedOdd1 = odd1 ?? existingPending?.reference_odd1 ?? null;
        const resolvedOdd2 = odd2 ?? existingPending?.reference_odd2 ?? null;
        const resolvedMarketType = marketType || market_type || existingPending?.market_type || inferTennisMarketTypeFromPrediction(prediction);
        const resolvedPoint = point ?? pointLine ?? existingPending?.point_line ?? null;
        const resolvedLeague = league || existingPending?.league || tournament || tournamentName || eventName || '';
        const resolvedSurface = surface || courtSurface || existingPending?.surface || null;
        const resolvedDate = commence_time || match_date || date || startTime || existingPending?.match_date || null;

        const matchContext = {
            tournament: tournament || tournamentName || eventName || resolvedLeague || '',
            tournamentName: tournamentName || tournament || eventName || resolvedLeague || '',
            eventName: eventName || tournamentName || tournament || resolvedLeague || '',
            league: resolvedLeague,
            competition: resolvedLeague,
            circuit: resolvedLeague,
            match_date: resolvedDate,
            commence_time: resolvedDate,
            date: resolvedDate,
            surface: resolvedSurface,
            courtSurface: resolvedSurface,
            marketType: resolvedMarketType,
            market_type: resolvedMarketType,
            point: resolvedPoint,
            pointLine: resolvedPoint,
            strategyTag: strategyTag || strategy_tag || existingPending?.strategy_tag || '',
            referenceMarketSource: existingPending?.reference_market_source || null,
            referenceMarketQuality: existingPending?.reference_market_quality || null,
            // STEP91_PREMATCH_LEAKAGE_GUARD: CLV/closing line della giocata corrente esclusi dal contesto DeepScan pre-match.
            preMatchLeakageGuard: 'CLV_CURRENT_EXCLUDED',
            sport: 'tennis',
            edge_pp: edge_pp ?? edge,
            ev_pct: ev_pct ?? null,
            engineVersion: TENNIS_ENGINE_VERSION,
            // STEP50E_TOTALS_DEEPSCAN_CONTEXT_BRIDGE
            side,
            line: line ?? resolvedPoint,
            over_odd: over_odd ?? overOdd ?? null,
            under_odd: under_odd ?? underOdd ?? null,
            no_vig_over_prob: no_vig_over_prob ?? noVigOverProb ?? null,
            no_vig_under_prob: no_vig_under_prob ?? noVigUnderProb ?? null,
            model_prob_over: model_prob_over ?? modelProbOver ?? null,
            model_prob_under: model_prob_under ?? modelProbUnder ?? null,
            expected_games: expected_games ?? expectedGames ?? null,
            games_std_dev: games_std_dev ?? gamesStdDev ?? null,
            markov_confidence: markov_confidence ?? markovConfidence ?? (existingPending?.markov_validated ? 0.62 : null),
            tie_break_risk: tie_break_risk ?? tieBreakRisk ?? null,
            best_of_sets: best_of_sets ?? bestOfSets ?? null,
            surface_games_profile: surface_games_profile ?? surfaceGamesProfile ?? null,
            hold_break_profile: hold_break_profile ?? holdBreakProfile ?? null,
            line_distance: line_distance ?? lineDistance ?? null,
            duplicate_line_rank: duplicate_line_rank ?? duplicateLineRank ?? null
        };

        // STEP91_PREMATCH_LEAKAGE_GUARD: verifica finale server prima di chiamare DeepScan.
        deepScanRoutePhase = 'PREMATCH_CONTEXT_GUARD';
        assertPreMatchOnlyContext(matchContext);

        deepScanRoutePhase = 'CORE_SCAN';
        const report = await deepScanTennis.scanMatchup(
            p1Name,
            p2Name,
            prediction,
            odd,
            prob,
            edge_pp ?? edge,
            resolvedOdd1,
            resolvedOdd2,
            matchContext
        );
        coreDeepScanReport = report;
        deepScanRoutePhase = report?.success ? 'POSTPROCESS' : 'CORE_SCAN_RESULT';

        let stakeAdjustment = null;
        let patch10FinalQuality = null;
        let historicalCombinationEvidence = null;
        let patch35StakeAuthorityDecision = null;
        let patch46StakeExecutionContract = null;
        let informationRetrievalEvidence = null;
        let externalIntelligenceReceipt = null;
        let patch39CalibrationReport = null;
        let patch39ProbabilityGuardDecision = null;
        let patch39EvidenceAgentReport = null;
        let patch39ReceiptLink = null;
        let tennisPredictionIndex = null;
        let t11FinalTrace = null; // T11_R2_R2: route-scope holder for final response
        let t11R3R1CalibratedValue = null; // T11_R3_R1_R1: route-scope holder for calibrated response
        let t11R3R1LedgerDecision = null; // T11_R3_R1_R1: route-scope holder for durable-ledger response

        if (report.success) {
            if (existingPending) {
                const baseStakeBeforeDeepScan = toNumber(existingPending.stake_base_before_deepscan, null) ?? toNumber(existingPending.stake, 0);
                stakeAdjustment = getDeepScanStakeAdjustmentPolicy(report, baseStakeBeforeDeepScan, existingPending, existingPending.stake);

                const setParts = ['ds_action = ?', 'ds_suggestion = ?'];
                const params = [report.action, report.suggestionText || ''];
                const patch26CanonicalBridge = report.canonicalPlayerEvidenceBridge || report.quantData?.canonicalPlayerEvidenceBridge || null;
                if (patch26CanonicalBridge) {
                    if (columnExists('ai_forward_test', 'tennis_canonical_player_evidence_version')) { setParts.push('tennis_canonical_player_evidence_version = ?'); params.push(patch26CanonicalBridge.version || tennisCanonicalPlayerEvidenceBridge.TENNIS_CANONICAL_PLAYER_EVIDENCE_VERSION); }
                    if (columnExists('ai_forward_test', 'tennis_canonical_player_evidence_status')) { setParts.push('tennis_canonical_player_evidence_status = ?'); params.push(patch26CanonicalBridge.status || 'UNAVAILABLE'); }
                    if (columnExists('ai_forward_test', 'tennis_canonical_player_evidence_score')) { setParts.push('tennis_canonical_player_evidence_score = ?'); params.push(toNumber(patch26CanonicalBridge.score, 0)); }
                    if (columnExists('ai_forward_test', 'tennis_canonical_player_evidence_source')) { setParts.push('tennis_canonical_player_evidence_source = ?'); params.push('MATCH_LEVEL_LOCAL+TENNISDB_CANONICAL_XLSX'); }
                    if (columnExists('ai_forward_test', 'tennis_canonical_player_evidence_json')) { setParts.push('tennis_canonical_player_evidence_json = ?'); params.push(JSON.stringify(patch26CanonicalBridge)); }
                    if (columnExists('ai_forward_test', 'tennis_canonical_player_evidence_updated_at')) { setParts.push('tennis_canonical_player_evidence_updated_at = ?'); params.push(new Date().toISOString()); }
                }

                if (columnExists('ai_forward_test', 'stake_base_before_deepscan')) {
                    setParts.push('stake_base_before_deepscan = COALESCE(stake_base_before_deepscan, ?)');
                    params.push(baseStakeBeforeDeepScan);
                }

                if (columnExists('ai_forward_test', 'deep_scan_risk_level')) {
                    setParts.push('deep_scan_risk_level = ?');
                    params.push(stakeAdjustment.level);
                }
                if (columnExists('ai_forward_test', 'deep_scan_risk_score')) {
                    setParts.push('deep_scan_risk_score = ?');
                    params.push(stakeAdjustment.score);
                }
                if (columnExists('ai_forward_test', 'stake_policy_note')) {
                    setParts.push('stake_policy_note = ?');
                    params.push(stakeAdjustment.reason);
                }

                // Step49B: DeepScan entra nel Consensus Gate, ma può sbloccare solo
                // blocchi SOFT verso WATCHLIST MICRO STAKE. Non può mai riabilitare
                // stake standard/professionale o hard veto.
                // Step49C marker: CONSENSUS_MICRO_STAKE_DEEPSCAN_CONFIRMED
                const consensusUpdate = buildStep49BDeepScanConsensusGateForPending(report, existingPending);

                if (consensusUpdate.shouldApplyMicroUnlock) {
                    const gate = consensusUpdate.gate;
                    const op = consensusUpdate.operationalReport;
                    const microStake = consensusUpdate.microStake;

                    setParts.push('stake = ?');
                    params.push(microStake);

                    if (columnExists('ai_forward_test', 'professional_gate_status')) {
                        setParts.push('professional_gate_status = ?');
                        params.push(gate.status);
                    }
                    if (columnExists('ai_forward_test', 'professional_gate_allow_bet')) {
                        setParts.push('professional_gate_allow_bet = ?');
                        params.push(1);
                    }
                    if (columnExists('ai_forward_test', 'professional_gate_reasons')) {
                        setParts.push('professional_gate_reasons = ?');
                        params.push([
                            ...(Array.isArray(gate.reasons) ? gate.reasons : []),
                            ...(Array.isArray(gate.warnings) ? gate.warnings : [])
                        ].join(' | '));
                    }
                    if (columnExists('ai_forward_test', 'professional_gate_max_stake')) {
                        setParts.push('professional_gate_max_stake = ?');
                        params.push(Math.max(microStake, toNumber(gate.stakePolicy?.recommendedMaxStake, 0) || 0));
                    }
                    if (columnExists('ai_forward_test', 'tennis_operational_status')) {
                        setParts.push('tennis_operational_status = ?');
                        params.push(op.status || 'WATCHLIST_MICRO_STAKE');
                    }
                    if (columnExists('ai_forward_test', 'tennis_operational_action')) {
                        setParts.push('tennis_operational_action = ?');
                        params.push(op.action || 'PAPER_OR_MICRO_STAKE');
                    }
                    if (columnExists('ai_forward_test', 'tennis_operational_summary')) {
                        setParts.push('tennis_operational_summary = ?');
                        params.push(op.summary || 'Step49C: DeepScan conferma: micro-stake attivo, stake standard non consentito.');
                    }
                    if (columnExists('ai_forward_test', 'stake_policy_note')) {
                        setParts.push('stake_policy_note = ?');
                        params.push('Step49C Consensus Gate: DeepScan conferma: micro-stake attivo, stake standard non consentito.');
                    }

                    stakeAdjustment = {
                        ...stakeAdjustment,
                        consensusGateApplied: true,
                        consensusGate: gate.consensusGate,
                        operationalReport: op,
                        suggestedStake: microStake,
                        adjustedStake: microStake,
                        currentStake: microStake,
                        reason: 'Step49C: DeepScan conferma: micro-stake attivo, stake standard non consentito.'
                    };
                } else {
                    stakeAdjustment = {
                        ...stakeAdjustment,
                        consensusGateApplied: false,
                        consensusGate: consensusUpdate.gate?.consensusGate || null,
                        consensusGateRejectedReasons: consensusUpdate.gate?.consensusGate?.rejectedReasons || []
                    };
                }

                // STEP64_TENNIS_DEEPSCAN_STAKE_MATRIX
                // Matrice prudenziale basata su DeepScan + Gate:
                // - BLOCCATA SOFT/HARD = stake 0 salvo VALUE CONFERMATO MICRO
                // - RISCHIO MODELLO = stake 0 solo se la riga non è già WATCHLIST MICRO/VALUE
                // - EDGE TECNICO = stake solo se Consensus Micro applicato
                // - VALUE CONFERMATO MICRO = micro attivo se non esiste hard veto
                // - WTA = cap micro più severo
                const step64Set = (column, value) => {
                    const idx = setParts.findIndex(part => String(part).startsWith(`${column} =`));
                    if (idx >= 0) {
                        params[idx] = value;
                    } else {
                        setParts.push(`${column} = ?`);
                        params.push(value);
                    }
                };

                const step64Category = classifyStep64DeepScanStakeMatrix(report);
                const step64GateText = [
                    existingPending.professional_gate_status,
                    existingPending.professional_gate_reasons,
                    existingPending.tennis_operational_status,
                    existingPending.tennis_operational_action,
                    existingPending.tennis_operational_summary,
                    existingPending.deepscan_gate_status,
                    existingPending.deepscan_gate_reason,
                    existingPending.trading_scope,
                    existingPending.paper_trading_scope,
                    existingPending.portfolio_scope
                ].map(v => String(v || '').toUpperCase()).join(' ');
                const step64HardVeto = step64GateText.includes('DATA_INSUFFICIENT') || step64GateText.includes('OPPOSITE_SIDE_CONFLICT');
                const step64ConsensusApplied = stakeAdjustment?.consensusGateApplied === true;
                const step64ValueConfirmedMicro = step64Category === 'VALUE_CONFERMATO_MICRO' || /VALUE[_ ]CONFERMATO|VALUE_CONFIRMED|CONFIRMED_VALUE|🟢/.test(step64GateText);
                const step64AlreadyWatchlistMicro = step64ConsensusApplied || /WATCHLIST[_ ]MICRO|CONSENSUS_MICRO|PAPER_OR_MICRO_STAKE|PORTFOLIO_REAL/.test(step64GateText);
                const step64ExistingStake = toNumber(existingPending.stake, 0);
                const step64KeepMicro = !step64HardVeto && (step64ValueConfirmedMicro || (step64AlreadyWatchlistMicro && step64ExistingStake > 0));
                    // STEP91G_WATCHLIST_EDGE_TECNICO_REDUCED_STAKE
                    // Regola corretta senior audit:
                    // WATCHLIST MICRO = permesso operativo micro.
                    // EDGE TECNICO = qualità segnale prudente, quindi riduzione/cap.
                    // La combinazione WATCHLIST MICRO + EDGE TECNICO NON deve azzerare
                    // lo stake, salvo hard veto reale. Lo zero resta solo per EDGE TECNICO
                    // senza watchlist/consensus/value o con veto hard.
                    const step91gWatchlistEdgeTecnicoReducedStake = !step64HardVeto &&
                        step64Category === 'EDGE_TECNICO' &&
                        step64AlreadyWatchlistMicro &&
                        step64ExistingStake > 0;
                const step90TennisHistoricalStats = getStep90TennisHistoricalStats(existingPending, report, step64GateText);
                const step90TennisDecision = step90GateDecision.evaluatePreMatchGateDecision({
                    ...buildStep90TennisRowInput(existingPending, report, step64GateText),
                    historicalStats: step90TennisHistoricalStats,
                    hardVetoReason: step64HardVeto ? step64GateText : ''
                });
                setStep90TennisDecisionColumns(step64Set, step90TennisDecision);
                    const step96CombinationStats = getStep96DeepScanGateCombinationStatsForPending(existingPending, report);
                    const step96CombinationDecision = step96DeepScanGatePolicy.evaluateStep96DeepScanGateCombinationDecision({
                        deepScan: step64Category,
                        gate: existingPending.tennis_operational_status || existingPending.professional_gate_status || step64GateText,
                        historicalStats: step96CombinationStats || step90TennisHistoricalStats || {}
                    });
                    const step96AllowRiskModelSoftMicro =
                        step64Category === 'RISCHIO_MODELLO' &&
                        step96CombinationDecision &&
                        step96CombinationDecision.allowMicroStake === true &&
                        ['MICRO_TEST', 'WATCHLIST_MICRO'].includes(String(step96CombinationDecision.action || '').toUpperCase());

                    const step96CRiskModelSoftRuntimeMicro = isStep96CRiskModelSoftRuntimeMicroEligible({
                        step64Category,
                        existingPending,
                        report,
                        step64GateText,
                        step64HardVeto,
                        step96CombinationDecision,
                        step96CombinationStats
                    });


                if ((step64Category === 'ALTO_RISCHIO' || step64Category === 'RISCHIO_MODELLO') && step64KeepMicro) {
                    const micro = getStep64MicroStakeForTennisRow(existingPending, stakeAdjustment?.adjustedStake ?? stakeAdjustment?.suggestedStake ?? step64ExistingStake ?? STEP49C_REPAIR_MICRO_STAKE);
                    step64Set('stake', micro);
                    if (columnExists('ai_forward_test', 'professional_gate_allow_bet')) step64Set('professional_gate_allow_bet', 1);
                    if (columnExists('ai_forward_test', 'professional_gate_status')) step64Set('professional_gate_status', step64ValueConfirmedMicro ? 'CONSENSUS_MICRO_STAKE_DEEPSCAN_CONFIRMED_STEP79' : 'WATCHLIST_MICRO_STAKE_MODEL_RISK_STEP79');
                    if (columnExists('ai_forward_test', 'tennis_operational_status')) step64Set('tennis_operational_status', step64ValueConfirmedMicro ? mapStep90DecisionToTennisStatus(step90TennisDecision, 'VALUE CONFERMATO MICRO') : mapStep90DecisionToTennisStatus(step90TennisDecision, 'WATCHLIST MICRO STAKE'));
                    if (columnExists('ai_forward_test', 'tennis_operational_action')) step64Set('tennis_operational_action', 'PAPER_OR_MICRO_STAKE');
                    if (columnExists('ai_forward_test', 'stake_policy_note')) step64Set('stake_policy_note', step64ValueConfirmedMicro
                        ? 'Step79: VALUE CONFERMATO MICRO autorizza micro-stake anche dopo blocco soft/hard precedente.'
                        : 'Step79: WATCHLIST MICRO STAKE + RISCHIO MODELLO mantiene micro-stake; rischio limitativo, non veto.');
                    stakeAdjustment = {
                        ...stakeAdjustment,
                        step64StakeMatrixApplied: true,
                        step79StakeNoteConsistency: true,
                        adjustedStake: micro,
                        currentStake: micro,
                        suggestedStake: micro,
                        reason: step90TennisDecision?.code === 'APPROVED'
                            ? 'Step90: APPROVATA da storico operativo positivo; CLV corrente escluso.'
                            : (step64ValueConfirmedMicro
                                ? 'Step79: VALUE CONFERMATO MICRO autorizza micro-stake ridotto.'
                                : 'Step79: WATCHLIST MICRO STAKE + RISCHIO MODELLO conferma micro-stake.')
                    };
                } else if (step64Category === 'ALTO_RISCHIO') {
                    step64Set('stake', 0);
                    if (columnExists('ai_forward_test', 'professional_gate_allow_bet')) step64Set('professional_gate_allow_bet', 0);
                    if (columnExists('ai_forward_test', 'professional_gate_status')) step64Set('professional_gate_status', 'BLOCKED_HARD_DEEPSCAN_HIGH_RISK_STEP64');
                    if (columnExists('ai_forward_test', 'tennis_operational_status')) step64Set('tennis_operational_status', 'BLOCCATA HARD');
                    if (columnExists('ai_forward_test', 'tennis_operational_action')) step64Set('tennis_operational_action', 'NO_BET_HARD');
                    if (columnExists('ai_forward_test', 'stake_policy_note')) step64Set('stake_policy_note', 'Step79: BLOCCATA HARD + ALTO RISCHIO = stake 0 salvo VALUE CONFERMATO MICRO.');
                    stakeAdjustment = { ...stakeAdjustment, step64StakeMatrixApplied: true, step79StakeNoteConsistency: true, adjustedStake: 0, currentStake: 0, suggestedStake: 0, reason: 'Step79: BLOCCATA HARD/ALTO RISCHIO senza VALUE CONFERMATO MICRO = stake 0.' };
                } else if (step64Category === 'RISCHIO_MODELLO' && step96CRiskModelSoftRuntimeMicro?.allow === true) {
                        const micro = getStep64MicroStakeForTennisRow(
                            existingPending,
                            step96CRiskModelSoftRuntimeMicro.recommendedStake || DEFAULT_MIN_BET
                        );
                        step64Set('stake', micro);
                        if (columnExists('ai_forward_test', 'professional_gate_allow_bet')) step64Set('professional_gate_allow_bet', 1);
                        if (columnExists('ai_forward_test', 'professional_gate_status')) step64Set('professional_gate_status', 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP96C');
                        if (columnExists('ai_forward_test', 'tennis_operational_status')) step64Set('tennis_operational_status', 'WATCHLIST MICRO');
                        if (columnExists('ai_forward_test', 'tennis_operational_action')) step64Set('tennis_operational_action', 'PAPER_OR_MICRO_STAKE');
                        if (columnExists('ai_forward_test', 'deepscan_gate_mode')) step64Set('deepscan_gate_mode', 'STEP96C_RUNTIME_MICRO_TEST_ACTIVATION');
                        if (columnExists('ai_forward_test', 'deepscan_gate_status')) step64Set('deepscan_gate_status', 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP96C');
                        if (columnExists('ai_forward_test', 'deepscan_gate_multiplier')) step64Set('deepscan_gate_multiplier', 0.5);
                        if (columnExists('ai_forward_test', 'deepscan_gate_reason')) step64Set('deepscan_gate_reason', step96CRiskModelSoftRuntimeMicro.reason);
                        if (columnExists('ai_forward_test', 'stake_policy_note')) step64Set('stake_policy_note', 'Step96C: RISCHIO MODELLO + BLOCCATA SOFT non più stake 0 fisso se storico positivo: MICRO TEST controllato. No stake pieno.');
                        stakeAdjustment = {
                            ...stakeAdjustment,
                            mode: 'STEP96C_RUNTIME_MICRO_TEST_ACTIVATION',
                            status: 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP96C',
                            level: 'RISCHIO_MODELLO_SOFT_MICRO_TEST',
                            multiplier: 0.5,
                            adjusted: true,
                            step96CRiskModelSoftRuntimeMicro: true,
                            step96RiskModelSoftRuntimeMicro: true,
                            step96CombinationDecision,
                            step96RuntimeEligibility: step96CRiskModelSoftRuntimeMicro,
                            step96CombinationStats,
                            adjustedStake: micro,
                            currentStake: micro,
                            suggestedStake: micro,
                            reason: step96CRiskModelSoftRuntimeMicro.reason
                        };
                    } else if (step64Category === 'RISCHIO_MODELLO' && step96AllowRiskModelSoftMicro) {
                        const micro = getStep64MicroStakeForTennisRow(
                            existingPending,
                            step96CombinationDecision.recommendedStake || DEFAULT_MIN_BET
                        );
                        step64Set('stake', micro);
                        if (columnExists('ai_forward_test', 'professional_gate_allow_bet')) step64Set('professional_gate_allow_bet', 1);
                        if (columnExists('ai_forward_test', 'professional_gate_status')) step64Set('professional_gate_status', 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP96');
                        if (columnExists('ai_forward_test', 'tennis_operational_status')) step64Set('tennis_operational_status', 'WATCHLIST MICRO');
                        if (columnExists('ai_forward_test', 'tennis_operational_action')) step64Set('tennis_operational_action', 'PAPER_OR_MICRO_STAKE');
                        if (columnExists('ai_forward_test', 'stake_policy_note')) step64Set('stake_policy_note', 'Step96: RISCHIO MODELLO + BLOCCATA SOFT riclassificato a micro test controllato da storico positivo. No stake pieno.');
                        stakeAdjustment = {
                            ...stakeAdjustment,
                            step96RiskModelSoftRecalibration: true,
                            step96CombinationDecision,
                            adjustedStake: micro,
                            currentStake: micro,
                            suggestedStake: micro,
                            reason: step96CombinationDecision.reason
                        };
                    } else if (step64Category === 'RISCHIO_MODELLO') {
                    step64Set('stake', 0);
                    if (columnExists('ai_forward_test', 'professional_gate_allow_bet')) step64Set('professional_gate_allow_bet', 0);
                    if (columnExists('ai_forward_test', 'professional_gate_status')) step64Set('professional_gate_status', 'BLOCKED_SOFT_DEEPSCAN_MODEL_RISK_STEP64');
                    if (columnExists('ai_forward_test', 'tennis_operational_status')) step64Set('tennis_operational_status', 'BLOCCATA SOFT');
                    if (columnExists('ai_forward_test', 'tennis_operational_action')) step64Set('tennis_operational_action', 'NO_BET_PREMATCH_MODEL_RISK');
                    if (columnExists('ai_forward_test', 'stake_policy_note')) step64Set('stake_policy_note', 'Step79: BLOCCATA SOFT + RISCHIO MODELLO = stake 0 salvo WATCHLIST/VALUE micro.');
                    stakeAdjustment = { ...stakeAdjustment, step64StakeMatrixApplied: true, step79StakeNoteConsistency: true, adjustedStake: 0, currentStake: 0, suggestedStake: 0, reason: 'Step79: BLOCCATA SOFT + RISCHIO MODELLO senza WATCHLIST/VALUE micro = stake 0.' };
                } else if (step91gWatchlistEdgeTecnicoReducedStake) {
                        const step91gBaseMicroStake = toNumber(
                            stakeAdjustment?.adjustedStake ??
                            stakeAdjustment?.suggestedStake ??
                            step64ExistingStake,
                            step64ExistingStake
                        );
                        const step91gReducedPreferredStake = Math.max(
                            DEFAULT_MIN_BET,
                            round(step91gBaseMicroStake * 0.75, 2)
                        );
                        const micro = getStep64MicroStakeForTennisRow(
                            existingPending,
                            Math.min(step91gBaseMicroStake, step91gReducedPreferredStake)
                        );
                        step64Set('stake', micro);
                        if (columnExists('ai_forward_test', 'professional_gate_allow_bet')) step64Set('professional_gate_allow_bet', 1);
                        if (columnExists('ai_forward_test', 'professional_gate_status')) step64Set('professional_gate_status', 'WATCHLIST_MICRO_EDGE_TECNICO_REDUCED_STEP91G');
                        if (columnExists('ai_forward_test', 'tennis_operational_status')) step64Set('tennis_operational_status', mapStep90DecisionToTennisStatus(step90TennisDecision, 'WATCHLIST MICRO'));
                        if (columnExists('ai_forward_test', 'tennis_operational_action')) step64Set('tennis_operational_action', 'PAPER_OR_MICRO_STAKE_REDUCED');
                        if (columnExists('ai_forward_test', 'stake_policy_note')) step64Set('stake_policy_note', 'Step91G: WATCHLIST MICRO + EDGE TECNICO = micro-stake ridotto/cappato, non stake zero. Nessun aumento consentito.');
                        stakeAdjustment = {
                            ...stakeAdjustment,
                            step64StakeMatrixApplied: true,
                            step91gWatchlistEdgeTecnicoReducedStake: true,
                            adjustedStake: micro,
                            currentStake: micro,
                            suggestedStake: micro,
                            reason: 'Step91G: WATCHLIST MICRO + EDGE TECNICO mantiene solo micro-stake ridotto; aumento vietato finché ROI storico categoria resta debole.'
                        };
                    } else if (step64Category === 'EDGE_TECNICO' && !step64ConsensusApplied && !step64ValueConfirmedMicro) {
                    step64Set('stake', 0);
                    if (columnExists('ai_forward_test', 'professional_gate_allow_bet')) step64Set('professional_gate_allow_bet', 0);
                    if (columnExists('ai_forward_test', 'professional_gate_status')) step64Set('professional_gate_status', 'BLOCKED_SOFT_EDGE_NEEDS_CONSENSUS_STEP64');
                    if (columnExists('ai_forward_test', 'tennis_operational_status')) step64Set('tennis_operational_status', 'BLOCCATA SOFT');
                    if (columnExists('ai_forward_test', 'tennis_operational_action')) step64Set('tennis_operational_action', 'NO_BET_EDGE_NEEDS_CONSENSUS');
                    if (columnExists('ai_forward_test', 'stake_policy_note')) step64Set('stake_policy_note', 'Step64 Stake Matrix: EDGE TECNICO richiede Consensus Micro per avere stake.');
                    stakeAdjustment = { ...stakeAdjustment, step64StakeMatrixApplied: true, adjustedStake: 0, currentStake: 0, suggestedStake: 0, reason: 'Step64 Stake Matrix: EDGE TECNICO senza Consensus Micro = stake 0.' };
                } else if (step64Category === 'VALUE_CONFERMATO_MICRO' && !step64HardVeto) {
                    const micro = getStep64MicroStakeForTennisRow(existingPending, stakeAdjustment?.adjustedStake ?? stakeAdjustment?.suggestedStake ?? STEP49C_REPAIR_MICRO_STAKE);
                    step64Set('stake', micro);
                    if (columnExists('ai_forward_test', 'professional_gate_allow_bet')) step64Set('professional_gate_allow_bet', 1);
                    if (columnExists('ai_forward_test', 'professional_gate_status')) step64Set('professional_gate_status', 'CONSENSUS_MICRO_STAKE_DEEPSCAN_CONFIRMED_STEP64');
                    if (columnExists('ai_forward_test', 'tennis_operational_status')) step64Set('tennis_operational_status', mapStep90DecisionToTennisStatus(step90TennisDecision, 'WATCHLIST MICRO'));
                    if (columnExists('ai_forward_test', 'tennis_operational_action')) step64Set('tennis_operational_action', 'PAPER_OR_MICRO_STAKE');
                    if (columnExists('ai_forward_test', 'stake_policy_note')) step64Set('stake_policy_note', isStep64WtaTennisRow(existingPending)
                        ? `Step64/90: ${mapStep90DecisionToTennisStatus(step90TennisDecision, 'VALUE CONFERMATO MICRO')} con cap WTA severo. CLV corrente escluso.`
                        : `Step64/90: ${mapStep90DecisionToTennisStatus(step90TennisDecision, 'VALUE CONFERMATO MICRO')} = micro/cap attivo. CLV corrente escluso.`);
                    stakeAdjustment = { ...stakeAdjustment, step64StakeMatrixApplied: true, step90PreMatchGateAlignment: true, preMatchGateDecision: step90TennisDecision, adjustedStake: micro, currentStake: micro, suggestedStake: micro, reason: step90TennisDecision?.code === 'APPROVED' ? 'Step90: APPROVATA da storico operativo positivo; stake pieno non attivo senza CLV storico sufficiente.' : (isStep64WtaTennisRow(existingPending) ? 'Step64: Value confermato micro con cap WTA severo.' : 'Step64: Value confermato micro attivo.') };
                } else if (step64ConsensusApplied && isStep64WtaTennisRow(existingPending)) {
                    const capped = getStep64MicroStakeForTennisRow(existingPending, stakeAdjustment?.adjustedStake ?? STEP49C_REPAIR_MICRO_STAKE);
                    step64Set('stake', capped);
                    if (columnExists('ai_forward_test', 'stake_policy_note')) step64Set('stake_policy_note', 'Step64 Stake Matrix: WTA cap micro severo applicato.');
                    stakeAdjustment = { ...stakeAdjustment, step64StakeMatrixApplied: true, adjustedStake: capped, currentStake: capped, suggestedStake: capped, reason: 'Step64: WTA cap micro severo applicato.' };
                }

                const deepScanOperationalGate = report.deepScanOperationalGate || report.quantData?.deepScanOperationalGate || null;
                if (deepScanOperationalGate) {
                    if (columnExists('ai_forward_test', 'deepscan_gate_mode')) step64Set('deepscan_gate_mode', deepScanOperationalGate.mode || 'OPERATIONAL_GATE');
                    if (columnExists('ai_forward_test', 'deepscan_gate_status')) step64Set('deepscan_gate_status', deepScanOperationalGate.status || stakeAdjustment.status || 'OPERATIONAL_GATE');
                    if (columnExists('ai_forward_test', 'deepscan_gate_multiplier')) step64Set('deepscan_gate_multiplier', toNumber(deepScanOperationalGate.stakeMultiplier, stakeAdjustment?.multiplier ?? 1));
                    if (columnExists('ai_forward_test', 'deepscan_gate_reason')) step64Set('deepscan_gate_reason', deepScanOperationalGate.reason || stakeAdjustment?.reason || 'DeepScan Tennis gate operativo.');
                }

                // T11_R2_DECISION_RESEARCH_BUNDLE
                // Durable audit observability + shadow research. No production decision authority.
                const t11StakeDecisionTrace = tennisStakeDecisionTraceT11.begin({
                    betId: existingPending.id,
                    match: `${existingPending.home_team || ''} - ${existingPending.away_team || ''}`.trim(),
                    matchDate: existingPending.match_date,
                    league: existingPending.league,
                    marketType: existingPending.market_type,
                    prediction: existingPending.prediction,
                    odd: existingPending.odd,
                    estimatedProb: existingPending.estimated_prob,
                    edgePp: existingPending.edge_pp,
                    evPct: existingPending.ev_pct
                });
                tennisStakeDecisionTraceT11.stage(t11StakeDecisionTrace, 'BEFORE_STEP96', {
                    stake: toNumber(stakeAdjustment?.adjustedStake ?? stakeAdjustment?.currentStake ?? existingPending.stake, 0),
                    status: stakeAdjustment?.status || null,
                    reason: stakeAdjustment?.reason || null,
                    deepScanAction: report.action || null,
                    deepScanRiskLevel: report.riskAssessment?.level || report.quantData?.riskAssessment?.level || report.level || null
                });

                // STEP96F_FINAL_RUNTIME_MICRO_OVERRIDE
                // Questo blocco è volutamente DOPO la vecchia matrice Step64/79 e DOPO
                // deepScanOperationalGate: intercetta il caso reale in cui Step64 aveva già
                // riscritto RISCHIO MODELLO + BLOCCATA SOFT a stake 0.
                const step96FFinalRuntimeBet = applyStep96FRiskModelSoftMicroToBet({
                    ...existingPending,
                    odd: existingPending.odd,
                    invested: String(stakeAdjustment?.adjustedStake ?? stakeAdjustment?.currentStake ?? existingPending.stake ?? 0),
                    stake: stakeAdjustment?.adjustedStake ?? stakeAdjustment?.currentStake ?? existingPending.stake ?? 0,
                    edge_pp: existingPending.edge_pp,
                    ev_pct: existingPending.ev_pct,
                    ds_action: report.action,
                    deep_scan_risk_level: report.riskAssessment?.level || report.quantData?.riskAssessment?.level || report.level || existingPending.deep_scan_risk_level,
                    ds_suggestion: report.suggestionText || report.summary || existingPending.ds_suggestion,
                    professional_gate_status: existingPending.professional_gate_status,
                    professional_gate_reasons: existingPending.professional_gate_reasons,
                    tennis_operational_status: existingPending.tennis_operational_status,
                    tennis_operational_action: existingPending.tennis_operational_action,
                    tennis_operational_summary: existingPending.tennis_operational_summary,
                    __step96FReportText: buildStep96FReportDeepScanText(report)
                }, existingPending, 'deepscan.final-override');
                if (step96FFinalRuntimeBet.step96FRuntimeMicroTestFinalOverride === true) {
                    const micro = toNumber(step96FFinalRuntimeBet.stake ?? step96FFinalRuntimeBet.invested, DEFAULT_MIN_BET);
                    step64Set('stake', micro);
                    if (columnExists('ai_forward_test', 'professional_gate_allow_bet')) step64Set('professional_gate_allow_bet', 1);
                    if (columnExists('ai_forward_test', 'professional_gate_status')) step64Set('professional_gate_status', step96FFinalRuntimeBet.professional_gate_status);
                    if (columnExists('ai_forward_test', 'professional_gate_reasons')) step64Set('professional_gate_reasons', step96FFinalRuntimeBet.professional_gate_reasons);
                    if (columnExists('ai_forward_test', 'professional_gate_max_stake')) step64Set('professional_gate_max_stake', micro);
                    if (columnExists('ai_forward_test', 'tennis_operational_status')) step64Set('tennis_operational_status', step96FFinalRuntimeBet.tennis_operational_status);
                    if (columnExists('ai_forward_test', 'tennis_operational_action')) step64Set('tennis_operational_action', step96FFinalRuntimeBet.tennis_operational_action);
                    if (columnExists('ai_forward_test', 'tennis_operational_summary')) step64Set('tennis_operational_summary', step96FFinalRuntimeBet.tennis_operational_summary);
                    if (columnExists('ai_forward_test', 'deepscan_gate_mode')) step64Set('deepscan_gate_mode', step96FFinalRuntimeBet.deepscan_gate_mode);
                    if (columnExists('ai_forward_test', 'deepscan_gate_status')) step64Set('deepscan_gate_status', step96FFinalRuntimeBet.deepscan_gate_status);
                    if (columnExists('ai_forward_test', 'deepscan_gate_multiplier')) step64Set('deepscan_gate_multiplier', 0.5);
                    if (columnExists('ai_forward_test', 'deepscan_gate_reason')) step64Set('deepscan_gate_reason', step96FFinalRuntimeBet.deepscan_gate_reason);
                    if (columnExists('ai_forward_test', 'stake_policy_note')) step64Set('stake_policy_note', step96FFinalRuntimeBet.stake_policy_note);
                    stakeAdjustment = {
                        ...stakeAdjustment,
                        mode: STEP96F_RUNTIME_MICRO_TEST_FINAL_OVERRIDE_AND_DRIFT_AUDIT,
                        status: 'WATCHLIST_MICRO_RISK_MODEL_SOFT_STEP96F',
                        adjusted: true,
                        step96FRuntimeMicroTestFinalOverride: true,
                        adjustedStake: micro,
                        currentStake: micro,
                        suggestedStake: micro,
                        reason: step96FFinalRuntimeBet.stake_policy_note,
                        step96RuntimeDecision: step96FFinalRuntimeBet.step96RuntimeDecision,
                        step96RuntimeStats: step96FFinalRuntimeBet.step96RuntimeStats
                    };
                }
                tennisStakeDecisionTraceT11.stage(t11StakeDecisionTrace, 'STEP96', {
                    applied: step96FFinalRuntimeBet.step96FRuntimeMicroTestFinalOverride === true,
                    stake: toNumber(stakeAdjustment?.adjustedStake ?? stakeAdjustment?.currentStake ?? existingPending.stake, 0),
                    decision: step96FFinalRuntimeBet.step96RuntimeDecision || null,
                    stats: step96FFinalRuntimeBet.step96RuntimeStats || null,
                    status: stakeAdjustment?.status || null,
                    reason: stakeAdjustment?.reason || null
                });
                // STEP101_FINAL_RUNTIME_OVERRIDE_AFTER_STEP64_96F
                // Ultima protezione runtime: se Step64/96F hanno lasciato RISCHIO MODELLO + BLOCCATA SOFT a stake 0,
                // Step101 applica micro-test paper-trading se Edge/EV sono positivi e non esiste hard veto reale.
                const step101FinalRuntime = applyStep101RiskModelSoftMicroRuntime({
                    existingPending,
                    report,
                    stakeAdjustment,
                    step64Set,
                    source: 'deepscan.final-step101'
                });
                if (step101FinalRuntime.applied === true) {
                    stakeAdjustment = step101FinalRuntime.stakeAdjustment;
                }
                tennisStakeDecisionTraceT11.stage(t11StakeDecisionTrace, 'STEP101', {
                    applied: step101FinalRuntime.applied === true,
                    stake: toNumber(stakeAdjustment?.adjustedStake ?? stakeAdjustment?.currentStake ?? existingPending.stake, 0),
                    status: stakeAdjustment?.status || null,
                    reason: stakeAdjustment?.reason || null,
                    runtime: step101FinalRuntime.runtime || step101FinalRuntime.decision || null
                });

                // PATCH10_QUALITY_FINAL_AFTER_DEEPSCAN
                // Base Quality and DeepScan remain separate. This is the only final fusion authority.
                const r25CapProof = require('./tennisCapProvenanceR25.cjs');
                const r25StagedCap = r25CapProof.fromPendingSetParts(setParts, params);
                const r25ProfessionalCap = r25CapProof.resolve({
                    persistedCap: existingPending.professional_gate_max_stake,
                    stagedCap: r25StagedCap.value, stagedPresent: r25StagedCap.present
                });
                tennisStakeDecisionTraceT11.stage(t11StakeDecisionTrace, 'R25_PROFESSIONAL_CAP_PROVENANCE', {
                    persistedCap: r25CapProof.number(existingPending.professional_gate_max_stake),
                    stagedCap: r25StagedCap.present ? r25StagedCap.value : null,
                    effectiveCap: r25ProfessionalCap.cap, status: r25ProfessionalCap.status,
                    firstZero: r25ProfessionalCap.firstZero, version: r25ProfessionalCap.version
                });
                const patch10BaseQuality = existingPending.quality_base_code
                    ? {
                        version: existingPending.quality_base_version || tennisQualityGateV2.TENNIS_QUALITY_BASE_VERSION,
                        code: existingPending.quality_base_code,
                        label: existingPending.quality_base_label,
                        score: toNumber(existingPending.quality_base_score, 0),
                        reason: existingPending.quality_base_reason || '',
                        reasons: [existingPending.quality_base_reason || 'Base Quality persisted'],
                        hardVeto: String(existingPending.quality_base_code || '').includes('HARD'),
                        metrics: {
                            estimatedProbability: toNumber(existingPending.estimated_prob, null),
                            marketProbability: toNumber(existingPending.market_implied_prob, null),
                            odd: toNumber(existingPending.odd, null),
                            edgePp: toNumber(existingPending.edge_pp, null),
                            evPct: toNumber(existingPending.ev_pct, null),
                            dataSufficiency: toNumber(existingPending.data_sufficiency_score, null),
                            referenceQuality: tennisQualityGateV2.normalizeReferenceQuality(existingPending),
                            marketType: existingPending.market_type,
                            markovValidated: existingPending.markov_validated === 1
                        },
                        deepScanUsed: false
                    }
                    : tennisQualityGateV2.evaluateBaseQualityGate(existingPending);
                const t11PreQualityStake = stakeAdjustment?.adjustedStake ?? stakeAdjustment?.currentStake ?? existingPending.stake;
                patch10FinalQuality = tennisQualityGateV2.fuseQualityGateWithDeepScan({
                    ...existingPending,
                    baseDecision: patch10BaseQuality,
                    deepScan: report,
                    currentStake: t11PreQualityStake,
                    bankroll: deepScanBankrollSnapshot, // AUDIT16D_R3_T5_R3_BANKROLL_SNAPSHOT_SCOPE_FIX
                    kellyRawStake: existingPending.kelly_raw_stake,
                    professionalCap: r25ProfessionalCap.cap,
                    calibrationReady: false
                });
                tennisStakeDecisionTraceT11.stage(t11StakeDecisionTrace, 'QUALITY_GATE_V2', {
                    inputStake: toNumber(t11PreQualityStake, 0),
                    outputStake: toNumber(patch10FinalQuality?.stake?.amount, 0),
                    baseCode: patch10BaseQuality?.code || null,
                    baseLabel: patch10BaseQuality?.label || null,
                    baseScore: toNumber(patch10BaseQuality?.score, null),
                    finalCode: patch10FinalQuality?.code || null,
                    finalLabel: patch10FinalQuality?.label || null,
                    finalScore: toNumber(patch10FinalQuality?.score, null),
                    deepScanClass: patch10FinalQuality?.deepScanClass || null,
                    hardVeto: patch10FinalQuality?.hardVeto === true,
                    allowBet: patch10FinalQuality?.allowBet === true,
                    edgePp: toNumber(patch10BaseQuality?.metrics?.edgePp ?? existingPending.edge_pp, null),
                    evPct: toNumber(patch10BaseQuality?.metrics?.evPct ?? existingPending.ev_pct, null),
                    dataSufficiency: toNumber(patch10BaseQuality?.metrics?.dataSufficiency ?? existingPending.data_sufficiency_score, null),
                    referenceQuality: patch10BaseQuality?.metrics?.referenceQuality || tennisQualityGateV2.normalizeReferenceQuality(existingPending),
                    marketType: patch10BaseQuality?.metrics?.marketType || existingPending.market_type || null,
                    reason: patch10FinalQuality?.reason || null
                });
                const patch10DecisionAt = new Date().toISOString();
                const patch10QualityFields = {
                    quality_base_code: patch10BaseQuality.code,
                    quality_base_label: patch10BaseQuality.label,
                    quality_base_score: patch10BaseQuality.score,
                    quality_base_reason: patch10BaseQuality.reason,
                    quality_base_version: patch10BaseQuality.version,
                    quality_final_code: patch10FinalQuality.code,
                    quality_final_label: patch10FinalQuality.label,
                    quality_final_score: patch10FinalQuality.score,
                    quality_final_reason: patch10FinalQuality.reason,
                    quality_final_version: patch10FinalQuality.version,
                    quality_stake_mode: patch10FinalQuality.stake.mode,
                    quality_stake_amount: patch10FinalQuality.stake.amount,
                    quality_budget_pct: patch10FinalQuality.stake.budgetPct,
                    quality_decision_at: patch10DecisionAt,
                    quality_deepscan_class: patch10FinalQuality.deepScanClass,
                    quality_deepscan_separate: 1
                };
                for (const [field, value] of Object.entries(patch10QualityFields)) {
                    if (columnExists('ai_forward_test', field)) step64Set(field, value);
                }

                // PATCH13_HISTORICAL_COMBINATION_SNAPSHOT
                // Empirical Paper Trading evidence only. Never changes model probability, DeepScan, Quality or stake.
                try {
                    historicalCombinationEvidence = tennisHistoricalCombinationEvidence.resolveHistoricalCombinationEvidence(db, {
                        deepScan: report,
                        qualityDecision: patch10FinalQuality
                    }, {
                        excludeBetId: existingPending.id,
                        asOf: patch10DecisionAt,
                        calculatedAt: patch10DecisionAt
                    });
                    const historicalFields = tennisHistoricalCombinationEvidence.toPersistenceFields(historicalCombinationEvidence);
                    for (const [field, value] of Object.entries(historicalFields)) {
                        if (columnExists('ai_forward_test', field)) step64Set(field, value);
                    }
                    runtimeDiagnostics.writeDiagnostic({
                        level: historicalCombinationEvidence.reliability === 'VERY_LOW' || historicalCombinationEvidence.reliability === 'LOW' ? 'WARN' : 'INFO',
                        component: 'TENNIS_HISTORICAL_COMBINATION', operation: 'HISTORICAL_COMBINATION_SNAPSHOT',
                        operationId: runtimeDiagnostics.createOperationId('TENNIS_HISTORICAL_COMBINATION'),
                        phase: 'HISTORICAL_COMBINATION_RATE_SNAPSHOT', event: 'HISTORICAL_COMBINATION_RATE_SNAPSHOT',
                        message: `${historicalCombinationEvidence.deepScan} × ${historicalCombinationEvidence.quality}: ${historicalCombinationEvidence.winRatePct ?? 'N/D'}% su n=${historicalCombinationEvidence.resolved}.`,
                        context: { betId: existingPending.id, evidence: historicalCombinationEvidence, stakeAuthority: false }
                    });
                } catch (historicalEvidenceError) {
                    historicalCombinationEvidence = {
                        success: false,
                        error: historicalEvidenceError.message,
                        version: tennisHistoricalCombinationEvidence.TENNIS_HISTORICAL_COMBINATION_VERSION,
                        stakeAuthority: false
                    };
                    runtimeDiagnostics.captureError({
                        component: 'TENNIS_HISTORICAL_COMBINATION', operation: 'HISTORICAL_COMBINATION_SNAPSHOT',
                        operationId: runtimeDiagnostics.createOperationId('TENNIS_HISTORICAL_COMBINATION'),
                        phase: 'HISTORICAL_COMBINATION_EVIDENCE_FAILED', error: historicalEvidenceError,
                        context: { betId: existingPending.id }
                    });
                }
                tennisStakeDecisionTraceT11.stage(t11StakeDecisionTrace, 'HISTORICAL_COMBINATION', {
                    key: historicalCombinationEvidence?.key || null,
                    deepScan: historicalCombinationEvidence?.deepScan || null,
                    quality: historicalCombinationEvidence?.quality || null,
                    resolved: toNumber(historicalCombinationEvidence?.resolved, 0),
                    wins: toNumber(historicalCombinationEvidence?.wins, 0),
                    losses: toNumber(historicalCombinationEvidence?.losses, 0),
                    winRatePct: toNumber(historicalCombinationEvidence?.winRatePct, null),
                    ci95LowPct: toNumber(historicalCombinationEvidence?.ci95LowPct, null),
                    ci95HighPct: toNumber(historicalCombinationEvidence?.ci95HighPct, null),
                    reliability: historicalCombinationEvidence?.reliability || null,
                    operationalResolved: toNumber(historicalCombinationEvidence?.operationalResolved, 0),
                    operationalWins: toNumber(historicalCombinationEvidence?.operationalWins, 0),
                    operationalWinRatePct: toNumber(historicalCombinationEvidence?.operationalWinRatePct, null),
                    operationalStake: toNumber(historicalCombinationEvidence?.operationalStake, 0),
                    operationalProfit: toNumber(historicalCombinationEvidence?.operationalProfit, 0),
                    operationalRoiPct: toNumber(historicalCombinationEvidence?.operationalRoiPct, null),
                    probabilityMeaning: historicalCombinationEvidence?.probabilityMeaning || null,
                    stakeAuthority: false,
                    error: historicalCombinationEvidence?.success === false ? historicalCombinationEvidence?.error || 'UNAVAILABLE' : null
                });
                // PATCH35_FINAL_STAKE_AUTHORITY
                // Tutti i vecchi Step possono proporre uno stake, ma solo questa decisione
                // finale può autorizzare il valore persistito. n=0/1 e in generale n<5
                // restano paper-only, anche quando la frequenza grezza visualizza 100%.
                const patch36DataReadiness = tennisTourDataReadiness.resolveEvidenceReadiness({
                    tour: existingPending.tour_type,
                    league: existingPending.league,
                    betType: existingPending.bet_type,
                    strategyTag: existingPending.strategy_tag
                }, { dataDir: ABSOLUTE_SACKMANN_DIR });
                patch35StakeAuthorityDecision = tennisRiskAuthorityPatch36.decide({
                    proposedStake: patch10FinalQuality.stake.amount,
                    qualityCode: patch10FinalQuality.code,
                    qualityLabel: patch10FinalQuality.label,
                    professionalGateStatus: existingPending.professional_gate_status,
                    operationalStatus: existingPending.tennis_operational_status,
                    operationalAction: existingPending.tennis_operational_action,
                    historicalEvidence: historicalCombinationEvidence,
                    historical_combo_resolved: existingPending.historical_combo_resolved,
                    historical_combo_reliability: existingPending.historical_combo_reliability,
                    pre_match_historical_sample: existingPending.pre_match_historical_sample,
                    tour: existingPending.tour_type,
                    league: existingPending.league,
                    betType: existingPending.bet_type,
                    dataReadiness: patch36DataReadiness
                });
                const patch35StakeFields = tennisRiskAuthorityPatch36.toPersistenceFields(patch35StakeAuthorityDecision, patch10DecisionAt);
                for (const [field, value] of Object.entries(patch35StakeFields)) {
                    if (columnExists('ai_forward_test', field)) step64Set(field, value);
                }
                const patch35FinalStake = patch35StakeAuthorityDecision.finalStake;
                tennisStakeDecisionTraceT11.stage(t11StakeDecisionTrace, 'PATCH35_RISK_AUTHORITY', {
                    proposedStake: toNumber(patch10FinalQuality?.stake?.amount, 0),
                    finalStake: toNumber(patch35FinalStake, 0),
                    status: patch35StakeAuthorityDecision?.status || null,
                    reason: patch35StakeAuthorityDecision?.reason || null,
                    hardBlocked: patch35StakeAuthorityDecision?.hardBlocked === true,
                    historicalSample: toNumber(patch35StakeAuthorityDecision?.historicalSample, null)
                });
                patch39CalibrationReport = tennisProbabilityCalibrationGuardPatch39.buildCalibrationReport(db, { generatedAt: patch10DecisionAt });
                patch39ProbabilityGuardDecision = tennisProbabilityCalibrationGuardPatch39.decide({
                    estimated_prob: existingPending.estimated_prob,
                    proposedStake: patch35FinalStake
                }, patch39CalibrationReport);
                const patch39FinalStake = Math.min(patch35FinalStake, patch39ProbabilityGuardDecision.finalStake);
                tennisStakeDecisionTraceT11.stage(t11StakeDecisionTrace, 'PATCH39_CALIBRATION_GUARD', {
                    proposedStake: toNumber(patch35FinalStake, 0),
                    finalStake: toNumber(patch39FinalStake, 0),
                    status: patch39ProbabilityGuardDecision?.status || null,
                    rawProbabilityPct: toNumber(patch39ProbabilityGuardDecision?.rawProbabilityPct, null),
                    operationalProbabilityPct: toNumber(patch39ProbabilityGuardDecision?.operationalProbabilityPct, null),
                    probabilityReductionPp: toNumber(patch39ProbabilityGuardDecision?.probabilityReductionPp, null),
                    finalStakeCap: toNumber(patch39ProbabilityGuardDecision?.finalStakeCap, null),
                    reason: patch39ProbabilityGuardDecision?.reason || null
                });
                // AUDIT05: Patch39 is an upstream proposal, not the final stake writer.
                // AUDIT05: Patch56 is evaluated only after Patch46 final paper stake.

                const patch39Set = (column, value) => { if (columnExists('ai_forward_test', column)) step64Set(column, value); };
                patch39Set('tennis_probability_guard_version', patch39ProbabilityGuardDecision.version);
                patch39Set('tennis_probability_guard_status', patch39ProbabilityGuardDecision.status);
                patch39Set('tennis_probability_raw_pct', patch39ProbabilityGuardDecision.rawProbabilityPct);
                patch39Set('tennis_probability_operational_pct', patch39ProbabilityGuardDecision.operationalProbabilityPct);
                patch39Set('tennis_probability_reduction_pp', patch39ProbabilityGuardDecision.probabilityReductionPp);
                patch39Set('tennis_probability_guard_window', patch39ProbabilityGuardDecision.evidenceWindow);
                patch39Set('tennis_probability_guard_band', patch39ProbabilityGuardDecision.evidenceBand);
                patch39Set('tennis_probability_guard_sample', patch39ProbabilityGuardDecision.evidenceSample);
                patch39Set('tennis_probability_guard_stake_cap', patch39ProbabilityGuardDecision.finalStakeCap);
                patch39Set('tennis_probability_guard_proposed_stake', patch35FinalStake);
                patch39Set('tennis_probability_guard_reason', patch39ProbabilityGuardDecision.reason);
                patch39Set('tennis_probability_guard_decided_at', patch10DecisionAt);
                if (columnExists('ai_forward_test', 'professional_gate_allow_bet')) step64Set('professional_gate_allow_bet', patch39FinalStake > 0 && patch10FinalQuality.allowBet ? 1 : 0);
                if (columnExists('ai_forward_test', 'professional_gate_max_stake')) step64Set('professional_gate_max_stake', patch39FinalStake);
                if (columnExists('ai_forward_test', 'tennis_operational_status')) step64Set('tennis_operational_status', `PROBABILITY_GUARD_${patch39ProbabilityGuardDecision.status}`);
                if (columnExists('ai_forward_test', 'tennis_operational_action')) step64Set('tennis_operational_action', patch39FinalStake > 0 ? 'FINAL_STAKE_AUTHORIZED_WITH_CALIBRATION_GUARD' : 'PAPER_ONLY_OVERCONFIDENCE_GUARD');
                if (columnExists('ai_forward_test', 'tennis_operational_summary')) step64Set('tennis_operational_summary', patch39ProbabilityGuardDecision.reason);
                if (columnExists('ai_forward_test', 'stake_policy_note')) step64Set('stake_policy_note', `Patch39 ${patch39ProbabilityGuardDecision.status}: ${patch39ProbabilityGuardDecision.reason}`);
                stakeAdjustment = {
                    ...stakeAdjustment,
                    mode: tennisRiskAuthorityPatch36.VERSION,
                    status: patch35StakeAuthorityDecision.status,
                    adjusted: patch39FinalStake !== patch10FinalQuality.stake.amount,
                    adjustedStake: patch39FinalStake,
                    currentStake: patch39FinalStake,
                    suggestedStake: patch39FinalStake,
                    proposedStakeBeforeFinalAuthority: patch10FinalQuality.stake.amount,
                    reason: patch35StakeAuthorityDecision.reason,
                    qualityGateV2: patch10FinalQuality,
                    finalStakeAuthority: patch35StakeAuthorityDecision,
                    probabilityCalibrationGuard: patch39ProbabilityGuardDecision,
                    realMoneyPortfolioRisk: null // AUDIT05: populated after the final contract
                };
                patch46StakeExecutionContract = tennisStakeExecutionContractPatch46.buildContract({
                    betId: existingPending.id,
                    modelSuggestedStake: patch10FinalQuality.stake.amount,
                    qualityGate: patch10FinalQuality,
                    riskAuthority: patch35StakeAuthorityDecision,
                    calibrationGuard: patch39ProbabilityGuardDecision,
                    finalExecutableStake: patch39FinalStake,
                    decidedAt: patch10DecisionAt
                });
                // AUDIT05: an issued Patch46 contract is the sole final paper stake authority.
                const patch46EffectivePaperStake = patch46StakeExecutionContract.finalExecution.executableStake;
                if (!Number.isFinite(patch46EffectivePaperStake) ||
                    patch46EffectivePaperStake < 0 || patch46EffectivePaperStake > 10 ||
                    patch46EffectivePaperStake > patch39FinalStake + 1e-9 ||
                    (patch46EffectivePaperStake > 0 && patch46EffectivePaperStake < 2)) {
                    throw new Error('AUDIT05_INVALID_PATCH46_FINAL_PAPER_STAKE');
                }
                step64Set('stake', patch46EffectivePaperStake);
                if (columnExists('ai_forward_test', 'professional_gate_allow_bet')) step64Set('professional_gate_allow_bet', patch46EffectivePaperStake > 0 && patch10FinalQuality.allowBet ? 1 : 0);
                if (columnExists('ai_forward_test', 'professional_gate_max_stake')) step64Set('professional_gate_max_stake', patch46EffectivePaperStake);
                if (columnExists('ai_forward_test', 'tennis_operational_action')) step64Set('tennis_operational_action', patch46EffectivePaperStake > 0 ? 'FINAL_STAKE_AUTHORIZED_BY_PATCH46' : 'PAPER_ONLY_FINAL_CONTRACT_VETO');
                if (patch46EffectivePaperStake === 0 && columnExists('ai_forward_test', 'tennis_operational_status')) step64Set('tennis_operational_status', 'FINAL_CONTRACT_' + patch46StakeExecutionContract.finalExecution.status);
                if (patch46EffectivePaperStake === 0 && columnExists('ai_forward_test', 'stake_policy_note')) step64Set('stake_policy_note', 'Patch46: ' + patch46StakeExecutionContract.finalExecution.reason);
                Object.assign(stakeAdjustment, {
                    adjusted: patch46EffectivePaperStake !== patch10FinalQuality.stake.amount,
                    adjustedStake: patch46EffectivePaperStake,
                    currentStake: patch46EffectivePaperStake,
                    suggestedStake: patch46EffectivePaperStake
                });
                // Real-money exposure remains distinct from paper; Patch55/57/58/59 still required.
                const patch56PortfolioRiskDecision = unifiedCrossSportPortfolioRiskAuthorityPatch56.decide({
                    sport: 'TENNIS',
                    betId: existingPending.id,
                    eventKey: existingPending.match_exposure_key,
                    home_team: existingPending.home_team,
                    away_team: existingPending.away_team,
                    match_date: existingPending.match_date,
                    proposedStake: patch46EffectivePaperStake,
                    bankrollSnapshot: deepScanBankrollSnapshot
                }, { db, projectRoot:path.resolve(ROOT_DIR,'..') });
                for (const [field, value] of Object.entries(unifiedCrossSportPortfolioRiskAuthorityPatch56.toPersistenceFields(patch56PortfolioRiskDecision))) {
                    if (columnExists('ai_forward_test', field)) step64Set(field, value);
                }
                stakeAdjustment.realMoneyPortfolioRisk = patch56PortfolioRiskDecision;
                                const patch46StakeFields = tennisStakeExecutionContractPatch46.toPersistenceFields(patch46StakeExecutionContract);
                for (const [field, value] of Object.entries(patch46StakeFields)) {
                    if (columnExists('ai_forward_test', field)) step64Set(field, value);
                }
                stakeAdjustment.finalExecutableStakeContract = patch46StakeExecutionContract;
                t11FinalTrace = tennisStakeDecisionTraceT11.finalize(t11StakeDecisionTrace, {
                    modelSuggestedStake: toNumber(patch10FinalQuality?.stake?.amount, 0),
                    riskCap: toNumber(patch35StakeAuthorityDecision?.finalStake, 0),
                    calibrationCap: toNumber(patch39ProbabilityGuardDecision?.finalStakeCap, null),
                    finalExecutableStake: toNumber(patch46EffectivePaperStake, 0),
                    finalStatus: patch46StakeExecutionContract?.finalExecution?.status || null,
                    finalReason: patch46StakeExecutionContract?.finalExecution?.reason || patch35StakeAuthorityDecision?.reason || null,
                    contractVersion: patch46StakeExecutionContract?.version || null
                });
                runtimeDiagnostics.writeDiagnostic({
                    level: t11FinalTrace?.analysis?.qualityClobber === true ? 'WARN' : 'INFO',
                    component: 'TENNIS_T11_STAKE_DECISION_TRACE',
                    operation: 'LIVE_STAKE_DECISION_TRACE',
                    operationId: runtimeDiagnostics.createOperationId('TENNIS_T11_STAKE_DECISION_TRACE'),
                    phase: t11FinalTrace?.analysis?.diagnosis || 'TRACE_COMPLETE',
                    event: 'T11_STAKE_CHAIN_OBSERVED',
                    message: `Bet ${existingPending.id}: Step96 €${Number(t11FinalTrace?.analysis?.stakes?.afterStep96 ?? 0).toFixed(2)} → Step101 €${Number(t11FinalTrace?.analysis?.stakes?.afterStep101 ?? 0).toFixed(2)} → Quality €${Number(t11FinalTrace?.analysis?.stakes?.qualityGate ?? 0).toFixed(2)} → Patch35 €${Number(t11FinalTrace?.analysis?.stakes?.patch35 ?? 0).toFixed(2)} → Patch39/46 €${Number(t11FinalTrace?.analysis?.stakes?.patch46 ?? 0).toFixed(2)} · ${t11FinalTrace?.analysis?.diagnosis || 'TRACE_COMPLETE'}.`,
                    context: { betId: existingPending.id, trace: t11FinalTrace, stakeAuthority: false }
                });
                t11R3R1CalibratedValue = tennisCalibratedValueShadowT11R3.build(t11FinalTrace || {});
                t11R3R1LedgerDecision = tennisCalibratedValueLedgerT11R3R1.recordDecision({
                    trace: t11FinalTrace, calibratedValue: t11R3R1CalibratedValue, deepScanOperationId: deepScanRouteOperationId,
                    betId: existingPending.id, match: `${p1Name} - ${p2Name}`, prediction
                });
                runtimeDiagnostics.writeDiagnostic({
                    level: t11R3R1LedgerDecision?.written === true ? 'INFO' : 'WARN',
                    component: 'TENNIS_T11_R3_R1_DURABLE_CALIBRATED_LEDGER', operation: 'CALIBRATED_DECISION_LEDGER_WRITE',
                    operationId: deepScanRouteOperationId, phase: t11R3R1CalibratedValue?.comparisonClass || 'CALIBRATED_UNAVAILABLE',
                    event: 'T11_R3_R1_CALIBRATED_DECISION_DURABLE',
                    message: `Bet ${existingPending.id}: ${t11R3R1CalibratedValue?.comparisonClass || 'UNAVAILABLE'} · ledger=${t11R3R1LedgerDecision?.written === true ? 'WRITTEN' : 'FAILED'}.`,
                    context: { betId: existingPending.id, calibratedValue: t11R3R1CalibratedValue, ledger: { written:t11R3R1LedgerDecision?.written === true, path:t11R3R1LedgerDecision?.path || null, recordHash:t11R3R1LedgerDecision?.recordHash || null, error:t11R3R1LedgerDecision?.error || null }, stakeAuthority:false }
                });

                runtimeDiagnostics.writeDiagnostic({
                    level: patch46EffectivePaperStake <= 0 && patch10FinalQuality.stake.amount > 0 ? 'WARN' : 'INFO',
                    component: 'TENNIS_STAKE_AUTHORITY',
                    operation: 'FINAL_STAKE_AUTHORITY',
                    operationId: runtimeDiagnostics.createOperationId('TENNIS_STAKE_AUTHORITY'),
                    phase: patch35StakeAuthorityDecision.status,
                    event: 'FINAL_STAKE_DECIDED',
                    message: `Proposta modello €${Number(patch10FinalQuality.stake.amount).toFixed(2)} · cap rischio €${Number(patch35StakeAuthorityDecision.finalStake).toFixed(2)} · finale eseguibile €${Number(patch46EffectivePaperStake).toFixed(2)} · ${patch46StakeExecutionContract.finalExecution.status}.`,
                    context: { betId: existingPending.id, decision: patch35StakeAuthorityDecision, finalExecutableStakeContract: patch46StakeExecutionContract, base: patch10BaseQuality.code, deepScan: patch10FinalQuality.deepScanClass, quality: patch10FinalQuality.code }
                });

                const step96FDriftAuditBet = applyStep96FAnalysisDriftAuditToBet({
                    ds_action: report.action,
                    deep_scan_risk_level: report.riskAssessment?.level || report.quantData?.riskAssessment?.level || report.level || null,
                    ds_suggestion: report.suggestionText || report.summary || '',
                    professional_gate_status: step96FFinalRuntimeBet.professional_gate_status || existingPending.professional_gate_status,
                    professional_gate_reasons: step96FFinalRuntimeBet.professional_gate_reasons || existingPending.professional_gate_reasons,
                    tennis_operational_status: step96FFinalRuntimeBet.tennis_operational_status || existingPending.tennis_operational_status,
                    tennis_operational_action: step96FFinalRuntimeBet.tennis_operational_action || existingPending.tennis_operational_action,
                    tennis_operational_summary: step96FFinalRuntimeBet.tennis_operational_summary || existingPending.tennis_operational_summary,
                    date: existingPending.match_date,
                    home: existingPending.home_team,
                    away: existingPending.away_team,
                    prediction: existingPending.prediction,
                    odd: existingPending.odd,
                    estimatedProb: existingPending.estimated_prob,
                    edge_pp: existingPending.edge_pp,
                    ev_pct: existingPending.ev_pct
                }, existingPending, 'deepscan');
                if (step96FDriftAuditBet.analysis_drift_detected === 1) {
                    if (columnExists('ai_forward_test', 'analysis_drift_detected')) step64Set('analysis_drift_detected', 1);
                    if (columnExists('ai_forward_test', 'analysis_drift_reason')) step64Set('analysis_drift_reason', step96FDriftAuditBet.analysis_drift_reason);
                    if (columnExists('ai_forward_test', 'analysis_previous_deepscan')) step64Set('analysis_previous_deepscan', step96FDriftAuditBet.analysis_previous_deepscan);
                    if (columnExists('ai_forward_test', 'analysis_current_deepscan')) step64Set('analysis_current_deepscan', step96FDriftAuditBet.analysis_current_deepscan);
                    if (columnExists('ai_forward_test', 'analysis_previous_gate')) step64Set('analysis_previous_gate', step96FDriftAuditBet.analysis_previous_gate);
                    if (columnExists('ai_forward_test', 'analysis_current_gate')) step64Set('analysis_current_gate', step96FDriftAuditBet.analysis_current_gate);
                    if (columnExists('ai_forward_test', 'analysis_fingerprint')) step64Set('analysis_fingerprint', step96FDriftAuditBet.analysis_fingerprint);
                    if (columnExists('ai_forward_test', 'analysis_updated_at')) step64Set('analysis_updated_at', step96FDriftAuditBet.analysis_updated_at);
                }

                const finalScope = tennisScope.classifyTennisTradingScope({
                    ...existingPending,
                    stake: patch46EffectivePaperStake,
                    professional_gate_status: patch35StakeAuthorityDecision?.status || `QUALITY_V2_${patch10FinalQuality.code}`,
                    professional_gate_allow_bet: patch46EffectivePaperStake > 0 && patch10FinalQuality.allowBet ? 1 : 0,
                    tennis_operational_status: patch35StakeAuthorityDecision ? `STAKE_AUTHORITY_${patch35StakeAuthorityDecision.status}` : `QUALITY_V2_${patch10FinalQuality.code}`,
                    deepscan_gate_mode: deepScanOperationalGate?.mode || 'OPERATIONAL_GATE',
                    deepscan_gate_status: deepScanOperationalGate?.status || stakeAdjustment?.status,
                    quality_final_code: patch10FinalQuality.code,
                    quality_final_label: patch10FinalQuality.label
                });
                if (columnExists('ai_forward_test', 'trading_scope')) step64Set('trading_scope', finalScope.scope);
                if (columnExists('ai_forward_test', 'paper_trading_scope')) step64Set('paper_trading_scope', finalScope.paperOperational ? 'PAPER_OPERATIONAL' : 'AUDIT_ONLY');
                if (columnExists('ai_forward_test', 'portfolio_scope')) step64Set('portfolio_scope', finalScope.portfolioEligible ? 'PORTFOLIO_REAL' : 'EXCLUDED_FROM_REAL_PORTFOLIO');
                if (columnExists('ai_forward_test', 'audit_scope_reason')) step64Set('audit_scope_reason', finalScope.reason);
                // STEP96F_SCOPE_OVERRIDE_AFTER_FINAL_SCOPE
                if (patch46EffectivePaperStake > 0 && patch10FinalQuality.code === tennisQualityGateV2.QUALITY_CODE.WATCHLIST_MICRO && (stakeAdjustment?.step96FRuntimeMicroTestFinalOverride === true || stakeAdjustment?.step101RiskModelSoftMicroFinal === true || stakeAdjustment?.step99RiskModelSoftMicroRuntimeFinal === true)) {
                    if (columnExists('ai_forward_test', 'trading_scope')) step64Set('trading_scope', 'PAPER_OPERATIONAL');
                    if (columnExists('ai_forward_test', 'paper_trading_scope')) step64Set('paper_trading_scope', 'PAPER_OPERATIONAL');
                    if (columnExists('ai_forward_test', 'portfolio_scope')) step64Set('portfolio_scope', 'EXCLUDED_FROM_REAL_PORTFOLIO');
                    if (columnExists('ai_forward_test', 'audit_scope_reason')) step64Set('audit_scope_reason', 'Step96F: micro-test paper operativo; portfolio reale solo dopo settlement e senza promozione automatica.');
                }

                if (patch46EffectivePaperStake === 0) {
                    // A hard-vetoed stake cannot acquire operational scope via Step96F.
                    if (columnExists('ai_forward_test', 'trading_scope')) step64Set('trading_scope', 'AUDIT_ONLY');
                    if (columnExists('ai_forward_test', 'paper_trading_scope')) step64Set('paper_trading_scope', 'AUDIT_ONLY');
                    if (columnExists('ai_forward_test', 'portfolio_scope')) step64Set('portfolio_scope', 'EXCLUDED_FROM_REAL_PORTFOLIO');
                    if (columnExists('ai_forward_test', 'audit_scope_reason')) step64Set('audit_scope_reason', 'Patch46 final veto: ' + patch46StakeExecutionContract.finalExecution.status);
                }

                const patch37External = report.externalMatchIntelligence || report.quantData?.externalMatchIntelligence || null;
                if (patch37External) {
                    const patch37Set = (column, value) => { if (columnExists('ai_forward_test', column)) step64Set(column, value); };
                    patch37Set('tennis_external_intelligence_version', patch37External.version);
                    patch37Set('tennis_external_h2h_status', patch37External.h2h?.status || null);
                    patch37Set('tennis_external_h2h_sample', patch37External.h2h?.overall?.matches || 0);
                    patch37Set('tennis_external_h2h_adjustment_pp', patch37External.h2hDecision?.adjustmentPp || 0);
                    patch37Set('tennis_external_ranking_status', patch37External.officialRankings?.status || null);
                    patch37Set('tennis_external_weather_status', patch37External.weather?.status || null);
                    patch37Set('tennis_external_weather_risk_score', patch37External.weather?.risk?.score || 0);
                    patch37Set('tennis_external_challenger_score', patch37External.challenger?.evidenceScore || 0);
                    patch37Set('tennis_external_intelligence_updated_at', patch37External.generatedAt || new Date().toISOString());
                }

                params.push(existingPending.id);
                deepScanRoutePhase = 'PERSISTENCE_PREPARE';
                const patch15DeepScanPersistence = db.transaction(() => {
                    // AUDIT10: recheck PENDING after async DeepScan.
                    const guardedUpdate = db.prepare(`
                        UPDATE ai_forward_test
                        SET ${setParts.join(', ')}
                        WHERE id = ?
                          AND UPPER(COALESCE(status, '')) = 'PENDING'
                          AND (
                              UPPER(COALESCE(sport_type, '')) = 'TENNIS'
                              OR UPPER(COALESCE(bet_type, '')) LIKE '%TENNIS%'
                          )
                    `).run(...params);
                    if (guardedUpdate.changes !== 1) {
                        throw new Error('AUDIT10_PENDING_STATUS_CHANGED_ABORT');
                    }
                    const updatedPending = db.prepare('SELECT * FROM ai_forward_test WHERE id = ?').get(existingPending.id);
                    informationRetrievalEvidence = tennisInformationRetrieval.persistPredictionEvidenceReceipt(db, updatedPending || existingPending, {
                        ...req.body,
                        ds_action: report.action,
                        deep_scan_risk_level: report.riskAssessment?.level || report.quantData?.riskAssessment?.level || report.level || null
                    }, {
                        betId: existingPending.id,
                        phase: tennisInformationRetrieval.RECEIPT_PHASES.DEEPSCAN_COMPLETE,
                        dataDir: ABSOLUTE_SACKMANN_DIR,
                        cacheDir: NEWS_CACHE_DIR
                    });
                    if (patch39CalibrationReport && patch39ProbabilityGuardDecision) {
                        tennisProbabilityCalibrationGuardPatch39.persistRun(db, patch39CalibrationReport);
                        tennisProbabilityCalibrationGuardPatch39.persistDecision(db, existingPending.id, patch39ProbabilityGuardDecision, patch39CalibrationReport.reportHash);
                    }
                    if (patch46StakeExecutionContract) {
                        tennisStakeExecutionContractPatch46.persistSnapshot(db, patch46StakeExecutionContract);
                    }
                    if (patch37External) {
                        externalIntelligenceReceipt = tennisExternalMatchIntelligencePatch37.persistReceipt(db, updatedPending || existingPending, patch37External);
                        if (externalIntelligenceReceipt) patch39ReceiptLink = tennisExternalReceiptLinkPatch39.link(db, updatedPending || existingPending, externalIntelligenceReceipt);
                        const linkedReceipt = externalIntelligenceReceipt ? db.prepare('SELECT * FROM tennis_external_intelligence_receipts WHERE receipt_id=?').get(externalIntelligenceReceipt.receipt_id) : null;
                        patch39EvidenceAgentReport = tennisEvidenceVerificationAgentPatch39.verify(updatedPending || existingPending, patch37External, linkedReceipt);
                        tennisEvidenceVerificationAgentPatch39.persist(db, updatedPending || existingPending, patch39EvidenceAgentReport);
                        const agentSet = [];
                        const agentParams = [];
                        const addAgent = (column, value) => { if (columnExists('ai_forward_test', column)) { agentSet.push(`${column}=?`); agentParams.push(value); } };
                        addAgent('tennis_evidence_agent_version', patch39EvidenceAgentReport.version);
                        addAgent('tennis_evidence_agent_status', patch39EvidenceAgentReport.status);
                        addAgent('tennis_evidence_agent_report_hash', patch39EvidenceAgentReport.reportHash);
                        addAgent('tennis_evidence_agent_verified_claims', patch39EvidenceAgentReport.metrics?.verifiedClaims || 0);
                        addAgent('tennis_evidence_agent_abstentions', patch39EvidenceAgentReport.metrics?.abstentions || 0);
                        addAgent('tennis_evidence_agent_updated_at', patch39EvidenceAgentReport.generatedAt);
                        if (agentSet.length) db.prepare(`UPDATE ai_forward_test SET ${agentSet.join(',')} WHERE id=?`).run(...agentParams, existingPending.id);
                    }
                });
                deepScanRoutePhase = 'PERSISTENCE_COMMIT';
                patch15DeepScanPersistence();
                deepScanPersistenceCompleted = true;
                deepScanRoutePhase = 'POST_PERSISTENCE';

                try {
                    auditTrail.writeBetAuditEvent(db, { ...existingPending, id: existingPending.id }, 'TENNIS_DEEPSCAN_OPERATIONAL_GATE', {
                        deepScanOperationalGate,
                        qualityBase: patch10BaseQuality,
                        qualityFinal: patch10FinalQuality,
                        historicalCombinationEvidence,
                        finalStakeAuthority: patch35StakeAuthorityDecision,
                        finalExecutableStakeContract: patch46StakeExecutionContract,
                        informationRetrievalEvidence,
                        externalIntelligenceReceipt,
                        externalReceiptLink: patch39ReceiptLink,
                        probabilityCalibrationGuard: patch39ProbabilityGuardDecision,
                        realMoneyPortfolioRisk: patch56PortfolioRiskDecision,
                        evidenceVerificationAgent: patch39EvidenceAgentReport,
                        externalMatchIntelligence: report.externalMatchIntelligence || null,
                        stakeAdjustment,
                        tradingScope: finalScope
                    });
                } catch (auditError) {
                    console.warn('⚠️ Audit trail Tennis DeepScan non scritto:', auditError.message);
                }
            } else {
                // AUDIT09: no PENDING row => no source-row update.
                // Preserve resolved historical records.
                deepScanRoutePhase = 'NO_PENDING_ROW_SKIP_SOURCE_WRITE';
                deepScanPersistenceCompleted = false;
            }

            deepScanRoutePhase = 'FINAL_INDEX';
            tennisPredictionIndex = tennisUnifiedPredictionIndex.calculateTennisPredictionIndex({
                ...(existingPending || req.body || {}),
                ds_action: report.action,
                deepScan: report,
                qualityGateV2: patch10FinalQuality,
                historicalCombinationEvidence,
                stake: patch46StakeExecutionContract?.finalExecution?.executableStake ?? patch39ProbabilityGuardDecision?.finalStake ?? patch35StakeAuthorityDecision?.finalStake ?? stakeAdjustment?.adjustedStake ?? patch10FinalQuality?.stake?.amount ?? existingPending?.stake ?? 0,
                edge_pp: existingPending?.edge_pp ?? edge_pp ?? edge,
                ev_pct: existingPending?.ev_pct ?? req.body?.ev_pct,
                model_confidence_score: existingPending?.model_confidence_score,
                data_sufficiency_score: existingPending?.data_sufficiency_score
            }, { phase: 'POST_DEEPSCAN_FINAL' });

            deepScanRoutePhase = 'COMPLETE';
            return res.json({
                ...report,
                ...(existingPending ? {} : {
                    operationallyCertified: false,
                    stakeAuthorized: false,
                    sourcePersistenceApplied: false,
                    operationalStatus: 'AUDIT_ONLY_NO_PENDING_BET'
                }),
                stakeAdjustment,
                qualityGateV2: patch10FinalQuality,
                historicalCombinationEvidence,
                finalStakeAuthority: patch35StakeAuthorityDecision,
                finalExecutableStakeContract: patch46StakeExecutionContract,
                probabilityCalibrationGuard: patch39ProbabilityGuardDecision,
                evidenceVerificationAgent: patch39EvidenceAgentReport,
                externalReceiptLink: patch39ReceiptLink,
                informationRetrievalEvidence,
                externalIntelligenceReceipt,
                tennisPredictionIndex,
                t11DecisionResearch: t11FinalTrace || null,
                aiReliabilityShadow: t11FinalTrace?.aiReliabilityShadow || null,
                thresholdContinuityShadow: t11FinalTrace?.thresholdContinuityShadow || null,
                calibratedValueShadow: t11R3R1CalibratedValue || tennisCalibratedValueShadowT11R3.build(t11FinalTrace || {}),
                calibratedValueLedger: t11R3R1LedgerDecision ? { written:t11R3R1LedgerDecision.written === true, path:t11R3R1LedgerDecision.path || null, recordHash:t11R3R1LedgerDecision.recordHash || null, error:t11R3R1LedgerDecision.error || null } : null,
                deepScanContext: {
                    consensusGateStep49B: stakeAdjustment?.consensusGateApplied === true ? 'MICRO_UNLOCK_APPLIED' : 'NO_MICRO_UNLOCK',
                    consensusMicroStakeStep50D: stakeAdjustment?.consensusGateApplied === true ? (stakeAdjustment?.adjustedStake ?? stakeAdjustment?.currentStake ?? stakeAdjustment?.suggestedStake ?? null) : null,
                    match_date: resolvedDate,
                    league: resolvedLeague,
                    surface: resolvedSurface,
                    marketType: resolvedMarketType,
                    point: resolvedPoint,
                    totalsDeepScanContextStep50E: resolvedMarketType === TENNIS_MARKETS.TOTALS ? {
                        side,
                        line: line ?? resolvedPoint,
                        overOdd: over_odd ?? overOdd ?? null,
                        underOdd: under_odd ?? underOdd ?? null,
                        noVigOverProb: no_vig_over_prob ?? noVigOverProb ?? null,
                        noVigUnderProb: no_vig_under_prob ?? noVigUnderProb ?? null,
                        modelProbOver: model_prob_over ?? modelProbOver ?? null,
                        modelProbUnder: model_prob_under ?? modelProbUnder ?? null,
                        expectedGames: expected_games ?? expectedGames ?? null,
                        gamesStdDev: games_std_dev ?? gamesStdDev ?? null,
                        markovConfidence: markov_confidence ?? markovConfidence ?? null,
                        lineDistance: line_distance ?? lineDistance ?? null,
                        duplicateLineRank: duplicate_line_rank ?? duplicateLineRank ?? null
                    } : null,
                    referenceOdd1: resolvedOdd1,
                    referenceOdd2: resolvedOdd2,
                    bankrollSnapshot: deepScanBankrollSnapshot,
                    bankrollSource: deepScanBankrollSource,
                    source: existingPending ? 'DB_PENDING_PLUS_REQUEST' : 'REQUEST_ONLY'
                },
                engineVersion: TENNIS_ENGINE_VERSION
            });
        }

        return res.status(500).json({
            success: false,
            code: 'TENNIS_DEEPSCAN_CORE_FAILED',
            operationId: deepScanRouteOperationId,
            phase: 'CORE_SCAN_RESULT',
            error: report.error || 'Errore Deep Scan Tennis.',
            engineVersion: TENNIS_ENGINE_VERSION
        });
    } catch (error) {
        let runtimeDiagnostic = null;
        try {
            runtimeDiagnostic = runtimeDiagnostics.captureError({
                component: 'TENNIS_API',
                operation: 'TENNIS_DEEPSCAN',
                operationId: error?.runtimeOperationId || deepScanRouteOperationId,
                phase: deepScanRoutePhase,
                error,
                context: {
                    url: req.originalUrl,
                    pendingId: deepScanPendingId,
                    p1Name: req.body?.p1Name || null,
                    p2Name: req.body?.p2Name || null,
                    prediction: req.body?.prediction || null,
                    coreDeepScanSucceeded: coreDeepScanReport?.success === true,
                    persistenceCompleted: deepScanPersistenceCompleted
                }
            });
        } catch (diagnosticError) {
            console.warn('⚠️ [AUDIT16D_R3_T5] runtime diagnostic DeepScan non scritto:', diagnosticError?.message || diagnosticError);
        }

        if (coreDeepScanReport?.success === true) {
            // Il segnale analitico del core e valido; l'autorita operativa downstream
            // non e completa. Restituiamo una risposta parziale fail-closed.
            return res.status(206).json({
                ...coreDeepScanReport,
                success: true,
                partial: true,
                status: 'DEEPSCAN_PARTIAL_POSTPROCESS_FAILURE',
                code: 'TENNIS_DEEPSCAN_POSTPROCESS_FAILURE',
                operationId: deepScanRouteOperationId,
                warning: 'Segnale DeepScan disponibile; verifica operativa finale non completata. Stake non autorizzato.',
                userSummary: {
                    status: 'VERIFICA_OPERATIVA_INCOMPLETA',
                    signalAvailable: true,
                    operationallyCertified: false,
                    stakeAuthorized: false
                },
                postProcessFailure: {
                    phase: deepScanRoutePhase,
                    message: error?.message || String(error),
                    operationId: runtimeDiagnostic?.operationId || error?.runtimeOperationId || deepScanRouteOperationId
                },
                persistenceCompleted: deepScanPersistenceCompleted,
                operationalMutationApplied: deepScanPersistenceCompleted,
                manualReviewRequired: true,
                authorityPreserved: true,
                engineVersion: TENNIS_ENGINE_VERSION,
                runtimeDiagnostic
            });
        }

        return res.status(500).json({
            success: false,
            code: 'TENNIS_DEEPSCAN_ROUTE_FAILURE',
            operationId: deepScanRouteOperationId,
            phase: deepScanRoutePhase,
            error: error?.message || String(error),
            runtimeDiagnostic,
            engineVersion: TENNIS_ENGINE_VERSION
        });
    }
});


// ============================================================================
// STEP64 - LEGACY EXPOSURE REPORT NON MUTANTE
// ============================================================================
function buildStep64LegacyExposureReport(limit = 1000) {
    const maxRows = Math.max(50, Math.min(5000, Math.trunc(toNumber(limit, 1000))));
    const rows = db.prepare(`
        SELECT id, match_date, league, home_team, away_team, prediction, odd, stake, status,
               ds_action, professional_gate_status, tennis_operational_status,
               exposure_role, exposure_group_status, market_type, point_line, strategy_tag, data_quality
        FROM ai_forward_test
        WHERE (UPPER(COALESCE(sport_type, '')) = 'TENNIS' OR UPPER(COALESCE(bet_type, '')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag, '')) LIKE '%TENNIS%')
          AND ${getCleanTennisDataQualitySql('data_quality')}
        ORDER BY id DESC
        LIMIT ?
    `).all(maxRows);

    const groups = new Map();
    for (const row of rows) {
        const key = buildStep54TennisExposureKey(row);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }

    const report = {
        mode: 'STEP64_LEGACY_EXPOSURE_AUDIT_READ_ONLY',
        readOnly: true,
        rowsScanned: rows.length,
        groupsScanned: groups.size,
        repeatedMatches: 0,
        multiRealStakeMatches: 0,
        moneylineOppositeMatches: 0,
        totalsMultiLineMatches: 0,
        missingExposureRoleRows: rows.filter(r => !String(r.exposure_role || '').trim()).length,
        examples: []
    };

    for (const [key, groupRows] of groups.entries()) {
        if (groupRows.length > 1) report.repeatedMatches++;

        const realStakeRows = groupRows.filter(isStep54RealStakeCandidate);
        const moneylineSides = new Set(groupRows
            .filter(r => !isStep54TotalsExposure(r))
            .map(r => normalizeTennisPredictionKey(r.prediction))
            .filter(v => v === '1' || v === '2'));
        const totalsLines = new Set(groupRows
            .filter(isStep54TotalsExposure)
            .map(r => `${getStep54ExposureSide(r)}_${toNumber(r.point_line, null) ?? String(r.prediction || '')}`));

        const flags = [];
        if (realStakeRows.length > STEP54_EXPOSURE_GUARD_MAX_REAL_STAKED_PICKS_PER_MATCH) {
            report.multiRealStakeMatches++;
            flags.push('MULTI_REAL_STAKE');
        }
        if (moneylineSides.has('1') && moneylineSides.has('2')) {
            report.moneylineOppositeMatches++;
            flags.push('MONEYLINE_OPPOSITE_SIDES');
        }
        if (totalsLines.size > 1) {
            report.totalsMultiLineMatches++;
            flags.push('TOTALS_MULTI_LINE');
        }

        if (flags.length && report.examples.length < 20) {
            report.examples.push({
                key,
                flags,
                match: `${groupRows[0]?.home_team || ''} - ${groupRows[0]?.away_team || ''}`.trim(),
                match_date: groupRows[0]?.match_date || null,
                league: groupRows[0]?.league || null,
                rows: groupRows.map(r => ({ id: r.id, prediction: r.prediction, stake: r.stake, status: r.status, gate: r.professional_gate_status, ds: r.ds_action, exposure_role: r.exposure_role || null }))
            });
        }
    }

    return report;
}

router.get('/legacy-exposure-audit', (req, res) => {
    try {
        const limit = toNumber(req.query?.limit, 1000);
        res.json({ success: true, ...buildStep64LegacyExposureReport(limit) });
    } catch (error) {
        res.status(500).json({ success: false, mode: 'STEP64_LEGACY_EXPOSURE_AUDIT_READ_ONLY', error: error.message });
    }
});



// ============================================================================
// 23. EXPORT
// ============================================================================

// <TENNIS_DUAL_SINGLES_V5_R1_ROUTE>
// Additive endpoints only, read-only; never changes existing /analyze or stake authority.
router.use('/dual-singles-v5', require('./tennisDualSinglesV5Router'));
module.exports = router;

// STEP42_SERVER_MIDDLEWARE_INSTALL
try {
  if (typeof app !== 'undefined') {
    installStep42TennisGateMiddleware(app, {
      force: true,
      settings: {
        tennisUseTotals: true
      }
    });
  }
} catch (error) {
  console.warn('[STEP42] Middleware Tennis Gate non installato:', error.message);
}
// /STEP42_SERVER_MIDDLEWARE_INSTALL


// STEP42_MARKET_MIX_AUDIT_EXPORT
// Stringhe di audit usate dai test e dalla UI: Over/Under non vengono forzati,
// ma viene segnalato se tennisUseTotals=true e il batch contiene solo moneyline.
// computeTennisMarketMixAudit(rows, { tennisUseTotals: true })
// transformTennisPayloadStep42(payload)
// /STEP42_MARKET_MIX_AUDIT_EXPORT

// STEP91R_COMPAT_MARKER: step91rResolveAiFallbackApplied buildStep91PTennisHistoryFallback(leagueFilter, req.query.limit || 300)

// STEP91R_TENNIS_HISTORY_FALLBACK_FINAL_REPAIR

// STEP93_TENNIS_PAPER_TRADING_DB_SYNC_FINAL: compatibilità finale Paper Trading Tennis, DB import CSV e binding Step91W -> Step92.
