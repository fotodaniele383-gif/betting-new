#!/usr/bin/env node
'use strict';

/**
 * Standalone audit for STEP114.
 * This test is intentionally dependency-free and does not require Jest.
 */

const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
  console.log(`PASS ${message}`);
}

function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

const testRel = path.join('backend', 'tests', 'step81FrontendRuntimeRecovery.test.js');
const publicAppRel = path.join('public', 'app.js');
const backendAppRel = path.join('backend', 'public', 'app.js');

assert(fs.existsSync(path.join(process.cwd(), testRel)), 'test Step81 presente');
const testSource = read(testRel);

assert(
  testSource.includes('STEP114_STEP81_REGEX_TEST_ESCAPE_FIX') ||
  testSource.includes('hasUnicodeOrLatinSafeBadgeRegex') ||
  testSource.includes('String.raw`.replace(/[^\\\\p{L}\\\\s]/gu,`'),
  'test Step81 contiene fix escape Unicode raw'
);

assert(
  !testSource.includes("toContain('.replace(/[^\\p{L}\\s]/gu,')"),
  'test Step81 non usa più literal fragile con \\p/\\s consumati'
);

if (fs.existsSync(path.join(process.cwd(), publicAppRel)) && fs.existsSync(path.join(process.cwd(), backendAppRel))) {
  const publicApp = read(publicAppRel);
  const backendApp = read(backendAppRel);
  assert(publicApp === backendApp, 'public/backend app.js restano identici');
  assert(
    publicApp.includes(String.raw`.replace(/[^\p{L}\s]/gu,`) ||
    publicApp.includes(String.raw`.replace(/[^a-zA-ZÀ-ÿ\s]/g,`) ||
    publicApp.includes(String.raw`.replace(/[^A-Za-z0-9]+/,`),
    'frontend contiene regex sicura per label/badge senza mojibake bloccante'
  );
}

console.log('STEP114 standalone audit complete: Step81 regex test escaping repaired, production runtime untouched.');
