'use strict';

const TENNIS_TECHNICAL_HEALTH_ALIGNMENT_VERSION = 'TENNIS_TECHNICAL_HEALTH_ALIGNMENT_V1_PATCH50';

const CHECK_SPECS = Object.freeze({
  runtimeDiagnosticsActive: Object.freeze({
    label: 'Runtime diagnostics',
    versionKey: 'RUNTIME_DIAGNOSTICS_VERSION',
    versionPattern: /^RUNTIME_DIAGNOSTICS_V\d+_PATCH[0-9A-Z_]+$/,
    requiredCapabilities: Object.freeze(['installProcessDiagnostics', 'readRecentDiagnostics', 'buildDiagnosticsSummary'])
  }),
  tennisForwardLifecycleActive: Object.freeze({
    label: 'Tennis forward lifecycle',
    versionKey: 'TENNIS_FORWARD_LIFECYCLE_VERSION',
    versionPattern: /^TENNIS_FORWARD_LIFECYCLE_V\d+_PATCH[0-9A-Z_]+$/,
    requiredCapabilities: Object.freeze(['inspectForwardLifecycleBet', 'scanForwardLifecycle', 'reconcileForwardLifecycle'])
  }),
  tennisPlayerEvidenceActive: Object.freeze({
    label: 'Tennis player evidence',
    versionKey: 'TENNIS_PLAYER_EVIDENCE_VERSION',
    versionPattern: /^TENNIS_PLAYER_EVIDENCE_V\d+_PATCH[0-9A-Z_]+$/,
    requiredCapabilities: Object.freeze(['init', 'buildPlayerEvidence', 'buildMatchupEvidence', 'getStatus'])
  }),
  tennisProgramProgressionAuditActive: Object.freeze({
    label: 'Tennis program progression audit',
    versionKey: 'TENNIS_PROGRAM_PROGRESSION_AUDIT_VERSION',
    versionPattern: /^TENNIS_PROGRAM_PROGRESSION_AUDIT_V\d+_PATCH[0-9A-Z_]+$/,
    requiredCapabilities: Object.freeze(['buildProgramProgressionAudit'])
  }),
  tennisMultiProviderDataActive: Object.freeze({
    label: 'Tennis multi-provider data',
    versionKey: 'TENNIS_MULTI_PROVIDER_VERSION',
    versionPattern: /^TENNIS_MULTI_PROVIDER_DATA_V\d+_PATCH[0-9A-Z_]+$/,
    requiredCapabilities: Object.freeze(['providerPlan', 'refreshMultiProvider', 'getHealth'])
  })
});

function evaluateTechnicalModule(moduleRef, spec, options = {}) {
  const source = moduleRef && typeof moduleRef === 'object' ? moduleRef : {};
  const actualVersion = String(source[spec.versionKey] || '').trim();
  const capabilityStatus = Object.fromEntries(
    spec.requiredCapabilities.map(name => [name, typeof source[name] === 'function'])
  );
  const missingCapabilities = Object.entries(capabilityStatus).filter(([, ok]) => !ok).map(([name]) => name);
  const versionCompatible = spec.versionPattern.test(actualVersion);
  let selfCheck = null;
  if (typeof options.selfCheck === 'function') {
    try { selfCheck = options.selfCheck(); }
    catch (error) { selfCheck = { ok: false, error: error.message }; }
  }
  const selfCheckOk = selfCheck == null || selfCheck.ok !== false;
  const ok = versionCompatible && missingCapabilities.length === 0 && selfCheckOk;
  const reasons = [];
  if (!actualVersion) reasons.push('VERSION_MISSING');
  else if (!versionCompatible) reasons.push('VERSION_FAMILY_INCOMPATIBLE');
  if (missingCapabilities.length) reasons.push(`CAPABILITY_MISSING:${missingCapabilities.join(',')}`);
  if (!selfCheckOk) reasons.push(`SELF_CHECK_FAILED:${selfCheck?.error || selfCheck?.reason || 'UNKNOWN'}`);
  return {
    ok,
    status: ok ? 'OK' : 'ERROR',
    effectiveStatus: ok ? 'OK' : 'ERROR',
    semanticLabel: ok ? 'ACTIVE_COMPATIBLE' : 'INACTIVE_OR_INCOMPATIBLE',
    blocking: !ok,
    version: actualVersion || null,
    actualVersion: actualVersion || null,
    expectedFamily: spec.versionPattern.source,
    capabilityStatus,
    missingCapabilities,
    selfCheck,
    reason: reasons.join(' · ') || 'VERSION_FAMILY_AND_CAPABILITIES_OK',
    alignmentVersion: TENNIS_TECHNICAL_HEALTH_ALIGNMENT_VERSION
  };
}

function buildAlignedTechnicalChecks(modules = {}) {
  return {
    runtimeDiagnosticsActive: evaluateTechnicalModule(modules.runtimeDiagnostics, CHECK_SPECS.runtimeDiagnosticsActive),
    tennisForwardLifecycleActive: evaluateTechnicalModule(modules.tennisForwardLifecycle, CHECK_SPECS.tennisForwardLifecycleActive),
    tennisPlayerEvidenceActive: evaluateTechnicalModule(modules.tennisPlayerEvidence, CHECK_SPECS.tennisPlayerEvidenceActive),
    tennisProgramProgressionAuditActive: evaluateTechnicalModule(modules.tennisProgramProgressionAudit, CHECK_SPECS.tennisProgramProgressionAuditActive),
    tennisMultiProviderDataActive: evaluateTechnicalModule(modules.tennisMultiProviderData, CHECK_SPECS.tennisMultiProviderDataActive)
  };
}

module.exports = {
  TENNIS_TECHNICAL_HEALTH_ALIGNMENT_VERSION,
  CHECK_SPECS,
  evaluateTechnicalModule,
  buildAlignedTechnicalChecks
};
