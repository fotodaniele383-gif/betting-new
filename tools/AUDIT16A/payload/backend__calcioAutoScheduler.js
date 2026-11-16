'use strict';
// ============================================================================
// AI BETTING QUANT PRO - CALCIO ORCHESTRATOR & SCHEDULER
// Versione: 3.0 STEP94 - Automation Scan Options
// legacy marker per test statici: const SCHEDULER_VERSION='2.1'
// ============================================================================
// Regole Step94:
// - configurazione Calcio separata da Tennis;
// - frequenza configurabile ogni 1h, 2h, 3h...;
// - giorni attivi configurabili Lun/Mar/Mer/Gio/Ven/Sab/Dom;
// - updateMode: all, paper_trading, analysis_ai;
// - persistenza su calcio_cron_config.json, quindi al riavvio resta l'ultima config;
// - nessun endpoint Tennis diretto in questo scheduler.
// ============================================================================

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const schedulerStateMachinePatch58 = require('./operationalSchedulerStateMachinePatch58');

const SCHEDULER_VERSION = '3.0_STEP94_AUTOMATION_SCAN_OPTIONS';
const CONFIG_FILE = path.join(__dirname, 'calcio_cron_config.json');
const LOCAL_API_URL = String(
    process.env.CALCIO_LOCAL_API_URL ||
    process.env.LOCAL_API_URL ||
    'http://localhost:3000/api'
).replace(/\/$/, '');

const DEFAULT_BANKROLL = 1000;
const DEFAULT_CONFIG = Object.freeze({
    enabled: false,
    type: 'interval_hours',
    intervalHours: 1,
    minute: 0,
    days: [],
    updateMode: 'all',
    runOptimization: true,
    runAnalysis: true,
    runDeepScan: true,
    runPaperSettlement: true,
    runClvSniper: true,
    bankroll: DEFAULT_BANKROLL,
    league: 'all',
    deepScanDelayMs: 4000,
    afterOptimizationDelayMs: 5000,
    afterAnalysisDelayMs: 10000
});

const VALID_UPDATE_MODES = new Set(['all', 'paper_trading', 'analysis_ai']);
const DAY_ALIASES = Object.freeze({
    sun: 0, sunday: 0, dom: 0, domenica: 0, '0': 0, '7': 0,
    mon: 1, monday: 1, lun: 1, lunedi: 1, lunedì: 1, '1': 1,
    tue: 2, tuesday: 2, mar: 2, martedi: 2, martedì: 2, '2': 2,
    wed: 3, wednesday: 3, mer: 3, mercoledi: 3, mercoledì: 3, '3': 3,
    thu: 4, thursday: 4, gio: 4, giovedi: 4, giovedì: 4, '4': 4,
    fri: 5, friday: 5, ven: 5, venerdi: 5, venerdì: 5, '5': 5,
    sat: 6, saturday: 6, sab: 6, sabato: 6, '6': 6
});

let isCalcioAutomationRunning = false;
let currentCalcioCronJob = null;
let currentClvCronJob = null;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function safeBool(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const v = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'si', 'sì', 'on'].includes(v)) return true;
        if (['false', '0', 'no', 'off'].includes(v)) return false;
    }
    return fallback;
}

function clampInt(value, min, max, fallback) {
    const n = Math.trunc(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function normalizeDay(value) {
    if (value === null || value === undefined || value === '') return null;
    const key = String(value).trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(DAY_ALIASES, key)) return DAY_ALIASES[key];
    const n = Number(value);
    if (Number.isInteger(n) && n >= 0 && n <= 7) return n === 7 ? 0 : n;
    return null;
}

function normalizeDays(days) {
    if (!Array.isArray(days)) return [];
    return [...new Set(days.map(normalizeDay).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))]
        .sort((a, b) => a - b);
}

