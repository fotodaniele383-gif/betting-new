#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] || '.' : path.join(__dirname, '..'));
const checks = [];
const add = (name, ok, details = null) => checks.push({ name, ok: Boolean(ok), details });
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
try {
  const publicFile = path.join(ROOT, 'public', 'app.js');
  const backendFile = path.join(ROOT, 'backend', 'public', 'app.js');
  const text = fs.readFileSync(publicFile, 'utf8');
  const backendText = fs.readFileSync(backendFile, 'utf8');
  const start = text.indexOf('function renderCompactCalcioDeepScan');
  const end = text.indexOf('\nfunction applyCalcioDeepScanStakeResult', start);
  const block = start >= 0 && end > start ? text.slice(start, end) : '';

  add('Frontend mirrors remain byte-identical', sha(publicFile) === sha(backendFile), { public: sha(publicFile), backend: sha(backendFile) });
  add('Compact Calcio DeepScan renderer found', block.length > 1000, { start, end, length: block.length });
  add('Detailed panel labels DeepScan signal as SHADOW', block.includes('Segnale DeepScan (SHADOW)') && block.includes('Nessuna autorità diretta su stake/gate'));
  add('Detailed panel exposes separate operational gate', block.includes('Gate operativo') && block.includes('Autorità operativa separata dal segnale DeepScan'));
  add('Signal and operational actions are resolved independently', block.includes('deepScanSignalAction') && block.includes('deepScanOperationalAction') && block.includes('result.signalAction') && block.includes('result.operationalAction'));
  add('Legacy ambiguous Value / operatività card removed from detailed renderer', !block.includes('Value / operatività'));
  add('R3_R1 explanatory banner present', block.includes('AUDIT16D_R3_R1') && block.includes('determina separatamente l\'azione e lo stake consentiti'));
  add('Mirror contains same R3_R1 UI markers', backendText.includes('Segnale DeepScan (SHADOW)') && backendText.includes('AUDIT16D_R3_R1'));
} catch (error) {
  add('Unhandled', false, { message: error.message, stack: error.stack });
}
const failures = checks.filter(x => !x.ok);
console.log(JSON.stringify({ success: failures.length === 0, patch: 'AUDIT16D_R3_R1', suite: 'CALCIO_UI_SIGNAL_GATE_SEPARATION', checks: checks.length, failures, details: checks }, null, 2));
process.exit(failures.length ? 1 : 0);
