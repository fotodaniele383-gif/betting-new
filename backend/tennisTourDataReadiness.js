'use strict';

const path = require('path');
const tennisPlayerDataRefresh = require('./tennisPlayerDataRefresh');
const tennisMultiProviderData = require('./tennisMultiProviderData');

const TENNIS_TOUR_DATA_READINESS_VERSION = 'TENNIS_TOUR_DATA_READINESS_V1_PATCH22';
const TENNIS_TOUR_DATA_POLICY_VERSION = 'TENNIS_TOUR_DATA_POLICY_V1_PATCH22';
const TARGET_IDS = Object.freeze(['ATP_MAIN', 'ATP_QUAL_CHALL', 'WTA_MAIN']);
const STATUS_ORDER = Object.freeze({ CURRENT: 0, AGING: 1, STALE: 2, UNAVAILABLE: 3, ERROR: 4 });

function finite(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function round(value, decimals = 1) {
  const n = finite(value, 0);
  return Number(n.toFixed(decimals));
}
function upper(value) { return String(value || '').trim().toUpperCase(); }
function freshnessStatus(latestMatchAt, now = new Date()) {
  const latestMs = latestMatchAt ? new Date(latestMatchAt).getTime() : NaN;
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(latestMs) || !Number.isFinite(nowMs)) return { status: 'UNAVAILABLE', dataAgeDays: null };
  const dataAgeDays = Math.max(0, (nowMs - latestMs) / 86400000);
  return {
    status: dataAgeDays <= 21 ? 'CURRENT' : dataAgeDays <= 45 ? 'AGING' : 'STALE',
    dataAgeDays: round(dataAgeDays, 1)
  };
}
function worstStatus(statuses = []) {
  const clean = statuses.filter(Boolean).map(upper);
  if (!clean.length) return 'UNAVAILABLE';
  return clean.sort((a, b) => (STATUS_ORDER[b] ?? 99) - (STATUS_ORDER[a] ?? 99))[0];
}
function resolveTargetId(context = {}) {
  const text = upper([
    context.targetId,
    context.tour,
    context.tourType,
    context.league,
    context.tournament,
    context.tournamentName,
    context.tournamentLevel,
    context.tournamentCategory,
    context.series,
    context.strategyTag,
    context.betType
  ].filter(Boolean).join(' '));
  if (TARGET_IDS.includes(upper(context.targetId))) return upper(context.targetId);
  if (/\bWTA\b|WOMEN|FEMMIN/.test(text)) return 'WTA_MAIN';
  if (/CHALLENGER|QUALIF|QUALIFY|\bCH\b|ITF|FUTURES/.test(text)) return 'ATP_QUAL_CHALL';
  if (/\bATP\b|MEN|UOMINI/.test(text)) return 'ATP_MAIN';
  return null;
}
function activityStatus(days) {
  const value = finite(days, null);
  if (value === null) return { status: 'UNKNOWN', penalty: 12, confidenceCap: 70 };
  if (value <= 14) return { status: 'ACTIVE', penalty: 0, confidenceCap: 100 };
  if (value <= 35) return { status: 'RESTED', penalty: 4, confidenceCap: 92 };
  if (value <= 70) return { status: 'LONG_ABSENCE', penalty: 12, confidenceCap: 78 };
  return { status: 'VERY_LONG_ABSENCE', penalty: 20, confidenceCap: 65 };
}
function sourcePenalty(status) {
  const normalized = upper(status);
  if (normalized === 'CURRENT') return { penalty: 0, confidenceCap: 100, readyForCurrentEvidence: true };
  if (normalized === 'AGING') return { penalty: 10, confidenceCap: 86, readyForCurrentEvidence: false };
  if (normalized === 'STALE') return { penalty: 25, confidenceCap: 60, readyForCurrentEvidence: false };
  return { penalty: 40, confidenceCap: 35, readyForCurrentEvidence: false };
}
function selectedProviderMap(multiHealth = {}) {
  return new Map((multiHealth.selectedProviders || []).map(item => [item.targetId, item]));
}
function buildTargetReadiness(options = {}) {
  const dataDir = path.resolve(options.dataDir || tennisPlayerDataRefresh.DEFAULT_DATA_DIR);
  const now = options.now || new Date();
  let local;
  try {
    local = tennisPlayerDataRefresh.inspectLocalSources(dataDir, { now, sources: options.sources });
  } catch (error) {
    local = { dataDir, files: [], latestMatchAt: null, status: 'ERROR', dataAgeDays: null, error: error.message };
  }
  let multiHealth;
  try {
    multiHealth = options.multiProviderHealth || tennisMultiProviderData.getHealth({ dataDir, now, projectRoot: options.projectRoot });
  } catch (error) {
    multiHealth = { success: false, status: 'UNAVAILABLE', selectedProviders: [], error: error.message };
  }
  const localMap = new Map((local.files || []).map(item => [item.sourceId, item]));
  const providerMap = selectedProviderMap(multiHealth);
  const targets = TARGET_IDS.map(targetId => {
    const provider = providerMap.get(targetId) || null;
    const localFile = localMap.get(targetId) || null;
    const latestMatchAt = provider?.latestMatchAt || localFile?.latestMatchAt || null;
    const fresh = freshnessStatus(latestMatchAt, now);
    const providerId = provider?.providerId || (multiHealth.status === 'READY' ? 'UNKNOWN_ACTIVE_PROVIDER' : 'LAST_KNOWN_GOOD');
    return {
      targetId,
      tour: targetId === 'WTA_MAIN' ? 'WTA' : 'ATP',
      segment: targetId === 'ATP_QUAL_CHALL' ? 'QUALIFYING_CHALLENGER' : 'MAIN',
      status: fresh.status,
      dataAgeDays: fresh.dataAgeDays,
      latestMatchAt,
      providerId,
      validRows: finite(provider?.validRows ?? localFile?.validRows ?? localFile?.rowCount, 0),
      localFile: localFile?.localFile || null,
      exists: localFile?.exists === true,
      fromCache: provider?.fromCache === true,
      networkCalls: finite(provider?.networkCalls, 0),
      sourceFreshnessAuthority: true,
      productionProbabilityAuthority: false,
      qualityGateAuthority: false,
      stakeAuthority: false
    };
  });
  const targetMap = new Map(targets.map(item => [item.targetId, item]));
  const atpTargets = ['ATP_MAIN', 'ATP_QUAL_CHALL'].map(id => targetMap.get(id)).filter(Boolean);
  const wtaTargets = ['WTA_MAIN'].map(id => targetMap.get(id)).filter(Boolean);
  const buildTour = (tour, rows) => {
    const status = worstStatus(rows.map(item => item.status));
    const latestMs = rows.map(item => item.latestMatchAt ? new Date(item.latestMatchAt).getTime() : NaN).filter(Number.isFinite);
    const oldestAge = rows.map(item => finite(item.dataAgeDays, null)).filter(value => value !== null).sort((a, b) => b - a)[0] ?? null;
    return {
      tour,
      status,
      readiness: status === 'CURRENT' ? 'READY_CURRENT' : status === 'AGING' ? 'READY_AGING' : status === 'STALE' ? 'DEGRADED_STALE' : 'UNAVAILABLE',
      latestMatchAt: latestMs.length ? new Date(Math.max(...latestMs)).toISOString() : null,
      worstDataAgeDays: oldestAge,
      targets: rows.map(item => item.targetId),
      readyForCurrentEvidence: rows.length > 0 && rows.every(item => item.status === 'CURRENT'),
      readyForShadowEvidence: rows.length > 0 && rows.every(item => ['CURRENT', 'AGING'].includes(item.status)),
      hardExclusion: false
    };
  };
  const tours = [buildTour('ATP', atpTargets), buildTour('WTA', wtaTargets)];
  const statuses = targets.map(item => item.status);
  const currentCount = statuses.filter(status => status === 'CURRENT').length;
  const staleCount = statuses.filter(status => status === 'STALE').length;
  const overallStatus = statuses.every(status => status === 'CURRENT')
    ? 'ALL_CURRENT'
    : currentCount > 0 && staleCount > 0
      ? 'MIXED_CURRENT_STALE'
      : statuses.some(status => status === 'AGING') && !staleCount
        ? 'MIXED_CURRENT_AGING'
        : worstStatus(statuses);
  return {
    success: !local.error,
    healthy: targets.every(item => item.exists) && targets.some(item => item.status === 'CURRENT'),
    status: overallStatus,
    version: TENNIS_TOUR_DATA_READINESS_VERSION,
    policyVersion: TENNIS_TOUR_DATA_POLICY_VERSION,
    mode: 'TARGET_AND_TOUR_SPECIFIC_FRESHNESS_NO_AGGREGATE_MASKING',
    dataDir,
    generatedAt: new Date(now).toISOString(),
    targets,
    tours,
    aggregateLatestAt: local.latestMatchAt || null,
    aggregateStatusCompatibility: local.status || null,
    mixedFreshnessDetected: new Set(statuses).size > 1,
    sourceFreshnessNotMasked: true,
    multiProviderStatus: multiHealth.status || 'UNAVAILABLE',
    selectedProviders: multiHealth.selectedProviders || [],
    authority: {
      productionProbability: false,
      deepScanDecision: false,
      qualityGate: false,
      stake: false,
      settlement: false,
      automaticPromotion: false
    },
    note: overallStatus === 'ALL_CURRENT'
      ? 'Tutti i segmenti Tennis richiesti dispongono di dati correnti.'
      : overallStatus === 'MIXED_CURRENT_STALE'
        ? 'Freschezza mista: i segmenti correnti restano utilizzabili, quelli obsoleti vengono degradati separatamente senza mascheramento aggregato.'
        : 'La freschezza viene valutata per target e circuito; nessun segmento può essere promosso usando la data più recente di un altro circuito.'
  };
}
function resolveEvidenceReadiness(context = {}, options = {}) {
  const report = options.report || buildTargetReadiness(options);
  const targetId = resolveTargetId(context);
  const target = report.targets.find(item => item.targetId === targetId) || null;
  const source = sourcePenalty(target?.status || 'UNAVAILABLE');
  const activityDays = finite(context.activityDays ?? context.restDays, null);
  const activity = activityStatus(activityDays);
  return {
    version: TENNIS_TOUR_DATA_READINESS_VERSION,
    targetId,
    tour: target?.tour || (targetId === 'WTA_MAIN' ? 'WTA' : targetId ? 'ATP' : null),
    sourceProviderId: target?.providerId || null,
    sourceFreshnessStatus: target?.status || 'UNAVAILABLE',
    sourceFreshnessDays: target?.dataAgeDays ?? null,
    sourceLatestMatchAt: target?.latestMatchAt || null,
    sourceFreshnessPenalty: source.penalty,
    sourceConfidenceCap: source.confidenceCap,
    sourceReadyForCurrentEvidence: source.readyForCurrentEvidence,
    activityStatus: activity.status,
    activityDays,
    activityPenalty: activity.penalty,
    activityConfidenceCap: activity.confidenceCap,
    combinedConfidenceCap: Math.min(source.confidenceCap, activity.confidenceCap),
    sourceFreshnessSeparateFromPlayerActivity: true,
    hardExclusion: false,
    authority: report.authority
  };
}
function tableCount(db, table) {
  try { return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n || 0); }
  catch (_) { return 0; }
}
function buildReadinessHealth(db, options = {}) {
  const data = buildTargetReadiness(options);
  const counts = db && typeof db.prepare === 'function' ? {
    sourceRows: tableCount(db, 'ai_forward_test'),
    predictionSnapshots: tableCount(db, 'tennis_prediction_snapshots'),
    playerEvidenceSnapshots: tableCount(db, 'tennis_player_evidence_snapshots'),
    matchupSnapshots: tableCount(db, 'tennis_matchup_feature_snapshots'),
    challengerPredictions: tableCount(db, 'tennis_challenger_predictions'),
    cohortMembers: tableCount(db, 'tennis_forward_cohort_members')
  } : null;
  const forwardStatus = !counts || counts.predictionSnapshots === 0
    ? 'NO_FORWARD_SAMPLE'
    : counts.matchupSnapshots === 0
      ? 'FORWARD_EVIDENCE_INCOMPLETE'
      : 'FORWARD_EVIDENCE_CAPTURING';
  return {
    ...data,
    readOnly: true,
    counts,
    forwardStatus,
    forwardPromotionEligible: false,
    forwardPromotionReason: forwardStatus === 'NO_FORWARD_SAMPLE'
      ? 'Nessuna previsione Tennis forward successiva agli snapshot immutabili.'
      : 'Il campione forward deve maturare con settlement e CLV certificati prima di qualsiasi revisione production.',
    performanceAuthority: false
  };
}

module.exports = {
  TENNIS_TOUR_DATA_READINESS_VERSION,
  TENNIS_TOUR_DATA_POLICY_VERSION,
  TARGET_IDS,
  freshnessStatus,
  worstStatus,
  resolveTargetId,
  activityStatus,
  buildTargetReadiness,
  resolveEvidenceReadiness,
  buildReadinessHealth
};
