#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const rootArg = process.argv.indexOf('--root');
const ROOT = path.resolve(rootArg >= 0 && process.argv[rootArg + 1] ? process.argv[rootArg + 1] : path.join(__dirname, '..'));
const helper = require(path.join(ROOT, 'backend', 'calcioUnderstatAnalysisPrefetchAudit16dR1.js'));

const details = [];
function check(name, ok, data = null) { details.push({ name, ok: Boolean(ok), details: data }); }
function src(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
    const publicApp = src('public/app.js');
    const backendApp = src('backend/public/app.js');
    const server = src('backend/server.js');
    const adaptive = src('backend/adaptiveLearningShadowAudit16d.js');

    check('Frontend mirrors identical', publicApp === backendApp);
    check('Step94 explicit-enable bridge present', publicApp.includes('AUDIT16D_R1_STEP94_CALCIO_EXPLICIT_ENABLE_BRIDGE'));
    check('Calcio user Save sends explicit enable only when enabled', publicApp.includes("if (sport === 'calcio' && config.enabled === true) config.explicitEnable = true;"));
    check('Backend explicit enable guard preserved', server.includes('PATCH58_CALCIO_EXPLICIT_ENABLE_REQUIRED') && server.includes('body.explicitEnable !== true'));
    check('Understat prefetch integrated', server.includes('calcioUnderstatAnalysisPrefetchAudit16dR1.prefetch'));
    check('Legacy serial Understat await removed from analyze', !server.includes('const xgResult = await getUnderstatxG(config.name);'));
    check('League phase timing diagnostics integrated', server.includes('leaguePerformanceAudit16dR1.oddsApiMs') && server.includes('leaguePerformanceAudit16dR1.modelMs'));
    check('AUDIT16D remains shadow-only', adaptive.includes('productionAuthorized:false') && adaptive.includes('PROSPECTIVE_SHADOW_ONLY_FAIL_CLOSED'));

    const resolved = helper.resolveOptions({ CALCIO_UNDERSTAT_ANALYSIS_TIMEOUT_MS: '99999', CALCIO_UNDERSTAT_PREFETCH_CONCURRENCY: '99' });
    check('Understat timeout/concurrency clamped', resolved.timeoutMs === 8000 && resolved.concurrency === 4, resolved);

    let active = 0, maxActive = 0;
    const seenTimeouts = [];
    const names = ['A','B','C','D','E'];
    const cfg = Object.fromEntries(names.map(n => [n, { name:n }]));
    const states = new Map();
    const started = Date.now();
    const result = await helper.prefetch({
        leagueKeys: names,
        leagueConfig: cfg,
        timeoutMs: 1800,
        concurrency: 3,
        getUnderstatxG: async (name, options) => {
            seenTimeouts.push(options.timeoutMs);
            active++; maxActive = Math.max(maxActive, active);
            await sleep(60);
            active--;
            states.set(name, { status:'READY_TEST' });
            return { [name]: { xG_for:1, xG_against:1 } };
        },
        getUnderstatState: name => states.get(name) || { status:'UNKNOWN' }
    });
    const elapsed = Date.now() - started;
    check('Prefetch bounded concurrency is active', maxActive === 3, { maxActive, elapsed });
    check('Analysis timeout propagated to provider', seenTimeouts.length === 5 && seenTimeouts.every(v => v === 1800), seenTimeouts);
    check('All prefetched leagues preserved', result.diagnostics.completed === 5 && result.diagnostics.withTeams === 5, result.diagnostics);

    const fail = await helper.prefetch({
        leagueKeys:['OK','FAIL'], leagueConfig:{OK:{name:'OK'},FAIL:{name:'FAIL'}}, timeoutMs:1700, concurrency:2,
        getUnderstatxG: async name => { if (name === 'FAIL') { const e = new Error('TEST_FAIL'); e.code='TEST_FAIL'; throw e; } return {OK:{}}; },
        getUnderstatState: name => ({status:name==='FAIL'?'UNAVAILABLE_TEST':'READY_TEST'})
    });
    check('Provider error fails closed per league without aborting batch', fail.byLeague.FAIL.error === 'TEST_FAIL' && Object.keys(fail.byLeague.FAIL.teams).length === 0 && fail.byLeague.OK.error === null, fail.diagnostics);

    const failures = details.filter(x => !x.ok);
    const output = { success: failures.length === 0, patch:'AUDIT16D_R1', checks:details.length, failures, details };
    console.log(JSON.stringify(output, null, 2));
    process.exit(output.success ? 0 : 1);
})().catch(err => {
    console.log(JSON.stringify({ success:false, patch:'AUDIT16D_R1', error:err.stack || err.message }, null, 2));
    process.exit(1);
});
