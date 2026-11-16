'use strict';

const TENNIS_RUNTIME_HEALTH_CONTRACT_VERSION = 'TENNIS_RUNTIME_HEALTH_CONTRACT_V2_PATCH29_R3';
const SERVER_CORE_VERSION = '14.7';
const TENNIS_ENGINE_VERSION = '15.16_STEP78_HISTORICAL_BOOTSTRAP_RELIABILITY';

const OPERATIONAL_STATES = Object.freeze({
  READY: 'READY',
  READY_WITH_WARNINGS: 'READY_WITH_WARNINGS',
  READY_FOR_FIRST_MATCH: 'READY_FOR_FIRST_MATCH',
  NOT_READY_CRITICAL: 'NOT_READY_CRITICAL'
});

const COMPONENT_ROLES = Object.freeze({
  REQUIRED_CORE: 'REQUIRED_CORE',
  REQUIRED_CAPTURE: 'REQUIRED_CAPTURE',
  OPTIONAL_EVIDENCE: 'OPTIONAL_EVIDENCE',
  OBSERVABILITY: 'OBSERVABILITY'
});

const COMPONENT_STATES = Object.freeze({
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  UNAVAILABLE: 'UNAVAILABLE',
  BLOCKED: 'BLOCKED',
  UNKNOWN: 'UNKNOWN'
});

const COMPONENT_ROLE_POLICY = Object.freeze({
  tennisValueEvaluator: COMPONENT_ROLES.REQUIRED_CORE,
  markov: COMPONENT_ROLES.REQUIRED_CORE,
  paperTradingTennis: COMPONENT_ROLES.REQUIRED_CAPTURE,
  deepScanTennis: COMPONENT_ROLES.REQUIRED_CAPTURE,
  tennisPatchRegistry: COMPONENT_ROLES.REQUIRED_CORE,
  tennisRuntimeHealthContract: COMPONENT_ROLES.REQUIRED_CORE,
  tennisMatchFormat: COMPONENT_ROLES.REQUIRED_CAPTURE,
  tennisEventIdentity: COMPONENT_ROLES.REQUIRED_CAPTURE,
  tennisSettlementContract: COMPONENT_ROLES.REQUIRED_CORE,
  tennisPrematchCaptureGate: COMPONENT_ROLES.REQUIRED_CAPTURE,
  tennisCanonicalEventTime: COMPONENT_ROLES.REQUIRED_CAPTURE,
  tennisOfficialScheduleAuthority: COMPONENT_ROLES.REQUIRED_CAPTURE,
  tennisMatchupIntelligence: COMPONENT_ROLES.REQUIRED_CAPTURE,
  sackmann: COMPONENT_ROLES.OPTIONAL_EVIDENCE,
  tennisPlayerDataRefresh: COMPONENT_ROLES.OPTIONAL_EVIDENCE,
  tennisMultiProviderData: COMPONENT_ROLES.OPTIONAL_EVIDENCE,
  tennisTourDataReadiness: COMPONENT_ROLES.OPTIONAL_EVIDENCE,
  tennisInformationRetrieval: COMPONENT_ROLES.OPTIONAL_EVIDENCE,
  tennisRejectedCaptureObservability: COMPONENT_ROLES.OBSERVABILITY
});

function text(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return text(value).toUpperCase(); }

function buildRuntimeVersions(patchStatus = {}) {
  return {
    contractVersion: TENNIS_RUNTIME_HEALTH_CONTRACT_VERSION,
    serverCoreVersion: SERVER_CORE_VERSION,
    tennisEngineVersion: TENNIS_ENGINE_VERSION,
    currentPatchVersion: text(patchStatus.currentPatchVersion || '0'),
    patchRegistryVersion: text(patchStatus.registryVersion || ''),
    labels: {
      serverCore: `Server Core ${SERVER_CORE_VERSION}`,
      tennisEngine: `Tennis Engine ${TENNIS_ENGINE_VERSION}`,
      patchRegistry: `Patch ${text(patchStatus.currentPatchVersion || '0')}`,
      componentSemantic: 'Component Health Semantic Patch 29 R3 · Canonical Event Time Patch 33 · Official Schedule Patch 34'
    }
  };
}

