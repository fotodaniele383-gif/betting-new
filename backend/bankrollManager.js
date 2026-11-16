'use strict';
// AI BETTING QUANT PRO - SPORT BANKROLL MANAGER v1.1
// Hotfix v1.1a:
// - Corregge arrotondamento monetario sui casi .x675 evitando il problema floating point di toFixed.
// Fix v1.1:
// - Accetta bankroll con decimali per CALCIO e TENNIS.
// - Accetta sia punto sia virgola: 1088.67 / 1088,67.
// - Accetta formati italiani con separatore migliaia: 1.088,67.
// - Arrotonda sempre a 2 decimali e non blocca valori con centesimi.

const fs = require('fs');
const path = require('path');

const BANKROLL_MANAGER_VERSION = '1.2-AUDIT03';
const crypto = require('crypto');
const revisions = new WeakMap();
const DEFAULT_BANKROLL = 1000;
const STATE_FILE = path.join(__dirname, 'bankroll_state.json');

// AUDIT04: validate the entire input; never strip arbitrary text into money.
function parseCurrencyNumber(value, fallback = 0) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    if (typeof value !== 'string') return fallback;
    let raw = value.trim();
    // One optional currency symbol at an edge; spaces inside digits are invalid.
    if (/^[€$£]/.test(raw)) raw = raw.slice(1).trim();
    else if (/[€$£]$/.test(raw)) raw = raw.slice(0, -1).trim();
    if (/^[+-]?\d+(?:[.,]\d+)?$/.test(raw)) raw = raw.replace(',', '.');
    else if (/^[+-]?\d{1,3}(?:\.\d{3})+,\d+$/.test(raw)) raw = raw.replace(/\./g, '').replace(',', '.');
    else if (/^[+-]?\d{1,3}(?:,\d{3})+\.\d+$/.test(raw)) raw = raw.replace(/,/g, '');
    else return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
}

function safeNumber(value, fallback = 0) {
    return parseCurrencyNumber(value, fallback);
}

function roundMoney(value) {
    const n = parseCurrencyNumber(value, 0);

    if (!Number.isFinite(n)) return 0;

    // Non usare Number#toFixed direttamente per decidere l'arrotondamento:
    // valori come 1088.675 possono essere rappresentati internamente come
    // 1088.674999... e diventare 1088.67 invece di 1088.68.
    const epsilon = n >= 0 ? Number.EPSILON : -Number.EPSILON;
    const rounded = Math.round((n + epsilon) * 100) / 100;

    return Number(rounded.toFixed(2));
}

function normalizeSport(sport = 'CALCIO') {
    const s = String(sport || 'CALCIO').toUpperCase();

    if (s === 'TENNIS') return 'TENNIS';
    if (s === 'ALL') return 'ALL';

    return 'CALCIO';
}

function stateError(code, cause) {
    const e=new Error(code + ': bankroll non disponibile; verificare il file di stato e il backup.');
    e.code=code;if(cause)e.cause=cause;return e;
}
function validateState(state) {
    if(!state || typeof state!=='object' || !['1.0','1.1',BANKROLL_MANAGER_VERSION].includes(state.version))throw stateError('BANKROLL_STATE_SCHEMA_INVALID');
    for(const sport of ['CALCIO','TENNIS']) {
        const st=state.sports?.[sport];
        if(!st || typeof st!=='object')throw stateError('BANKROLL_STATE_SCHEMA_INVALID');
        for(const key of ['baseBankroll','baselineProfit']) {
            const n=st[key];
            if(typeof n!=='number' || !Number.isFinite(n) || Math.abs(n)>1e12 || (key==='baseBankroll' && n<0))throw stateError('BANKROLL_STATE_VALUE_INVALID');
        }
    }
    return state;
}
function stateHash(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function readState() {
    let bytes;
    try {bytes=fs.readFileSync(STATE_FILE);}catch(e){throw stateError(e.code==='ENOENT'?'BANKROLL_STATE_MISSING':'BANKROLL_STATE_READ_FAILED',e);}
    let state;
    try {state=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));}catch(e){throw stateError('BANKROLL_STATE_JSON_INVALID',e);}
    validateState(state);revisions.set(state,stateHash(bytes));return state;
}
function writeState(state) {
    validateState(state);
    const expected=revisions.get(state);
    if(!expected)throw stateError('BANKROLL_STATE_REVISION_REQUIRED');
    const next={...state,version:BANKROLL_MANAGER_VERSION,updatedAt:new Date().toISOString()};
    const lockPath=STATE_FILE+'.lock', temp=STATE_FILE+'.audit03-'+crypto.randomUUID()+'.tmp';
    let lock,fd,created=false;
    try {
        try{lock=fs.openSync(lockPath,'wx');}catch(e){throw stateError(e.code==='EEXIST'?'BANKROLL_STATE_BUSY':'BANKROLL_STATE_LOCK_FAILED',e);}
        if(stateHash(fs.readFileSync(STATE_FILE))!==expected)throw stateError('BANKROLL_STATE_CONCURRENT_CHANGE');
        fd=fs.openSync(temp,'wx');created=true;fs.writeFileSync(fd,JSON.stringify(next,null,2),'utf8');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
        if(stateHash(fs.readFileSync(STATE_FILE))!==expected)throw stateError('BANKROLL_STATE_CONCURRENT_CHANGE');
        fs.renameSync(temp,STATE_FILE);created=false;
        revisions.set(next,stateHash(Buffer.from(JSON.stringify(next,null,2))));return next;
    }catch(e){if(e.code?.startsWith('BANKROLL_'))throw e;throw stateError('BANKROLL_STATE_WRITE_FAILED',e);}
    finally {
        if(fd!==undefined)try{fs.closeSync(fd);}catch(_){}
        if(created)try{fs.unlinkSync(temp);}catch(_){}
        if(lock!==undefined){try{fs.closeSync(lock);}catch(_){}try{fs.unlinkSync(lockPath);}catch(_){} }
    }
}
// Strict parser only for manual bankroll input. The legacy general parser is audited separately.
function parseBankrollInput(value) {
    if(typeof value==='number')return Number.isFinite(value)&&value>=0&&value<=1e12?value:NaN;
    if(typeof value!=='string')return NaN;
    let raw=value.trim();
    if(/^\d+(?:[.,]\d{1,3})?$/.test(raw))raw=raw.replace(',','.');
    else if(/^\d{1,3}(?:\.\d{3})+,\d{1,3}$/.test(raw))raw=raw.replace(/\./g,'').replace(',','.');
    else if(/^\d{1,3}(?:,\d{3})+\.\d{1,3}$/.test(raw))raw=raw.replace(/,/g,'');
    else return NaN;
    const n=Number(raw);return Number.isFinite(n)&&n<=1e12?n:NaN;
}

