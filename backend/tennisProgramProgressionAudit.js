'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const registry = require('./tennisPatchRegistry');
let globalRegistry = null;
try { globalRegistry = require('./calcioPatchRegistry'); } catch (_) {}
const playerDataRefresh = require('./tennisPlayerDataRefresh');
const multiProviderData = require('./tennisMultiProviderData');
const informationRetrieval = require('./tennisInformationRetrievalCertification');
const historicalPlayerStats = require('./tennisHistoricalPlayerStats');
const historicalValidationPerformance = require('./tennisHistoricalValidationPerformance');
const statisticalChallenger = require('./tennisStatisticalChallenger');
const professionalStatisticalEnsemble = require('./tennisProfessionalStatisticalEnsemble');
const tournamentStageModel = require('./tennisTournamentStageModel');
const tourDataReadiness = require('./tennisTourDataReadiness');
const forwardSampleIntake = require('./tennisForwardSampleIntake');
const runtimeHealthContract = require('./tennisRuntimeHealthContract');
const prematchCaptureGate = require('./tennisPrematchCaptureGate');
const rejectedCaptureObservability = require('./tennisRejectedCaptureObservability');
const canonicalEventTime = require('./tennisCanonicalEventTime');
const officialScheduleAuthority = require('./tennisOfficialScheduleAuthority');
const coreContractAudit = require('./tennisCoreContractAudit');
const releaseSecurity = require('./tennisReleaseSecurity');
const canonicalPlayerEvidenceBridge = require('./tennisCanonicalPlayerEvidenceBridge');
const officialSettlementResolver = require('./tennisOfficialSettlementResolver');
const settlementUpdateAudit = require('./tennisSettlementUpdateAudit');
const clvSportDiscoveryPatch35 = require('./tennisClvSportKeyDiscoveryPatch35');
const stakeAuthorityPatch35 = require('./tennisStakeAuthorityPatch35');
const riskAuthorityPatch36 = require('./tennisRiskAuthorityPatch36');
const tourDriftAuthorityPatch36 = require('./tennisTourDriftAuthorityPatch36');

const TENNIS_PROGRAM_PROGRESSION_AUDIT_VERSION = 'TENNIS_PROGRAM_PROGRESSION_AUDIT_V29_PATCH36';
const EXPECTED_HISTORICAL_SEASONS = Object.freeze([2026, 2025, 2024]);

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function tableExists(db, table) {
  try { return Number(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(table).n || 0) === 1; }
  catch (_) { return false; }
}
function triggerExists(db, trigger) {
  try { return Number(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger).n || 0) === 1; }
  catch (_) { return false; }
}
function duplicateHtmlIds(html) {
  const counts = new Map();
  const regex = /\bid\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(String(html || '')))) counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }));
}
function check(name, ok, details = null, severity = 'error') {
  return { name, ok: Boolean(ok), severity, details };
}
function sameSeasonSequence(actual) {
  return Array.isArray(actual)
    && actual.length === EXPECTED_HISTORICAL_SEASONS.length
    && actual.every((value, index) => Number(value) === EXPECTED_HISTORICAL_SEASONS[index]);
}

