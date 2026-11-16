#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const rootIndex = process.argv.indexOf('--root');
const root = path.resolve(rootIndex >= 0 && process.argv[rootIndex + 1] ? process.argv[rootIndex + 1] : '.');
const checks = [];
function check(name, condition, details = null) {
  checks.push({ name, ok: Boolean(condition), details });
}

try {
  const source = fs.readFileSync(path.join(root, 'backend', 'clvTracker.js'), 'utf8');
  check('Import esplicito buildClvContractFields', /const\s*\{[\s\S]*buildClvContractFields[\s\S]*\}\s*=\s*require\('\.\/tennisClvContract'\)/.test(source));
  check('Import esplicito TENNIS_CLV_CONTRACT_VERSION', /const\s*\{[\s\S]*TENNIS_CLV_CONTRACT_VERSION[\s\S]*\}\s*=\s*require\('\.\/tennisClvContract'\)/.test(source));
  check('Marker Patch45 presente', source.includes('TENNIS_PATCH45_CLV_CONTRACT_RUNTIME_BINDING_ATOMIC_LOCK_RECOVERY'));
  check('Assertion fail-fast definita', source.includes('function assertPatch45ClvRuntimeBindings()'));
  check('Assertion eseguita al caricamento', source.includes('const PATCH45_CLV_RUNTIME_BINDINGS_READY = assertPatch45ClvRuntimeBindings();'));

  const originalLoad = Module._load;
  let axiosCalls = 0;
  Module._load = function patch45ModuleLoad(request) {
    if (request === 'axios') return { get: async () => { axiosCalls += 1; throw new Error('PATCH45_TEST_NETWORK_FORBIDDEN'); } };
    return originalLoad.apply(this, arguments);
  };
  let tracker;
  try {
    const trackerPath = path.join(root, 'backend', 'clvTracker.js');
    delete require.cache[require.resolve(trackerPath)];
    tracker = require(trackerPath);
  } finally {
    Module._load = originalLoad;
  }
  check('Modulo clvTracker caricabile', Boolean(tracker));
  check('Binding runtime dichiarati pronti', tracker.PATCH45_CLV_RUNTIME_BINDINGS_READY === true);
  check('Assertion runtime restituisce true', tracker.assertPatch45ClvRuntimeBindings() === true);
  check('Nessuna chiamata rete al caricamento', axiosCalls === 0, { axiosCalls });

  const failed = checks.filter(item => !item.ok);
  console.log(JSON.stringify({
    success: failed.length === 0,
    patch: 'TENNIS_PATCH_45_CLV_CONTRACT_RUNTIME_BINDING_ATOMIC_LOCK_RECOVERY',
    suite: 'PATCH45_CLV_BINDING_FAIL_FAST',
    checks: checks.length,
    details: checks,
    failures: failed
  }, null, 2));
  if (failed.length) process.exit(1);
} catch (error) {
  console.log(JSON.stringify({ success: false, suite: 'PATCH45_CLV_BINDING_FAIL_FAST', checks: checks.length, error: error.stack || error.message, details: checks }, null, 2));
  process.exit(1);
}