function getSportRows(rows = [], sport = 'CALCIO', filters = {}) {
    const s = normalizeSport(sport);

    if (s === 'ALL') return Array.isArray(rows) ? rows : [];

    const isFootballRow = typeof filters.isFootballRow === 'function'
        ? filters.isFootballRow
        : (row) => String(row.sport_type || row.sport || row.bet_type || '').toLowerCase().includes('calcio');

    const isTennisRow = typeof filters.isTennisRow === 'function'
        ? filters.isTennisRow
        : (row) => String(row.sport_type || row.sport || row.bet_type || '').toLowerCase().includes('tennis');

    return (Array.isArray(rows) ? rows : []).filter(row => {
        return s === 'TENNIS'
            ? isTennisRow(row)
            : isFootballRow(row);
    });
}

function calculateProfit(rows = [], sport = 'CALCIO', filters = {}) {
    return roundMoney(
        getSportRows(rows, sport, filters).reduce((sum, row) => {
            if(typeof row.profit!=='number'||!Number.isFinite(row.profit))throw stateError('BANKROLL_PROFIT_INVALID');
            return sum + row.profit;
        }, 0)
    );
}

function getSportState(sport = 'CALCIO') {
    const s = normalizeSport(sport);
    const state = readState();

    if (s === 'ALL') return state.sports;

    return state.sports[s];
}

function getBankrollStatus(sport = 'CALCIO', rows = [], filters = {}) {
    const s = normalizeSport(sport);

    if (s === 'ALL') {
        const calcio = getBankrollStatus('CALCIO', rows, filters);
        const tennis = getBankrollStatus('TENNIS', rows, filters);

        return {
            sport: 'ALL',
            currentBankroll: roundMoney(calcio.currentBankroll + tennis.currentBankroll),
            baseBankroll: roundMoney(calcio.baseBankroll + tennis.baseBankroll),
            currentProfit: roundMoney(calcio.currentProfit + tennis.currentProfit),
            baselineProfit: roundMoney(calcio.baselineProfit + tennis.baselineProfit),
            sports: {
                CALCIO: calcio,
                TENNIS: tennis
            }
        };
    }

    const st = getSportState(s);
    const currentProfit = calculateProfit(rows, s, filters);
    const baseBankroll = roundMoney(st.baseBankroll);
    const baselineProfit = roundMoney(st.baselineProfit);

    return {
        sport: s,
        baseBankroll,
        baselineProfit,
        currentProfit,
        currentBankroll: roundMoney(baseBankroll + (currentProfit - baselineProfit)),
        updatedAt: st.updatedAt || null,
        source: st.source || 'UNKNOWN',
        version: BANKROLL_MANAGER_VERSION
    };
}

function setManualBankroll(sport = 'CALCIO', bankroll, rows = [], filters = {}) {
    const s = String(sport).toUpperCase();
    if(!['CALCIO','TENNIS','ALL'].includes(s))throw new Error('Sport non valido.');

    if (s === 'ALL') {
        throw new Error('Impostare il bankroll separatamente per CALCIO o TENNIS.');
    }

    const value = parseBankrollInput(bankroll);

    if (!Number.isFinite(value) || value < 0) {
        throw new Error('Bankroll non valido.');
    }

    const state = readState();
    const currentProfit = calculateProfit(rows, s, filters);

    state.sports[s] = {
        baseBankroll: roundMoney(value),
        baselineProfit: roundMoney(currentProfit),
        updatedAt: new Date().toISOString(),
        source: 'MANUAL'
    };

    writeState(state);

    return getBankrollStatus(s, rows, filters);
}

module.exports = {
    BANKROLL_MANAGER_VERSION,
    DEFAULT_BANKROLL,
    STATE_FILE,

    normalizeSport,
    parseCurrencyNumber,
    safeNumber,
    roundMoney,

    parseBankrollInput,
    validateState,
    readState,
    writeState,
    calculateProfit,
    getBankrollStatus,
    setManualBankroll
};