function dedupeIssues(issues = []) {
  const seen = new Set();
  const output = [];
  for (const issue of issues) {
    const code = upper(issue?.code || issue?.name || issue?.component || 'UNKNOWN');
    if (!code || seen.has(code)) continue;
    seen.add(code);
    output.push({
      code,
      severity: upper(issue?.severity || 'WARN'),
      message: text(issue?.message || issue?.name || issue?.component || code),
      source: text(issue?.source || issue?.component || 'HEALTH'),
      component: text(issue?.component || '') || null,
      role: text(issue?.role || '') || null,
      semanticState: text(issue?.semanticState || '') || null
    });
  }
  return output;
}

function componentRole(name, component = {}) {
  const declared = upper(component.role || component.componentRole);
  if (Object.values(COMPONENT_ROLES).includes(declared)) return declared;
  return COMPONENT_ROLE_POLICY[name] || COMPONENT_ROLES.OBSERVABILITY;
}

function normalizeComponentHealth(name, component = {}) {
  const raw = component && typeof component === 'object' ? component : { ok: Boolean(component) };
  const role = componentRole(name, raw);
  const rawStatus = upper(raw.status || (raw.ok === false ? 'ERROR' : raw.ok === true ? 'OK' : 'UNKNOWN'));
  const required = role === COMPONENT_ROLES.REQUIRED_CORE || role === COMPONENT_ROLES.REQUIRED_CAPTURE;
  let semanticState = COMPONENT_STATES.UNKNOWN;
  if (rawStatus === 'OK' && raw.ok !== false) semanticState = COMPONENT_STATES.HEALTHY;
  else if (rawStatus === 'WARN') semanticState = COMPONENT_STATES.DEGRADED;
  else if (rawStatus === 'ERROR' || raw.ok === false) semanticState = required ? COMPONENT_STATES.BLOCKED : COMPONENT_STATES.UNAVAILABLE;
  else if (raw.ok === true) semanticState = COMPONENT_STATES.HEALTHY;
  else semanticState = required ? COMPONENT_STATES.BLOCKED : COMPONENT_STATES.UNKNOWN;

  const blocking = required && [COMPONENT_STATES.BLOCKED, COMPONENT_STATES.UNKNOWN].includes(semanticState);
  const degraded = !blocking && semanticState !== COMPONENT_STATES.HEALTHY;
  const captureBlocking = role === COMPONENT_ROLES.REQUIRED_CAPTURE && blocking;
  const labels = {
    [COMPONENT_STATES.HEALTHY]: 'Operativo',
    [COMPONENT_STATES.DEGRADED]: 'Operativo degradato',
    [COMPONENT_STATES.UNAVAILABLE]: 'Fonte opzionale non disponibile',
    [COMPONENT_STATES.BLOCKED]: 'Blocco operativo',
    [COMPONENT_STATES.UNKNOWN]: 'Stato non certificato'
  };
  return {
    ...raw,
    name,
    rawStatus,
    role,
    required,
    semanticState,
    semanticLabel: labels[semanticState],
    blocking,
    captureBlocking,
    degraded,
    effectiveStatus: blocking ? 'ERROR' : degraded ? 'WARN' : 'OK'
  };
}

function buildComponentHealthSemantics(components = {}) {
  const normalized = Object.fromEntries(Object.entries(components || {}).map(([name, component]) => [name, normalizeComponentHealth(name, component)]));
  const values = Object.values(normalized);
  const blockingComponents = values.filter(item => item.blocking).map(item => item.name);
  const captureBlockingComponents = values.filter(item => item.captureBlocking).map(item => item.name);
  const degradedComponents = values.filter(item => item.degraded).map(item => item.name);
  const status = blockingComponents.length ? 'ERROR' : degradedComponents.length ? 'WARN' : 'OK';
  return {
    version: TENNIS_RUNTIME_HEALTH_CONTRACT_VERSION,
    status,
    healthy: blockingComponents.length === 0,
    captureReady: captureBlockingComponents.length === 0,
    blockingComponents,
    captureBlockingComponents,
    degradedComponents,
    counts: {
      total: values.length,
      healthy: values.filter(item => item.semanticState === COMPONENT_STATES.HEALTHY).length,
      degraded: values.filter(item => item.degraded).length,
      blocking: blockingComponents.length,
      captureBlocking: captureBlockingComponents.length
    },
    components: normalized,
    rule: 'Solo REQUIRED_CORE e REQUIRED_CAPTURE possono produrre NOT_READY_CRITICAL; OPTIONAL_EVIDENCE degrada la qualità senza bloccare la cattura.'
  };
}

