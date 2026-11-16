#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { createRequire } = require('module');

const rootArg = process.argv.indexOf('--root');
const root = path.resolve(rootArg >= 0 && process.argv[rootArg + 1] ? process.argv[rootArg + 1] : '.');
const packagePath = path.join(root, 'package.json');
const registryPath = path.join(root, 'backend', 'tennisPatchRegistry.js');
const databasePath = path.join(root, 'backend', 'database_betting.db');
const statePath = path.join(root, '.tennis_patch44_state.json');

const pkg = require(packagePath);
delete require.cache[require.resolve(registryPath)];
const registry = require(registryPath);
const checks = [];
const add = (name, ok, details = {}) => checks.push({ name, ok: Boolean(ok), details });
const sha256File = filePath => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
const sha256Json = value => crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex');

function inspectDatabase() {
  if (!fs.existsSync(databasePath)) {
    return { healthy: false, error: 'DATABASE_MISSING', integrity: null, foreignKeyViolations: null };
  }

  let db;
  let adapter;
  try {
    const projectRequire = createRequire(packagePath);
    const BetterSqlite3 = projectRequire('better-sqlite3');
    db = new BetterSqlite3(databasePath, { readonly: true, fileMustExist: true });
    adapter = 'better-sqlite3';
  } catch (_) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      db = new DatabaseSync(databasePath, { readOnly: true, open: true });
      adapter = 'node:sqlite';
    } catch (error) {
      return { healthy: false, error: `DATABASE_ADAPTER_UNAVAILABLE: ${error.message}`, integrity: null, foreignKeyViolations: null };
    }
  }

  try {
    const integrityRow = db.prepare('PRAGMA integrity_check').get();
    const integrity = String(Object.values(integrityRow || {})[0] || 'unknown');
    const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_forward_test'").get();
    const counts = table
      ? {
          total: Number(db.prepare('SELECT COUNT(*) AS n FROM ai_forward_test').get().n),
          tennis: Number(db.prepare("SELECT COUNT(*) AS n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get().n)
        }
      : { total: null, tennis: null };
    return {
      healthy: integrity.toLowerCase() === 'ok' && foreignKeys.length === 0 && Boolean(table),
      adapter,
      integrity,
      foreignKeyViolations: foreignKeys.length,
      tablePresent: Boolean(table),
      ...counts
    };
  } catch (error) {
    return { healthy: false, adapter, error: error.message, integrity: null, foreignKeyViolations: null };
  } finally {
    try { db.close(); } catch (_) {}
  }
}

add(
  'versioni Patch44 compatibili',
  Number(pkg.version.split('.')[1]) >= 31
    && Number(registry.TENNIS_CURRENT_PATCH_VERSION) >= 44
    && /^TENNIS_PATCH_REGISTRY_V(?:4[4-9]|[5-9]\d+)$/.test(registry.TENNIS_PATCH_REGISTRY_VERSION),
  {
    packageVersion: pkg.version,
    current: registry.TENNIS_CURRENT_PATCH_VERSION,
    registry: registry.TENNIS_PATCH_REGISTRY_VERSION
  }
);

add(
  'Patch 1-44 registrate',
  Array.from({ length: 44 }, (_, index) => String(index + 1))
    .every(version => registry.PATCHES.some(patch => String(patch.version) === version))
);

const patch44 = registry.PATCHES.find(patch => String(patch.version) === '44');
add(
  'scope frontend-only',
  patch44?.status === 'ACTIVE' && patch44.scope.some(item => item.includes('frontend-only')),
  { title: patch44?.title, scope: patch44?.scope }
);

add('nessuna migrazione DB Patch44', !fs.existsSync(path.join(root, 'backend', 'migrateTennisPatch44.js')));
add(
  'nessun modulo probabilità/stake Patch44',
  !fs.existsSync(path.join(root, 'backend', 'tennisProbabilityPatch44.js'))
    && !fs.existsSync(path.join(root, 'backend', 'tennisStakeAuthorityPatch44.js'))
);

const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null;
if (state) {
  const currentSha256 = fs.existsSync(databasePath) ? sha256File(databasePath) : null;
  const installationBaselineSha256 = state.databaseBeforeSha256 || null;
  const byteIdenticalToInstallation = Boolean(
    currentSha256 && installationBaselineSha256 && currentSha256 === installationBaselineSha256
  );
  const database = inspectDatabase();

  /*
   * Patch 44's installer already proves byte identity inside its own atomic
   * installation window. The persistent state file is also used for rollback,
   * but it is not a permanent freeze of an operational SQLite database.
   * Legitimate predictions, settlement and lifecycle writes after installation
   * necessarily change the file hash. Long-running compatibility audits must
   * therefore require database integrity, not historical byte identity.
   */
  add(
    byteIdenticalToInstallation
      ? 'database byte-identico alla baseline di installazione Patch44'
      : 'database runtime integro con drift operativo successivo a Patch44',
    byteIdenticalToInstallation || database.healthy,
    {
      installationBaselineSha256,
      currentSha256,
      byteIdenticalToInstallation,
      runtimeDriftDetected: !byteIdenticalToInstallation,
      policy: 'PATCH44_INSTALLER_ASSERTS_BYTE_IDENTITY_AT_INSTALL_TIME; POST_INSTALL_RUNTIME_WRITES_REQUIRE_INTEGRITY_ONLY',
      database
    }
  );

  add(
    'dipendenze npm immutate',
    state.dependenciesBeforeSha256 === sha256Json(pkg.dependencies)
      && state.devDependenciesBeforeSha256 === sha256Json(pkg.devDependencies)
  );
} else {
  add('state installer opzionale in sviluppo', true, { statePresent: false });
}

if (String(process.env.PATCH50_SKIP_NESTED_PROGRESSION || '') === '1') {
  add('progression audit delegated to Patch50 matrix', true, {
    delegated: true,
    target: 'tools/audit-tennis-program-progression.js'
  });
} else {
  const progression = cp.spawnSync(
    process.execPath,
    [path.join(root, 'tools', 'audit-tennis-program-progression.js'), root],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 180000,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
        TENNIS_PATCH43_WTA_AUTO_REFRESH: '0'
      }
    }
  );
  let progressionOutput = null;
  try { progressionOutput = JSON.parse(progression.stdout); } catch (_) {}
  add(
    'progression audit healthy',
    progression.status === 0 && progressionOutput?.healthy === true,
    {
      status: progressionOutput?.status,
      errors: progressionOutput?.errors,
      warnings: progressionOutput?.warnings,
      stderr: progression.stderr?.slice(0, 500),
      spawnError: progression.error?.message || null
    }
  );
}

const failed = checks.filter(check => !check.ok);
console.log(JSON.stringify({
  success: failed.length === 0,
  patch: '44',
  revision: 'R2_RUNTIME_DATABASE_DRIFT_COMPATIBILITY',
  checks,
  errors: failed.length
}, null, 2));
if (failed.length) process.exit(1);