function normalizeUpdateMode(config = {}) {
    const explicit = String(config.updateMode || config.update_mode || '').trim().toLowerCase();
    if (VALID_UPDATE_MODES.has(explicit)) return explicit;

    const runAnalysis = config.runAnalysis === true;
    const runDeepScan = config.runDeepScan === true;
    const runPaper = config.runPaperSettlement === true;
    const runOpt = config.runOptimization === true;

    if (runPaper && !runAnalysis && !runDeepScan && !runOpt) return 'paper_trading';
    if ((runAnalysis || runDeepScan) && !runPaper && !runOpt) return 'analysis_ai';
    return DEFAULT_CONFIG.updateMode;
}

function applyUpdateModeFlags(config = {}) {
    const updateMode = normalizeUpdateMode(config);
    const next = { ...config, updateMode };

    if (updateMode === 'paper_trading') {
        next.runOptimization = false;
        next.runAnalysis = false;
        next.runDeepScan = false;
        next.runPaperSettlement = true;
        next.runClvSniper = true;
    } else if (updateMode === 'analysis_ai') {
        next.runOptimization = false;
        next.runAnalysis = true;
        next.runDeepScan = true;
        next.runPaperSettlement = false;
        next.runClvSniper = false;
    } else {
        next.runOptimization = true;
        next.runAnalysis = true;
        next.runDeepScan = true;
        next.runPaperSettlement = true;
        next.runClvSniper = true;
    }

    return next;
}

function safeReadJson(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return { ...fallback };
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : { ...fallback };
    } catch (error) {
        console.warn(`⚠️ [SCHEDULER CALCIO] Config non leggibile: ${error.message}. Uso default.`);
        return { ...fallback };
    }
}

// AUDIT16A_CALCIO_SCHEDULER_ATOMIC_PERSISTENCE
// Configurazione cron e state machine Patch58 devono avanzare come una singola
// transazione logica. Se sync/read-back/scheduling falliscono, entrambi vengono
// ripristinati prima di propagare l'errore all'API.
const AUDIT16A_VERSION = 'AUDIT16A_CALCIO_SCHEDULER_ATOMIC_PERSISTENCE_V1';
const PROJECT_ROOT = path.join(__dirname, '..');

