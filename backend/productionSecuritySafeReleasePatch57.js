'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const legacyReleaseSecurity = require('./tennisReleaseSecurity');

const VERSION = 'PRODUCTION_SECURITY_SAFE_RELEASE_V1_PATCH57';
const POLICY_VERSION = 'PRODUCTION_SECURITY_POLICY_V1_PATCH57';
const NETWORK_POLICY_VERSION = 'PRODUCTION_NETWORK_FAIL_CLOSED_V1_PATCH57';
const RELEASE_POLICY_VERSION = 'STRICT_RELEASE_ALLOWLIST_V1_PATCH57';
const MODE = 'LOCAL_FIRST_REMOTE_EXPLICIT_TOKEN_GATED_FAIL_CLOSED';
const DEFAULT_BIND_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const DEFAULT_MAX_RELEASE_BYTES = 150 * 1024 * 1024;
const MIN_REMOTE_TOKEN_LENGTH = 32;
const RATE_WINDOW_MS = 60 * 1000;

const DEFAULT_LIMITS = Object.freeze({
  apiPerMinute: 300,
  mutationPerMinute: 60,
  sensitivePerMinute: 12
});

const ALLOWED_TOP_LEVEL_DIRS = Object.freeze(new Set([
  'backend', 'public', 'tools', 'config', 'data', 'Dati statistici Giocatori web_file'
]));
const ALLOWED_ROOT_FILES = Object.freeze(new Set([
  'package.json', 'package-lock.json', '.env.example', '.gitignore', '.releaseignore',
  'Avvia_Betting.bat', 'avvia_sistema.ps1', 'RUN_PORTABILITY_AUDIT.cmd', 'style.css'
]));
const SENSITIVE_PATH_PATTERNS = Object.freeze([
  /^\/api\/bet\/[^/]+\/force(?:\/|$)/i,
  /^\/api\/bets\/bulk-action(?:\/|$)/i,
  /^\/api\/bankroll\/set(?:\/|$)/i,
  /^\/api\/background\/set(?:\/|$)/i,
  /^\/api\/setup\/(?:tennis|calcio)-automation(?:\/|$)/i,
  /^\/api\/calcio\/optimize\/apply(?:\/|$)/i,
  /^\/api\/calcio\/football-data-refresh(?:\/|$)/i,
  /^\/api\/calcio\/source-intelligence\/probe(?:\/|$)/i,
  /^\/api\/calcio\/portfolio\/finalize-batch(?:\/|$)/i,
  /^\/api\/telegram\/(?:config|send|test|reset-state)(?:\/|$)/i,
  /^\/api\/tennis\/(?:player-data-refresh|player-data-provider-probe|player-data-source-probe|wta-freshness-recovery-refresh|patch43-wta-source-refresh|patch52-wta-recovery-refresh|historical-validation-performance-refresh|statistical-challenger-refresh|statistical-engine-audit-refresh)(?:\/|$)/i
]);

const rateBuckets = new Map();

function text(value) { return String(value == null ? '' : value).trim(); }
function bool(value, fallback = false) {
  const raw = text(value).toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}
