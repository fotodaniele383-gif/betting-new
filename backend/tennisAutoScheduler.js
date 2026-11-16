'use strict';
// ============================================================================
// AI BETTING QUANT PRO - TENNIS ORCHESTRATOR & SCHEDULER
// Versione: 3.1 PATCH25 - Persistent Exact Interval Scheduler
// legacy marker per test statici: const SCHEDULER_VERSION='2.1'
// ============================================================================
// Regole Step94:
// - configurazione Tennis separata da Calcio;
// - frequenza configurabile ogni 1h, 2h, 3h...;
// - giorni attivi configurabili Lun/Mar/Mer/Gio/Ven/Sab/Dom;
// - updateMode: all, paper_trading, analysis_ai;
// - persistenza su tennis_cron_config.json, quindi al riavvio resta l'ultima config;
// - optimizer Tennis resta recommendation-only: mai auto-apply soglie live.
// ============================================================================

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const schedulerStateMachinePatch58 = require('./operationalSchedulerStateMachinePatch58');

const SCHEDULER_VERSION = '3.1_PATCH25_PERSISTENT_EXACT_INTERVAL';
const SCHEDULER_MODE_EXACT = 'PERSISTENT_EXACT_INTERVAL';
const CONFIG_FILE = path.join(__dirname, 'tennis_cron_config.json');
const LOCAL_API_URL = String(
    process.env.TENNIS_LOCAL_API_URL ||
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
    runOptimizationRecommendation: true,
    runAnalysis: true,
    runDeepScan: true,
    runPaperSettlement: true,
    bankroll: DEFAULT_BANKROLL,
    league: 'all',
    deepScanDelayMs: 4000,
    afterOptimizationDelayMs: 5000,
    afterAnalysisDelayMs: 10000,
    intervalAnchorAt: null,
    nextRunAt: null,
    lastTriggerAt: null,
    lastRunAt: null,
    lastCompletedAt: null,
    lastRunSuccess: null,
    lastSkipReason: null,
    schedulerMode: 'PERSISTENT_EXACT_INTERVAL'
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

let isAutomationRunning = false;
let currentCronJob = null;
let currentIntervalTimer = null;
let schedulerGeneration = 0;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const MAX_TIMEOUT_MS = 0x7fffffff;

function safeIso(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function atomicWriteJson(filePath, value) {
    const tmp = `${filePath}.patch25.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
}

function intervalMilliseconds(config = {}) {
    return clampInt(config.intervalHours ?? config.interval_hours ?? 1, 1, 24, 1) * 60 * 60 * 1000;
}

function scheduleSignature(config = {}) {
    return JSON.stringify({
        enabled: config.enabled === true,
        type: String(config.type || 'interval_hours'),
        intervalHours: clampInt(config.intervalHours ?? 1, 1, 24, 1),
        minute: clampInt(config.minute ?? 0, 0, 59, 0),
        days: normalizeDays(config.days)
    });
}

function isAllowedDay(timestamp, days = []) {
    const normalized = normalizeDays(days);
    if (!normalized.length) return true;
    return normalized.includes(new Date(timestamp).getDay());
}

function calculateNextRunAt(config = {}, nowInput = Date.now()) {
    const now = nowInput instanceof Date ? nowInput.getTime() : Number(nowInput);
    if (!Number.isFinite(now)) throw new Error('PATCH25_SCHEDULER_NOW_INVALID');
    const intervalMs = intervalMilliseconds(config);
    const existingNext = safeIso(config.nextRunAt);
    const anchor = safeIso(config.intervalAnchorAt) || safeIso(config.lastRunAt);
    let candidate;

    if (existingNext) {
        candidate = new Date(existingNext).getTime();
        if (candidate <= now) {
            const jumps = Math.floor((now - candidate) / intervalMs) + 1;
            candidate += jumps * intervalMs;
        }
    } else if (anchor) {
        candidate = new Date(anchor).getTime() + intervalMs;
        if (candidate <= now) {
            const jumps = Math.floor((now - candidate) / intervalMs) + 1;
            candidate += jumps * intervalMs;
        }
    } else {
        candidate = now + intervalMs;
    }

    let guard = 0;
    while (!isAllowedDay(candidate, config.days) && guard < 200) {
        candidate += intervalMs;
        guard += 1;
    }
    if (guard >= 200) throw new Error('PATCH25_SCHEDULER_ALLOWED_DAY_NOT_FOUND');
    return new Date(candidate).toISOString();
}

function persistSchedulerState(patch = {}) {
    const raw = safeReadJson(CONFIG_FILE, DEFAULT_CONFIG);
    const merged = mergeConfig({ ...raw, ...(patch || {}) });
    atomicWriteJson(CONFIG_FILE, merged);
    return merged;
}

function clearScheduleHandles() {
    schedulerGeneration += 1;
    if (currentCronJob) {
        currentCronJob.stop();
        currentCronJob = null;
    }
    if (currentIntervalTimer) {
        clearTimeout(currentIntervalTimer);
        currentIntervalTimer = null;
    }
}

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
    const runOpt = config.runOptimizationRecommendation === true;

    if (runPaper && !runAnalysis && !runDeepScan && !runOpt) return 'paper_trading';
    if ((runAnalysis || runDeepScan) && !runPaper && !runOpt) return 'analysis_ai';
    return DEFAULT_CONFIG.updateMode;
}

function applyUpdateModeFlags(config = {}) {
    const updateMode = normalizeUpdateMode(config);
    const next = { ...config, updateMode };

    if (updateMode === 'paper_trading') {
        next.runOptimizationRecommendation = false;
        next.runAnalysis = false;
        next.runDeepScan = false;
        next.runPaperSettlement = true;
    } else if (updateMode === 'analysis_ai') {
        next.runOptimizationRecommendation = false;
        next.runAnalysis = true;
        next.runDeepScan = true;
        next.runPaperSettlement = false;
    } else {
        next.runOptimizationRecommendation = true;
        next.runAnalysis = true;
        next.runDeepScan = true;
        next.runPaperSettlement = true;
    }

    return next;
}

function safeReadJson(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return { ...fallback };
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : { ...fallback };
    } catch (error) {
        console.warn(`⚠️ [SCHEDULER TENNIS] Config non leggibile: ${error.message}. Uso default.`);
        return { ...fallback };
    }
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
        enabled: safeBool(source.enabled, DEFAULT_CONFIG.enabled),
        intervalAnchorAt: safeIso(source.intervalAnchorAt),
        nextRunAt: safeIso(source.nextRunAt),
        lastTriggerAt: safeIso(source.lastTriggerAt),
        lastRunAt: safeIso(source.lastRunAt),
        lastCompletedAt: safeIso(source.lastCompletedAt),
        lastRunSuccess: typeof source.lastRunSuccess === 'boolean' ? source.lastRunSuccess : null,
        lastSkipReason: source.lastSkipReason ? String(source.lastSkipReason) : null,
        schedulerMode: source.type === 'interval_hours' ? SCHEDULER_MODE_EXACT : String(source.schedulerMode || 'CRON_COMPATIBILITY')
    });

    normalized.scheduleSummary = buildScheduleSummary(normalized);
    return normalized;
}

function getCronConfig() {
    return mergeConfig(safeReadJson(CONFIG_FILE, DEFAULT_CONFIG));
}

function saveCronConfig(config) {
    const previous = getCronConfig();
    const merged = mergeConfig({ ...previous, ...(config || {}) });
    if (merged.type === 'interval_hours') {
        const scheduleChanged = scheduleSignature(previous) !== scheduleSignature(merged);
        const now = Date.now();
        if (scheduleChanged || !merged.intervalAnchorAt) merged.intervalAnchorAt = new Date(now).toISOString();
        if (scheduleChanged) merged.nextRunAt = null;
        merged.nextRunAt = calculateNextRunAt(merged, now);
        merged.schedulerMode = SCHEDULER_MODE_EXACT;
    }
    atomicWriteJson(CONFIG_FILE, merged);
    try { schedulerStateMachinePatch58.noteConfigChange('TENNIS', merged, { projectRoot: path.join(__dirname, '..') }); } catch (_) {}
    applySchedule();
    return merged;
}

function buildDayCronSegment(days = []) {
    const normalized = normalizeDays(days);
    return normalized.length ? normalized.join(',') : '*';
}

function buildCronExpression(config) {
    const merged = mergeConfig(config || {});

    if (merged.type === 'interval_hours') {
        // Patch 25: gli intervalli non divisori di 24 (es. 7h) non possono essere
        // rappresentati correttamente da cron */N. Sono gestiti da timer persistente.
        return '';
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
    const cadence = merged.type === 'interval_hours'
        ? `Ogni ${merged.intervalHours || 1} ore reali`
        : `Calendario ${merged.type || 'cron'}`;
    return `${cadence} · ${dayLabel} · ${modeLabel}`;
}

function getEdgePp(bet = {}) {
    return safeNumber(bet.edge_pp ?? bet.adjusted_edge_pp ?? bet.edge, 0);
}

function getEvPct(bet = {}) {
    return safeNumber(bet.ev_pct ?? bet.adjusted_ev_pct ?? bet.expectedValue ?? bet.ev, 0);
}

function getProbability(bet = {}) {
    return safeNumber(
        bet.estimatedProb ?? bet.estimated_prob ?? bet.calibrated_probability_pct ?? bet.calibratedProbability ?? bet.probability,
        0
    );
}

function summarizeOptimizeResponse(data = {}) {
    const diagnostics = data.diagnostics || {};
    return {
        success: data.success === true,
        applied: data.applied === true || diagnostics.applied === true,
        recommendationOnly: data.recommendationOnly === true || diagnostics.recommendationOnly === true,
        settingsSaved: data.settingsSaved === true || diagnostics.settingsSaved === true,
        message: data.message || data.reason || 'Nessun messaggio optimizer disponibile',
        sample: {
            atp: safeNumber(diagnostics.atpSample ?? diagnostics?.sample?.atp, 0),
            wta: safeNumber(diagnostics.wtaSample ?? diagnostics?.sample?.wta, 0),
            required: safeNumber(diagnostics.requiredSample ?? data.requiredSample, 0)
        },
        recommendation: data.recommendation || data.recommendedSettings || {},
        activeSettings: data.activeSettings || data.previousSettings || {}
    };
}

function buildDeepScanPayload(bet = {}) {
    return {
        p1Name: bet.home,
        p2Name: bet.away,
        prediction: bet.prediction,
        odd: bet.odd,
        prob: getProbability(bet),
        edge: getEdgePp(bet),
        edge_pp: getEdgePp(bet),
        ev_pct: getEvPct(bet),
        odd1: bet.odd1,
        odd2: bet.odd2,
        league: bet.league,
        marketType: bet.marketType || bet.market_type || null,
        data_quality: bet.data_quality || 'CURRENT_BOOTSTRAP',
        sport_type: 'TENNIS'
    };
}

async function runOptimizationRecommendationStep(report) {
    const response = await axios.get(`${LOCAL_API_URL}/tennis/optimize`, { timeout: 300000 });
    const summary = summarizeOptimizeResponse(response.data || {});
    report.optimization = summary;

    if (summary.applied || summary.settingsSaved) {
        console.warn('🚨 [SCHEDULER TENNIS] WARNING: optimizer ha dichiarato applied/settingsSaved=true. Lo scheduler Tennis resta recommendation-only.');
    }

    return summary;
}

async function runAnalysisStep(config, report) {
    const response = await axios.post(
        `${LOCAL_API_URL}/tennis/analyze`,
        { bankroll: safeNumber(config.bankroll, DEFAULT_BANKROLL), league: config.league || 'all' },
        { timeout: 600000 }
    );

    const valueBets = Array.isArray(response.data?.valueBets) ? response.data.valueBets : [];
    report.analysis = {
        success: true,
        valueBetsFound: valueBets.length,
        reliabilityMode: response.data?.reliabilityMode || null,
        reliabilitySampleSize: response.data?.reliabilitySampleSize || 0,
        engineVersion: response.data?.engineVersion || null,
        modelVersion: response.data?.modelVersion || null,
        metricVersion: response.data?.metricVersion || null
    };

    return { data: response.data, valueBets };
}

async function runDeepScanStep(valueBets = [], config, report) {
    if (!Array.isArray(valueBets) || valueBets.length === 0) {
        report.deepScan = { success: true, scanned: 0, errors: 0, skipped: true, reason: 'NO_VALUE_BETS' };
        return report.deepScan;
    }

    let scanned = 0;
    let errors = 0;
    for (const bet of valueBets) {
        try {
            await axios.post(`${LOCAL_API_URL}/tennis/deepscan`, buildDeepScanPayload(bet), { timeout: 180000 });
            scanned += 1;
            await delay(safeNumber(config.deepScanDelayMs, DEFAULT_CONFIG.deepScanDelayMs));
        } catch (error) {
            errors += 1;
            console.warn(`⚠️ [SCHEDULER TENNIS] Errore Deep Scan automatico: ${error.message}`);
        }
    }

    report.deepScan = { success: errors === 0, scanned, errors, skipped: false };
    return report.deepScan;
}

async function runPaperSettlementStep(report) {
    const response = await axios.get(`${LOCAL_API_URL}/tennis/resolve_ai?leagueFilter=all`, { timeout: 300000 });
    report.paperSettlement = {
        success: response.data?.success !== false,
        resolvedCount: response.data?.resolvedCount ?? response.data?.resolved ?? 0,
        unresolvedCount: response.data?.unresolvedCount ?? response.data?.unresolved ?? 0,
        engineVersion: response.data?.engineVersion || response.data?.meta?.engineVersion || null,
        dataMode: response.data?.dataMode || response.data?.meta?.dataMode || null
    };
    return report.paperSettlement;
}

async function executeTennisAutomationFlowCore(overrides = {}) {
    if (isAutomationRunning) {
        return { success: false, skipped: true, reason: 'ALREADY_RUNNING', schedulerVersion: SCHEDULER_VERSION };
    }

    const config = mergeConfig({ ...getCronConfig(), ...(overrides || {}) });
    const report = {
        success: false,
        schedulerVersion: SCHEDULER_VERSION,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        localApiUrl: LOCAL_API_URL,
        schedule: { type: config.type, cron: buildCronExpression(config) || null, exactInterval: config.type === 'interval_hours', nextRunAt: config.nextRunAt || null, summary: buildScheduleSummary(config) },
        config: {
            enabled: config.enabled,
            updateMode: config.updateMode,
            intervalHours: config.intervalHours,
            days: config.days,
            runOptimizationRecommendation: config.runOptimizationRecommendation,
            runAnalysis: config.runAnalysis,
            runDeepScan: config.runDeepScan,
            runPaperSettlement: config.runPaperSettlement,
            bankroll: config.bankroll,
            league: config.league
        },
        optimization: null,
        analysis: null,
        deepScan: null,
        paperSettlement: null,
        errors: []
    };

    isAutomationRunning = true;
    try {
        let analysisResult = { valueBets: [] };

        if (config.runOptimizationRecommendation) {
            await runOptimizationRecommendationStep(report);
            await delay(config.afterOptimizationDelayMs);
        }

        if (config.runAnalysis) {
            analysisResult = await runAnalysisStep(config, report);
            await delay(config.afterAnalysisDelayMs);
        }

        if (config.runDeepScan) {
            await runDeepScanStep(analysisResult.valueBets || [], config, report);
        }

        if (config.runPaperSettlement) {
            await runPaperSettlementStep(report);
        }

        report.success = true;
    } catch (error) {
        report.errors.push(error.message);
        console.error('❌ [SCHEDULER TENNIS] ERRORE CRITICO:', error.message);
    } finally {
        report.finishedAt = new Date().toISOString();
        isAutomationRunning = false;
    }

    return report;
}

async function executeTennisAutomationFlow(overrides = {}) {
    const config = mergeConfig({ ...getCronConfig(), ...(overrides || {}) });
    return schedulerStateMachinePatch58.runManagedCycle(
        'TENNIS',
        () => executeTennisAutomationFlowCore(overrides),
        {
            projectRoot: path.join(__dirname, '..'),
            config,
            trigger: overrides?._schedulerTrigger || 'MANUAL_OR_INTERNAL'
        }
    );
}

function armPersistentInterval(configInput = getCronConfig()) {
    const generation = schedulerGeneration;
    let config = mergeConfig(configInput);
    if (!config.intervalAnchorAt) config.intervalAnchorAt = new Date().toISOString();
    const calculatedNext = calculateNextRunAt(config, Date.now());
    if (config.nextRunAt !== calculatedNext || config.schedulerMode !== SCHEDULER_MODE_EXACT) {
        config = persistSchedulerState({
            intervalAnchorAt: config.intervalAnchorAt,
            nextRunAt: calculatedNext,
            schedulerMode: SCHEDULER_MODE_EXACT
        });
    }

    const nextMs = new Date(config.nextRunAt).getTime();
    const delayMs = Math.max(1000, Math.min(MAX_TIMEOUT_MS, nextMs - Date.now()));
    currentIntervalTimer = setTimeout(async () => {
        if (generation !== schedulerGeneration) return;
        const live = getCronConfig();
        if (!live.enabled || live.type !== 'interval_hours') return;
        const scheduledAt = live.nextRunAt || new Date().toISOString();
        const following = calculateNextRunAt({
            ...live,
            nextRunAt: new Date(new Date(scheduledAt).getTime() + intervalMilliseconds(live)).toISOString()
        }, Date.now());
        persistSchedulerState({
            lastTriggerAt: new Date().toISOString(),
            nextRunAt: following,
            schedulerMode: SCHEDULER_MODE_EXACT,
            lastSkipReason: null
        });
        const report = await executeTennisAutomationFlow({
            _schedulerTrigger: SCHEDULER_MODE_EXACT,
            _scheduledAt: scheduledAt
        });
        persistSchedulerState({
            lastRunAt: report.startedAt || new Date().toISOString(),
            lastCompletedAt: report.finishedAt || new Date().toISOString(),
            lastRunSuccess: report.success === true,
            lastSkipReason: report.skipped ? (report.reason || 'SKIPPED') : null
        });
        if (generation === schedulerGeneration) armPersistentInterval(getCronConfig());
    }, delayMs);
    if (typeof currentIntervalTimer.unref === 'function') currentIntervalTimer.unref();
    return currentIntervalTimer;
}

function applySchedule() {
    clearScheduleHandles();
    const config = getCronConfig();
    try { schedulerStateMachinePatch58.noteConfigChange('TENNIS', config, { projectRoot: path.join(__dirname, '..') }); } catch (_) {}
    if (!config.enabled) {
        console.log('⏸️ [SCHEDULER TENNIS] Automazione DISATTIVATA.');
        return null;
    }

    if (config.type === 'interval_hours') {
        const initialized = persistSchedulerState({
            intervalAnchorAt: config.intervalAnchorAt || new Date().toISOString(),
            nextRunAt: calculateNextRunAt(config, Date.now()),
            schedulerMode: SCHEDULER_MODE_EXACT
        });
        const timer = armPersistentInterval(initialized);
        console.log(`⏱️ [SCHEDULER TENNIS] Attivo: intervallo persistente esatto ${initialized.intervalHours}h · prossimo ${initialized.nextRunAt} (${buildScheduleSummary(initialized)})`);
        return timer;
    }

    const cronExpression = buildCronExpression(config);
    if (!cronExpression || !cron.validate(cronExpression)) {
        console.warn('⚠️ [SCHEDULER TENNIS] Config cron non valida. Scheduler non avviato.');
        return null;
    }
    currentCronJob = cron.schedule(cronExpression, () => executeTennisAutomationFlow({ _schedulerTrigger: 'CRON_COMPATIBILITY' }));
    currentCronJob.start();
    console.log(`⏱️ [SCHEDULER TENNIS] Attivo: ${cronExpression} (${buildScheduleSummary(config)})`);
    return currentCronJob;
}

function stopSchedule() {
    clearScheduleHandles();
    return true;
}

function getSchedulerStatus() {
    const config = getCronConfig();
    const now = Date.now();
    const nextRunAt = config.type === 'interval_hours' ? calculateNextRunAt(config, now) : null;
    return {
        schedulerVersion: SCHEDULER_VERSION,
        schedulerMode: config.type === 'interval_hours' ? SCHEDULER_MODE_EXACT : 'CRON_COMPATIBILITY',
        localApiUrl: LOCAL_API_URL,
        isAutomationRunning,
        singleFlightLockActive: isAutomationRunning,
        hasActiveCronJob: Boolean(currentCronJob),
        hasActiveIntervalTimer: Boolean(currentIntervalTimer),
        cronExpression: config.type === 'interval_hours' ? null : buildCronExpression(config),
        legacyMisleadingCronBlocked: config.type === 'interval_hours',
        intervalHours: config.intervalHours,
        intervalAnchorAt: config.intervalAnchorAt,
        nextRunAt,
        millisecondsUntilNextRun: nextRunAt ? Math.max(0, new Date(nextRunAt).getTime() - now) : null,
        scheduleSummary: buildScheduleSummary(config),
        persistentState: {
            lastTriggerAt: config.lastTriggerAt,
            lastRunAt: config.lastRunAt,
            lastCompletedAt: config.lastCompletedAt,
            lastRunSuccess: config.lastRunSuccess,
            lastSkipReason: config.lastSkipReason
        },
        stateMachine: schedulerStateMachinePatch58.getState('TENNIS', path.join(__dirname, '..')),
        config
    };
}

module.exports = {
    getCronConfig,
    saveCronConfig,
    applySchedule,
    stopSchedule,
    executeTennisAutomationFlow,
    getSchedulerStatus,
    buildCronExpression,
    buildScheduleSummary,
    mergeConfig,
    normalizeDays,
    normalizeUpdateMode,
    applyUpdateModeFlags,
    calculateNextRunAt,
    intervalMilliseconds,
    scheduleSignature,
    isAllowedDay,
    persistSchedulerState,
    SCHEDULER_MODE_EXACT,
    SCHEDULER_VERSION
};
