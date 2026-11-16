'use strict';
// Probability First Calcio V1: prediction ranking, never an authority to book a stake.
const fs = require('node:fs');
const path = require('node:path');
const CONFIG_PATH = path.resolve(__dirname, '..', 'calcio_probability_first.json');
const VERSION = 'CALCIO_PROBABILITY_FIRST_V1_20261106';
const DEFAULTS = Object.freeze({
    version: VERSION,
    mode: 'PROBABILITY_FIRST',
    minOdd: 1.50,
    maxOdd: 2.40,
    minProbabilityPct: 55,
    minReliabilityScore: 55,
    paperSimulationStakeEuro: 2.00,
    mainPaperStakeEnabled: true,
    mainPaperStakeEuro: 2.00,
    mainPaperMinReliability: 40,
    mainPaperMinRobustProbabilityPct: 60,
    mainPaperMaxGapPp: 18,
    mainPaperMaxDays: 7
});
function finite(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function validPositive(v, lo, hi) { const n = finite(v); return n !== null && n >= lo && n <= hi; }
function validate(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw Error('PF_CONFIG_OBJECT_REQUIRED');
    const allowed = new Set(Object.keys(DEFAULTS));
    for (const key of Object.keys(source)) if (!allowed.has(key)) throw Error(`PF_CONFIG_UNKNOWN_FIELD:${key}`);
    const c = { ...DEFAULTS, ...source, version: VERSION };
    if (!['PROBABILITY_FIRST','VALUE'].includes(c.mode)) throw Error('PF_MODE_INVALID');
    for (const [key,lo,hi] of [['minOdd',1.01,20],['maxOdd',1.01,30],['minProbabilityPct',1,99],['minReliabilityScore',0,100],['paperSimulationStakeEuro',0,10],['mainPaperStakeEuro',2,5],['mainPaperMinReliability',20,80],['mainPaperMinRobustProbabilityPct',40,90],['mainPaperMaxGapPp',0,30],['mainPaperMaxDays',0.1,21]]) {
        if (!validPositive(c[key],lo,hi)) throw Error(`PF_INVALID_${key}`);
        c[key] = Number(c[key]);
    }
    if (typeof c.mainPaperStakeEnabled !== 'boolean') throw Error('PF_PAPER_MAIN_ENABLED_BOOLEAN_REQUIRED');
    if (c.maxOdd < c.minOdd || c.maxOdd - c.minOdd < 0.05) throw Error('PF_ODDS_RANGE_INVALID');
    return c;
}
function readConfig() {
    if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULTS };
    return validate(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
}
function saveConfig(input) {
    const old = readConfig();
    const safe = validate({ ...old, ...input });
    const temp = CONFIG_PATH + '.tmp-' + process.pid;
    fs.writeFileSync(temp, JSON.stringify(safe, null, 2) + '\n', { encoding:'utf8', flag:'wx', mode:0o600 });
    try { fs.renameSync(temp, CONFIG_PATH); }
    catch(e) { try { fs.unlinkSync(temp); } catch (_) {} throw e; }
    return safe;
}
function candidateProbability(c = {}) {
    const value = c.estimatedProb ?? c.estimated_prob ?? c.rawProb ?? c.probabilityPct ?? c.prob;
    const n = finite(value); return n !== null && n > 0 && n <= 100 ? n : null;
}
function candidateReliability(c = {}) {
    const n = finite(c.prediction_reliability_score ?? c.calcio_prediction_reliability_score ?? c.predictionReliability?.score);
    return n !== null && n >= 0 && n <= 100 ? n : null;
}
function quoteCertified(c = {}) {
    const cert = c.oddsCertification || c.odds_certification || c.extData?.oddsCertification;
    if (!cert || typeof cert !== 'object') return false;
    return cert.certified === true && cert.realDirect === true && cert.operationalEligible !== false;
}
function assess(candidate = {}, config = readConfig()) {
    const odd = finite(candidate.odd);
    const p = candidateProbability(candidate);
    const reliability = candidateReliability(candidate);
    const withinOdds = odd !== null && odd >= config.minOdd - 1e-9 && odd <= config.maxOdd + 1e-9;
    const supportedMarket = ['1','X','2','O2.5','U2.5'].includes(String(candidate.prediction || '').toUpperCase().replace(/\s+/g,''));
    const quoteOk = quoteCertified(candidate);
    const probabilityOk = p !== null && p >= config.minProbabilityPct;
    const reliabilityOk = reliability !== null && reliability >= config.minReliabilityScore;
    const qualityStatus = String(candidate.calcio_data_quality_status || candidate.dataQuality?.status || '').toUpperCase();
    const hardQualityVeto = qualityStatus === 'DATA_QUALITY_BLOCKED';
    const applicable = Boolean(withinOdds && supportedMarket && quoteOk && p !== null);
    const qualified = Boolean(applicable && probabilityOk && reliabilityOk && !hardQualityVeto);
    const reasons = [];
    if (!supportedMarket) reasons.push('MERCATO_NON_SUPPORTATO');
    if (!withinOdds) reasons.push('QUOTA_FUORI_FASCIA');
    if (!quoteOk) reasons.push('QUOTA_NON_CERTIFICATA_DIRETTA');
    if (p === null) reasons.push('PROBABILITA_NON_DISPONIBILE');
    if (!probabilityOk && p !== null) reasons.push('PROBABILITA_SOTTO_SOGLIA');
    if (!reliabilityOk) reasons.push('AFFIDABILITA_INSUFFICIENTE');
    if (hardQualityVeto) reasons.push('QUALITA_BLOCCATA');
    return {
        version: VERSION, mode: config.mode, prediction: String(candidate.prediction || ''),
        odd, probabilityPct:p, reliabilityScore:reliability, withinOdds, quoteCertified:quoteOk,
        probabilityOk, reliabilityOk, applicable, qualified,
        hypotheticalPaperStakeEuro: qualified ? config.paperSimulationStakeEuro : 0,
        isSimulationOnly:true, operationalAuthority:false, reasons
    };
}
function compare(a,b) { // Qualified first, then in-band and certified, then higher P(win). Never sort by EV.
    const aa = a || {}, bb = b || {};
    for (const key of ['qualified','applicable','withinOdds','quoteCertified']) {
        if (Boolean(aa[key]) !== Boolean(bb[key])) return Number(Boolean(bb[key])) - Number(Boolean(aa[key]));
    }
    const pa = finite(aa.probabilityPct) ?? -1, pb = finite(bb.probabilityPct) ?? -1;
    if (Math.abs(pa - pb) >= 0.0001) return pb - pa;
    const ra = finite(aa.reliabilityScore) ?? -1, rb = finite(bb.reliabilityScore) ?? -1;
    if (Math.abs(ra-rb) >= 0.0001) return rb-ra;
    return String(aa.prediction||'').localeCompare(String(bb.prediction||''));
}
function summarize(rows, config = readConfig()) {
    const all = (Array.isArray(rows) ? rows : []).map(row => assess(row, config));
    return { version:VERSION, config, ranked: all.slice().sort(compare),
        qualified:all.filter(x=>x.qualified).length, inBand:all.filter(x=>x.withinOdds).length,
        recommended:all.filter(x=>x.qualified).sort(compare).slice(0,2) };
}
module.exports = { VERSION, DEFAULTS, CONFIG_PATH, validate, readConfig, saveConfig, assess, compare, summarize };

// PF_MAIN_PAPER_V1_20261106
