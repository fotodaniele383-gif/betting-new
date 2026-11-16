'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CANONICAL_XLSX,
  CANONICAL_WEB_DIR,
  CANONICAL_PDF,
  REQUIRED_HTML,
  resolvePatch16Sources
} = require('./resolve-tennis-patch16-sources');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function makeHtml(directory, prefix = 'html') {
  for (const [index, file] of REQUIRED_HTML.entries()) write(path.join(directory, file), `${prefix}-${index}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bettingapp-patch16-source-layout-'));
const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, success: true });
  } catch (error) {
    results.push({ name, success: false, error: error.message });
    throw error;
  }
}

try {
  const standard = path.join(root, 'standard');
  write(path.join(standard, CANONICAL_XLSX), 'xlsx-standard');
  makeHtml(path.join(standard, CANONICAL_WEB_DIR), 'standard');
  write(path.join(standard, CANONICAL_PDF), 'pdf-standard');
  test('STANDARD_ROOT_XLSX_PLUS_WEB_FOLDER', () => {
    const resolved = resolvePatch16Sources({ root: standard });
    assert.strictEqual(resolved.layout, 'STANDARD_ROOT_XLSX_PLUS_WEB_FOLDER');
    assert.strictEqual(resolved.pdfPresent, true);
  });

  const unified = path.join(root, 'unified');
  const unifiedDir = path.join(unified, CANONICAL_WEB_DIR);
  write(path.join(unifiedDir, CANONICAL_XLSX), 'xlsx-unified');
  makeHtml(unifiedDir, 'unified');
  write(path.join(unifiedDir, CANONICAL_PDF), 'pdf-unified');
  test('UNIFIED_WEB_FOLDER_WITH_XLSX', () => {
    const resolved = resolvePatch16Sources({ root: unified });
    assert.strictEqual(resolved.layout, 'UNIFIED_WEB_FOLDER_WITH_XLSX');
    assert.strictEqual(resolved.sourceFile, path.join(unifiedDir, CANONICAL_XLSX));
    assert.strictEqual(resolved.webDir, unifiedDir);
  });

  const noPdf = path.join(root, 'no-pdf');
  write(path.join(noPdf, CANONICAL_XLSX), 'xlsx-no-pdf');
  makeHtml(path.join(noPdf, CANONICAL_WEB_DIR), 'no-pdf');
  test('PDF_AUDIT_ONLY_OPTIONAL', () => {
    const resolved = resolvePatch16Sources({ root: noPdf });
    assert.strictEqual(resolved.pdfPresent, false);
  });

  const identical = path.join(root, 'identical');
  write(path.join(identical, CANONICAL_XLSX), 'same-xlsx');
  write(path.join(identical, CANONICAL_WEB_DIR, CANONICAL_XLSX), 'same-xlsx');
  makeHtml(path.join(identical, CANONICAL_WEB_DIR), 'identical');
  test('IDENTICAL_DUPLICATES_DETERMINISTIC', () => {
    const resolved = resolvePatch16Sources({ root: identical });
    assert.strictEqual(resolved.layout, 'STANDARD_ROOT_XLSX_PLUS_WEB_FOLDER');
    assert.strictEqual(resolved.sourceIdenticalDuplicates.length, 1);
  });

  const ambiguous = path.join(root, 'ambiguous');
  write(path.join(ambiguous, CANONICAL_XLSX), 'xlsx-a');
  write(path.join(ambiguous, CANONICAL_WEB_DIR, CANONICAL_XLSX), 'xlsx-b');
  makeHtml(path.join(ambiguous, CANONICAL_WEB_DIR), 'ambiguous');
  test('DIFFERENT_DUPLICATES_FAIL_CLOSED', () => {
    assert.throws(() => resolvePatch16Sources({ root: ambiguous }), /Sorgente XLSX ambiguo/);
  });

  const missing = path.join(root, 'missing');
  makeHtml(path.join(missing, CANONICAL_WEB_DIR), 'missing');
  test('MISSING_XLSX_FAIL_CLOSED', () => {
    assert.throws(() => resolvePatch16Sources({ root: missing }), /Sorgente XLSX mancante/);
  });

  console.log(JSON.stringify({ success: true, patch: '16-R1', tests: results.length, passed: results.filter(item => item.success).length, results }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