function int(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}
function normalizeHost(value) {
  let host = text(value).toLowerCase();
  if (!host) return '';
  if (host.startsWith('[') && host.includes(']')) host = host.slice(1, host.indexOf(']'));
  if (host.includes(':') && !host.includes('::')) host = host.split(':')[0];
  return host;
}
function isLoopbackHost(value) {
  const host = normalizeHost(value);
  return host === '127.0.0.1' || host === '::1' || host === 'localhost' || host === '::ffff:127.0.0.1' || host.endsWith('127.0.0.1');
}
function isPlaceholderSecret(value) {
  const raw = text(value);
  const up = raw.toUpperCase();
  return !raw || up.includes('INSERISCI_QUI') || up.includes('PLACEHOLDER') || up.includes('EXAMPLE') || up.includes('CHANGEME') || up.includes('REDACTED');
}
function tokenIsStrong(value) {
  const raw = text(value);
  return raw.length >= MIN_REMOTE_TOKEN_LENGTH && !isPlaceholderSecret(raw);
}
function parseOrigins(raw, port = DEFAULT_PORT) {
  const defaults = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    'http://127.0.0.1',
    'http://localhost'
  ]);
  for (const item of text(raw).split(',').map(x => x.trim()).filter(Boolean)) {
    try {
      const url = new URL(item);
      if (url.protocol === 'http:' || url.protocol === 'https:') defaults.add(url.origin);
    } catch (_) {}
  }
  return [...defaults];
}
function resolveRuntimeConfig(options = {}) {
  const env = options.env || process.env;
  const port = int(options.port ?? env.PORT, DEFAULT_PORT, 1, 65535);
  const bindHost = text(options.bindHost ?? env.BETTINGAPP_BIND_HOST) || DEFAULT_BIND_HOST;
  const remoteAccessEnabled = bool(options.remoteAccessEnabled ?? env.BETTINGAPP_REMOTE_ACCESS_ENABLED, false);
  const allowNonLoopbackBind = bool(options.allowNonLoopbackBind ?? env.BETTINGAPP_ALLOW_NON_LOOPBACK_BIND, false);
  const remoteToken = text(options.remoteToken ?? env.BETTINGAPP_REMOTE_ACCESS_TOKEN ?? env.BETTINGAPP_API_TOKEN);
  const remoteTokenConfigured = tokenIsStrong(remoteToken);
  const allowedOrigins = parseOrigins(options.allowedOrigins ?? env.BETTINGAPP_ALLOWED_ORIGINS, port);
  const limits = {
    apiPerMinute: int(options.apiPerMinute ?? env.BETTINGAPP_RATE_LIMIT_API_PER_MINUTE, DEFAULT_LIMITS.apiPerMinute, 30, 10000),
    mutationPerMinute: int(options.mutationPerMinute ?? env.BETTINGAPP_RATE_LIMIT_MUTATION_PER_MINUTE, DEFAULT_LIMITS.mutationPerMinute, 5, 1000),
    sensitivePerMinute: int(options.sensitivePerMinute ?? env.BETTINGAPP_RATE_LIMIT_SENSITIVE_PER_MINUTE, DEFAULT_LIMITS.sensitivePerMinute, 2, 300)
  };
  const loopbackBind = isLoopbackHost(bindHost);
  const bindAllowed = loopbackBind || (remoteAccessEnabled && allowNonLoopbackBind && remoteTokenConfigured);
  const remoteModeReady = !remoteAccessEnabled || remoteTokenConfigured;
  const ready = bindAllowed && remoteModeReady;
  return {
    version: VERSION,
    policyVersion: POLICY_VERSION,
    networkPolicyVersion: NETWORK_POLICY_VERSION,
    mode: MODE,
    port,
    bindHost,
    loopbackBind,
    allowNonLoopbackBind,
    remoteAccessEnabled,
    remoteTokenConfigured,
    remoteTokenLengthOk: remoteTokenConfigured,
    allowedOrigins,
    limits,
    ready,
    status: ready ? (remoteAccessEnabled ? 'SECURE_REMOTE_TOKEN_GATED' : 'LOCAL_ONLY_SECURE') : 'BLOCKED_UNSAFE_NETWORK_CONFIGURATION',
    _remoteToken: remoteToken
  };
}
function safeRuntimeConfig(config = resolveRuntimeConfig()) {
  const { _remoteToken, ...safe } = config;
  return { ...safe, remoteTokenExposed: false };
}
function hostFromHeader(value) {
  const raw = text(value);
  if (!raw) return '';
  try { return new URL(`http://${raw}`).hostname.toLowerCase(); } catch (_) { return normalizeHost(raw); }
}
function requestNetworkContext(req = {}) {
  const headers = req.headers || {};
  const socketAddress = text(req.socket?.remoteAddress || req.connection?.remoteAddress || req.ip).toLowerCase();
  const hostHeader = text(headers.host);
  const host = hostFromHeader(hostHeader);
  const forwardedFor = text(headers['x-forwarded-for']).split(',')[0].trim();
  const forwardedHost = text(headers['x-forwarded-host']).split(',')[0].trim();
  const forwardedProto = text(headers['x-forwarded-proto']).split(',')[0].trim().toLowerCase();
  const proxied = Boolean(forwardedFor || forwardedHost || forwardedProto);
  const socketLoopback = isLoopbackHost(socketAddress);
  const hostLoopback = !host || isLoopbackHost(host);
  const external = proxied || !socketLoopback || !hostLoopback;
  return { socketAddress, socketLoopback, hostHeader, host, hostLoopback, forwardedFor, forwardedHost, forwardedProto, proxied, external };
}
function extractAccessToken(req = {}) {
  const headers = req.headers || {};
  const direct = text(headers['x-bettingapp-token']);
  if (direct) return direct;
  const auth = text(headers.authorization);
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? text(match[1]) : '';
}
function safeEqual(a, b) {
  const aa = Buffer.from(text(a));
  const bb = Buffer.from(text(b));
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}
function accessTokenValid(req, config) {
  return config.remoteTokenConfigured && safeEqual(extractAccessToken(req), config._remoteToken);
}
function isApiPath(req = {}) { return text(req.path || req.originalUrl || req.url).split('?')[0].startsWith('/api/'); }
function isMutationMethod(method) { return !['GET', 'HEAD', 'OPTIONS'].includes(text(method).toUpperCase()); }
function isSensitivePath(req = {}) {
  const p = text(req.path || req.originalUrl || req.url).split('?')[0];
  return SENSITIVE_PATH_PATTERNS.some(rx => rx.test(p));
}
function sameOrigin(origin, req) {
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return u.host.toLowerCase() === text(req.headers?.host).toLowerCase();
  } catch (_) { return false; }
}
function originAllowed(origin, req, config) {
  if (!origin) return true;
  let normalized;
  try { normalized = new URL(origin).origin; } catch (_) { return false; }
  if (config.allowedOrigins.includes(normalized)) return true;
  if (sameOrigin(normalized, req)) {
    const context = requestNetworkContext(req);
    return !context.external || config.remoteAccessEnabled;
  }
  return false;
}
function securityHeadersMiddleware(config = resolveRuntimeConfig()) {
  return function patch57SecurityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    if (isApiPath(req)) res.setHeader('Cache-Control', 'no-store');
    const ctx = requestNetworkContext(req);
    if (ctx.forwardedProto === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-BettingApp-Security-Version', VERSION);
    return next();
  };
}
function corsMiddleware(config = resolveRuntimeConfig()) {
  return function patch57Cors(req, res, next) {
    const origin = text(req.headers?.origin);
    if (origin && !originAllowed(origin, req, config)) {
      return res.status(403).json({ success: false, code: 'PATCH57_ORIGIN_BLOCKED', securityVersion: VERSION });
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'false');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-BettingApp-Token, X-Requested-With');
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (text(req.method).toUpperCase() === 'OPTIONS') return res.status(204).end();
    return next();
  };
}
function accessControlMiddleware(config = resolveRuntimeConfig()) {
  return function patch57AccessControl(req, res, next) {
    if (!isApiPath(req)) return next();
    const context = requestNetworkContext(req);
    if (!context.external) return next();
    if (!config.remoteAccessEnabled) {
      return res.status(403).json({ success: false, code: 'PATCH57_REMOTE_ACCESS_DISABLED', securityVersion: VERSION });
    }
    if (!config.remoteTokenConfigured) {
      return res.status(503).json({ success: false, code: 'PATCH57_REMOTE_TOKEN_NOT_CONFIGURED', securityVersion: VERSION });
    }
    if (!accessTokenValid(req, config)) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="BettingApp"');
      return res.status(401).json({ success: false, code: 'PATCH57_REMOTE_AUTH_REQUIRED', securityVersion: VERSION });
    }
    return next();
  };
}
function clientKey(req) {
  const ctx = requestNetworkContext(req);
  return `${ctx.socketAddress || 'unknown'}|${ctx.forwardedFor || '-'}|${ctx.host || '-'}`;
}
function rateClass(req) {
  if (isSensitivePath(req)) return 'sensitive';
  if (isMutationMethod(req.method)) return 'mutation';
  return 'api';
}
function rateLimitMiddleware(config = resolveRuntimeConfig(), options = {}) {
  const buckets = options.buckets || rateBuckets;
  const windowMs = int(options.windowMs, RATE_WINDOW_MS, 1000, 60 * 60 * 1000);
  return function patch57RateLimit(req, res, next) {
    if (!isApiPath(req)) return next();
    const cls = rateClass(req);
    const limit = cls === 'sensitive' ? config.limits.sensitivePerMinute : cls === 'mutation' ? config.limits.mutationPerMinute : config.limits.apiPerMinute;
    const now = Number(options.now ? options.now() : Date.now());
    const key = `${clientKey(req)}|${cls}`;
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) bucket = { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    buckets.set(key, bucket);
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > limit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ success: false, code: 'PATCH57_RATE_LIMITED', bucket: cls, securityVersion: VERSION });
    }
    return next();
  };
}
function installExpressSecurity(app, options = {}) {
  const config = resolveRuntimeConfig(options);
  if (!config.ready) {
    const err = new Error(`PATCH57_UNSAFE_RUNTIME_CONFIGURATION:${JSON.stringify(safeRuntimeConfig(config))}`);
    err.code = 'PATCH57_UNSAFE_RUNTIME_CONFIGURATION';
    throw err;
  }
  app.disable?.('x-powered-by');
  app.use(securityHeadersMiddleware(config));
  app.use(corsMiddleware(config));
  app.use(rateLimitMiddleware(config));
  app.use(accessControlMiddleware(config));
  return config;
}
function allowlistedPath(relativePath = '') {
  const rel = legacyReleaseSecurity.normalize(relativePath);
  if (!rel || rel.includes('..')) return false;
  const parts = rel.split('/').filter(Boolean);
  if (parts.length === 1) return ALLOWED_ROOT_FILES.has(parts[0]);
  return ALLOWED_TOP_LEVEL_DIRS.has(parts[0]);
}
function buildStrictReleasePlan(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const maxBytes = Number(options.maxBytes || DEFAULT_MAX_RELEASE_BYTES);
  const traversal = legacyReleaseSecurity.walkProject(root, { includeExcludedForAudit: false });
  const included = [];
  const notAllowlisted = [];
  for (const file of traversal.files) {
    if (!allowlistedPath(file.relative)) { notAllowlisted.push({ path: file.relative, reason: 'NOT_ALLOWLISTED' }); continue; }
    included.push({
      path: file.relative,
      sizeBytes: file.sizeBytes,
      sha256: options.withHashes === false ? null : legacyReleaseSecurity.sha256File(file.full)
    });
  }
  const totalBytes = included.reduce((sum, item) => sum + item.sizeBytes, 0);
  const excluded = [...traversal.exclusions, ...notAllowlisted];
  const excludedByReason = {};
  for (const item of excluded) excludedByReason[item.reason] = (excludedByReason[item.reason] || 0) + 1;
  return {
    version: RELEASE_POLICY_VERSION,
    projectRoot: root,
    included,
    excluded,
    summary: {
      includedFiles: included.length,
      excludedEntries: excluded.length,
      totalBytes,
      totalMiB: Number((totalBytes / 1024 / 1024).toFixed(2)),
      maxBytes,
      maxMiB: Number((maxBytes / 1024 / 1024).toFixed(2)),
      withinSizeGuard: totalBytes <= maxBytes,
      excludedByReason,
      strictAllowlist: true
    }
  };
}
function scanStrictReleaseSurface(projectRoot, plan = null) {
  const root = path.resolve(projectRoot);
  const releasePlan = plan || buildStrictReleasePlan(root, { withHashes: false });
  const findings = [];
  let scannedFiles = 0;
  for (const item of releasePlan.included) {
    const full = path.join(root, item.path);
    if (!legacyReleaseSecurity.isTextFile(full)) continue;
    scannedFiles += 1;
    const rows = legacyReleaseSecurity.scanFile(full, root);
    if (legacyReleaseSecurity.KNOWN_TEST_FIXTURES.includes(item.path)) continue;
    findings.push(...rows);
  }
  return { success: findings.length === 0, healthy: findings.length === 0, findings, scannedFiles, secretsExposedInReport: false };
}
function sourceRiskSummary(projectRoot) {
  const root = path.resolve(projectRoot);
  const exists = rel => fs.existsSync(path.join(root, rel));
  return {
    historicalPatchBackupsPresent: exists('backend/.betting_patch_backups'),
    legacyBackupDirectoryPresent: exists('backup') || exists('backend/backup') || exists('backend/backups'),
    localEnvironmentFilePresent: exists('.env') || exists('backend/.env'),
    ngrokBinaryPresent: exists('backend/ngrok.exe'),
    ngrokRecoveryMaterialPresent: exists('backup/ngrok_recovery_codes.txt'),
    note: 'Queste superfici sono sorgente/runtime e devono restare escluse dalla release certificata.'
  };
}
function buildProductionSecurityHealth(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '..'));
  const config = resolveRuntimeConfig(options);
  const plan = buildStrictReleasePlan(projectRoot, { withHashes: false, maxBytes: options.maxBytes });
  const scan = scanStrictReleaseSurface(projectRoot, plan);
  const releaseReady = plan.summary.withinSizeGuard && plan.summary.strictAllowlist && scan.healthy;
  const securityReady = config.ready && releaseReady;
  return {
    success: securityReady,
    healthy: securityReady,
    securityReady,
    status: securityReady ? 'PRODUCTION_SECURITY_READY' : 'PRODUCTION_SECURITY_BLOCKED',
    version: VERSION,
    policyVersion: POLICY_VERSION,
    networkPolicyVersion: NETWORK_POLICY_VERSION,
    releasePolicyVersion: RELEASE_POLICY_VERSION,
    mode: MODE,
    runtime: safeRuntimeConfig(config),
    protections: {
      defaultLoopbackBind: true,
      wildcardCorsDisabled: true,
      exactOriginCors: true,
      remoteApiTokenRequired: true,
      forwardedTunnelDetected: true,
      securityHeaders: true,
      cspEnabled: true,
      apiRateLimit: true,
      mutationRateLimit: true,
      sensitiveRateLimit: true,
      xPoweredByDisabled: true,
      trustProxyImplicitlyDisabled: true
    },
    release: {
      ready: releaseReady,
      strictAllowlist: true,
      includedFiles: plan.summary.includedFiles,
      excludedEntries: plan.excluded.length,
      projectedMiB: plan.summary.totalMiB,
      maxMiB: plan.summary.maxMiB,
      withinSizeGuard: plan.summary.withinSizeGuard,
      excludedByReason: plan.summary.excludedByReason,
      secretFindings: scan.findings.length,
      secretValuesExposed: false
    },
    sourceRisk: sourceRiskSummary(projectRoot),
    authority: {
      productionSecurityClassificationOnly: true,
      realMoneyStakeAuthority: false,
      probabilityMutation: false,
      paperStakeMutation: false,
      settlementMutation: false,
      schedulerMutation: false,
      automaticProductionActivation: false
    }
  };
}
function portfolioSecurityReady(options = {}) {
  const config = resolveRuntimeConfig(options);
  return config.ready === true;
}
function clearRateLimitState() { rateBuckets.clear(); }

module.exports = {
  VERSION, POLICY_VERSION, NETWORK_POLICY_VERSION, RELEASE_POLICY_VERSION, MODE,
  DEFAULT_BIND_HOST, DEFAULT_PORT, DEFAULT_MAX_RELEASE_BYTES, MIN_REMOTE_TOKEN_LENGTH,
  DEFAULT_LIMITS, ALLOWED_TOP_LEVEL_DIRS, ALLOWED_ROOT_FILES, SENSITIVE_PATH_PATTERNS,
  bool, isLoopbackHost, tokenIsStrong, parseOrigins, resolveRuntimeConfig, safeRuntimeConfig,
  requestNetworkContext, extractAccessToken, accessTokenValid, isApiPath, isMutationMethod,
  isSensitivePath, originAllowed, securityHeadersMiddleware, corsMiddleware, accessControlMiddleware,
  rateLimitMiddleware, installExpressSecurity, allowlistedPath, buildStrictReleasePlan,
  scanStrictReleaseSurface, sourceRiskSummary, buildProductionSecurityHealth, portfolioSecurityReady,
  clearRateLimitState
};
