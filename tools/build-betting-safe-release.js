#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const cp = require('child_process');
const patch57 = require('../backend/productionSecuritySafeReleasePatch57');

const rootIdx = process.argv.indexOf('--root');
const rootEq = process.argv.find(arg => arg.startsWith('--root='));
const ROOT = path.resolve(rootIdx >= 0 && process.argv[rootIdx + 1] ? process.argv[rootIdx + 1] : rootEq ? rootEq.slice(7) : process.cwd());
const outputIdx = process.argv.indexOf('--output');
const outputEq = process.argv.find(arg => arg.startsWith('--output='));
const OUTPUT = path.resolve(outputIdx >= 0 && process.argv[outputIdx + 1] ? process.argv[outputIdx + 1] : outputEq ? outputEq.slice(9) : path.join(path.dirname(ROOT), `BettingApp_safe_release_patch57_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`));
const planOnly = process.argv.includes('--plan-only');
const maxEq = process.argv.find(arg => arg.startsWith('--max-mib='));
const MAX_BYTES = maxEq ? Math.max(1, Number(maxEq.slice(10))) * 1024 * 1024 : patch57.DEFAULT_MAX_RELEASE_BYTES;

function copyFile(source, destination) { fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(source, destination); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function run(command, args, options = {}) {
  const result = cp.spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`ARCHIVE_COMMAND_FAILED:${command}:${result.stderr || result.stdout || result.status}`);
  return result;
}
function createZip(staging, output) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.rmSync(output, { force: true });
  if (process.platform === 'win32') {
    const escapedSource = path.join(staging, '*').replace(/'/g, "''");
    const escapedOutput = output.replace(/'/g, "''");
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -Path '${escapedSource}' -DestinationPath '${escapedOutput}' -CompressionLevel Optimal -Force`]);
    return 'POWERSHELL_COMPRESS_ARCHIVE';
  }
  const python = ['python3', 'python'].find(command => cp.spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0);
  if (python) { run(python, ['-m', 'zipfile', '-c', output, '.'], { cwd: staging }); return 'PYTHON_ZIPFILE'; }
  run('zip', ['-q', '-r', output, '.'], { cwd: staging });
  return 'ZIP_CLI';
}

if (!fs.existsSync(path.join(ROOT, 'package.json'))) {
  console.log(JSON.stringify({ success:false, code:'PROJECT_ROOT_INVALID', root:ROOT }, null, 2)); process.exit(1);
}
const runtime = patch57.resolveRuntimeConfig();
if (!runtime.ready) {
  console.log(JSON.stringify({ success:false, code:'PATCH57_UNSAFE_RUNTIME_CONFIGURATION', runtime:patch57.safeRuntimeConfig(runtime) }, null, 2)); process.exit(1);
}
const plan = patch57.buildStrictReleasePlan(ROOT, { maxBytes: MAX_BYTES, withHashes: true });
const scan = patch57.scanStrictReleaseSurface(ROOT, plan);
if (!plan.summary.withinSizeGuard || !scan.healthy) {
  console.log(JSON.stringify({ success:false, code:'PATCH57_RELEASE_GUARD_BLOCKED', summary:plan.summary, secretFindings:scan.findings.length }, null, 2)); process.exit(1);
}
if (planOnly) {
  console.log(JSON.stringify({ success:true, mode:'PLAN_ONLY', version:patch57.VERSION, releasePolicyVersion:patch57.RELEASE_POLICY_VERSION, summary:plan.summary, secretFindings:0 }, null, 2)); process.exit(0);
}

const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'bettingapp-safe-release-p57-'));
try {
  for (const item of plan.included) copyFile(path.join(ROOT, item.path), path.join(staging, item.path));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const registry = require(path.join(ROOT, 'backend', 'tennisPatchRegistry.js'));
  const calcioRegistry = require(path.join(ROOT, 'backend', 'calcioPatchRegistry.js'));
  const manifest = {
    format: 'BETTINGAPP_SAFE_RELEASE_MANIFEST_V2_PATCH57',
    createdAt: new Date().toISOString(),
    packageVersion: pkg.version,
    tennisRegistry: registry.TENNIS_CURRENT_PATCH_VERSION,
    calcioRegistry: calcioRegistry.CALCIO_CURRENT_PATCH_VERSION,
    securityVersion: patch57.VERSION,
    policyVersion: patch57.POLICY_VERSION,
    releasePolicyVersion: patch57.RELEASE_POLICY_VERSION,
    strictAllowlist: true,
    secretValuesIncluded: false,
    databaseIncluded: false,
    backupsIncluded: false,
    logsIncluded: false,
    executablesIncluded: false,
    environmentFilesIncluded: false,
    patchStateIncluded: false,
    includedFiles: plan.included,
    excludedSummary: plan.summary.excludedByReason,
    totalBytes: plan.summary.totalBytes,
    maxBytes: plan.summary.maxBytes
  };
  fs.writeFileSync(path.join(staging, 'RELEASE_MANIFEST.json'), JSON.stringify(manifest, null, 2));
  const stagedPlan = patch57.buildStrictReleasePlan(staging, { maxBytes: MAX_BYTES, withHashes: false });
  // RELEASE_MANIFEST is generated after the strict source plan; scan it explicitly as text.
  const stagedScan = patch57.scanStrictReleaseSurface(staging, stagedPlan);
  const manifestFindings = require('../backend/tennisReleaseSecurity').scanFile(path.join(staging, 'RELEASE_MANIFEST.json'), staging);
  if (!stagedScan.healthy || manifestFindings.length) throw new Error(`STAGING_SECRET_SCAN_FAILED:${stagedScan.findings.length + manifestFindings.length}`);
  const archiveMethod = createZip(staging, OUTPUT);
  console.log(JSON.stringify({
    success:true,
    mode:'BUILD',
    version:patch57.VERSION,
    releasePolicyVersion:patch57.RELEASE_POLICY_VERSION,
    output:OUTPUT,
    archiveMethod,
    archiveBytes:fs.statSync(OUTPUT).size,
    archiveSha256:sha256(OUTPUT),
    manifest:{packageVersion:manifest.packageVersion,tennisRegistry:manifest.tennisRegistry,calcioRegistry:manifest.calcioRegistry,includedFiles:manifest.includedFiles.length,sourceBytes:manifest.totalBytes,strictAllowlist:true,secretValuesIncluded:false,databaseIncluded:false,backupsIncluded:false,logsIncluded:false,executablesIncluded:false,environmentFilesIncluded:false,patchStateIncluded:false},
    scan:{healthy:true,findings:0,secretsExposedInReport:false}
  }, null, 2));
} finally { fs.rmSync(staging, { recursive:true, force:true }); }
