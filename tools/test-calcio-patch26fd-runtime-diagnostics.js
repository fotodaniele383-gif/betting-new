'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const diagnostics = require('../backend/runtimeDiagnostics');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch26fd-runtime-'));
const logFile = path.join(dir, 'runtime.jsonl');
const rows = [
  { timestamp:'2026-07-28T08:00:00.000Z', level:'ERROR', component:'CALCIO_BATCH', operation:'CALCIO_PORTFOLIO', phase:'FAILED', message:'Calcio failure', context:{ sport:'CALCIO' } },
  { timestamp:'2026-07-28T08:01:00.000Z', level:'WARN', component:'TENNIS_SETTLEMENT', operation:'TENNIS', phase:'CHECK', message:'Tennis warning', context:{ sport:'TENNIS' } },
  { timestamp:'2026-07-28T08:02:00.000Z', level:'INFO', component:'SERVER_CORE', operation:'HEALTH', phase:'COMPLETE', message:'Generic info', context:{} }
];
fs.writeFileSync(logFile, rows.map(row => JSON.stringify(row)).join('\n') + '\n');

const calcio = diagnostics.readRecentDiagnostics(20, { logFile, scope:'CALCIO' });
assert.strictEqual(calcio.length, 1);
assert.strictEqual(calcio[0].scope, 'CALCIO');
const tennis = diagnostics.readRecentDiagnostics(20, { logFile, scope:'TENNIS' });
assert.strictEqual(tennis.length, 1);
assert.strictEqual(tennis[0].scope, 'TENNIS');
const errors = diagnostics.readRecentDiagnostics(20, { logFile, scope:'ALL', levels:['ERROR'] });
assert.strictEqual(errors.length, 1);
const all = diagnostics.readRecentDiagnostics(20, { logFile, scope:'ALL' });
assert.strictEqual(all.length, 3);
assert.strictEqual(all[0].timestamp, '2026-07-28T08:02:00.000Z');
const summary = diagnostics.buildDiagnosticsSummary(all);
assert.strictEqual(summary.total, 3);
assert.strictEqual(summary.byLevel.ERROR, 1);
assert.strictEqual(summary.byScope.CALCIO, 1);
assert.ok(diagnostics.RUNTIME_DIAGNOSTICS_VERSION.includes('V2'));
assert.strictEqual(diagnostics.RUNTIME_DIAGNOSTICS_COMPAT_VERSION, 'RUNTIME_DIAGNOSTICS_V1_PATCH5');

const sanitized = diagnostics.sanitize({ apiKey:'secret', nested:{ token:'hidden' }, safe:'ok' });
assert.strictEqual(sanitized.apiKey, '[REDACTED]');
assert.strictEqual(sanitized.nested.token, '[REDACTED]');
assert.strictEqual(sanitized.safe, 'ok');
fs.rmSync(dir, { recursive:true, force:true });
console.log(JSON.stringify({ success:true, patch:'BETTING_PATCH_26F_D_CALCIO_RELIABILITY_CALIBRATION_TRADING_PORTFOLIO_RUNTIME_DIAGNOSTICS_V2', checks:15, scopes:{ calcio:calcio.length, tennis:tennis.length, all:all.length }, summary }, null, 2));