function buildProgramProgressionAudit(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('DB_ADAPTER_REQUIRED');
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '..'));
  const backendDir = path.join(projectRoot, 'backend');
  const historicalDatasetPath = path.resolve(options.historicalDatasetPath || path.join(projectRoot, 'data', 'tennisdb_historical_player_stats.json'));
  const publicApp = path.join(projectRoot, 'public', 'app.js');
  const backendPublicApp = path.join(backendDir, 'public', 'app.js');
  const publicIndex = path.join(projectRoot, 'public', 'index.html');
  const backendPublicIndex = path.join(backendDir, 'public', 'index.html');
  const inventoryPath = path.join(backendDir, 'tennis_patch_inventory.json');
  const serverPath = path.join(backendDir, 'server.tennis.js');
  const schedulerPath = path.join(backendDir, 'tennisAutoScheduler.js');
  const schedulerConfigPath = path.join(backendDir, 'tennis_cron_config.json');

  let inventory = null;
  try { inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8')); } catch (_) {}
  let integrity = null;
  try { integrity = db.prepare('PRAGMA integrity_check').get().integrity_check; } catch (error) { integrity = error.message; }

  const requiredTables = [
    'ai_forward_test',
    'tennis_calibration_eligibility',
    'tennis_prediction_snapshots',
    'tennis_forward_cohorts',
    'tennis_forward_cohort_members',
    'tennis_player_evidence_snapshots',
    'tennis_matchup_feature_snapshots',
    'tennis_challenger_predictions',
    informationRetrieval.TABLE_RUNS,
    informationRetrieval.TABLE_CHECKS,
    informationRetrieval.TABLE_RECEIPTS,
    historicalPlayerStats.TABLE_IMPORTS,
    historicalPlayerStats.TABLE_RECORDS,
    historicalValidationPerformance.TABLE_RUNS,
    historicalValidationPerformance.TABLE_EVALUATIONS,
    statisticalChallenger.TABLE_RUNS,
    statisticalChallenger.TABLE_PREDICTIONS,
    'tennis_statistical_engine_audit_runs',
    'tennis_statistical_engine_checks',
    'tennis_event_time_revisions',
    'tennis_schedule_receipts'
  ];
  const requiredTriggers = [
    'trg_tennis_player_evidence_no_update',
    'trg_tennis_player_evidence_no_delete',
    'trg_tennis_matchup_features_no_update',
    'trg_tennis_matchup_features_no_delete',
    'trg_tennis_challenger_no_update',
    'trg_tennis_challenger_no_delete',
    'trg_tennis_info_runs_no_update',
    'trg_tennis_info_runs_no_delete',
    'trg_tennis_info_checks_no_update',
    'trg_tennis_info_checks_no_delete',
    'trg_tennis_prediction_receipts_no_update',
    'trg_tennis_prediction_receipts_no_delete',
    'trg_tennis_historical_imports_no_update',
    'trg_tennis_historical_imports_no_delete',
    'trg_tennis_historical_records_no_update',
    'trg_tennis_historical_records_no_delete',
    'trg_tennis_hist_validation_runs_no_update',
    'trg_tennis_hist_validation_runs_no_delete',
    'trg_tennis_hist_validation_evals_no_update',
    'trg_tennis_hist_validation_evals_no_delete',
    'trg_tennis_stat_challenger_runs_no_update',
    'trg_tennis_stat_challenger_runs_no_delete',
    'trg_tennis_stat_challenger_predictions_no_update',
    'trg_tennis_stat_challenger_predictions_no_delete',
    'trg_tennis_stat_engine_runs_no_update',
    'trg_tennis_stat_engine_runs_no_delete',
    'trg_tennis_stat_engine_checks_no_update',
    'trg_tennis_stat_engine_checks_no_delete',
    'trg_tennis_event_time_no_update',
    'trg_tennis_event_time_no_delete',
    'trg_tennis_schedule_receipts_no_update',
    'trg_tennis_schedule_receipts_no_delete'
  ];
  const requiredModules = [
    'tennisQualityGateV2.js',
    'tennisForwardCaptureHealth.js',
    'tennisPlayerEvidence.js',
    'tennisMatchupIntelligence.js',
    'tennisHistoricalCombinationEvidence.js',
    'tennisProgramProgressionAudit.js',
    'tennisPlayerDataRefresh.js',
    'tennisMultiProviderData.js',
    'tennisInformationRetrievalCertification.js',
    'tennisHistoricalPlayerStats.js',
    'tennisHistoricalValidationPerformance.js',
    'tennisStatisticalChallenger.js',
    'tennisTournamentStageModel.js',
    'tennisProfessionalStatisticalEnsemble.js',
    'tennisTourDataReadiness.js',
    'tennisForwardSampleIntake.js',
    'tennisRuntimeHealthContract.js',
    'tennisPrematchCaptureGate.js',
    'tennisRejectedCaptureObservability.js',
    'migrateTennisPatch32.js',
    'tennisCanonicalEventTime.js',
    'migrateTennisPatch33.js',
    'tennisOfficialScheduleAuthority.js',
    'migrateTennisPatch34.js',
    'tennisCoreContractAudit.js',
    'tennisReleaseSecurity.js',
    'repairTennisPendingConsistency.js',
    'repairStep49CSoftBlocks.js',
    'tennisCanonicalPlayerEvidenceBridge.js',
    'tennisOfficialSettlementResolver.js',
    'tennisOfficialSettlementSeedPatch29.json',
    'migrateTennisPatch29.js',
    'migrateTennisPatch29R3.js'
  ];
  const serverText = fs.existsSync(serverPath) ? fs.readFileSync(serverPath, 'utf8') : '';
  const schedulerText = fs.existsSync(schedulerPath) ? fs.readFileSync(schedulerPath, 'utf8') : '';
  const appText = fs.existsSync(publicApp) ? fs.readFileSync(publicApp, 'utf8') : '';
  const schedulerConfig = fs.existsSync(schedulerConfigPath) ? (() => { try { return JSON.parse(fs.readFileSync(schedulerConfigPath, 'utf8')); } catch (_) { return null; } })() : null;
  const indexText = fs.existsSync(publicIndex) ? fs.readFileSync(publicIndex, 'utf8') : '';
  const activePatches = registry.PATCHES.filter(item => Number(item.version) >= 1 && item.status.startsWith('ACTIVE')).map(item => String(item.version));
  const expectedPatches = Array.from({ length: Number(registry.TENNIS_CURRENT_PATCH_VERSION) }, (_, index) => String(index + 1));
  const missingActivePatches = expectedPatches.filter(version => !activePatches.includes(version));
  const frontAppSame = fs.existsSync(publicApp) && fs.existsSync(backendPublicApp) && sha256File(publicApp) === sha256File(backendPublicApp);
  const frontIndexSame = fs.existsSync(publicIndex) && fs.existsSync(backendPublicIndex) && sha256File(publicIndex) === sha256File(backendPublicIndex);
  const duplicates = duplicateHtmlIds(indexText);
  const requiredRoutes = [
    '/quality-gate-health',
    '/forward-capture-health',
    '/prematch-capture-gate-health',
    '/rejected-capture-observability',
    '/canonical-event-time-health',
    '/official-schedule-health',
    '/core-contract-health',
    '/forward-sample-intake-readiness',
    '/player-matchup-intelligence',
    '/historical-combination-evidence',
    '/program-progression-health',
    '/player-data-freshness',
    '/player-data-refresh',
    '/player-data-source-probe',
    '/player-data-provider-health',
    '/player-data-provider-probe',
    '/tour-data-readiness',
    '/information-retrieval-health',
    '/information-retrieval-probe',
    '/historical-player-stats-health',
    '/historical-player-stats-matchup',
    '/canonical-player-evidence-health',
    '/canonical-player-evidence-matchup',
    '/historical-validation-performance-health',
    '/historical-validation-performance',
    '/historical-validation-performance-refresh',
    '/statistical-challenger-health',
    '/statistical-challenger',
    '/statistical-challenger-refresh',
    '/statistical-engine-health',
    '/statistical-engine-audit',
    '/statistical-engine-audit-refresh',
    '/official-settlement-health',
    '/official-settlement-preview'
  ];
  const missingRoutes = requiredRoutes.filter(route => !serverText.includes(route));

  const tennisWhere = "(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%')";
  const sourceRows = tableExists(db, 'ai_forward_test') ? Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n || 0) : 0;
  const tennisRows = tableExists(db, 'ai_forward_test') ? Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere}`).get().n || 0) : 0;
  const historicalComboColumns = tableExists(db, 'ai_forward_test')
    ? new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name))
    : new Set();
  const requiredComboColumns = [
    'historical_combo_key', 'historical_combo_deepscan', 'historical_combo_quality',
    'historical_combo_resolved', 'historical_combo_win_rate_pct', 'historical_combo_reliability',
    'historical_combo_evidence_hash', 'historical_combo_version', 'historical_combo_calculated_at'
  ];
  const prematchGateColumns = [
    'prematch_capture_gate_version', 'prematch_capture_gate_status', 'prematch_capture_gate_reason',
    'prematch_capture_gate_checked_at', 'prematch_capture_gate_lead_ms', 'prematch_capture_gate_timezone'
  ];
  const canonicalEventTimeColumns = [
    'canonical_event_time_contract_version', 'canonical_event_time_revision_id',
    'canonical_event_time_source_kind', 'canonical_event_time_source_id',
    'canonical_event_time_source_field', 'canonical_event_time_source_timezone',
    'canonical_event_time_canonical_utc', 'canonical_event_time_safety_utc',
    'canonical_event_time_confidence', 'canonical_event_time_quality_status',
    'canonical_event_time_conflict_ms', 'canonical_event_time_checked_at'
  ];
  const canonicalEventTimeSelfCheck = canonicalEventTime.selfCheck();
  let canonicalEventTimeHealth = null;
  try { canonicalEventTimeHealth = canonicalEventTime.buildProviderTimeQualityReport(db, { limit: 5 }); }
  catch (error) { canonicalEventTimeHealth = { success: false, healthy: false, status: 'ERROR', error: error.message }; }
  const officialScheduleColumns = [
    'official_schedule_contract_version','official_schedule_receipt_id','official_schedule_source_kind',
    'official_schedule_source_id','official_schedule_status','official_schedule_transition_type',
    'official_schedule_effective_start_at_utc','official_schedule_capture_disposition',
    'official_schedule_observation_hash','official_schedule_checked_at'
  ];
  const officialScheduleSelfCheck = officialScheduleAuthority.selfCheck();
  let officialScheduleHealth = null;
  try { officialScheduleHealth = officialScheduleAuthority.buildScheduleHealthReport(db, { limit: 5 }); }
  catch (error) { officialScheduleHealth = { success: false, healthy: false, status: 'ERROR', error: error.message }; }
  const prematchGateSelfCheck = prematchCaptureGate.selfCheck();
  const rejectedCaptureSelfCheck = rejectedCaptureObservability.selfCheck();
  let rejectedCaptureObservabilityHealth = null;
  try { rejectedCaptureObservabilityHealth = rejectedCaptureObservability.buildObservabilityReport(db, { limit: 5 }); }
  catch (error) { rejectedCaptureObservabilityHealth = { success: false, healthy: false, status: 'ERROR', error: error.message }; }
  let coreContractHealth = null;
  try { coreContractHealth = coreContractAudit.buildCoreContractAudit({ projectRoot }); }
  catch (error) { coreContractHealth = { success: false, healthy: false, status: 'ERROR', error: error.message }; }
  let releaseSecurityHealth = null;
  try { releaseSecurityHealth = releaseSecurity.buildSecurityHealth({ projectRoot }); }
  catch (error) { releaseSecurityHealth = { success: false, healthy: false, status: 'ERROR', error: error.message }; }

  let playerDataHealth = null;
  try { playerDataHealth = playerDataRefresh.getPlayerDataHealth({ dataDir: path.join(backendDir, 'sackmann_data'), initialize: true }); }
  catch (error) { playerDataHealth = { status: 'ERROR', error: error.message, healthy: false }; }
  let multiProviderHealth = null;
  try { multiProviderHealth = multiProviderData.getHealth({ dataDir: path.join(backendDir, 'sackmann_data'), projectRoot }); }
  catch (error) { multiProviderHealth = { success: false, status: 'ERROR', error: error.message }; }
  let tourDataReadinessHealth = null;
  try { tourDataReadinessHealth = tourDataReadiness.buildReadinessHealth(db, { dataDir: path.join(backendDir, 'sackmann_data'), projectRoot }); }
  catch (error) { tourDataReadinessHealth = { success: false, status: 'ERROR', error: error.message, targets: [], tours: [] }; }

  let forwardSampleIntakeHealth = null;
  try { forwardSampleIntakeHealth = forwardSampleIntake.inspectForwardSampleIntake(db); }
  catch (error) {
    forwardSampleIntakeHealth = {
      success: false,
      healthy: false,
      status: 'BLOCKED_CAPTURE',
      structuralReady: false,
      structuralGaps: ['INTAKE_AUDIT_ERROR'],
      error: error.message,
      historicalBackfill: false,
      authority: { productionProbability: false, qualityGate: false, stake: false, settlement: false }
    };
  }

  let historicalStatsHealth = null;
  try {
    historicalStatsHealth = {
      ...historicalPlayerStats.getStatus({ datasetPath: historicalDatasetPath, initialize: true }),
      database: historicalPlayerStats.getDatabaseHealth(db)
    };
  } catch (error) {
    historicalStatsHealth = { success: false, loaded: false, status: 'UNAVAILABLE', error: error.message, database: { success: false, status: 'ERROR' } };
  }

  let canonicalPlayerEvidenceHealth = null;
  try { canonicalPlayerEvidenceHealth = canonicalPlayerEvidenceBridge.getHealth({ historicalDatasetPath }); }
  catch (error) { canonicalPlayerEvidenceHealth = { success: false, status: 'ERROR', error: error.message }; }

  let historicalValidationPerformanceHealth = null;
  try { historicalValidationPerformanceHealth = historicalValidationPerformance.getPerformanceHealth(db); }
  catch (error) { historicalValidationPerformanceHealth = { success: false, status: 'ERROR', error: error.message }; }

  let statisticalChallengerHealth = null;
  try { statisticalChallengerHealth = statisticalChallenger.getStatisticalChallengerHealth(db); }
  catch (error) { statisticalChallengerHealth = { success: false, status: 'ERROR', error: error.message }; }

  let professionalStatisticalEngineHealth = null;
  try { professionalStatisticalEngineHealth = professionalStatisticalEnsemble.getProfessionalEngineHealth(db); }
  catch (error) { professionalStatisticalEngineHealth = { success: false, status: 'ERROR', error: error.message }; }
  let recentPerformanceGuard = null;
  try { recentPerformanceGuard = tournamentStageModel.loadRecentPerformanceFromDb(db, { recentSize: 60, previousSize: 120 }); }
  catch (error) { recentPerformanceGuard = { degradationActive: false, error: error.message }; }

  let informationRetrievalHealth = null;
  try {
    informationRetrievalHealth = informationRetrieval.buildInformationRetrievalHealth(db, {
      projectRoot,
      dataDir: path.join(backendDir, 'sackmann_data'),
      cacheDir: path.join(backendDir, 'cache_news'),
      playerDataHealth,
    multiProviderHealth,
      historicalDatasetPath,
      historicalPlayerStatsHealth: historicalStatsHealth,
      limit: 4
    });
  } catch (error) {
    informationRetrievalHealth = { status: 'FAIL', success: false, error: error.message, overallScore: 0 };
  }

  const currentVersion = String(registry.TENNIS_CURRENT_PATCH_VERSION);
  const historicalAuthoritySafe = historicalStatsHealth?.modelProbabilityAuthority === false
    && historicalStatsHealth?.qualityGateAuthority === false
    && historicalStatsHealth?.stakeAuthority === false
    && historicalStatsHealth?.settlementAuthority === false;
  const historicalSeasonsSafe = sameSeasonSequence(historicalStatsHealth?.seasons?.ATP)
    && sameSeasonSequence(historicalStatsHealth?.seasons?.WTA);
  const historicalParitySafe = ['MATCH', 'MATCH_WITH_STALE_HTML_HEADER'].includes(historicalStatsHealth?.formatParity);
  const historicalDatabaseSafe = historicalStatsHealth?.database?.success === true
    && historicalStatsHealth?.database?.immutableTriggers === true
    && Number(historicalStatsHealth?.database?.orphanRecords || 0) === 0;
  const runtimeHealthContractSafe = runtimeHealthContract.TENNIS_RUNTIME_HEALTH_CONTRACT_VERSION === 'TENNIS_RUNTIME_HEALTH_CONTRACT_V2_PATCH29_R3'
    && runtimeHealthContract.SERVER_CORE_VERSION === '14.7'
    && runtimeHealthContract.TENNIS_ENGINE_VERSION === '15.16_STEP78_HISTORICAL_BOOTSTRAP_RELIABILITY';
  const activeIndexText = indexText.replace(/<!--[\s\S]*?-->/g, '');
  const activeFrontendScript = (activeIndexText.match(/<script[^>]+src=["'](?:\.\/)?app\.js\?v=([^"']+)["']/i) || [])[1] || '';
  const tennisFrontendRevisionPattern = new RegExp(`^patch${currentVersion}(?:-r\\d+)?-[a-z0-9-]+$`, 'i');
  const globalFrontendRevisionPattern = /^betting-patch[a-z0-9-]+$/i;
  const currentGlobalVersion = String(globalRegistry?.CALCIO_CURRENT_PATCH_VERSION || '');
  const currentGlobalPatch = Array.isArray(globalRegistry?.PATCHES)
    ? globalRegistry.PATCHES.find(item => String(item?.version || '') === currentGlobalVersion)
    : null;
  const currentGlobalFrontendScope = Array.isArray(currentGlobalPatch?.scope)
    && currentGlobalPatch.scope.includes('public/app.js')
    && currentGlobalPatch.scope.includes('public/index.html');
  const tennisRevisionAccepted = tennisFrontendRevisionPattern.test(activeFrontendScript);
  const globalRevisionAccepted = globalFrontendRevisionPattern.test(activeFrontendScript)
    && Number(currentGlobalVersion || 0) >= 38
    && currentGlobalPatch?.status === 'ACTIVE'
    && currentGlobalFrontendScope;
  const frontendRevisionAccepted = tennisRevisionAccepted || globalRevisionAccepted;
  const frontendAppCopiesSynchronized = fs.existsSync(backendPublicApp)
    && sha256File(publicApp) === sha256File(backendPublicApp);
  const frontendIndexCopiesSynchronized = fs.existsSync(backendPublicIndex)
    && sha256File(publicIndex) === sha256File(backendPublicIndex);
  const frontendCopiesSynchronized = frontendAppCopiesSynchronized && frontendIndexCopiesSynchronized;
  const frontendRuntimeTruthSafe = frontendRevisionAccepted
    && frontendCopiesSynchronized
    && appText.includes('PATCH28_RUNTIME_HEALTH_TRUTH_EVIDENCE_CLARITY')
    && appText.includes('PATCH25_TENNIS_RUNTIME_HEALTH_TRUTH_UI')
    && appText.includes('PATCH28_R2_UI_NAVIGATION_STABILITY')
    && appText.includes('TENNIS_PATCH28_R3_RUNTIME_DIAGNOSTICS_SCOPE_ODDS_TIMEOUT_DERIVED_STATE_ALIGNMENT')
    && appText.includes('TENNIS_PATCH29_R3_PREMATCH_CAPTURE_GATE_COMPONENT_HEALTH_SEMANTIC')
    && appText.includes('TENNIS_PATCH30_CORE_HYGIENE_SCRIPT_CONTRACT_REPAIR')
    && appText.includes('TENNIS_PATCH31_SECRETS_RELEASE_HARDENING')
    && appText.includes('TENNIS_PATCH32_REJECTED_CAPTURE_OBSERVABILITY_CLOCK_DRIFT_LEDGER')
    && appText.includes('TENNIS_PATCH33_CANONICAL_EVENT_TIME_PROVIDER_TIME_QUALITY')
    && appText.includes('TENNIS_PATCH34_R4_SETTLEMENT_TRUTH_SNAPSHOT_AUTHORITY_DIAGNOSTIC_SEMANTICS')
    && appText.includes('Pronto al primo match')
    && !indexText.includes('app.js?v=patch20-resilient-player-data-refresh');
  const schedulerExactSafe = schedulerText.includes("const SCHEDULER_MODE_EXACT = 'PERSISTENT_EXACT_INTERVAL'")
    && schedulerText.includes('calculateNextRunAt')
    && schedulerText.includes('legacyMisleadingCronBlocked')
    && schedulerText.includes('singleFlightLockActive')
    && !schedulerText.includes('return `${merged.minute} */${merged.intervalHours}');
  const schedulerConfigSafe = !schedulerConfig || schedulerConfig.type !== 'interval_hours'
    || schedulerConfig.schedulerMode === 'PERSISTENT_EXACT_INTERVAL';

  const checks = [
    check(`Registry corrente Patch ${currentVersion}`, Number(currentVersion) >= 21 && registry.TENNIS_PATCH_REGISTRY_VERSION === `TENNIS_PATCH_REGISTRY_V${currentVersion}`, { current: currentVersion, registry: registry.TENNIS_PATCH_REGISTRY_VERSION }),
    check(`Patch 1-${currentVersion} attive`, missingActivePatches.length === 0, { missing: missingActivePatches }),
    check('Inventario legacy completo', Number(inventory?.summary?.uniqueLegacySteps) === 56 && Number(inventory?.summary?.unregisteredCount) === 0 && String(inventory?.registry?.currentPatchVersion) === currentVersion, inventory?.summary || null),
    check('Integrità SQLite', integrity === 'ok', { integrity }),
    check('Tabelle critiche presenti', requiredTables.every(table => tableExists(db, table)), { missing: requiredTables.filter(table => !tableExists(db, table)) }),
    check('Trigger append-only e immutabilità presenti', requiredTriggers.every(trigger => triggerExists(db, trigger)), { missing: requiredTriggers.filter(trigger => !triggerExists(db, trigger)) }),
    check('Colonne evidenza storica Patch 13', requiredComboColumns.every(column => historicalComboColumns.has(column)), { missing: requiredComboColumns.filter(column => !historicalComboColumns.has(column)) }),
    check('Moduli Tennis critici presenti', requiredModules.every(file => fs.existsSync(path.join(backendDir, file))), { missing: requiredModules.filter(file => !fs.existsSync(path.join(backendDir, file))) }),
    check('Endpoint critici collegati', missingRoutes.length === 0, { missing: missingRoutes }),
    check('Resolver settlement ufficiale Patch 29 R1', officialSettlementResolver.health().healthy === true
      && officialSettlementResolver.health().version === 'TENNIS_OFFICIAL_SETTLEMENT_RESOLVER_V3_PATCH34_R4'
      && Number(officialSettlementResolver.health().seedByTour?.WTA || 0) >= 9
      && officialSettlementResolver.health().wtaDrawParserActive === true
      && officialSettlementResolver.health().zeroOddsApiCalls === true,
      officialSettlementResolver.health()),
    check('Settlement update audit truth Patch 29 R2', settlementUpdateAudit.VERSION === 'TENNIS_SETTLEMENT_UPDATE_AUDIT_V1_PATCH29_R2'
      && settlementUpdateAudit.OUTCOMES.DB_UPDATE_FAILED === 'DB_UPDATE_FAILED'
      && settlementUpdateAudit.OUTCOMES.SKIPPED_MANUAL_REVIEW === 'SKIPPED_MANUAL_REVIEW', settlementUpdateAudit.OUTCOMES),
    check('Ritiri ufficiali senza settlement automatico', officialSettlementResolver.health().retirementEvidenceRecords > 0
      && officialSettlementResolver.health().retirementAutoSettlement === false,
      { retirementEvidenceRecords: officialSettlementResolver.health().retirementEvidenceRecords,
        retirementAutoSettlement: officialSettlementResolver.health().retirementAutoSettlement,
        policy: officialSettlementResolver.health().policy }),
    check('Runtime Health Contract semantic Patch 29 R3', runtimeHealthContractSafe
      && typeof runtimeHealthContract.buildComponentHealthSemantics === 'function'
      && serverText.includes('componentHealthSemantics'),
      { version: runtimeHealthContract.TENNIS_RUNTIME_HEALTH_CONTRACT_VERSION, serverCore: runtimeHealthContract.SERVER_CORE_VERSION, tennisEngine: runtimeHealthContract.TENNIS_ENGINE_VERSION }),
    check('Prematch Capture Gate Patch 29 R3', prematchGateSelfCheck.ok === true
      && prematchCaptureGate.TENNIS_PREMATCH_CAPTURE_GATE_VERSION === 'TENNIS_PREMATCH_CAPTURE_GATE_V1_PATCH29_R3'
      && serverText.includes('PREMATCH_CAPTURE_GATE_PASS')
      && serverText.includes('PATCH29_R3_PREMATCH_CAPTURE_GATE_BLOCKED'), prematchGateSelfCheck),
    check('Schema Prematch Capture Gate additivo', prematchGateColumns.every(column => historicalComboColumns.has(column)),
      { missing: prematchGateColumns.filter(column => !historicalComboColumns.has(column)), noHistoricalBackfillRequired: true }),
    check('Canonical Event Time Contract Patch 33', canonicalEventTimeSelfCheck.ok === true
      && canonicalEventTimeHealth?.healthy === true
      && canonicalEventTimeHealth?.schema?.appendOnly === true
      && canonicalEventTimeHealth?.chain?.healthy === true
      && canonicalEventTimeHealth?.automaticGateOverride === false
      && canonicalEventTimeHealth?.authority?.captureTime === true
      && canonicalEventTimeHealth?.authority?.modelProbability === false
      && serverText.includes('PATCH33_CANONICAL_EVENT_TIME_BLOCKED')
      && serverText.includes('/canonical-event-time-health'),
      { selfCheck: canonicalEventTimeSelfCheck, status: canonicalEventTimeHealth?.status, schema: canonicalEventTimeHealth?.schema, chain: canonicalEventTimeHealth?.chain, counts: canonicalEventTimeHealth?.counts, authority: canonicalEventTimeHealth?.authority }),
    check('Schema Canonical Event Time additivo e forward-only', canonicalEventTimeColumns.every(column => historicalComboColumns.has(column))
      && canonicalEventTimeHealth?.forwardOnly === true
      && canonicalEventTimeHealth?.noHistoricalBackfill === true,
      { missing: canonicalEventTimeColumns.filter(column => !historicalComboColumns.has(column)), ledgerRows: canonicalEventTimeHealth?.total, noHistoricalBackfill: canonicalEventTimeHealth?.noHistoricalBackfill }),
    check('Official Schedule Authority Patch 34', officialScheduleSelfCheck.ok === true
      && officialScheduleHealth?.healthy === true
      && officialScheduleHealth?.schema?.appendOnly === true
      && officialScheduleHealth?.chain?.healthy === true
      && officialScheduleHealth?.captureRaceGuard === true
      && officialScheduleHealth?.automaticSettlement === false
      && officialScheduleHealth?.authority?.captureLifecycle === true
      && officialScheduleHealth?.authority?.probability === false
      && officialScheduleHealth?.authority?.stake === false
      && officialScheduleHealth?.authority?.settlement === false
      && serverText.includes('PATCH34_OFFICIAL_SCHEDULE_LIFECYCLE_BLOCKED')
      && serverText.includes('OFFICIAL_SCHEDULE_CAPTURE_TOKEN_STABLE')
      && serverText.includes('/official-schedule-health'),
      { selfCheck: officialScheduleSelfCheck, status: officialScheduleHealth?.status, schema: officialScheduleHealth?.schema, chain: officialScheduleHealth?.chain, counts: officialScheduleHealth?.counts, authority: officialScheduleHealth?.authority }),
    check('Schema Official Schedule additivo e forward-only', officialScheduleColumns.every(column => historicalComboColumns.has(column))
      && officialScheduleHealth?.forwardOnly === true
      && officialScheduleHealth?.noHistoricalBackfill === true,
      { missing: officialScheduleColumns.filter(column => !historicalComboColumns.has(column)), receiptRows: officialScheduleHealth?.total, noHistoricalBackfill: officialScheduleHealth?.noHistoricalBackfill }),
    check('Rejected Capture Observability Patch 32', rejectedCaptureSelfCheck.ok === true
      && rejectedCaptureObservabilityHealth?.healthy === true
      && rejectedCaptureObservabilityHealth?.appendOnly === true
      && rejectedCaptureObservabilityHealth?.chain?.healthy === true
      && serverText.includes('POST_ROLLBACK_LEDGER_APPEND')
      && serverText.includes('/rejected-capture-observability'),
      { selfCheck: rejectedCaptureSelfCheck, status: rejectedCaptureObservabilityHealth?.status, schema: rejectedCaptureObservabilityHealth?.schema, chain: rejectedCaptureObservabilityHealth?.chain, counts: rejectedCaptureObservabilityHealth?.counts }),
    check('Ledger rifiuti forward-only senza ricostruzione storica', Number(rejectedCaptureObservabilityHealth?.counts?.total || 0) >= 0
      && rejectedCaptureObservabilityHealth?.automaticOverride === false
      && rejectedCaptureObservabilityHealth?.authority?.predictionPersistence === false
      && rejectedCaptureObservabilityHealth?.authority?.stake === false,
      { counts: rejectedCaptureObservabilityHealth?.counts, authority: rejectedCaptureObservabilityHealth?.authority, noHistoricalBackfill: true }),
    check('Core Contract Audit Patch 30', coreContractHealth?.healthy === true
      && coreContractAudit.TENNIS_CORE_CONTRACT_AUDIT_VERSION === 'TENNIS_CORE_CONTRACT_AUDIT_V1_PATCH30'
      && Number(coreContractHealth?.packageScripts?.missingFileTargets?.length || 0) === 0
      && Number(coreContractHealth?.runtimeDependencies?.missing?.length || 0) === 0
      && Number(coreContractHealth?.duplicateFunctionDeclarations?.length || 0) === 0,
      { version: coreContractAudit.TENNIS_CORE_CONTRACT_AUDIT_VERSION, packageScripts: coreContractHealth?.packageScripts, missingRuntimeDependencies: coreContractHealth?.runtimeDependencies?.missing, duplicateFunctionDeclarations: coreContractHealth?.duplicateFunctionDeclarations }),
    check('Secrets & Release Hardening Patch 31', releaseSecurityHealth?.healthy === true
      && releaseSecurity.TENNIS_RELEASE_SECURITY_VERSION === 'TENNIS_RELEASE_SECURITY_V1_PATCH31'
      && Number(releaseSecurityHealth?.secretPersistence?.findingCount || 0) === 0
      && releaseSecurityHealth?.secretPersistence?.persistedTelegramConfigToken === false
      && releaseSecurityHealth?.releasePolicy?.withinSizeGuard === true
      && releaseSecurityHealth?.releasePolicy?.backupsExcluded === true
      && releaseSecurityHealth?.releasePolicy?.databasesExcluded === true
      && releaseSecurityHealth?.releasePolicy?.executablesExcluded === true,
      { version: releaseSecurity.TENNIS_RELEASE_SECURITY_VERSION, status: releaseSecurityHealth?.status, secretPersistence: releaseSecurityHealth?.secretPersistence, releasePolicy: releaseSecurityHealth?.releasePolicy, secretsExposed: false }),
    check(`Frontend health truth e cache coherency Patch ${currentVersion}`, frontendRuntimeTruthSafe, { activeFrontendScript, acceptedTennisRevisionPattern: tennisFrontendRevisionPattern.source, acceptedGlobalRevisionPattern: globalFrontendRevisionPattern.source, frontendAuthority: tennisRevisionAccepted ? 'TENNIS_REVISION' : (globalRevisionAccepted ? 'GLOBAL_REVISION' : 'UNRECOGNIZED'), globalRegistryVersion: currentGlobalVersion || null, currentGlobalPatchId: currentGlobalPatch?.id || null, currentGlobalFrontendScope, publicBackendAppSynchronized: frontendAppCopiesSynchronized, publicBackendIndexSynchronized: frontendIndexCopiesSynchronized, publicBackendCopiesSynchronized: frontendCopiesSynchronized, navigationMarker: appText.includes('PATCH28_R2_UI_NAVIGATION_STABILITY'), runtimeAlignmentMarker: appText.includes('TENNIS_PATCH28_R3_RUNTIME_DIAGNOSTICS_SCOPE_ODDS_TIMEOUT_DERIVED_STATE_ALIGNMENT'), stalePatch20CacheBuster: indexText.includes('app.js?v=patch20-resilient-player-data-refresh') }),
    check('Scheduler intervallo persistente esatto Patch 25', schedulerExactSafe && schedulerConfigSafe, { schedulerVersionMarker: schedulerText.includes('3.1_PATCH25_PERSISTENT_EXACT_INTERVAL'), configMode: schedulerConfig?.schedulerMode || null, legacyCronBlocked: schedulerText.includes('legacyMisleadingCronBlocked') }),
    check('Primo match pronto senza torneo live', forwardSampleIntakeHealth?.structuralReady === true && ['READY_FOR_NEXT_PREDICTION','CAPTURING_FORWARD_SAMPLE'].includes(forwardSampleIntakeHealth?.status), { status: forwardSampleIntakeHealth?.status, structuralReady: forwardSampleIntakeHealth?.structuralReady, nextAction: forwardSampleIntakeHealth?.nextAction }),
    check('Refresh dati giocatori resiliente allowlist/atomico', playerDataHealth?.status !== 'ERROR' && playerDataRefresh.ALLOWED_HOSTS.has('raw.githubusercontent.com') && playerDataRefresh.ALLOWED_HOSTS.has('api.github.com') && playerDataRefresh.TENNIS_PLAYER_DATA_REFRESH_VERSION === 'TENNIS_PLAYER_DATA_REFRESH_V2_PATCH20', { status: playerDataHealth?.status, refreshState: playerDataHealth?.refreshState, degradedUsingLastKnownGood: playerDataHealth?.degradedUsingLastKnownGood, latestMatchAt: playerDataHealth?.latestMatchAt, dataAgeDays: playerDataHealth?.dataAgeDays, errors: playerDataHealth?.errors || [] }),
    check('Registry multi-provider Patch 21/36', multiProviderHealth?.success === true && ['TENNIS_MULTI_PROVIDER_DATA_V1_PATCH21','TENNIS_MULTI_PROVIDER_DATA_V2_PATCH36'].includes(multiProviderData.TENNIS_MULTI_PROVIDER_VERSION) && ['TENNIS_MULTI_PROVIDER_REGISTRY_V1_PATCH21','TENNIS_MULTI_PROVIDER_REGISTRY_V2_PATCH36'].includes(multiProviderData.TENNIS_MULTI_PROVIDER_REGISTRY_VERSION), multiProviderHealth),
    check('Politica costi zero-key prima delle API', multiProviderHealth?.costPolicy?.zeroKeyFirst === true && multiProviderHealth?.costPolicy?.bulkBeforeApi === true && multiProviderHealth?.costPolicy?.cacheBeforeNetwork === true, multiProviderHealth?.costPolicy || null),
    check('Chiavi API non persistite e non esposte', multiProviderHealth?.apiUsage?.keyPersisted === false && multiProviderHealth?.apiUsage?.keyExposed === false, multiProviderHealth?.apiUsage || null),
    check('Multi-provider senza autorità operativa', multiProviderHealth?.productionAuthority === false && multiProviderHealth?.qualityGateAuthority === false && multiProviderHealth?.stakeAuthority === false && multiProviderHealth?.hardExclusion === false, { productionAuthority: multiProviderHealth?.productionAuthority, qualityGateAuthority: multiProviderHealth?.qualityGateAuthority, stakeAuthority: multiProviderHealth?.stakeAuthority, hardExclusion: multiProviderHealth?.hardExclusion }),
    check('Freschezza target/circuito senza mascheramento aggregato', tourDataReadinessHealth?.success === true && tourDataReadinessHealth?.sourceFreshnessNotMasked === true && Array.isArray(tourDataReadinessHealth?.targets) && tourDataReadinessHealth.targets.length === 3, { status: tourDataReadinessHealth?.status, targets: tourDataReadinessHealth?.targets, tours: tourDataReadinessHealth?.tours }),
    check('Tutti i circuiti dispongono di dati correnti', tourDataReadinessHealth?.status === 'ALL_CURRENT', { status: tourDataReadinessHealth?.status, targets: tourDataReadinessHealth?.targets, note: tourDataReadinessHealth?.note }, 'warn'),
    check('Campione forward matchup disponibile', tourDataReadinessHealth?.forwardStatus !== 'NO_FORWARD_SAMPLE', { forwardStatus: tourDataReadinessHealth?.forwardStatus, counts: tourDataReadinessHealth?.counts, reason: tourDataReadinessHealth?.forwardPromotionReason }, 'warn'),
    check('Pipeline intake forward Patch 24 strutturalmente pronta', forwardSampleIntakeHealth?.structuralReady === true && forwardSampleIntakeHealth?.status !== 'BLOCKED_CAPTURE', forwardSampleIntakeHealth),
    check('Campione forward Patch 24 in accumulo', Number(forwardSampleIntakeHealth?.forwardSample?.actionableRows || 0) > 0, { status: forwardSampleIntakeHealth?.status, counts: forwardSampleIntakeHealth?.counts, forwardSample: forwardSampleIntakeHealth?.forwardSample, nextAction: forwardSampleIntakeHealth?.nextAction }, 'warn'),
    check('Patch 24 vieta backfill e autorità production', forwardSampleIntakeHealth?.historicalBackfill === false
      && forwardSampleIntakeHealth?.authority?.productionProbability === false
      && forwardSampleIntakeHealth?.authority?.qualityGate === false
      && forwardSampleIntakeHealth?.authority?.stake === false
      && forwardSampleIntakeHealth?.authority?.settlement === false
      && forwardSampleIntakeHealth?.authority?.automaticPromotion === false,
      { historicalBackfill: forwardSampleIntakeHealth?.historicalBackfill, authority: forwardSampleIntakeHealth?.authority }),
    check('Freschezza aggregata dati giocatori', ['CURRENT','AGING'].includes(playerDataHealth?.status) && playerDataHealth?.degradedUsingLastKnownGood !== true, { status: playerDataHealth?.status, readinessStatus: playerDataHealth?.readinessStatus, refreshState: playerDataHealth?.refreshState, degradedUsingLastKnownGood: playerDataHealth?.degradedUsingLastKnownGood, latestMatchAt: playerDataHealth?.latestMatchAt, dataAgeDays: playerDataHealth?.dataAgeDays, lastRefreshAt: playerDataHealth?.lastRefreshAt, lastFailure: playerDataHealth?.lastFailure || null }, 'warn'),
    check('Certificazione ricerca informazioni Patch 23', !['FAIL','SCHEMA_MISSING'].includes(informationRetrievalHealth?.status) && informationRetrieval.TENNIS_INFORMATION_RETRIEVAL_VERSION === 'TENNIS_INFORMATION_RETRIEVAL_V3_PATCH23', { status: informationRetrievalHealth?.status, version: informationRetrieval.TENNIS_INFORMATION_RETRIEVAL_VERSION, overallScore: informationRetrievalHealth?.overallScore, probeScope: informationRetrievalHealth?.probeScope, channels: informationRetrievalHealth?.channels }, 'warn'),
    check('Information Retrieval senza mascheramento ATP/WTA', informationRetrievalHealth?.sourceFreshnessNotMasked === true && informationRetrievalHealth?.probeScope?.aggregateStatusIgnored === true, { sourceFreshnessNotMasked: informationRetrievalHealth?.sourceFreshnessNotMasked, probeScope: informationRetrievalHealth?.probeScope }),
    check('Scoring fonti zero-key-first', informationRetrievalHealth?.zeroKeyHealthScoringAligned === true && Array.isArray(informationRetrievalHealth?.optionalSourcesExcluded), { zeroKeyHealthScoringAligned: informationRetrievalHealth?.zeroKeyHealthScoringAligned, optionalSourcesExcluded: informationRetrievalHealth?.optionalSourcesExcluded }),
    check('Dataset storico Patch 16 caricato', historicalStatsHealth?.loaded === true && Number(historicalStatsHealth?.activeRecords || 0) > 0, historicalStatsHealth),
    check('Canonical Player Evidence Bridge Patch 26', canonicalPlayerEvidenceHealth?.success === true
      && canonicalPlayerEvidenceHealth?.authority?.modelProbability === false
      && canonicalPlayerEvidenceHealth?.authority?.qualityGate === false
      && canonicalPlayerEvidenceHealth?.authority?.stake === false,
      canonicalPlayerEvidenceHealth),
    check('Stagioni ATP/WTA certificate 2026-2025-2024', historicalSeasonsSafe, { expected: EXPECTED_HISTORICAL_SEASONS, actual: historicalStatsHealth?.seasons }),
    check('Parità righe XLSX/HTML', historicalParitySafe, { formatParity: historicalStatsHealth?.formatParity, warningCodes: historicalStatsHealth?.warningCodes || [] }, historicalStatsHealth?.formatParity === 'MATCH_WITH_STALE_HTML_HEADER' ? 'warn' : 'error'),
    check('Autorità shadow Patch 16', historicalAuthoritySafe, { modelProbabilityAuthority: historicalStatsHealth?.modelProbabilityAuthority, qualityGateAuthority: historicalStatsHealth?.qualityGateAuthority, stakeAuthority: historicalStatsHealth?.stakeAuthority, settlementAuthority: historicalStatsHealth?.settlementAuthority }),
    check('Persistenza storica immutabile Patch 16', historicalDatabaseSafe, historicalStatsHealth?.database || null),
    check('Performance ledger Patch 17 disponibile', historicalValidationPerformanceHealth?.success === true && historicalValidationPerformanceHealth?.immutableTriggers === true, historicalValidationPerformanceHealth),
    check('Patch 17 senza autorità automatica', historicalValidationPerformanceHealth?.authority?.modelProbability === false && historicalValidationPerformanceHealth?.authority?.qualityGate === false && historicalValidationPerformanceHealth?.authority?.stake === false && historicalValidationPerformanceHealth?.authority?.settlement === false && historicalValidationPerformanceHealth?.authority?.automaticPromotion === false, historicalValidationPerformanceHealth?.authority || null),
    check('Campione forward storico Patch 17', Number(historicalValidationPerformanceHealth?.forwardEvaluations || 0) > 0, { status: historicalValidationPerformanceHealth?.status, forwardEvaluations: historicalValidationPerformanceHealth?.forwardEvaluations, performanceGate: historicalValidationPerformanceHealth?.performanceGate }, 'warn'),
    check('Challenger statistico Patch 18 disponibile', statisticalChallengerHealth?.success === true && statisticalChallengerHealth?.immutableTriggers === true && Number(statisticalChallengerHealth?.predictions || 0) > 0, statisticalChallengerHealth),
    check('Patch 18 senza autorità production', statisticalChallengerHealth?.authority?.modelProbability === false && statisticalChallengerHealth?.authority?.qualityGate === false && statisticalChallengerHealth?.authority?.stake === false && statisticalChallengerHealth?.authority?.settlement === false && statisticalChallengerHealth?.authority?.automaticPromotion === false, statisticalChallengerHealth?.authority || null),
    check('Stabilità challenger per circuito', statisticalChallengerHealth?.stabilityGuard?.status === 'OOS_IMPROVEMENT_STABLE_ALL_TOURS_RETROSPECTIVE_ONLY', { status: statisticalChallengerHealth?.stabilityGuard?.status, metrics: statisticalChallengerHealth?.metrics, bootstrap: statisticalChallengerHealth?.bootstrap }, 'warn'),
    check('Motori statistici professionali Patch 19', professionalStatisticalEngineHealth?.status === 'PROFESSIONAL_ENGINES_VERIFIED_BEST_FORECAST_ACTIVE' && professionalStatisticalEngineHealth?.immutableTriggers === true, professionalStatisticalEngineHealth),
    check('Patch 19 offre sempre il miglior pronostico senza veto', professionalStatisticalEngineHealth?.policy?.forecastAlwaysAvailable === true && professionalStatisticalEngineHealth?.policy?.hardExclusion === false && professionalStatisticalEngineHealth?.policy?.lateRoundSoftAdjustmentOnly === true, professionalStatisticalEngineHealth?.policy || null),
    check('Patch 19 senza autorità production', professionalStatisticalEngineHealth?.authority?.productionProbability === false && professionalStatisticalEngineHealth?.authority?.qualityGate === false && professionalStatisticalEngineHealth?.authority?.stake === false && professionalStatisticalEngineHealth?.authority?.settlement === false, professionalStatisticalEngineHealth?.authority || null),
    check('Drift retrospettivo separato dalla autorità probabilità', recentPerformanceGuard?.probabilityAdjustmentAuthority === false && recentPerformanceGuard?.authority?.retrospectiveDiagnostic === true, recentPerformanceGuard),
    check('Campione forward drift ancora immaturo', recentPerformanceGuard?.forwardOverallMature === true, { forward: recentPerformanceGuard?.forward, thresholds: recentPerformanceGuard?.thresholds, probabilityAdjustmentAuthority: recentPerformanceGuard?.probabilityAdjustmentAuthority }, 'warn'),
    check('Patch35 CLV sport-key discovery attivo', clvSportDiscoveryPatch35.health().version === clvSportDiscoveryPatch35.VERSION && clvSportDiscoveryPatch35.health().modelAuthority === false && clvSportDiscoveryPatch35.health().stakeAuthority === false, clvSportDiscoveryPatch35.health()),
    check('Patch35 small-sample guard preservato', stakeAuthorityPatch35.health().soleFinalStakeAuthority === true && stakeAuthorityPatch35.health().n0AndN1Protected === true, stakeAuthorityPatch35.health()),
    check('Patch36 final risk authority con WTA freshness breaker', riskAuthorityPatch36.health().soleFinalStakeAuthority === true && riskAuthorityPatch36.health().wtaStaleCircuitBreaker === true, riskAuthorityPatch36.health()),
    check('Patch36 provider WTA zero-key registrato', Array.isArray(multiProviderHealth?.providers) && multiProviderHealth.providers.some(item => item.id === 'JEFF_SACKMANN_GITHUB' && item.enabled === true && item.supports?.includes('WTA_MAIN')), { version: multiProviderHealth?.version, providers: multiProviderHealth?.providers, githubPolicy: multiProviderHealth?.githubPolicy }),
    check('Frontend app byte-identici', frontAppSame, { public: publicApp, backend: backendPublicApp }),
    check('Frontend index byte-identici', frontIndexSame, { public: publicIndex, backend: backendPublicIndex }),
    check('ID HTML univoci', duplicates.length === 0, { duplicates }),
    check('Dataset sorgente non vuoto', sourceRows > 0 && tennisRows > 0, { sourceRows, tennisRows }, 'warn')
  ];

  const errors = checks.filter(item => !item.ok && item.severity === 'error');
  const warnings = checks.filter(item => !item.ok && item.severity !== 'error');
  const waitingForFirstMatch = errors.length === 0
    && forwardSampleIntakeHealth?.structuralReady === true
    && Number(forwardSampleIntakeHealth?.forwardSample?.actionableRows || 0) === 0;
  const operationalSummary = {
    version: runtimeHealthContract.TENNIS_RUNTIME_HEALTH_CONTRACT_VERSION,
    state: errors.length > 0 ? 'NOT_READY_CRITICAL' : waitingForFirstMatch ? 'READY_FOR_FIRST_MATCH' : warnings.length > 0 ? 'READY_WITH_WARNINGS' : 'READY',
    label: errors.length > 0 ? 'Non pronto — errore critico' : waitingForFirstMatch ? 'Pronto al primo match' : warnings.length > 0 ? 'Pronto con avvisi' : 'Pronto',
    errorCount: errors.length,
    warningCount: warnings.length,
    waitingForFirstMatch,
    canonicalIssueCount: errors.length + warnings.length,
    ready: errors.length === 0
  };
  return {
    success: errors.length === 0,
    healthy: errors.length === 0,
    status: errors.length > 0 ? 'ERROR' : warnings.length > 0 ? 'WARN' : 'OK',
    version: TENNIS_PROGRAM_PROGRESSION_AUDIT_VERSION,
    readOnly: true,
    currentPatchVersion: registry.TENNIS_CURRENT_PATCH_VERSION,
    registryVersion: registry.TENNIS_PATCH_REGISTRY_VERSION,
    sourceRows,
    tennisRows,
    playerDataHealth,
    multiProviderHealth,
    tourDataReadinessHealth,
    forwardSampleIntakeHealth,
    historicalStatsHealth,
    historicalValidationPerformanceHealth,
    statisticalChallengerHealth,
    professionalStatisticalEngineHealth,
    recentPerformanceGuard,
    informationRetrievalHealth,
    coreContractHealth,
    releaseSecurityHealth,
    rejectedCaptureObservabilityHealth,
    canonicalEventTimeHealth,
    officialScheduleHealth,
    clvSportDiscoveryHealth: clvSportDiscoveryPatch35.health(),
    finalStakeAuthorityHealth: riskAuthorityPatch36.health(),
    tourDriftAuthorityHealth: tourDriftAuthorityPatch36.health(recentPerformanceGuard),
    operationalSummary,
    checks,
    errors: errors.length,
    warnings: warnings.length,
    generatedAt: new Date().toISOString(),
    note: errors.length > 0
      ? 'Progressione Tennis non certificata: almeno un controllo critico è fallito.'
      : warnings.length > 0
        ? 'Progressione Tennis certificata con avvisi non bloccanti; la validazione storica e il challenger cross-fitted e motori Patch 19, registry multi-provider Patch 21, readiness per circuito Patch 22, certificazione tour-aware Patch 23 e intake forward atomico Patch 24 e Runtime Health Contract semantic Patch 29 R3, Core Contract Audit Patch 30, Rejected Capture Observability Patch 32 e Canonical Event Time Patch 33 restano senza autorità su probabilità/stake; WTA match-level stale, campione forward ancora in accumulo e stabilità per circuito richiedono prudenza; il drift retrospettivo resta diagnostico e non dispone di autorità sulla probabilità.'
        : 'Progressione Tennis certificata: registry, database, freschezza per circuito, attività giocatore separata, statistiche storiche, performance shadow, challenger statistico cross-fitted, Markov/Monte Carlo/Elo professionali, guardia round, miglior pronostico, ricerca informazioni tour-aware, scoring zero-key, intake forward atomico senza backfill, Prematch Capture Gate transazionale, ledger append-only dei rifiuti con clock drift semantic, canonical event time DST-safe e provider time quality, component health semantic, Core Contract Audit degli entrypoint e dipendenze, scheduler persistente esatto e frontend coerente, trigger ed endpoint sono coerenti.'
  };
}

module.exports = {
  TENNIS_PROGRAM_PROGRESSION_AUDIT_VERSION,
  EXPECTED_HISTORICAL_SEASONS,
  duplicateHtmlIds,
  buildProgramProgressionAudit
};
