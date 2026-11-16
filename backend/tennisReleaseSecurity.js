'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TENNIS_RELEASE_SECURITY_VERSION = 'TENNIS_RELEASE_SECURITY_V1_PATCH31';
const AUDIT16D_R3_T1_HEALTH_HARDENING_REVISION = 'AUDIT16D_R3_T1_TENNIS_HEALTH_AND_FORWARD_DATA_V1';
const DEFAULT_MAX_RELEASE_BYTES = 150 * 1024 * 1024;

const SECRET_PATTERNS = Object.freeze([
  Object.freeze({ code: 'TELEGRAM_BOT_TOKEN', severity: 'CRITICAL', regex: /\b\d{7,12}:[A-Za-z0-9_-]{25,}\b/g }),
  Object.freeze({ code: 'OPENAI_STYLE_KEY', severity: 'CRITICAL', regex: /\bsk-[A-Za-z0-9_-]{16,}\b/g }),
  Object.freeze({ code: 'GITHUB_TOKEN', severity: 'CRITICAL', regex: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g }),
  Object.freeze({ code: 'BEARER_TOKEN', severity: 'CRITICAL', regex: /\bBearer\s+[A-Za-z0-9._~+\/-]{20,}\b/gi }),
  Object.freeze({ code: 'PRIVATE_KEY', severity: 'CRITICAL', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g }),
  Object.freeze({ code: 'AWS_ACCESS_KEY', severity: 'CRITICAL', regex: /\bAKIA[0-9A-Z]{16}\b/g })
]);

const ALWAYS_EXCLUDED_DIR_NAMES = new Set([
  'node_modules', '.git', '.idea', '.vscode', '__pycache__',
  '.betting_patch_backups', '.scheduler_patch58_runtime', '.controlled_canary_patch59_runtime', 'backup', 'backups', 'coverage', '.nyc_output',
  '.audit_patches', 'last_known_good_patch21', '.tennis_provider_cache', 'cache_official_tennis_patch29', 'audit16d-runtime'
]);

const RELEASE_EXCLUDED_FILE_NAMES = new Set([
  'telegram.config.json', 'telegram_state.json',
  'database_betting.db', 'database_betting.db-wal', 'database_betting.db-shm',
  'Thumbs.db', 'desktop.ini', '.DS_Store', 'api_usage_cache.json'
]);

const ALLOWED_SECRET_STORAGE = Object.freeze([
  '.env', 'backend/.env'
]);

const KNOWN_TEST_FIXTURES = Object.freeze([
  'tools/test-tennis-safe-support-immutable-sanitization.js',
  'backend/tests/patch11TennisForwardCaptureHealthAndSafeSupport.test.js',
  'tools/test-tennis-patch57-release-policy.js'
]);

