#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const rootArg = process.argv.indexOf('--root');
const projectRoot = path.resolve(rootArg >= 0 && process.argv[rootArg + 1] ? process.argv[rootArg + 1] : '.');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tennis-patch45-r2-drift-'));
const checks = [];
const add = (name, ok, details = {}) => checks.push({ name, ok: Boolean(ok), details });
const sha256File = filePath => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
const sha256Json = value => crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex');

function mkdir(relativePath) {
  fs.mkdirSync(path.join(temporaryRoot, relativePath), { recursive: true });
}

try {
  mkdir('backend');
  mkdir('tools');

  const pkg = {
    name: 'patch45-r2-drift-test',
    version: '21.32.0',
    dependencies: { alpha: '1.0.0' },
    devDependencies: { beta: '1.0.0' }
  };
  fs.writeFileSync(path.join(temporaryRoot, 'package.json'), JSON.stringify(pkg, null, 2));

  const patches = Array.from({ length: 44 }, (_, index) => ({
    version: String(index + 1),
    status: 'ACTIVE',
    title: index === 43 ? 'Atomic Trading dashboard DOM wrapping and forward completion guard' : `Patch ${index + 1}`,
    scope: index === 43 ? ['The patch is frontend-only: runtime database writes remain operational.'] : []
  }));
  fs.writeFileSync(
    path.join(temporaryRoot, 'backend', 'tennisPatchRegistry.js'),
    `'use strict';\nmodule.exports=${JSON.stringify({ TENNIS_CURRENT_PATCH_VERSION: '45', TENNIS_PATCH_REGISTRY_VERSION: 'TENNIS_PATCH_REGISTRY_V45', PATCHES: patches }, null, 2)};\n`
  );

  const databasePath = path.join(temporaryRoot, 'backend', 'database_betting.db');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE ai_forward_test (id INTEGER PRIMARY KEY, sport_type TEXT); INSERT INTO ai_forward_test(sport_type) VALUES ('TENNIS');");
  db.close();
  const installationSha256 = sha256File(databasePath);

  const reopened = new DatabaseSync(databasePath);
  reopened.exec("INSERT INTO ai_forward_test(sport_type) VALUES ('TENNIS');");
  reopened.close();
  const runtimeSha256 = sha256File(databasePath);

  fs.writeFileSync(path.join(temporaryRoot, '.tennis_patch44_state.json'), JSON.stringify({
    patch: 'TENNIS_PATCH_44_TRADING_DOM_ATOMIC_WRAP_FORWARD_COMPLETION_GUARD',
    databaseBeforeSha256: installationSha256,
    dependenciesBeforeSha256: sha256Json(pkg.dependencies),
    devDependenciesBeforeSha256: sha256Json(pkg.devDependencies)
  }, null, 2));

  fs.writeFileSync(
    path.join(temporaryRoot, 'tools', 'audit-tennis-program-progression.js'),
    "#!/usr/bin/env node\nconsole.log(JSON.stringify({success:true,healthy:true,status:'WARN',errors:0,warnings:3}));\n"
  );
  fs.copyFileSync(
    path.join(projectRoot, 'tools', 'audit-tennis-patch44.js'),
    path.join(temporaryRoot, 'tools', 'audit-tennis-patch44.js')
  );

  const run = cp.spawnSync(
    process.execPath,
    [path.join(temporaryRoot, 'tools', 'audit-tennis-patch44.js'), '--root', temporaryRoot],
    { cwd: temporaryRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, env: { ...process.env, NODE_NO_WARNINGS: '1' } }
  );
  let output = null;
  try { output = JSON.parse(run.stdout); } catch (_) {}
  const driftCheck = output?.checks?.find(check => check.name.includes('drift operativo'));

  add('fixture modifica realmente hash DB dopo installazione', installationSha256 !== runtimeSha256, { installationSha256, runtimeSha256 });
  add('audit Patch44 termina con exit code 0', run.status === 0, { stderr: run.stderr, stdout: run.stdout?.slice(0, 1000) });
  add('audit Patch44 restituisce success true', output?.success === true, { output });
  add('drift operativo rilevato esplicitamente', driftCheck?.details?.runtimeDriftDetected === true, { driftCheck });
  add('database runtime verificato integro', driftCheck?.details?.database?.healthy === true, { database: driftCheck?.details?.database });
  add('vecchio hash non viene promosso a requisito permanente', driftCheck?.details?.byteIdenticalToInstallation === false, { driftCheck });

  const failed = checks.filter(check => !check.ok);
  console.log(JSON.stringify({
    success: failed.length === 0,
    patch: 'TENNIS_PATCH_45_CLV_CONTRACT_RUNTIME_BINDING_ATOMIC_LOCK_RECOVERY',
    revision: 'R2_WINDOWS_NODE_CLV_BINDING_RUNTIME_DB_DRIFT_COMPAT',
    checks,
    errors: failed.length
  }, null, 2));
  if (failed.length) process.exit(1);
} catch (error) {
  console.log(JSON.stringify({
    success: false,
    patch: 'TENNIS_PATCH_45_CLV_CONTRACT_RUNTIME_BINDING_ATOMIC_LOCK_RECOVERY',
    revision: 'R2_WINDOWS_NODE_CLV_BINDING_RUNTIME_DB_DRIFT_COMPAT',
    checks,
    error: error.stack || error.message
  }, null, 2));
  process.exit(1);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
