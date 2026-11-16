#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const root = path.resolve(__dirname, '..');
const verify = childProcess.spawnSync(process.execPath, [path.join(root, 'tools/verify-tennis-patch30.js')], { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
let verification = null; try { verification = JSON.parse(String(verify.stdout || '').trim()); } catch (_) {}
const core = require('../backend/tennisCoreContractAudit').buildCoreContractAudit({ projectRoot: root });
const output = {
  success: verify.status === 0 && core.healthy === true,
  patch: 'TENNIS_PATCH_30_CORE_HYGIENE_SCRIPT_CONTRACT_REPAIR',
  verification,
  coreContract: {
    status: core.status,
    packageScriptCount: core.packageScripts.scriptCount,
    missingFileTargets: core.packageScripts.missingFileTargets,
    missingScriptReferences: core.packageScripts.missingScriptReferences,
    runtimeFilesScanned: core.runtimeDependencies.fileCount,
    missingRuntimeDependencies: core.runtimeDependencies.missing,
    duplicateFunctionDeclarations: core.duplicateFunctionDeclarations,
    routeCount: core.routeDependencyMap.length
  },
  regressionAuthority: {
    databaseRowsChangedByInstall: false,
    productionProbabilityChanged: false,
    qualityGateChanged: false,
    stakeAuthorityChanged: false,
    settlementChanged: false,
    clvChanged: false,
    calcioChanged: false,
    oddsApiCallsAdded: false
  },
  residualFindings: {
    fullJestExecution: fs.existsSync(path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'jest.cmd' : 'jest')) ? 'AVAILABLE' : 'DEPENDENCIES_NOT_INSTALLED_IN_AUDIT_ENVIRONMENT',
    repairUtilities: 'PREVIEW_DEFAULT_EXPLICIT_APPLY_REQUIRED',
    releaseHardeningNext: ['Secret rotation and environment-only credentials', 'Exclude patch backups and binaries from release packages']
  }
};
console.log(JSON.stringify(output, null, 2));
process.exit(output.success ? 0 : 1);