function normalize(relativePath = '') {
  return String(relativePath).split(path.sep).join('/').replace(/^\.\//, '');
}
function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}
function isPlaceholder(value = '') {
  const text = String(value || '').toUpperCase();
  return !text || text.includes('INSERISCI_QUI') || text.includes('PLACEHOLDER') || text.includes('REDACTED') || text.includes('EXAMPLE') || text.includes('TEST_ONLY');
}
function isTextFile(file) {
  return !/\.(?:db|sqlite|sqlite3|png|jpe?g|gif|webp|ico|pdf|xlsx?|xlsm|zip|7z|rar|gz|tar|exe|dll|node|msi|woff2?|ttf|eot|mp3|mp4|avi)$/i.test(file);
}
function classifyExclusion(relativePath, stat = null) {
  const rel = normalize(relativePath);
  const parts = rel.split('/').filter(Boolean);
  if (parts.some(part => ALWAYS_EXCLUDED_DIR_NAMES.has(part))) return 'BACKUP_OR_DEPENDENCY';
  if (/^AUDIT(?:\d|[A-Z_])/i.test(parts[0] || '')) return 'PATCH_PACKAGE';
  if (/^config\/AUDIT(?:\d|[A-Z_])/i.test(rel)) return 'PATCH_PACKAGE';
  if (/^(?:TENNIS|CALCIO)_PATCH_\d+/i.test(parts[0] || '')) return 'PATCH_PACKAGE';
  if (/^\.(?:tennis|calcio)_patch.*_state\.json$/i.test(path.basename(rel))) return 'PATCH_STATE';
  if (/^\.env(?:\..*)?$/i.test(path.basename(rel)) && !/\.env\.example$/i.test(path.basename(rel))) return 'SECRET_ENV';
  if (RELEASE_EXCLUDED_FILE_NAMES.has(path.basename(rel))) return 'RUNTIME_STATE';
  if (/\.(?:zip|7z|rar|gz|tar)$/i.test(rel)) return 'ARCHIVE';
  if (/\.(?:exe|dll|node|msi)$/i.test(rel)) return 'EXECUTABLE_BINARY';
  if (/\.(?:log|tmp|bak)$/i.test(rel)) return 'LOG_OR_TEMP';
  if (/\.db(?:-wal|-shm|-journal)?$/i.test(rel) || /\.sqlite3?$/i.test(rel)) return 'DATABASE';
  if (/^backend\/logs\//i.test(rel)) return 'RUNTIME_LOG';
  if (stat && stat.isSymbolicLink && stat.isSymbolicLink()) return 'SYMLINK';
  return null;
}
function walkProject(root, options = {}) {
  const files = [];
  const exclusions = [];
  const resolvedRoot = path.resolve(root);
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = normalize(path.relative(resolvedRoot, full));
      const reason = classifyExclusion(rel, entry);
      if (reason) {
        exclusions.push({ path: rel, reason, directory: entry.isDirectory() });
        if (entry.isDirectory()) continue;
        if (options.includeExcludedForAudit !== true) continue;
      }
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push({ full, relative: rel, sizeBytes: entry.size || fs.statSync(full).size });
    }
  }
  walk(resolvedRoot);
  return { files, exclusions };
}
function scanText(text, relativePath = '') {
  const findings = [];
  const source = String(text || '');
  for (const pattern of SECRET_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match;
    while ((match = regex.exec(source))) {
      const value = match[0];
      if (isPlaceholder(value)) continue;
      findings.push({
        code: pattern.code,
        severity: pattern.severity,
        path: normalize(relativePath),
        index: match.index,
        fingerprint: sha256Buffer(Buffer.from(value)).slice(0, 16),
        exposedValue: false
      });
      if (match.index === regex.lastIndex) regex.lastIndex += 1;
    }
  }
  return findings;
}
function scanFile(file, root) {
  if (!isTextFile(file)) return [];
  const rel = normalize(path.relative(root, file));
  const text = fs.readFileSync(file, 'utf8');
  return scanText(text, rel);
}
function scanProject(root, options = {}) {
  const resolvedRoot = path.resolve(root);
  const traversal = walkProject(resolvedRoot, { includeExcludedForAudit: false });
  const findings = [];
  const fixtureFindings = [];
  let scannedFiles = 0;
  let scannedBytes = 0;
  for (const file of traversal.files) {
    if (!isTextFile(file.full)) continue;
    scannedFiles += 1;
    scannedBytes += file.sizeBytes;
    const fileFindings = scanFile(file.full, resolvedRoot);
    if (KNOWN_TEST_FIXTURES.includes(file.relative)) fixtureFindings.push(...fileFindings.map(item => ({ ...item, allowedFixture: true })));
    else findings.push(...fileFindings);
  }
  const critical = findings.filter(item => item.severity === 'CRITICAL');
  const persistedTelegramConfig = path.join(resolvedRoot, 'backend', 'telegram.config.json');
  let telegramConfigTokenField = false;
  if (fs.existsSync(persistedTelegramConfig)) {
    try {
      const config = JSON.parse(fs.readFileSync(persistedTelegramConfig, 'utf8'));
      telegramConfigTokenField = Boolean(config.token && !isPlaceholder(config.token));
    } catch (_) {
      telegramConfigTokenField = true;
    }
  }
  const historicalBackupRisk = fs.existsSync(path.join(resolvedRoot, 'backend', '.betting_patch_backups'));
  return {
    version: TENNIS_RELEASE_SECURITY_VERSION,
    healthHardeningRevision: AUDIT16D_R3_T1_HEALTH_HARDENING_REVISION,
    success: critical.length === 0 && telegramConfigTokenField === false,
    healthy: critical.length === 0 && telegramConfigTokenField === false,
    status: critical.length || telegramConfigTokenField ? 'BLOCKED_SECRET_PERSISTENCE' : 'READY',
    readOnly: true,
    scannedFiles,
    scannedBytes,
    findings,
    fixtureFindings,
    persistedTelegramConfigToken: telegramConfigTokenField,
    allowedSecretStorage: [...ALLOWED_SECRET_STORAGE],
    historicalBackupRisk,
    backupPolicy: historicalBackupRisk ? 'ROTATE_EXPOSED_CREDENTIALS_AND_EXCLUDE_BACKUPS_FROM_RELEASE' : 'NO_BACKUP_DIRECTORY_PRESENT',
    secretsExposedInReport: false
  };
}
function buildReleasePlan(root, options = {}) {
  const resolvedRoot = path.resolve(root);
  const maxBytes = Number(options.maxBytes || DEFAULT_MAX_RELEASE_BYTES);
  const traversal = walkProject(resolvedRoot);
  const included = traversal.files
    .filter(file => !classifyExclusion(file.relative))
    .map(file => ({ path: file.relative, sizeBytes: file.sizeBytes, sha256: options.withHashes === false ? null : sha256File(file.full) }));
  const totalBytes = included.reduce((sum, file) => sum + file.sizeBytes, 0);
  const excludedByReason = {};
  for (const item of traversal.exclusions) excludedByReason[item.reason] = (excludedByReason[item.reason] || 0) + 1;
  return {
    version: TENNIS_RELEASE_SECURITY_VERSION,
    healthHardeningRevision: AUDIT16D_R3_T1_HEALTH_HARDENING_REVISION,
    root: resolvedRoot,
    generatedAt: new Date().toISOString(),
    included,
    excluded: traversal.exclusions,
    summary: {
      includedFiles: included.length,
      excludedEntries: traversal.exclusions.length,
      totalBytes,
      totalMiB: Number((totalBytes / 1024 / 1024).toFixed(2)),
      maxBytes,
      maxMiB: Number((maxBytes / 1024 / 1024).toFixed(2)),
      withinSizeGuard: totalBytes <= maxBytes,
      excludedByReason
    }
  };
}
function buildSecurityHealth(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '..'));
  const scan = scanProject(projectRoot);
  const plan = buildReleasePlan(projectRoot, { withHashes: false, maxBytes: options.maxBytes });
  const envTokenConfigured = Boolean(String(process.env.TELEGRAM_BOT_TOKEN || '').trim());
  const rotationRequired = ['1', 'true', 'yes', 'on'].includes(String(process.env.TELEGRAM_TOKEN_ROTATION_REQUIRED || '').trim().toLowerCase());
  const healthy = scan.healthy && plan.summary.withinSizeGuard;
  return {
    success: healthy,
    healthy,
    status: healthy ? (rotationRequired ? 'READY_WITH_CREDENTIAL_ROTATION_REQUIRED' : 'READY') : 'BLOCKED',
    version: TENNIS_RELEASE_SECURITY_VERSION,
    healthHardeningRevision: AUDIT16D_R3_T1_HEALTH_HARDENING_REVISION,
    readOnly: true,
    secretPersistence: {
      status: scan.status,
      findingCount: scan.findings.length,
      persistedTelegramConfigToken: scan.persistedTelegramConfigToken,
      secretsExposedInResponse: false
    },
    telegramCredential: {
      sourcePolicy: 'ENVIRONMENT_ONLY',
      configured: envTokenConfigured,
      rotationRequired,
      valueExposed: false
    },
    releasePolicy: {
      includedFiles: plan.summary.includedFiles,
      projectedMiB: plan.summary.totalMiB,
      maxMiB: plan.summary.maxMiB,
      withinSizeGuard: plan.summary.withinSizeGuard,
      backupsExcluded: true,
      databasesExcluded: true,
      executablesExcluded: true,
      archivesExcluded: true,
      environmentFilesExcluded: true,
      observedExcludedByReason: plan.summary.excludedByReason
    },
    historicalBackupRisk: scan.historicalBackupRisk,
    note: rotationRequired
      ? 'Il token Telegram precedentemente persistito deve essere revocato e sostituito. Il programma non invia finché TELEGRAM_TOKEN_ROTATION_REQUIRED non viene impostato a 0.'
      : 'Nessuna credenziale è persistita sulle superfici distribuibili certificate.'
  };
}

module.exports = {
  TENNIS_RELEASE_SECURITY_VERSION,
  AUDIT16D_R3_T1_HEALTH_HARDENING_REVISION,
  DEFAULT_MAX_RELEASE_BYTES,
  SECRET_PATTERNS,
  ALLOWED_SECRET_STORAGE,
  KNOWN_TEST_FIXTURES,
  normalize,
  classifyExclusion,
  walkProject,
  scanText,
  scanFile,
  scanProject,
  isTextFile,
  buildReleasePlan,
  buildSecurityHealth,
  sha256File
};
