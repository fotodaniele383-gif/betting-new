#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const dbPath = path.join(root, 'backend', 'database_betting.db');
function openDb() { try { const B = require(path.join(root, 'node_modules', 'better-sqlite3')); return { db: new B(dbPath), adapter: 'better-sqlite3' }; } catch (_) { const { DatabaseSync } = require('node:sqlite'); return { db: new DatabaseSync(dbPath), adapter: 'node:sqlite' }; } }
function sha() { return crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex'); }
function runPreview(file) { return childProcess.spawnSync(process.execPath, [path.join(root, file), '--root', root], { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }); }
const checks = [];
function check(name, fn) { try { fn(); checks.push({ name, ok: true }); } catch (error) { checks.push({ name, ok: false, error: error.message }); } }
const before = sha();
const p1 = runPreview('backend/repairTennisPendingConsistency.js');
const after1 = sha();
const p2 = runPreview('backend/repairStep49CSoftBlocks.js');
const after2 = sha();
const { db, adapter } = openDb();
let stats;
try {
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const total = Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n || 0);
  const tennis = Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'").get().n || 0);
  const snapshots = Number(db.prepare('SELECT COUNT(*) n FROM tennis_prediction_snapshots').get().n || 0);
  const anchors = Number(db.prepare('SELECT COUNT(*) n FROM tennis_prediction_snapshots WHERE is_calibration_anchor=1').get().n || 0);
  const invalid = Number(db.prepare("SELECT COUNT(*) n FROM tennis_prediction_snapshots WHERE snapshot_status IN ('POST_START_INVALID','INCOMPLETE')").get().n || 0);
  const patch30Schema = db.prepare("SELECT name,type FROM sqlite_master WHERE LOWER(name) LIKE '%patch30%' OR LOWER(name) LIKE '%core_contract%'").all();
  stats = { integrity, total, tennis, snapshots, anchors, invalid, patch30Schema };
  check('integrità SQLite', () => assert.equal(integrity, 'ok'));
  check('dataset presente', () => assert(total > 0 && tennis > 0));
  check('snapshot validi preservati', () => assert(invalid === 0));
  check('nessuno schema Patch30', () => assert.equal(patch30Schema.length, 0));
} finally { db.close(); }
check('preview pending exit 0', () => assert.equal(p1.status, 0, p1.stderr || p1.stdout));
check('preview Step49C exit 0', () => assert.equal(p2.status, 0, p2.stderr || p2.stdout));
check('preview pending non muta DB', () => assert.equal(before, after1));
check('preview Step49C non muta DB', () => assert.equal(after1, after2));
const failed = checks.filter(item => !item.ok);
console.log(JSON.stringify({ success: !failed.length, adapter, database: stats, databaseSha256: after2, checks, passed: checks.length - failed.length, failed: failed.length }, null, 2));
process.exit(failed.length ? 1 : 0);
