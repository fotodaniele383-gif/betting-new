'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawnSync } = require('child_process');

const VERSION = 'TENNIS_SAFE_SUPPORT_BUNDLE_V6_PATCH31';
const ROOT = path.resolve(process.argv[2] || process.cwd());
const OUTPUT_ARG = process.argv.find(arg => String(arg).startsWith('--output='));
const OUTPUT = path.resolve(OUTPUT_ARG ? OUTPUT_ARG.slice('--output='.length) : path.join(ROOT, `tennis_safe_support_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`));
const VERIFY_ONLY = process.argv.includes('--verify-only');
const EXCLUDED_NAMES = new Set(['node_modules', 'backup', 'backups', '.betting_patch_backups', '.release_staging', '.git', '.idea', '.vscode', '__pycache__']);
const SENSITIVE_FILE = /(^|\/)(\.env(?:\..*)?|telegram\.config\.json|telegram_state\.json|.*(?:token|secret|credential|session).*\.(?:json|txt|log))$/i;
const PATCH_DIR = /(^|\/)(?:TENNIS|CALCIO)_PATCH_\d+/i;
const LOG_FILE = 'backend/logs/runtime-diagnostics.jsonl';
const DB_FILE = 'backend/database_betting.db';
const MAX_LOG_LINES = 500;
const EXECUTABLE_BINARY = /\.(?:msi|exe|dll|node)$/i;
const SECRET_PATTERNS = [
  { code: 'TELEGRAM_TOKEN', regex: /\b\d{7,12}:[A-Za-z0-9_-]{25,}\b/g },
  { code: 'OPENAI_STYLE_KEY', regex: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { code: 'BEARER_TOKEN', regex: /Bearer\s+[A-Za-z0-9._~+\/-]{20,}/gi }
];

function rel(file) { return path.relative(ROOT, file).split(path.sep).join('/'); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function quoteIdentifier(value) { return `"${String(value).replace(/"/g, '""')}"`; }
function normalizeSql(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function listUserTriggers(db) {
  return db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL ORDER BY name").all()
    .map(row => ({ name: String(row.name), table: String(row.tbl_name || ''), sql: String(row.sql) }));
}
function triggerSchemaHash(triggers) {
  const canonical = (triggers || []).map(item => ({ name: item.name, table: item.table, sql: normalizeSql(item.sql) }));
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
function dropUserTriggers(db, triggers) {
  for (const trigger of triggers || []) db.exec(`DROP TRIGGER IF EXISTS ${quoteIdentifier(trigger.name)}`);
}
function restoreUserTriggers(db, triggers) {
  for (const trigger of triggers || []) db.exec(trigger.sql);
}
function assertTriggerSchemaRestored(db, expected) {
  const actual = listUserTriggers(db);
  const expectedHash = triggerSchemaHash(expected);
  const actualHash = triggerSchemaHash(actual);
  if (actual.length !== expected.length || actualHash !== expectedHash) {
    throw new Error(`SAFE_SUPPORT_TRIGGER_SCHEMA_NOT_RESTORED:${expected.length}:${actual.length}:${expectedHash}:${actualHash}`);
  }
  return { triggerCount: actual.length, triggerSchemaHash: actualHash };
}
function sanitizeString(value) {
  return String(value == null ? '' : value)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password|authorization|cookie|session)\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[REDACTED]')
    .replace(/\b\d{7,12}:[A-Za-z0-9_-]{25,}\b/g, '[REDACTED_TELEGRAM_TOKEN]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_API_KEY]');
}
function sanitizeValue(value, depth = 0) {
  if (depth > 8 || value == null) return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = /(token|secret|password|authorization|cookie|session|api[_-]?key|telegram)/i.test(key)
        ? '[REDACTED]'
        : sanitizeValue(item, depth + 1);
    }
    return out;
  }
  return value;
}
function sanitizeTextCell(value, columnName = '') {
  if (value == null) return value;
  if (/(token|secret|password|authorization|cookie|session|api[_-]?key|telegram)/i.test(columnName)) return '[REDACTED]';
  const original = String(value);
  const trimmed = original.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { return JSON.stringify(sanitizeValue(JSON.parse(original))); } catch (_) { /* plain text below */ }
  }
  return sanitizeString(original);
}
function shouldExclude(relativePath, isDirectory = false) {
  const normalized = String(relativePath || '').split('\\').join('/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some(part => EXCLUDED_NAMES.has(part))) return true;
  if (parts.some(part => part === '.patch14_lkg' || part.startsWith('.patch14_stage_'))) return true;
  if (parts.some(part => part === '.patch14_refresh.lock' || part.endsWith('.patch14-new'))) return true;
  if (PATCH_DIR.test(normalized)) return true;
  if (SENSITIVE_FILE.test(normalized)) return true;
  if (normalized === LOG_FILE || normalized === `${DB_FILE}-wal` || normalized === `${DB_FILE}-shm`) return true;
  if (/^\.(?:tennis|calcio)_patch.*_state\.json$/i.test(parts[parts.length - 1] || '')) return true;
  if (/\.(?:zip|7z|rar)$/i.test(normalized) || EXECUTABLE_BINARY.test(normalized)) return true;
  if (isDirectory && parts.some(part => /^audit_patch\d+_old/i.test(part))) return true;
  return false;
}
function walk(dir, out = [], root = ROOT) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const relativePath = path.relative(root, full).split(path.sep).join('/');
    if (shouldExclude(relativePath, entry.isDirectory())) continue;
    if (entry.isDirectory()) walk(full, out, root);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
function buildSanitizedDiagnostics(staging) {
  const source = path.join(ROOT, ...LOG_FILE.split('/'));
  if (!fs.existsSync(source)) return { sourcePresent: false, includedLines: 0 };
  const lines = fs.readFileSync(source, 'utf8').split(/\r?\n/).filter(Boolean).slice(-MAX_LOG_LINES);
  const sanitized = lines.map(line => {
    try { return JSON.stringify(sanitizeValue(JSON.parse(line))); }
    catch (_) { return JSON.stringify({ level: 'WARN', message: 'Riga diagnostica non JSON', raw: sanitizeString(line).slice(0, 1200) }); }
  });
  const destination = path.join(staging, 'backend', 'logs', 'runtime-diagnostics.redacted.jsonl');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, sanitized.join('\n') + (sanitized.length ? '\n' : ''), 'utf8');
  return { sourcePresent: true, includedLines: sanitized.length };
}
async function sanitizeDatabase(source, destination) {
  if (!fs.existsSync(source)) return { sourcePresent: false, sanitized: false, tablesScanned: 0, cellsRedacted: 0, secretFindings: 0 };
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); }
  catch (error) { throw new Error(`Node SQLite richiesto per il database sicuro: ${error.message}`); }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.rmSync(destination, { force: true });
  const sourceDb = new DatabaseSync(source, { readOnly: true });
  try { sourceDb.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`); } finally { sourceDb.close(); }
  const db = new DatabaseSync(destination);
  let tablesScanned = 0;
  let cellsScanned = 0;
  let cellsRedacted = 0;
  let triggers = [];
  try {
    db.exec('PRAGMA journal_mode = DELETE');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
    triggers = listUserTriggers(db);
    const triggerHashBefore = triggerSchemaHash(triggers);
    db.exec('BEGIN IMMEDIATE');
    try {
      // Il database di supporto è una copia VACUUM INTO. I trigger append-only devono
      // essere sospesi soltanto nella copia, altrimenti la redazione di celle testuali
      // legittimamente sensibili viene bloccata da PATCH15/16/17/18 immutability guards.
      dropUserTriggers(db, triggers);
      for (const table of tables) {
        const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all()
          .filter(column => /TEXT|CHAR|CLOB|JSON/i.test(String(column.type || '')) || /(token|secret|password|authorization|cookie|session|api[_-]?key|telegram|config)/i.test(column.name));
        if (!columns.length) continue;
        tablesScanned += 1;
        for (const column of columns) {
          let rows;
          try { rows = db.prepare(`SELECT rowid AS __rowid, ${quoteIdentifier(column.name)} AS value FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(column.name)} IS NOT NULL`).all(); }
          catch (_) { continue; }
          const update = db.prepare(`UPDATE ${quoteIdentifier(table)} SET ${quoteIdentifier(column.name)}=? WHERE rowid=?`);
          for (const row of rows) {
            cellsScanned += 1;
            const sanitized = sanitizeTextCell(row.value, column.name);
            if (String(sanitized) !== String(row.value)) {
              update.run(sanitized, row.__rowid);
              cellsRedacted += 1;
            }
          }
        }
      }
      restoreUserTriggers(db, triggers);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
    const triggerAudit = assertTriggerSchemaRestored(db, triggers);
    if (triggerAudit.triggerSchemaHash !== triggerHashBefore) throw new Error('SAFE_SUPPORT_TRIGGER_SCHEMA_HASH_CHANGED');
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
    if (integrity !== 'ok') throw new Error(`Integrità database redatto: ${integrity}`);
    const findings = scanDatabaseForSecrets(db);
    if (findings.length) throw new Error(`DATABASE_SECURITY_SCAN_FAILED:${JSON.stringify(findings.slice(0, 20))}`);
    db.exec('VACUUM');
    return {
      sourcePresent: true,
      sanitized: true,
      engine: 'node:sqlite VACUUM INTO',
      tablesScanned,
      cellsScanned,
      cellsRedacted,
      secretFindings: 0,
      integrity,
      immutableTriggerCompatibility: true,
      triggersTemporarilySuspended: triggers.length,
      triggersRestored: triggerAudit.triggerCount,
      triggerSchemaHash: triggerAudit.triggerSchemaHash
    };
  } finally { db.close(); }
}

function hasSecretPattern(value) {
  const text = String(value == null ? '' : value);
  return SECRET_PATTERNS.some(pattern => { pattern.regex.lastIndex = 0; return pattern.regex.test(text); });
}
function scanDatabaseForSecrets(db) {
  const findings = [];
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all()
      .filter(column => /TEXT|CHAR|CLOB|JSON/i.test(String(column.type || '')) || /(token|secret|password|authorization|cookie|session|api[_-]?key|telegram|config)/i.test(column.name));
    for (const column of columns) {
      let rows;
      try { rows = db.prepare(`SELECT rowid AS __rowid, ${quoteIdentifier(column.name)} AS value FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(column.name)} IS NOT NULL`).iterate(); }
      catch (_) { continue; }
      for (const row of rows) {
        const value = String(row.value ?? '');
        if (hasSecretPattern(value)) findings.push({ table, column: column.name, rowid: row.__rowid, code: 'SECRET_PATTERN' });
        if (/(token|secret|password|authorization|cookie|session|api[_-]?key|telegram)/i.test(column.name) && value && value !== '[REDACTED]') {
          findings.push({ table, column: column.name, rowid: row.__rowid, code: 'SENSITIVE_COLUMN_NOT_REDACTED' });
        }
        if (findings.length >= 50) return findings;
      }
    }
  }
  return findings;
}
function scanForSecrets(staging) {
  const findings = [];
  const files = walk(staging, [], staging);
  const binaryExtensions = /\.(?:db|sqlite|png|jpe?g|gif|ico|pdf|xlsx?)$/i;
  const placeholder = /(YOUR_|INSERISCI|LA_TUA|EXAMPLE|DUMMY|TEST|SUPER-SECRET|REDACTED|PROCESS\.ENV|\+\s*[A-Z_]+\s*\+)/i;
  for (const file of files) {
    const relativePath = path.relative(staging, file).split(path.sep).join('/');
    if (SENSITIVE_FILE.test(relativePath)) findings.push({ file: relativePath, code: 'SENSITIVE_FILENAME' });
    if (binaryExtensions.test(relativePath) || fs.statSync(file).size > 8 * 1024 * 1024) continue;
    const content = fs.readFileSync(file, 'utf8');
    const testLike = /(^|\/)(?:tests?|__tests__)(\/|$)|(^|\/)tools\/test/i.test(relativePath);
    if (!testLike) {
      for (const pattern of SECRET_PATTERNS) { pattern.regex.lastIndex = 0; if (pattern.regex.test(content)) findings.push({ file: relativePath, code: pattern.code }); }
      // Patch 11: match only explicit sensitive identifiers. Generic domain fields such as
      // seasonToken/revisionToken are not credentials and must not block safe-support.
      const assigned = /(?:^|[,{;\s])(?:api[_-]?key|access[_-]?token|auth[_-]?token|bearer[_-]?token|client[_-]?secret|secret|password)\s*[:=]\s*["']([^"'\r\n]{12,})["']/igm;
      let match;
      while ((match = assigned.exec(content))) if (!placeholder.test(match[1])) findings.push({ file: relativePath, code: 'ASSIGNED_SECRET' });
    }
  }
  return findings;
}
function createZip(staging, output) {
  fs.rmSync(output, { force: true });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (process.platform === 'win32') {
    const command = `Compress-Archive -Path '${staging.replace(/'/g, "''")}\\*' -DestinationPath '${output.replace(/'/g, "''")}' -Force`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Compress-Archive fallito: ${result.stderr || result.stdout}`);
    return;
  }
  const python = spawnSync('python3', ['-m', 'zipfile', '-c', output, '.'], { cwd: staging, encoding: 'utf8' });
  if (python.status !== 0) throw new Error(`python zipfile fallito: ${python.stderr || python.stdout}`);
}
async function main() {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'tennis-safe-support-'));
  try {
    const files = walk(ROOT, []);
    for (const source of files) {
      const relativePath = rel(source);
      if (relativePath === rel(OUTPUT) || relativePath === DB_FILE) continue;
      copyFile(source, path.join(staging, ...relativePath.split('/')));
    }
    const diagnostics = buildSanitizedDiagnostics(staging);
    const database = await sanitizeDatabase(path.join(ROOT, ...DB_FILE.split('/')), path.join(staging, ...DB_FILE.split('/')));
    const secretFindings = scanForSecrets(staging);
    if (secretFindings.length) throw new Error(`SECURITY_SCAN_FAILED:${JSON.stringify(secretFindings.slice(0, 20))}`);
    const stagedFiles = walk(staging, [], staging).map(file => {
      const relativePath = path.relative(staging, file).split(path.sep).join('/');
      return { path: relativePath, sizeBytes: fs.statSync(file).size, sha256: sha256File(file) };
    }).sort((a, b) => a.path.localeCompare(b.path));
    const manifest = {
      success: true, version: VERSION, createdAt: new Date().toISOString(), sourceRoot: '.',
      files: stagedFiles,
      exclusions: ['node_modules', 'backup', 'TENNIS_PATCH_* / CALCIO_PATCH_*', '.env*', 'telegram.config.json', 'telegram_state.json', 'token/secret/session files', 'raw runtime diagnostics', 'existing archives', 'executable binaries', 'Patch14 staging/lock/LKG backups', 'Patch15 live probe excludes secrets and raw logs'],
      diagnostics: { source: LOG_FILE, included: 'backend/logs/runtime-diagnostics.redacted.jsonl', maxLines: MAX_LOG_LINES, ...diagnostics },
      database: { source: DB_FILE, included: DB_FILE, ...database },
      securityScan: { passed: true, fileFindings: 0, databaseFindings: 0 }
    };
    fs.writeFileSync(path.join(staging, 'SAFE_SUPPORT_MANIFEST.json'), JSON.stringify(manifest, null, 2));
    if (VERIFY_ONLY) {
      const result = { ...manifest, verifyOnly: true, output: null, zipSha256: null, zipSizeBytes: 0 };
      console.log(JSON.stringify(result, null, 2));
      return result;
    }
    createZip(staging, OUTPUT);
    const result = { ...manifest, verifyOnly: false, output: OUTPUT, zipSha256: sha256File(OUTPUT), zipSizeBytes: fs.statSync(OUTPUT).size };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}

if (require.main === module) {
  main().catch(error => { console.error(`SAFE SUPPORT BUNDLE ERROR: ${error.stack || error.message}`); process.exit(2); });
}
module.exports = { VERSION, sanitizeString, sanitizeValue, sanitizeTextCell, normalizeSql, listUserTriggers, triggerSchemaHash, dropUserTriggers, restoreUserTriggers, assertTriggerSchemaRestored, shouldExclude, scanForSecrets, scanDatabaseForSecrets, sanitizeDatabase, main };
