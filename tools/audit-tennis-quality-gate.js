'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const quality = require('../backend/tennisQualityGateV2');
const runtimeDiagnostics = require('../backend/runtimeDiagnostics');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.env.BETTING_DB_PATH || path.join(ROOT, 'backend', 'database_betting.db');
const AUDIT_DIR = path.join(ROOT, 'audit_patch10');
const operationId = runtimeDiagnostics.createOperationId('PATCH10_QUALITY_GATE_AUDIT');
let db;
try {
  db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const where = "(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%')";
  const rows = db.prepare(`SELECT * FROM ai_forward_test WHERE ${where} ORDER BY id`).all();
  const audit = quality.buildQualityPerformanceAudit(rows);
  const output = { ...audit, integrity, operationId, generatedAt: new Date().toISOString() };
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  fs.writeFileSync(path.join(AUDIT_DIR, 'patch10_quality_gate_audit.json'), JSON.stringify(output, null, 2));
  const md = [
    '# Patch 10 — Quality Gate performance audit', '',
    `- Integrity: **${integrity}**`,
    `- Tennis rows: **${audit.rows}**`,
    `- Resolved WON/LOST: **${audit.resolved}**`,
    `- Operational: **${audit.operational}**`,
    `- Stake zero: **${audit.zeroStake}**`, '',
    '## Final Quality', '',
    '| Category | Signals | Signal WR | Operational | ROI | Zero stake |',
    '|---|---:|---:|---:|---:|---:|',
    ...Object.entries(audit.byFinalQuality).map(([name, s]) => `| ${name} | ${s.signals} | ${s.signalWinRatePct ?? 'N/A'}% | ${s.operational} | ${s.roiPct ?? 'N/A'}% | ${s.zeroStake} |`),
    '', '## Zero-stake combinations requiring review', '',
    ...(audit.zeroStakeHighRate.length ? audit.zeroStakeHighRate.map(item => `- ${item.key}: ${item.zeroStake} zero-stake, WR ${item.zeroStakeWinRatePct}% (signal CI ${item.signalWinRate95.lowPct}–${item.signalWinRate95.highPct}%).`) : ['- None.']),
    '', '> Performance is an aggregate audit, not a label derived from the future result of the current match.'
  ].join('\n');
  fs.writeFileSync(path.join(AUDIT_DIR, 'patch10_quality_gate_audit.md'), md + '\n');
  console.log(JSON.stringify(output, null, 2));
  if (integrity !== 'ok' || !audit.success) process.exitCode = 2;
} catch (error) {
  console.error(JSON.stringify({ success: false, operationId, error: error.message }, null, 2));
  process.exitCode = 2;
} finally { try { db?.close(); } catch (_) {} }
