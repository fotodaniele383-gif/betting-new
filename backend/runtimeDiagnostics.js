'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RUNTIME_DIAGNOSTICS_VERSION = 'RUNTIME_DIAGNOSTICS_V2_PATCH26FD';
const RUNTIME_DIAGNOSTICS_COMPAT_VERSION = 'RUNTIME_DIAGNOSTICS_V1_PATCH5';
const DEFAULT_TAIL_BYTES = 512 * 1024;
const DEFAULT_LOG_DIR = path.resolve(__dirname, 'logs');
const DEFAULT_LOG_FILE = path.join(DEFAULT_LOG_DIR, 'runtime-diagnostics.jsonl');
const MAX_STRING_LENGTH = 1200;
const SENSITIVE_KEY_PATTERN = /(api[_-]?key|token|secret|password|authorization|cookie|session|odds_api_keys?)/i;
let processHandlersInstalled = false;

function ensureLogDir(filePath = DEFAULT_LOG_FILE) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function redactString(value) {
  const text = String(value == null ? '' : value);
  return text
    .replace(/(apiKey=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[REDACTED]')
    .slice(0, MAX_STRING_LENGTH);
}

function sanitize(value, depth = 0, seen = new WeakSet()) {
  if (value == null) return value;
  if (depth > 5) return '[MAX_DEPTH]';
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      code: value.code || null,
      stack: redactString(value.stack || '')
    };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitize(item, depth + 1, seen));
  if (typeof value === 'object') {
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 80)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : sanitize(item, depth + 1, seen);
    }
    return out;
  }
  return redactString(value);
}