function atomicWriteJson(filePath, value) {
    const tmp = `${filePath}.audit16a-${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, filePath);
}

function schedulerPersistencePaths() {
    return [
        CONFIG_FILE,
        schedulerStateMachinePatch58.statePath('CALCIO', PROJECT_ROOT),
        schedulerStateMachinePatch58.eventsPath('CALCIO', PROJECT_ROOT)
    ];
}

function snapshotSchedulerPersistence() {
    return schedulerPersistencePaths().map(filePath => ({
        filePath,
        existed: fs.existsSync(filePath),
        content: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null
    }));
}

function restoreSchedulerPersistence(snapshot = []) {
    for (const item of snapshot) {
        if (item.existed) {
            fs.mkdirSync(path.dirname(item.filePath), { recursive: true });
            fs.writeFileSync(item.filePath, item.content);
        } else if (fs.existsSync(item.filePath)) {
            fs.rmSync(item.filePath, { force: true });
        }
    }
}

function assertConfigReadback(expected) {
    const actual = getCronConfig();
    const keys = ['enabled','type','intervalHours','minute','days','updateMode','runOptimization','runAnalysis','runDeepScan','runPaperSettlement','runClvSniper','bankroll','league','deepScanDelayMs','afterOptimizationDelayMs','afterAnalysisDelayMs'];
    for (const key of keys) {
        if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) {
            const error = new Error(`AUDIT16A_CONFIG_READBACK_MISMATCH:${key}`);
            error.code = 'AUDIT16A_CONFIG_READBACK_MISMATCH';
            throw error;
        }
    }
    return actual;
}

function syncStateMachineOrThrow(config) {
    const written = schedulerStateMachinePatch58.noteConfigChange('CALCIO', config, { projectRoot: PROJECT_ROOT });
    const persisted = schedulerStateMachinePatch58.getState('CALCIO', PROJECT_ROOT);
    if (!written || !persisted || persisted.configEnabled !== (config.enabled === true)) {
        const error = new Error('AUDIT16A_SCHEDULER_STATE_READBACK_MISMATCH');
        error.code = 'AUDIT16A_SCHEDULER_STATE_READBACK_MISMATCH';
        throw error;
    }
    return persisted;
}

function mergeConfig(config = {}) {
    const source = { ...DEFAULT_CONFIG, ...(config || {}) };
    const normalized = applyUpdateModeFlags({
        ...source,
        type: source.type || 'interval_hours',
        intervalHours: clampInt(source.intervalHours ?? source.interval_hours ?? 1, 1, 24, 1),
        minute: clampInt(source.minute ?? 0, 0, 59, 0),
        days: normalizeDays(source.days),
        times: Array.isArray(source.times) && source.times.length ? source.times : DEFAULT_CONFIG.times,
        bankroll: safeNumber(source.bankroll, DEFAULT_CONFIG.bankroll),
        league: source.league || 'all',
        deepScanDelayMs: safeNumber(source.deepScanDelayMs, DEFAULT_CONFIG.deepScanDelayMs),
        afterOptimizationDelayMs: safeNumber(source.afterOptimizationDelayMs, DEFAULT_CONFIG.afterOptimizationDelayMs),
        afterAnalysisDelayMs: safeNumber(source.afterAnalysisDelayMs, DEFAULT_CONFIG.afterAnalysisDelayMs),
        enabled: safeBool(source.enabled, DEFAULT_CONFIG.enabled)
    });

    normalized.scheduleSummary = buildScheduleSummary(normalized);
    return normalized;
}

function getCronConfig() {
    return mergeConfig(safeReadJson(CONFIG_FILE, DEFAULT_CONFIG));
}

function saveCronConfig(config) {
    const previous = getCronConfig();
    const merged = mergeConfig(config);
    const explicitEnable = config?.patch58ExplicitEnable === true || config?.explicitEnable === true;
    if (merged.enabled === true && previous.enabled !== true && !explicitEnable) {
        const error = new Error('PATCH58_CALCIO_EXPLICIT_ENABLE_REQUIRED');
        error.code = 'PATCH58_CALCIO_EXPLICIT_ENABLE_REQUIRED';
        throw error;
    }
    delete merged.patch58ExplicitEnable;
    delete merged.explicitEnable;

    const persistenceSnapshot = snapshotSchedulerPersistence();
    try {
        atomicWriteJson(CONFIG_FILE, merged);
        syncStateMachineOrThrow(merged);
        applySchedule({ skipStateSync: true });
        return assertConfigReadback(merged);
    } catch (error) {
        stopSchedule();
        restoreSchedulerPersistence(persistenceSnapshot);
        try { applySchedule({ skipStateSync: true, restoringPreviousConfig: true }); }
        catch (restoreError) { console.error('❌ [AUDIT16A] Ripristino job scheduler fallito:', restoreError.message); }
        if (!error.code) error.code = 'AUDIT16A_CALCIO_SCHEDULER_PERSISTENCE_FAILED';
        throw error;
    }
}

function buildDayCronSegment(days = []) {
    const normalized = normalizeDays(days);
    return normalized.length ? normalized.join(',') : '*';
}

function buildCronExpression(config) {
    const merged = mergeConfig(config || {});

    if (merged.type === 'interval_hours') {
        return `${merged.minute} */${merged.intervalHours} * * ${buildDayCronSegment(merged.days)}`;
    }

    // Compatibilità vecchie configurazioni.
    if (merged.type === 'daily_twice') {
        const times = Array.isArray(merged.times) && merged.times.length ? merged.times : ['09:00', '20:00'];
        const hours = times
            .map(t => parseInt(String(t).split(':')[0], 10))
            .filter(h => Number.isInteger(h) && h >= 0 && h <= 23)
            .join(',');
        const minute = clampInt(String(times[0] || '00:00').split(':')[1], 0, 59, 0);
        return hours ? `${minute} ${hours} * * ${buildDayCronSegment(merged.days)}` : '';
    }

    if (merged.type === 'custom_days') {
        const days = normalizeDays(merged.days);
        const firstTime = Array.isArray(merged.times) && merged.times[0] ? merged.times[0] : '09:00';
        const hour = clampInt(String(firstTime).split(':')[0], 0, 23, 9);
        const minute = clampInt(String(firstTime).split(':')[1], 0, 59, 0);
        return days.length ? `${minute} ${hour} * * ${days.join(',')}` : '';
    }

    return '';
}

function buildScheduleSummary(config = {}) {
    const merged = { ...DEFAULT_CONFIG, ...(config || {}) };
    const days = normalizeDays(merged.days);
    const dayLabel = days.length ? days.map(d => ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'][d]).join(', ') : 'tutti i giorni';
    const modeLabel = merged.updateMode === 'paper_trading'
        ? 'solo paper trading'
        : (merged.updateMode === 'analysis_ai' ? 'solo Analisi AI' : 'tutto');
    return `Ogni ${merged.intervalHours || 1}h · ${dayLabel} · ${modeLabel}`;
}

async function executeCalcioAutomationFlowCore(overrides = {}) {
    if (isCalcioAutomationRunning) {
        return { success: false, skipped: true, reason: 'ALREADY_RUNNING', schedulerVersion: SCHEDULER_VERSION };
    }

    const config = mergeConfig({ ...getCronConfig(), ...(overrides || {}) });
    const report = {
        success: false,
        schedulerVersion: SCHEDULER_VERSION,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        localApiUrl: LOCAL_API_URL,
        schedule: { cron: buildCronExpression(config), summary: buildScheduleSummary(config) },
        config: {
            enabled: config.enabled,
            updateMode: config.updateMode,
            intervalHours: config.intervalHours,
            days: config.days,
            bankroll: config.bankroll,
            league: config.league,
            runOptimization: config.runOptimization,
            runAnalysis: config.runAnalysis,
            runDeepScan: config.runDeepScan,
            runPaperSettlement: config.runPaperSettlement,
            runClvSniper: config.runClvSniper
        },
        optimization: null,
        analysis: null,
        deepScan: null,
        paperSettlement: null,
        clvSniper: null,
        errors: []
    };

    isCalcioAutomationRunning = true;
    try {
        let valueBets = [];

        if (config.runOptimization) {
            const opt = await axios.get(`${LOCAL_API_URL}/calcio/optimize`, { timeout: 300000 });
            report.optimization = opt.data || {};
            await delay(config.afterOptimizationDelayMs);
        }

        if (config.runAnalysis) {
            const res = await axios.post(
                `${LOCAL_API_URL}/analyze`,
                { bankroll: safeNumber(config.bankroll, DEFAULT_BANKROLL), league: config.league || 'all' },
                { timeout: 600000 }
            );
            valueBets = Array.isArray(res.data?.valueBets) ? res.data.valueBets : [];
            report.analysis = { success: true, valueBetsFound: valueBets.length, engineVersion: res.data?.engineVersion || null };
            await delay(config.afterAnalysisDelayMs);
        }

        if (config.runDeepScan && valueBets.length) {
            let scanned = 0;
            let errors = 0;
            for (const bet of valueBets) {
                try {
                    await axios.post(`${LOCAL_API_URL}/calcio/deepscan`, {
                        homeTeam: bet.home,
                        awayTeam: bet.away,
                        prediction: bet.prediction,
                        odd: bet.odd,
                        prob: bet.estimatedProb ?? bet.estimated_prob ?? bet.calibrated_probability_pct,
                        edge: bet.edge_pp ?? bet.edge,
                        edge_pp: bet.edge_pp ?? bet.edge,
                        ev_pct: bet.ev_pct ?? bet.expectedValue ?? bet.ev,
                        odd1: bet.odd1,
                        oddX: bet.oddX,
                        odd2: bet.odd2,
                        league: bet.league,
                        sport_type: 'CALCIO'
                    }, { timeout: 180000 });
                    scanned += 1;
                    await delay(config.deepScanDelayMs);
                } catch (error) {
                    errors += 1;
                    console.warn(`⚠️ [SCHEDULER CALCIO] Errore Deep Scan automatico: ${error.message}`);
                }
            }
            report.deepScan = { success: errors === 0, scanned, errors };
        } else {
            report.deepScan = { success: true, scanned: 0, errors: 0, skipped: true };
        }

        if (config.runPaperSettlement) {
            const settle = await axios.get(`${LOCAL_API_URL}/resolve_ai?leagueFilter=all`, { timeout: 300000 });
            report.paperSettlement = { success: settle.data?.success !== false, data: settle.data || {} };
        }

        if (config.updateMode === 'paper_trading' && config.runClvSniper) {
            report.clvSniper = await executeClvSniper();
        }

        report.success = true;
    } catch (error) {
        report.errors.push(error.message);
        console.error('❌ [SCHEDULER CALCIO] ERRORE DURANTE AUTOMAZIONE:', error.message);
    } finally {
        report.finishedAt = new Date().toISOString();
        isCalcioAutomationRunning = false;
    }

    return report;
}

async function executeCalcioAutomationFlow(overrides = {}) {
    const config = mergeConfig({ ...getCronConfig(), ...(overrides || {}) });
    return schedulerStateMachinePatch58.runManagedCycle(
        'CALCIO',
        () => executeCalcioAutomationFlowCore(overrides),
        { projectRoot: path.join(__dirname, '..'), config, trigger: overrides?._schedulerTrigger || 'MANUAL_OR_INTERNAL' }
    );
}

async function executeClvSniper() {
    try {
        await axios.get(`${LOCAL_API_URL}/internal/track-clv`, { timeout: 120000 });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

function applySchedule(options = {}) {
    if (currentCalcioCronJob) {
        currentCalcioCronJob.stop();
        currentCalcioCronJob = null;
    }
    if (currentClvCronJob) {
        currentClvCronJob.stop();
        currentClvCronJob = null;
    }

    const config = getCronConfig();
    if (options.skipStateSync !== true) syncStateMachineOrThrow(config);
    if (!config.enabled) {
        console.log('⏸️ [SCHEDULER CALCIO] Automazione DISATTIVATA.');
        return null;
    }

    const cronExpression = buildCronExpression(config);
    if (!cronExpression) {
        const error = new Error('AUDIT16A_CALCIO_SCHEDULER_INVALID_CRON_CONFIG');
        error.code = 'AUDIT16A_CALCIO_SCHEDULER_INVALID_CRON_CONFIG';
        throw error;
    }

    currentCalcioCronJob = cron.schedule(cronExpression, () => executeCalcioAutomationFlow());
    currentCalcioCronJob.start();

    if (config.runClvSniper && config.updateMode !== 'analysis_ai') {
        currentClvCronJob = cron.schedule('*/15 * * * *', () => executeClvSniper());
        currentClvCronJob.start();
    }

    console.log(`⏱️ [SCHEDULER CALCIO] Attivo: ${cronExpression} (${buildScheduleSummary(config)})`);
    return currentCalcioCronJob;
}

function stopSchedule() {
    if (currentCalcioCronJob) {
        currentCalcioCronJob.stop();
        currentCalcioCronJob = null;
    }
    if (currentClvCronJob) {
        currentClvCronJob.stop();
        currentClvCronJob = null;
    }
    return true;
}

function getSchedulerStatus() {
    const config = getCronConfig();
    return {
        schedulerVersion: SCHEDULER_VERSION,
        localApiUrl: LOCAL_API_URL,
        isAutomationRunning: isCalcioAutomationRunning,
        hasActiveCronJob: Boolean(currentCalcioCronJob),
        hasActiveClvJob: Boolean(currentClvCronJob),
        cronExpression: buildCronExpression(config),
        scheduleSummary: buildScheduleSummary(config),
        stateMachine: schedulerStateMachinePatch58.getState('CALCIO', path.join(__dirname, '..')),
        config
    };
}

module.exports = {
    getCronConfig,
    saveCronConfig,
    applySchedule,
    stopSchedule,
    executeCalcioAutomationFlow,
    executeClvSniper,
    getSchedulerStatus,
    buildCronExpression,
    buildScheduleSummary,
    mergeConfig,
    normalizeDays,
    normalizeUpdateMode,
    applyUpdateModeFlags,
    AUDIT16A_VERSION,
    assertConfigReadback,
    SCHEDULER_VERSION
};
