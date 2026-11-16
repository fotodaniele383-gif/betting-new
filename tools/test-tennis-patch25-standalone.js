'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'node-cron') return { schedule: () => ({ start() {}, stop() {} }), validate: () => true };
  if (request === 'axios') return { get: async () => ({ data: {} }), post: async () => ({ data: {} }) };
  return originalLoad.call(this, request, parent, isMain);
};
const registry = require(path.join(root, 'backend', 'tennisPatchRegistry.js'));
const contract = require(path.join(root, 'backend', 'tennisRuntimeHealthContract.js'));
const scheduler = require(path.join(root, 'backend', 'tennisAutoScheduler.js'));
Module._load = originalLoad;

const checks = [];
function check(name, ok, details = null) { checks.push({ name, ok: Boolean(ok), details }); }
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'backend', 'server.tennis.js'), 'utf8');
const schedulerSource = fs.readFileSync(path.join(root, 'backend', 'tennisAutoScheduler.js'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(root, 'backend', 'tennis_cron_config.json'), 'utf8'));

check('Registry Patch 25', registry.TENNIS_CURRENT_PATCH_VERSION === '25' && registry.TENNIS_PATCH_REGISTRY_VERSION === 'TENNIS_PATCH_REGISTRY_V25' && registry.PATCHES.some(x => x.version === '24' && String(x.status).startsWith('ACTIVE')));
const versions = contract.buildRuntimeVersions(registry.getTennisPatchStatus());
check('Runtime identities separated', versions.serverCoreVersion === '14.7' && versions.tennisEngineVersion.startsWith('15.16_') && versions.currentPatchVersion === '25', versions);
const readiness = contract.buildOperationalReadiness({ healthStatus: 'WARN', components: { wta: { ok: true, status: 'WARN' } }, forwardIntake: { structuralReady: true, forwardSample: { actionableRows: 0 } } });
check('First match ready is not global Not ready', readiness.state === 'READY_FOR_FIRST_MATCH' && readiness.ready === true, readiness);

const start = Date.parse('2026-07-20T12:00:00.000Z');
const interval = 7 * 3600000;
let next = scheduler.calculateNextRunAt({ type: 'interval_hours', intervalHours: 7, days: [], intervalAnchorAt: new Date(start).toISOString(), nextRunAt: null }, start);
const sequence = [next];
for (let i = 0; i < 8; i += 1) {
  const candidate = new Date(Date.parse(next) + interval).toISOString();
  next = scheduler.calculateNextRunAt({ type: 'interval_hours', intervalHours: 7, days: [], intervalAnchorAt: new Date(start).toISOString(), nextRunAt: candidate }, Date.parse(next) + 1);
  sequence.push(next);
}
check('Exact 7h over 48h', sequence.every((v, i) => i === 0 || Date.parse(v) - Date.parse(sequence[i - 1]) === interval) && Date.parse(sequence.at(-1)) - Date.parse(sequence[0]) === 56 * 3600000, sequence);
const restartNext = scheduler.calculateNextRunAt({ type: 'interval_hours', intervalHours: 7, days: [], nextRunAt: '2026-07-20T05:00:00.000Z' }, Date.parse('2026-07-20T12:00:00.000Z'));
check('Restart skips missed bursts', restartNext === '2026-07-20T19:00:00.000Z', { restartNext });
check('Legacy cron */7 blocked', scheduler.buildCronExpression({ type: 'interval_hours', intervalHours: 7, minute: 0, days: [] }) === '' && !schedulerSource.includes('return `${merged.minute} */${merged.intervalHours}'));
check('Single-flight overlap lock', schedulerSource.includes("reason: 'ALREADY_RUNNING'") && schedulerSource.includes('singleFlightLockActive'));
check('Persistent scheduler config migrated', config.schedulerMode === 'PERSISTENT_EXACT_INTERVAL' && Boolean(config.intervalAnchorAt) && Boolean(config.nextRunAt), { schedulerMode: config.schedulerMode, nextRunAt: config.nextRunAt });
check('Dynamic Patch badge and canonical counts', index.includes('Patch 1–25') && app.includes('PATCH25_TENNIS_RUNTIME_HEALTH_TRUTH_UI') && app.includes('warningCount') && !app.includes("alertChip.textContent = `${alerts} ${alerts === 1 ? 'anomalia' : 'anomalie'}`"));
check('Frontend cache-buster Patch 25', index.includes('app.js?v=patch25-runtime-health-scheduler-coherency') && !index.includes('app.js?v=patch20-resilient-player-data-refresh'));
check('Runtime versions exposed', server.includes('runtimeVersions') && server.includes('operationalReadiness') && server.includes('runtimeVersionIdentityCoherent'));
check('Patch 24 first-match rollback canary retained', fs.existsSync(path.join(root, 'tools', 'verify-tennis-patch24-canary.js')));
check('No production authority', contract.buildOperationalReadiness({ healthStatus: 'OK', forwardIntake: { structuralReady: true, forwardSample: { actionableRows: 0 } } }).ready === true && server.includes('stakeAuthority: false'));

const success = checks.every(x => x.ok);
console.log(JSON.stringify({ success, patch: '25', version: contract.TENNIS_RUNTIME_HEALTH_CONTRACT_VERSION, schedulerVersion: scheduler.SCHEDULER_VERSION, checks }, null, 2));
if (!success) process.exit(2);
