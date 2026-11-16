// STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER
const express = require('express');
const notifier = require('./telegramNotifier');
const stateStore = require('./telegramStateStore');

const router = express.Router();
const STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER = 'STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER';

function ok(res, payload) { res.json({ success: true, mode: STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER, ...payload }); }
function fail(res, error, status = 500) { res.status(status).json({ success: false, mode: STEP109_TELEGRAM_EXTERNAL_UI_NOTIFIER, error: error.message || String(error) }); }

router.get('/status', (req, res) => {
    try {
        ok(res, { config: notifier.publicConfig(), state: stateStore.loadState() });
    } catch (error) { fail(res, error); }
});

router.get('/config', (req, res) => {
    try { ok(res, { config: notifier.publicConfig() }); }
    catch (error) { fail(res, error); }
});

router.post('/config', (req, res) => {
    try { ok(res, { config: notifier.saveConfigPatch(req.body || {}) }); }
    catch (error) { fail(res, error); }
});

router.post('/preview', (req, res) => {
    try { ok(res, notifier.previewTelegramReport(req.body || {})); }
    catch (error) { fail(res, error); }
});

router.post('/send', async (req, res) => {
    try { ok(res, await notifier.sendTelegramReport(req.body || {})); }
    catch (error) { fail(res, error); }
});

router.post('/test', async (req, res) => {
    try { ok(res, await notifier.sendTestMessage(req.body || {})); }
    catch (error) { fail(res, error); }
});

router.post('/reset-state', (req, res) => {
    try {
        if (!req.body || req.body.confirm !== true) return fail(res, new Error('Conferma richiesta: {"confirm":true}'), 400);
        ok(res, { state: stateStore.resetState() });
    } catch (error) { fail(res, error); }
});

module.exports = router;