function buildOperationalReadiness(options = {}) {
  const components = options.components && typeof options.components === 'object' ? options.components : {};
  const checks = options.checks && typeof options.checks === 'object' ? options.checks : {};
  const forwardIntake = options.forwardIntake && typeof options.forwardIntake === 'object' ? options.forwardIntake : {};
  const semantics = options.componentHealthSemantics?.components
    ? options.componentHealthSemantics
    : buildComponentHealthSemantics(components);
  const issues = [];

  for (const component of Object.values(semantics.components || {})) {
    if (component.blocking) {
      issues.push({
        code: `COMPONENT_${component.name}`,
        severity: 'ERROR',
        message: `${component.name} blocca l’operatività (${component.semanticLabel})`,
        component: component.name,
        role: component.role,
        semanticState: component.semanticState
      });
    } else if (component.degraded) {
      issues.push({
        code: `COMPONENT_${component.name}`,
        severity: 'WARN',
        message: `${component.name}: ${component.semanticLabel}`,
        component: component.name,
        role: component.role,
        semanticState: component.semanticState
      });
    }
  }
  for (const [name, ok] of Object.entries(checks)) {
    if (ok === false) issues.push({ code: `CHECK_${name}`, severity: 'ERROR', message: `${name} non superato`, source: 'CHECKS' });
  }

  const uniqueIssues = dedupeIssues(issues);
  const errorCount = uniqueIssues.filter(item => item.severity === 'ERROR').length;
  const warningCount = uniqueIssues.filter(item => item.severity !== 'ERROR').length;
  const structuralReady = forwardIntake.structuralReady === true;
  const actionableRows = Number(forwardIntake.forwardSample?.actionableRows || 0);
  const firstMatchWaiting = structuralReady && actionableRows === 0;
  const healthErrorWithoutComponents = upper(options.healthStatus) === 'ERROR' && Object.keys(components).length === 0;

  let state = OPERATIONAL_STATES.READY;
  if (healthErrorWithoutComponents || errorCount > 0 || !structuralReady || semantics.captureReady === false) state = OPERATIONAL_STATES.NOT_READY_CRITICAL;
  else if (firstMatchWaiting) state = OPERATIONAL_STATES.READY_FOR_FIRST_MATCH;
  else if (warningCount > 0 || upper(options.healthStatus) === 'WARN') state = OPERATIONAL_STATES.READY_WITH_WARNINGS;

  const labels = {
    [OPERATIONAL_STATES.READY]: 'Pronto',
    [OPERATIONAL_STATES.READY_WITH_WARNINGS]: 'Pronto con avvisi',
    [OPERATIONAL_STATES.READY_FOR_FIRST_MATCH]: 'Pronto al primo match',
    [OPERATIONAL_STATES.NOT_READY_CRITICAL]: 'Non pronto — errore critico'
  };

  return {
    version: TENNIS_RUNTIME_HEALTH_CONTRACT_VERSION,
    state,
    label: labels[state],
    ready: state !== OPERATIONAL_STATES.NOT_READY_CRITICAL,
    captureReady: state !== OPERATIONAL_STATES.NOT_READY_CRITICAL && semantics.captureReady !== false,
    readyForFirstMatch: state === OPERATIONAL_STATES.READY_FOR_FIRST_MATCH,
    structuralReady,
    actionableRows,
    errorCount,
    warningCount,
    issues: uniqueIssues,
    componentHealthSemantics: semantics,
    blockingComponents: semantics.blockingComponents || [],
    degradedComponents: semantics.degradedComponents || [],
    currentSampleIsWaitingState: firstMatchWaiting,
    note: state === OPERATIONAL_STATES.READY_FOR_FIRST_MATCH
      ? 'Sistema strutturalmente pronto: il primo match Tennis reale pre-match avvierà il campione forward.'
      : state === OPERATIONAL_STATES.NOT_READY_CRITICAL
        ? 'Almeno un requisito core/capture impedisce l’acquisizione affidabile del prossimo match.'
        : state === OPERATIONAL_STATES.READY_WITH_WARNINGS
          ? 'Sistema operativo; provider o fonti opzionali degradati riducono l’evidenza ma non bloccano il capture gate.'
          : 'Sistema operativo e senza avvisi critici.'
  };
}

module.exports = {
  TENNIS_RUNTIME_HEALTH_CONTRACT_VERSION,
  SERVER_CORE_VERSION,
  TENNIS_ENGINE_VERSION,
  OPERATIONAL_STATES,
  COMPONENT_ROLES,
  COMPONENT_STATES,
  COMPONENT_ROLE_POLICY,
  buildRuntimeVersions,
  normalizeComponentHealth,
  buildComponentHealthSemantics,
  buildOperationalReadiness,
  dedupeIssues
};
