// STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER
// Stato anti-duplicazione separato dal programma principale.
const fs = require('fs');
const path = require('path');

const STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER = 'STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER';
const DEFAULT_STATE_PATH = path.join(__dirname, 'telegram_state.json');

function defaultState() {
    return {
        version: STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER,
        sentResultIds: [],
        sentPredictionIds: [],
        lastResultsRunAt: null,
        lastPredictionsRunAt: null,
        lastSummaryRunAt: null,
        updatedAt: null
    };
}

function loadState(statePath = DEFAULT_STATE_PATH) {
    try {
        if (!fs.existsSync(statePath)) return defaultState();
        const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        return {
            ...defaultState(),
            ...parsed,
            sentResultIds: Array.isArray(parsed.sentResultIds) ? parsed.sentResultIds : [],
            sentPredictionIds: Array.isArray(parsed.sentPredictionIds) ? parsed.sentPredictionIds : []
        };
    } catch (error) {
        return { ...defaultState(), error: error.message };
    }
}

function saveState(state, statePath = DEFAULT_STATE_PATH) {
    const payload = {
        ...defaultState(),
        ...state,
        updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(statePath, JSON.stringify(payload, null, 2));
    return payload;
}

function markRowsSent(rows = [], mode = 'results_since_last', statePath = DEFAULT_STATE_PATH) {
    const state = loadState(statePath);
    const ids = rows.map(r => Number(r.id)).filter(Number.isFinite);
    const isPrediction = String(mode || '').includes('prediction');
    const targetKey = isPrediction ? 'sentPredictionIds' : 'sentResultIds';
    const merged = new Set([...(state[targetKey] || []), ...ids]);
    state[targetKey] = Array.from(merged).sort((a, b) => a - b);
    if (isPrediction) state.lastPredictionsRunAt = new Date().toISOString();
    else if (String(mode || '').includes('summary')) state.lastSummaryRunAt = new Date().toISOString();
    else state.lastResultsRunAt = new Date().toISOString();
    return saveState(state, statePath);
}

function resetState(statePath = DEFAULT_STATE_PATH) {
    return saveState(defaultState(), statePath);
}

module.exports = {
    STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER,
    DEFAULT_STATE_PATH,
    defaultState,
    loadState,
    saveState,
    markRowsSent,
    resetState
};
