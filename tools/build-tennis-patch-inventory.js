#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const registry = require('../backend/tennisPatchRegistry');

const root = path.resolve(__dirname, '..');
const TENNIS_INVENTORY_BUILDER_REVISION = 'PATCH10_R1_SELF_EXCLUSION';
const outputArg = process.argv.find(arg => arg.startsWith('--output='));
const outputPath = outputArg
  ? path.resolve(root, outputArg.slice('--output='.length))
  : path.join(root, 'backend', 'tennis_patch_inventory.json');

const scanRoots = [
  path.join(root, 'backend'),
  path.join(root, 'public')
];

const excludedDirs = new Set([
  'backup', 'backups', 'cache', 'cache_news', 'cache_results_v10',
  'node_modules', 'migrations', 'File richiesti', 'file test', 'file test audit'
]);

const allowedExtensions = new Set(['.js', '.json', '.html']);

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (allowedExtensions.has(path.extname(entry.name).toLowerCase())) files.push(full);
  }
  return files;
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

const occurrences = new Map();
const stepRegex = /\bSTEP[\s_-]?(\d{1,3})([A-Z]*)\b/g;

const normalizedOutputPath = path.resolve(outputPath);

for (const file of scanRoots.flatMap(scanRoot => walk(scanRoot))) {
  // Generated inventory must never scan itself: otherwise every rebuild changes semantic contents.
  if (path.resolve(file) === normalizedOutputPath) continue;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
  if (!/TENNIS|STEP/i.test(text)) continue;
  let match;
  while ((match = stepRegex.exec(text))) {
    const step = Number(match[1]);
    const token = `STEP${step}${match[2] || ''}`;
    if (!occurrences.has(step)) occurrences.set(step, { tokens: new Set(), files: new Set(), count: 0 });
    const row = occurrences.get(step);
    row.tokens.add(token);
    row.files.add(relative(file));
    row.count += 1;
  }
}

const legacySteps = [...occurrences.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([step, row]) => {
    const group = registry.getLegacyBaselineGroup(step);
    return {
      step,
      baselineVersion: group ? group.version : null,
      area: group ? group.area : null,
      occurrenceCount: row.count,
      tokens: [...row.tokens].sort(),
      files: [...row.files].sort()
    };
  });

const unregistered = legacySteps.filter(row => !row.baselineVersion);
if (unregistered.length) {
  console.error('Legacy steps non registrati:', unregistered.map(row => row.step).join(', '));
  process.exitCode = 2;
}

const payload = {
  generatedAt: new Date().toISOString(),
  registry: registry.getTennisPatchStatus(),
  summary: {
    uniqueLegacySteps: legacySteps.length,
    firstLegacyStep: legacySteps[0]?.step ?? null,
    lastLegacyStep: legacySteps.at(-1)?.step ?? null,
    unregisteredCount: unregistered.length
  },
  legacySteps
};

const canonical = JSON.stringify(payload, null, 2) + '\n';
payload.sha256 = crypto.createHash('sha256').update(canonical).digest('hex');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + '\n');
console.log(JSON.stringify({
  success: unregistered.length === 0,
  output: relative(outputPath),
  uniqueLegacySteps: legacySteps.length,
  firstLegacyStep: payload.summary.firstLegacyStep,
  lastLegacyStep: payload.summary.lastLegacyStep,
  unregisteredCount: unregistered.length,
  currentPatchVersion: registry.TENNIS_CURRENT_PATCH_VERSION
}, null, 2));