function createOperationId(prefix = 'OP') {
  const safePrefix = String(prefix || 'OP').toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 24) || 'OP';
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${safePrefix}_${stamp}_${crypto.randomBytes(4).toString('hex')}`;
}

function writeDiagnostic(entry, options = {}) {
  const logFile = options.logFile || process.env.RUNTIME_DIAGNOSTICS_FILE || DEFAULT_LOG_FILE;
  const payload = {
    timestamp: new Date().toISOString(),
    version: RUNTIME_DIAGNOSTICS_VERSION,
    level: String(entry.level || 'INFO').toUpperCase(),
    component: String(entry.component || 'UNKNOWN'),
    operation: String(entry.operation || 'UNSCOPED'),
    operationId: entry.operationId || null,
    phase: entry.phase || null,
    event: entry.event || null,
    message: redactString(entry.message || ''),
    context: sanitize(entry.context || {}),
    error: entry.error ? sanitize(entry.error) : null
  };
  try {
    ensureLogDir(logFile);
    fs.appendFileSync(logFile, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch (writeError) {
    console.error('❌ [RUNTIME DIAGNOSTICS] Impossibile scrivere il file log:', writeError.message);
  }
  const tag = `[${payload.component}] [${payload.operationId || 'NO_OP'}]${payload.phase ? ` [${payload.phase}]` : ''}`;
  const line = `${tag} ${payload.message}`;
  if (payload.level === 'ERROR' || payload.level === 'FATAL') console.error(`❌ ${line}`);
  else if (payload.level === 'WARN') console.warn(`⚠️ ${line}`);
  else console.log(`ℹ️ ${line}`);
  return payload;
}

function startOperation(operation, context = {}, options = {}) {
  const operationId = options.operationId || createOperationId(operation);
  const component = options.component || 'TENNIS';
  const startedAt = Date.now();
  writeDiagnostic({ level: 'INFO', component, operation, operationId, phase: 'START', event: 'OPERATION_START', message: `Avvio operazione ${operation}.`, context }, options);
  return {
    operation,
    operationId,
    component,
    startedAt,
    phase(phase, message, phaseContext = {}, level = 'INFO') {
      return writeDiagnostic({ level, component, operation, operationId, phase, event: 'PHASE', message, context: phaseContext }, options);
    },
    warn(phase, message, phaseContext = {}) {
      return writeDiagnostic({ level: 'WARN', component, operation, operationId, phase, event: 'WARNING', message, context: phaseContext }, options);
    },
    error(phase, error, phaseContext = {}) {
      return writeDiagnostic({ level: 'ERROR', component, operation, operationId, phase, event: 'ERROR', message: error?.message || String(error), context: phaseContext, error }, options);
    },
    complete(result = {}) {
      return writeDiagnostic({
        level: result.success === false ? 'WARN' : 'INFO',
        component,
        operation,
        operationId,
        phase: 'COMPLETE',
        event: 'OPERATION_COMPLETE',
        message: result.message || `Operazione ${operation} completata.`,
        context: { ...result, durationMs: Date.now() - startedAt }
      }, options);
    }
  };
}

function captureError({ component = 'SERVER', operation = 'UNSCOPED', operationId = null, phase = 'ERROR', error, context = {} } = {}, options = {}) {
  return writeDiagnostic({ level: 'ERROR', component, operation, operationId, phase, event: 'CAPTURED_ERROR', message: error?.message || String(error || 'Errore non specificato'), context, error }, options);
}

function normalizeDiagnosticScope(value = 'ALL') {
  const scope = String(value || 'ALL').trim().toUpperCase();
  if (['CALCIO', 'FOOTBALL'].includes(scope)) return 'CALCIO';
  if (scope === 'TENNIS') return 'TENNIS';
  return 'ALL';
}

function inferDiagnosticScope(entry = {}) {
  const searchable = [
    entry.component,
    entry.operation,
    entry.phase,
    entry.event,
    entry.message,
    entry.context?.sport,
    entry.context?.league,
    entry.context?.batchId
  ].map(value => String(value || '').toUpperCase()).join(' ');
  if (/CALCIO|FOOTBALL|SERIE_A|SERIE B|BATCH_PORTFOLIO|DEEPSCAN_CALCIO/.test(searchable)) return 'CALCIO';
  if (/TENNIS|ATP|WTA/.test(searchable)) return 'TENNIS';
  return 'GENERAL';
}

function readTailText(filePath, maxBytes = DEFAULT_TAIL_BYTES) {
  const stat = fs.statSync(filePath);
  const bytes = Math.max(4096, Math.min(4 * 1024 * 1024, Number(maxBytes) || DEFAULT_TAIL_BYTES));
  const start = Math.max(0, stat.size - bytes);
  const length = stat.size - start;
  if (length <= 0) return '';
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    let text = buffer.toString('utf8');
    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
    }
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

function readRecentDiagnostics(limit = 20, options = {}) {
  const logFile = options.logFile || process.env.RUNTIME_DIAGNOSTICS_FILE || DEFAULT_LOG_FILE;
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 20));
  const scope = normalizeDiagnosticScope(options.scope || 'ALL');
  const requestedLevels = new Set((Array.isArray(options.levels) ? options.levels : []).map(value => String(value || '').toUpperCase()).filter(Boolean));
  const requestedComponents = new Set((Array.isArray(options.components) ? options.components : []).map(value => String(value || '').toUpperCase()).filter(Boolean));
  if (!fs.existsSync(logFile)) return [];
  try {
    const lines = readTailText(logFile, options.maxBytes).split(/\r?\n/).filter(Boolean);
    const parsed = lines.map(line => {
      try {
        const entry = JSON.parse(line);
        return { ...entry, scope: inferDiagnosticScope(entry) };
      } catch (_) {
        return { level: 'ERROR', component: 'RUNTIME_DIAGNOSTICS', scope: 'GENERAL', message: 'Riga diagnostica non parseabile', raw: redactString(line) };
      }
    });
    return parsed.filter(entry => {
      if (scope !== 'ALL' && entry.scope !== scope) return false;
      if (requestedLevels.size && !requestedLevels.has(String(entry.level || '').toUpperCase())) return false;
      if (requestedComponents.size && !requestedComponents.has(String(entry.component || '').toUpperCase())) return false;
      return true;
    }).slice(-safeLimit).reverse();
  } catch (error) {
    return [{ level: 'ERROR', component: 'RUNTIME_DIAGNOSTICS', scope: 'GENERAL', message: `Lettura log fallita: ${error.message}` }];
  }
}

function buildDiagnosticsSummary(entries = []) {
  const summary = { total: 0, byLevel: {}, byScope: {}, byComponent: {}, latestTimestamp: null };
  for (const entry of Array.isArray(entries) ? entries : []) {
    summary.total += 1;
    const level = String(entry.level || 'UNKNOWN').toUpperCase();
    const scope = String(entry.scope || inferDiagnosticScope(entry));
    const component = String(entry.component || 'UNKNOWN');
    summary.byLevel[level] = (summary.byLevel[level] || 0) + 1;
    summary.byScope[scope] = (summary.byScope[scope] || 0) + 1;
    summary.byComponent[component] = (summary.byComponent[component] || 0) + 1;
    if (!summary.latestTimestamp || String(entry.timestamp || '') > summary.latestTimestamp) summary.latestTimestamp = entry.timestamp || summary.latestTimestamp;
  }
  return summary;
}

function installProcessDiagnostics(options = {}) {
  if (processHandlersInstalled) return false;
  processHandlersInstalled = true;
  const component = options.component || 'SERVER_CORE';
  process.on('unhandledRejection', (reason) => {
    captureError({ component, operation: 'PROCESS', phase: 'UNHANDLED_REJECTION', error: reason instanceof Error ? reason : new Error(String(reason)), context: { fatal: false } });
  });
  process.on('uncaughtException', (error) => {
    captureError({ component, operation: 'PROCESS', phase: 'UNCAUGHT_EXCEPTION', error, context: { fatal: true, exitCode: 1 } });
    process.exitCode = 1;
    if (String(process.env.RUNTIME_DIAGNOSTICS_EXIT_ON_UNCAUGHT || '1') !== '0') {
      setTimeout(() => process.exit(1), 250).unref();
    }
  });
  return true;
}

module.exports = {
  RUNTIME_DIAGNOSTICS_VERSION,
  RUNTIME_DIAGNOSTICS_COMPAT_VERSION,
  DEFAULT_LOG_FILE,
  DEFAULT_TAIL_BYTES,
  sanitize,
  createOperationId,
  writeDiagnostic,
  startOperation,
  captureError,
  normalizeDiagnosticScope,
  inferDiagnosticScope,
  readTailText,
  readRecentDiagnostics,
  buildDiagnosticsSummary,
  installProcessDiagnostics
};
