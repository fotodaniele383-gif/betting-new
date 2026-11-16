// STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER
// Notifier Telegram esterno: può essere usato da CLI e da /api/telegram.
const fs = require('fs');
const path = require('path');
const repo = require('./telegramRepository');
const builder = require('./telegramReportBuilder');
const stateStore = require('./telegramStateStore');

const STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER = 'STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER';
const TELEGRAM_CREDENTIAL_POLICY_VERSION = 'TELEGRAM_ENV_ONLY_CREDENTIAL_POLICY_V1_PATCH31';
const CONFIG_PATH = path.join(__dirname, 'telegram.config.json');
const EXAMPLE_CONFIG_PATH = path.join(__dirname, 'telegram.config.example.json');

function defaultConfig() {
    return {
        enabled: false,
        tokenEnv: 'TELEGRAM_BOT_TOKEN',
        credentialPolicy: 'ENVIRONMENT_ONLY',
        defaultParseMode: 'HTML',
        contacts: [
            { name: 'INSERISCI_QUI_NOME_CONTATTO', chatId: 'INSERISCI_QUI_CHAT_ID', enabled: false }
        ],
        defaultFilters: {
            mode: 'results_since_last',
            area: 'both',
            sport: 'tennis',
            stakeScope: 'operational',
            onlyCurrentDataQuality: true,
            dedupe: true,
            limit: 20
        }
    };
}
function ensureConfigFile() {
    if (!fs.existsSync(CONFIG_PATH)) {
        const src = fs.existsSync(EXAMPLE_CONFIG_PATH) ? fs.readFileSync(EXAMPLE_CONFIG_PATH, 'utf8') : JSON.stringify(defaultConfig(), null, 2);
        fs.writeFileSync(CONFIG_PATH, src);
    }
}
function loadConfig() {
    ensureConfigFile();
    try {
        return { ...defaultConfig(), ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    } catch (error) {
        return { ...defaultConfig(), configError: error.message };
    }
}
function normalizeContact(contact = {}, idx = 0) {
    return {
        id: String(contact.id || contact.chatId || `contact_${idx + 1}`),
        name: String(contact.name || `Contatto ${idx + 1}`),
        chatId: String(contact.chatId || '').trim(),
        enabled: contact.enabled !== false
    };
}
function maskToken(token = '') {
    return String(token || '').trim() ? 'CONFIGURATO_IN_ENV' : 'NON_CONFIGURATO';
}
function isRotationRequired() {
    return ['1', 'true', 'yes', 'on'].includes(String(process.env.TELEGRAM_TOKEN_ROTATION_REQUIRED || '').trim().toLowerCase());
}
function getToken(config = loadConfig()) {
    const envName = config.tokenEnv || 'TELEGRAM_BOT_TOKEN';
    const envToken = process.env[envName];
    return envToken && String(envToken).trim() ? String(envToken).trim() : '';
}
function sanitizeTelegramError(error, token = '') {
    const raw = String(error?.message || error || 'TELEGRAM_ERROR');
    const safe = token ? raw.split(String(token)).join('[REDACTED_TELEGRAM_TOKEN]') : raw;
    return safe.replace(/\b\d{7,12}:[A-Za-z0-9_-]{25,}\b/g, '[REDACTED_TELEGRAM_TOKEN]');
}
function getContacts(config = loadConfig(), options = {}) {
    const base = Array.isArray(config.contacts) ? config.contacts : [];
    const envChatId = process.env.TELEGRAM_CHAT_ID;
    const contacts = base.map(normalizeContact);
    if (envChatId && !contacts.some(c => c.chatId === envChatId)) {
        contacts.push({ id: envChatId, name: 'TELEGRAM_CHAT_ID da .env', chatId: envChatId, enabled: true });
    }
    const requested = new Set((options.contactIds || []).map(String));
    return contacts.filter(c => c.chatId && !c.chatId.includes('INSERISCI_QUI') && c.enabled !== false && (!requested.size || requested.has(String(c.id)) || requested.has(String(c.chatId))));
}
function publicConfig(config = loadConfig()) {
    const token = getToken(config);
    const contacts = (Array.isArray(config.contacts) ? config.contacts : []).map(normalizeContact);
    return {
        mode: STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER,
        credentialPolicyVersion: TELEGRAM_CREDENTIAL_POLICY_VERSION,
        credentialSource: 'ENVIRONMENT_ONLY',
        enabled: config.enabled === true,
        tokenConfigured: Boolean(token),
        tokenMasked: maskToken(token),
        tokenEnv: config.tokenEnv || 'TELEGRAM_BOT_TOKEN',
        rotationRequired: isRotationRequired(),
        defaultParseMode: config.defaultParseMode || 'HTML',
        defaultFilters: config.defaultFilters || defaultConfig().defaultFilters,
        contacts,
        configPath: CONFIG_PATH,
        statePath: stateStore.DEFAULT_STATE_PATH,
        tokenPersistedInConfig: false
    };
}
function saveConfigPatch(patch = {}) {
    if (Object.prototype.hasOwnProperty.call(patch, 'token')) {
        throw new Error('TELEGRAM_TOKEN_FILE_PERSISTENCE_DISABLED_PATCH31');
    }
    const current = loadConfig();
    const safeCurrent = { ...current };
    delete safeCurrent.token;
    const safePatch = { ...patch };
    delete safePatch.token;
    delete safePatch.tokenEnv;
    delete safePatch.credentialPolicy;
    const next = {
        ...safeCurrent,
        ...safePatch,
        tokenEnv: 'TELEGRAM_BOT_TOKEN',
        credentialPolicy: 'ENVIRONMENT_ONLY',
        defaultFilters: { ...(safeCurrent.defaultFilters || {}), ...(safePatch.defaultFilters || {}) }
    };
    if (Array.isArray(safePatch.contacts)) next.contacts = safePatch.contacts.map(normalizeContact);
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
    return publicConfig(next);
}
async function sendTelegramMessage({ token, chatId, text, parseMode = 'HTML', disableWebPagePreview = true }) {
    if (!token) throw new Error('TELEGRAM_TOKEN_MANCANTE');
    if (!chatId) throw new Error('TELEGRAM_CHAT_ID_MANCANTE');
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode, disable_web_page_preview: disableWebPagePreview })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
        throw new Error(sanitizeTelegramError(payload.description || `Telegram HTTP ${response.status}`, token));
    }
    return payload;
}
function buildOptions(options = {}, config = loadConfig()) {
    return { ...(config.defaultFilters || defaultConfig().defaultFilters), ...options };
}
function previewTelegramReport(options = {}) {
    const config = loadConfig();
    const finalOptions = buildOptions(options, config);
    const state = stateStore.loadState();
    const rows = repo.getTelegramRows(finalOptions, state);
    const report = builder.buildTelegramReport(rows, finalOptions);
    return { success: true, dryRun: true, options: finalOptions, count: rows.length, rowIds: report.rowIds, messages: report.messages, summary: repo.summarizeRows(rows) };
}
async function sendTelegramReport(options = {}) {
    const config = loadConfig();
    const finalOptions = buildOptions(options, config);
    const token = getToken(config);
    const contacts = getContacts(config, finalOptions);
    const preview = previewTelegramReport(finalOptions);
    if (config.enabled !== true && finalOptions.force !== true) {
        return { ...preview, success: false, sent: false, reason: 'TELEGRAM_DISABLED_IN_CONFIG' };
    }
    if (isRotationRequired()) return { ...preview, success: false, sent: false, reason: 'TELEGRAM_TOKEN_ROTATION_REQUIRED' };
    if (!token) return { ...preview, success: false, sent: false, reason: 'TELEGRAM_TOKEN_MANCANTE' };
    if (!contacts.length) return { ...preview, success: false, sent: false, reason: 'NESSUN_CONTATTO_TELEGRAM_VALIDO' };
    const results = [];
    for (const contact of contacts) {
        for (const message of preview.messages) {
            try {
                const sent = await sendTelegramMessage({ token, chatId: contact.chatId, text: message, parseMode: config.defaultParseMode || 'HTML' });
                results.push({ contact: contact.name, chatId: contact.chatId, ok: true, messageId: sent.result?.message_id || null });
            } catch (error) {
                results.push({ contact: contact.name, chatId: contact.chatId, ok: false, error: sanitizeTelegramError(error, token) });
            }
        }
    }
    const anyOk = results.some(r => r.ok);
    if (anyOk && finalOptions.dedupe !== false) {
        stateStore.markRowsSent(preview.rowIds.map(id => ({ id })), finalOptions.mode);
    }
    return { ...preview, dryRun: false, sent: anyOk, contacts: contacts.length, results };
}
async function sendTestMessage(options = {}) {
    const config = loadConfig();
    const token = getToken(config);
    const contacts = getContacts(config, options);
    const text = `<b>✅ Test Telegram BettingApp</b>\n${new Date().toLocaleString('it-IT')}\nModulo: ${STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER}`;
    if (isRotationRequired()) return { success: false, reason: 'TELEGRAM_TOKEN_ROTATION_REQUIRED' };
    if (!token) return { success: false, reason: 'TELEGRAM_TOKEN_MANCANTE' };
    if (!contacts.length) return { success: false, reason: 'NESSUN_CONTATTO_TELEGRAM_VALIDO' };
    const results = [];
    for (const contact of contacts) {
        try {
            const sent = await sendTelegramMessage({ token, chatId: contact.chatId, text, parseMode: config.defaultParseMode || 'HTML' });
            results.push({ contact: contact.name, chatId: contact.chatId, ok: true, messageId: sent.result?.message_id || null });
        } catch (error) {
            results.push({ contact: contact.name, chatId: contact.chatId, ok: false, error: sanitizeTelegramError(error, token) });
        }
    }
    return { success: results.some(r => r.ok), results };
}
async function mainCli() {
    const command = process.argv[2] || 'preview';
    const options = { mode: process.argv[3] || undefined };
    if (command === 'status') return console.log(JSON.stringify({ config: publicConfig(), state: stateStore.loadState() }, null, 2));
    if (command === 'test') return console.log(JSON.stringify(await sendTestMessage({ force: true }), null, 2));
    if (command === 'send') return console.log(JSON.stringify(await sendTelegramReport({ ...options, force: true }), null, 2));
    if (command === 'reset-state') return console.log(JSON.stringify(stateStore.resetState(), null, 2));
    return console.log(JSON.stringify(previewTelegramReport(options), null, 2));
}

if (require.main === module) {
    mainCli().catch(error => {
        console.error(JSON.stringify({ success: false, error: error.message, stack: error.stack }, null, 2));
        process.exitCode = 1;
    });
}

module.exports = {
    STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER,
    TELEGRAM_CREDENTIAL_POLICY_VERSION,
    CONFIG_PATH,
    EXAMPLE_CONFIG_PATH,
    defaultConfig,
    ensureConfigFile,
    loadConfig,
    saveConfigPatch,
    publicConfig,
    getToken,
    getContacts,
    previewTelegramReport,
    sendTelegramReport,
    sendTestMessage,
    sendTelegramMessage,
    maskToken,
    isRotationRequired,
    sanitizeTelegramError
};
