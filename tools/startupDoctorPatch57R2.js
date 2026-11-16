'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');

const VERSION = 'TENNIS_PATCH59_R2_STARTUP_HEALTH_GRACE_V1';
const ROOT = path.resolve(__dirname, '..');
const CRITICAL_MODULES = ['express', 'better-sqlite3', 'axios', 'xlsx', 'node-cron'];

function semverTuple(v) {
  const m = String(v || '').replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? m.slice(1).map(Number) : [0, 0, 0];
}
function nodeSupported(v = process.versions.node) {
  const [a,b,c] = semverTuple(v);
  return a > 20 || (a === 20 && (b > 18 || (b === 18 && c >= 1)));
}
function safePackage() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); }
  catch (error) { return { version: null, _error: error.message }; }
}
function detectPatch58OrLater(pkg) {
  const legacyState = path.join(ROOT, '.tennis_patch58_state.json');
  if (fs.existsSync(legacyState)) {
    return { installed: true, evidence: 'PATCH58_STATE_FILE', currentPatchVersion: '58+' };
  }
  try {
    const registry = require(path.join(ROOT, 'backend', 'tennisPatchRegistry.js'));
    const current = Number(registry.TENNIS_CURRENT_PATCH_VERSION);
    if (Number.isFinite(current) && current >= 58) {
      return { installed: true, evidence: 'TENNIS_REGISTRY', currentPatchVersion: String(registry.TENNIS_CURRENT_PATCH_VERSION) };
    }
  } catch (_) {}
  const [major, minor] = semverTuple(pkg?.version);
  if (major > 21 || (major === 21 && minor >= 45)) {
    return { installed: true, evidence: 'PACKAGE_VERSION_FALLBACK', currentPatchVersion: null };
  }
  return { installed: false, evidence: 'NO_PATCH58_PLUS_EVIDENCE', currentPatchVersion: null };
}
function checkModules() {
  const resolved = {};
  const missing = [];
  for (const name of CRITICAL_MODULES) {
    try { resolved[name] = require.resolve(name, { paths: [ROOT] }); }
    catch (error) { missing.push({ name, code: error.code || 'RESOLVE_ERROR', message: error.message }); }
  }
  return { resolved, missing };
}
function checkNativeBetterSqlite3() {
  try {
    const modPath = require.resolve('better-sqlite3', { paths: [ROOT] });
    // Resolve/load from project search path without changing cwd.
    const Database = require(modPath);
    const db = new Database(':memory:');
    db.prepare('SELECT 1 AS ok').get();
    db.close();
    return { ok: true, modulePath: modPath };
  } catch (error) {
    return { ok: false, code: error.code || 'NATIVE_LOAD_ERROR', message: error.message };
  }
}
function checkSecurity() {
  try {
    const security = require(path.join(ROOT, 'backend', 'productionSecuritySafeReleasePatch57.js'));
    const config = security.resolveRuntimeConfig({ projectRoot: ROOT });
    return { ok: Boolean(config.ready), status: config.status, bindHost: config.bindHost, remoteAccessEnabled: config.remoteAccessEnabled, remoteTokenConfigured: config.remoteTokenConfigured };
  } catch (error) {
    return { ok: false, code: error.code || 'SECURITY_LOAD_ERROR', message: error.message };
  }
}
function checkDb() {
  const dbPath = path.join(ROOT, 'backend', 'database_betting.db');
  if (!fs.existsSync(dbPath)) return { ok: false, code: 'DB_MISSING', dbPath };
  const native = checkNativeBetterSqlite3();
  if (!native.ok) return { ok: false, code: 'DB_DRIVER_UNAVAILABLE', dbPath, native };
  try {
    const Database = require(native.modulePath);
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const integrity = db.pragma('integrity_check', { simple: true });
    const fk = db.pragma('foreign_key_check');
    db.close();
    return { ok: integrity === 'ok' && fk.length === 0, integrity, foreignKeyViolations: fk.length, dbPath };
  } catch (error) {
    return { ok: false, code: error.code || 'DB_OPEN_ERROR', message: error.message, dbPath };
  }
}
function health(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 2500 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { if (body.length < 8192) body += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (_) {}
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300 && Boolean(parsed?.success), statusCode: res.statusCode, body: parsed || body.slice(0, 500) });
      });
    });
    req.on('timeout', () => req.destroy(new Error('HEALTH_TIMEOUT')));
    req.on('error', error => resolve({ ok: false, code: error.code || 'HEALTH_ERROR', message: error.message }));
  });
}
function portProbe(port = 3000, host = '127.0.0.1') {
  return new Promise(resolve => {
    const s = net.createConnection({ port, host });
    let done = false;
    const finish = result => { if (done) return; done = true; s.destroy(); resolve(result); };
    s.setTimeout(1200);
    s.once('connect', () => finish({ listening: true, host, port }));
    s.once('timeout', () => finish({ listening: false, host, port, timeout: true }));
    s.once('error', error => finish({ listening: false, host, port, code: error.code || 'PORT_ERROR' }));
  });
}
async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--health')) {
    const result = await health('http://127.0.0.1:3000/api/health');
    console.log(JSON.stringify({ version: VERSION, mode: 'HEALTH', ...result }, null, 2));
    process.exit(result.ok ? 0 : 20);
  }

  const pkg = safePackage();
  const patch58 = detectPatch58OrLater(pkg);
  const modules = checkModules();
  const native = modules.missing.some(x => x.name === 'better-sqlite3') ? { ok: false, code: 'MODULE_MISSING' } : checkNativeBetterSqlite3();
  const security = checkSecurity();
  const db = modules.missing.length === 0 && native.ok ? checkDb() : { ok: false, skipped: true, reason: 'DEPENDENCIES_NOT_READY' };
  const port = await portProbe(3000);
  const report = {
    version: VERSION,
    root: ROOT,
    node: { version: process.versions.node, supported: nodeSupported() },
    npmHint: 'npm >=10 required by package.json',
    packageVersion: pkg.version,
    patch58Installed: patch58.installed,
    patch58Detection: patch58,
    rootEnv: { exists: fs.existsSync(path.join(ROOT, '.env')), requiredForLocalSecureBoot: false },
    nodeModules: { exists: fs.existsSync(path.join(ROOT, 'node_modules')) },
    modules,
    nativeBetterSqlite3: native,
    security,
    database: db,
    port3000: port,
    recommendation: []
  };

  let exitCode = 0;
  if (!report.node.supported) { report.recommendation.push('Installare Node >=20.18.1.'); exitCode = 9; }
  if (modules.missing.length) { report.recommendation.push('Eseguire npm ci --no-audit --no-fund nella root del progetto.'); exitCode = Math.max(exitCode, 10); }
  if (!modules.missing.length && !native.ok) { report.recommendation.push('Modulo nativo better-sqlite3 non compatibile: eseguire npm rebuild better-sqlite3; se persiste, npm ci.'); exitCode = Math.max(exitCode, 11); }
  if (!security.ok) { report.recommendation.push('Configurazione Patch57 non sicura: mantenere bind 127.0.0.1 e remote access disabilitato finché non configurato.'); exitCode = Math.max(exitCode, 12); }
  if (!report.rootEnv.exists) report.recommendation.push('Il file .env root è assente: il recovery launcher userà i default locali sicuri invece di bloccare l’avvio.');
  if (port.listening) report.recommendation.push('La porta 3000 è già occupata: verificare /api/health prima di avviare una seconda istanza.');
  if (db.ok === false && !db.skipped) { report.recommendation.push('Database non pronto: controllare il dettaglio database prima dell’avvio.'); exitCode = Math.max(exitCode, 13); }

  report.readyToStart = exitCode === 0;
  console.log(JSON.stringify(report, null, 2));
  process.exit(exitCode);
}

main().catch(error => {
  console.error(JSON.stringify({ version: VERSION, success: false, code: error.code || 'STARTUP_DOCTOR_FATAL', error: error.message }, null, 2));
  process.exit(99);
});
