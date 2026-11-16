#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'audit_patch2', 'patch2_verification_report.json');
const startedAt = new Date().toISOString();
const results = [];

function run(name, command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 30 * 1024 * 1024
  });
  const row = {
    name,
    command: [command, ...args].join(' '),
    status: result.status,
    success: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
  results.push(row);
  process.stdout.write(`\n[${row.success ? 'PASS' : 'FAIL'}] ${name}\n`);
  if (row.stdout) process.stdout.write(row.stdout);
  if (row.stderr) process.stderr.write(row.stderr);
  return row.success;
}

const jest = path.join('node_modules', 'jest', 'bin', 'jest.js');
let ok = true;
ok = run('Node syntax - server Tennis', process.execPath, ['--check', 'backend/server.tennis.js']) && ok;
ok = run('Node syntax - match format contract', process.execPath, ['--check', 'backend/tennisMatchFormat.js']) && ok;
ok = run('Node syntax - patch registry', process.execPath, ['--check', 'backend/tennisPatchRegistry.js']) && ok;
ok = run('Build legacy patch inventory', process.execPath, ['tools/build-tennis-patch-inventory.js']) && ok;
ok = run('Patch 2 match-format tests', process.execPath, [
  jest,
  'backend/tests/patch2TennisMatchFormatContract.test.js',
  'backend/tests/patch1TennisPatchRegistryAndPipeline.test.js',
  'backend/tests/server.tennis.health.test.js',
  'backend/tests/tennisTotalsLiveParserStep50A.test.js',
  'backend/tests/deepScanTennisStep50ETotalsCalibration.test.js',
  'backend/tests/markov.test.js',
  '--runInBand'
]) && ok;
ok = run('Patch 1 full regression verifier', process.execPath, ['tools/verify-tennis-patch1.js']) && ok;
ok = run('Tennis core regression suite', process.execPath, [
  jest,
  'backend/tests/server.tennis.professional.test.js',
  'backend/tests/server.tennis.health.test.js',
  'backend/tests/server.tennis.optimize.test.js',
  'backend/tests/tennisValueEvaluator.test.js',
  'backend/tests/paperTrading.tennis.test.js',
  '--runInBand'
]) && ok;

const report = {
  patch: '2',
  title: 'Tennis Match Format Contract',
  startedAt,
  finishedAt: new Date().toISOString(),
  success: ok,
  databaseModified: false,
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch
  },
  results: results.map(row => ({
    name: row.name,
    command: row.command,
    status: row.status,
    success: row.success,
    stdoutTail: row.stdout.slice(-5000),
    stderrTail: row.stderr.slice(-5000)
  }))
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`\nReport: ${path.relative(root, reportPath)}`);
process.exit(ok ? 0 : 1);
