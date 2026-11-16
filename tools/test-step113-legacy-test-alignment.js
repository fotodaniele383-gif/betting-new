#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
function read(rel) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) throw new Error('File mancante: ' + rel);
  return fs.readFileSync(file, 'utf8');
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log('PASS ' + message);
}
function extractActiveAppVersion(indexHtml) {
  const matches = [...String(indexHtml).matchAll(/<script\s+src=["']app\.js\?v=([^"']+)["']\s*>/gi)];
  return matches.length ? matches[matches.length - 1][1] : '';
}
function extractVersion(source, constantName) {
  const re = new RegExp(constantName + "\\s*=\\s*'([^']+)'", 'm');
  const match = source.match(re);
  return match ? match[1] : '';
}
function majorMinor(version) {
  const match = String(version || '').match(/^(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

const clvTest = read('backend/tests/clvStep57ApiEfficiency.test.js');
const step81Test = read('backend/tests/step81FrontendRuntimeRecovery.test.js');
const stakeTest = read('backend/tests/tennisStakePolicy.test.js');
const clvTracker = read('backend/clvTracker.js');
const server = read('backend/server.js');
const evaluator = read('backend/tennisValueEvaluator.js');
const deepscan = read('backend/deepScanTennis.js');
const publicIndex = read('public/index.html');
const backendIndex = read('backend/public/index.html');

assert(!clvTest.includes("const apiFetchCandidates = [...betsToTrack]');"), 'Step57 test non è più bloccato sulla vecchia implementazione apiFetchCandidates');
assert(clvTest.includes('STEP62_CLV_HARD_BUDGET_SMART_FETCH') && clvTest.includes('STEP103_CLV_RUNTIME_VISIBILITY_AUDIT'), 'Step57 test accetta runtime CLV Step62/Step103');
assert(/const\s+apiFetchCandidates\s*=\s*(?:\[\s*\.\.\.betsToTrack\s*\]|betsToTrack\.filter)/.test(clvTracker), 'clvTracker contiene apiFetchCandidates live-window/current-safe');
assert(server.includes('clv: clvResult') && server.includes('buildStep103ClvRuntimeAudit'), 'server espone payload CLV e audit runtime senza perdere i dati');

assert(!step81Test.includes('app.js?v=step81-frontend-runtime-recovery'), 'Step81 test non forza più un cache-busting vecchio');
const publicVersion = extractActiveAppVersion(publicIndex);
const backendVersion = extractActiveAppVersion(backendIndex);
assert(publicVersion && backendVersion && publicVersion === backendVersion, 'public/backend index caricano la stessa versione app.js');
assert(Number((publicVersion.match(/^step(\d+)/i) || [])[1] || 0) >= 81, 'cache-busting app.js è Step81 o superiore');
assert(read('public/sw.js').includes('STEP81_SW_NEUTRALIZED') && !read('public/sw.js').includes("addEventListener('fetch'"), 'service worker pubblico resta neutralizzato');

assert(!stakeTest.includes("TENNIS_VALUE_EVALUATOR_VERSION = '4.6'"), 'stake policy test non blocca più evaluator alla versione 4.6 esatta');
assert(!stakeTest.includes("DEEP_SCAN_TENNIS_VERSION = '14.5'"), 'stake policy test non blocca più DeepScan alla versione 14.5 esatta');
assert(majorMinor(extractVersion(evaluator, 'TENNIS_VALUE_EVALUATOR_VERSION')) >= 4.6, 'tennisValueEvaluator è 4.6 o superiore');
assert(majorMinor(extractVersion(deepscan, 'DEEP_SCAN_TENNIS_VERSION')) >= 14.5, 'deepScanTennis è 14.5 o superiore');
assert(deepscan.includes('stakePolicy') && deepscan.includes('buildTennisDeepScanOperationalGate'), 'DeepScan mantiene stakePolicy e operational gate');

console.log('STEP113 standalone audit complete: legacy source tests aligned, no production runtime changed.');
