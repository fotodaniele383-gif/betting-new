'use strict';

const { calculateTennisPredictionIndex } = require('./tennisUnifiedPredictionIndex');

const AI_PREDICTION_INDEX_BAND_VERSION = 'TENNIS_PATCH49_CROSS_SPORT_PREDICTION_INDEX_BANDS_V1';
const BAND_DEFINITIONS = Object.freeze(Array.from({ length: 10 }, (_, index) => Object.freeze({
    key: `${index * 10}_${(index + 1) * 10}`,
    min: index * 10,
    max: index === 9 ? 100.000001 : (index + 1) * 10,
    label: `${index * 10}–${(index + 1) * 10}`
})));

function text(value) { return String(value == null ? '' : value).trim(); }
function number(value, fallback = null) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value) { const n = number(value, null); return n == null ? null : Math.max(0, Math.min(100, n)); }
function normalizeSport(value) { return text(value).toUpperCase() === 'TENNIS' ? 'TENNIS' : 'CALCIO'; }
function inferSport(row = {}) {
    const explicit = text(row.sport_type).toUpperCase();
    if (explicit === 'TENNIS') return 'TENNIS';
    const joined = [row.bet_type, row.strategy_tag, row.league, row.tour_type].map(v => text(v).toUpperCase()).join(' ');
    return joined.includes('TENNIS') || joined.includes('[ATP]') || joined.includes('[WTA]') ? 'TENNIS' : 'CALCIO';
}
function isResolved(row = {}) { const status = text(row.status).toUpperCase(); return status === 'WON' || status === 'LOST'; }
function isActive(row = {}) { return number(row.paper_result_active, 1) === 1 && number(row.paper_result_conflict, 0) === 0; }
function isSingle(row = {}) { return !text(row.bet_type).toUpperCase().includes('MULTI'); }
function competition(row = {}, sport = inferSport(row)) {
    return text(row.league || row.tournament_name || row.tournament_category || row.tour_type) || (sport === 'TENNIS' ? 'Tennis · Altro' : 'Calcio · Altro');
}
function resolveReliability(row = {}, sport = inferSport(row)) {
    if (sport === 'TENNIS') return clamp(row.model_confidence_score ?? row.confidence ?? row.valueScore);
    return clamp(row.calcio_prediction_reliability_score ?? row.calcio_forecast_confidence_score ?? row.calcio_forecast_confidence_shadow ?? row.confidence);
}
function resolvePredictionIndex(row = {}, sport = inferSport(row)) {
    if (sport === 'CALCIO') return clamp(row.calcio_prediction_index_score);
    const explicit = clamp(row.tennis_prediction_index_score ?? row.tennisPredictionIndex?.score ?? row.tennis_prediction_index?.score);
    if (explicit != null) return explicit;
    const result = calculateTennisPredictionIndex(row, { phase: 'PERSISTED_PREMATCH_ANALYTICS' });
    return clamp(result?.score);
}
function getBand(score) { return BAND_DEFINITIONS.find(b => score >= b.min && score < b.max) || null; }
function wilson(wins, total, z = 1.959963984540054) {
    if (!total) return { lowPct: null, highPct: null };
    const p=wins/total, den=1+(z*z)/total, center=(p+(z*z)/(2*total))/den;
    const margin=(z*Math.sqrt((p*(1-p)+(z*z)/(4*total))/total))/den;
    return { lowPct: Math.max(0,(center-margin)*100), highPct: Math.min(100,(center+margin)*100) };
}
function reliabilityLabel(total) { return total>=100?'ALTA':total>=30?'BUONA':total>=15?'MEDIA':total>=5?'BASSA':total>0?'MOLTO_BASSA':'NESSUN_CAMPIONE'; }
function accumulator(band) { return { key:band.key,label:band.label,min:band.min,max:band.max>100?100:band.max,resolved:0,won:0,lost:0,indexSum:0,reliabilitySum:0,reliabilityRows:0,realStakeRows:0 }; }
function finalize(a) {
    const ci=wilson(a.won,a.resolved);
    return { ...a,
        winRatePct:a.resolved?(a.won/a.resolved)*100:null,
        lossRatePct:a.resolved?(a.lost/a.resolved)*100:null,
        averagePredictionIndex:a.resolved?a.indexSum/a.resolved:null,
        averageAiReliability:a.reliabilityRows?a.reliabilitySum/a.reliabilityRows:null,
        ciLowPct:ci.lowPct,ciHighPct:ci.highPct,reliability:reliabilityLabel(a.resolved)
    };
}
function aggregate(rows = [], sport = 'CALCIO') {
    const map=new Map(BAND_DEFINITIONS.map(b=>[b.key,accumulator(b)]));
    let excludedMissingIndex=0, resolved=0, won=0, lost=0, indexSum=0, reliabilitySum=0, reliabilityRows=0, realStakeRows=0;
    for (const row of rows) {
        const index=resolvePredictionIndex(row,sport);
        if (index==null) { excludedMissingIndex++; continue; }
        const band=getBand(index); if (!band) { excludedMissingIndex++; continue; }
        const target=map.get(band.key), status=text(row.status).toUpperCase(), rel=resolveReliability(row,sport), real=number(row.stake,0)>0;
        target.resolved++; target.indexSum+=index; resolved++; indexSum+=index;
        if(status==='WON'){target.won++;won++;} else {target.lost++;lost++;}
        if(rel!=null){target.reliabilitySum+=rel;target.reliabilityRows++;reliabilitySum+=rel;reliabilityRows++;}
        if(real){target.realStakeRows++;realStakeRows++;}
    }
    const ci=wilson(won,resolved);
    return { summary:{resolved,won,lost,winRatePct:resolved?won/resolved*100:null,lossRatePct:resolved?lost/resolved*100:null,averagePredictionIndex:resolved?indexSum/resolved:null,averageAiReliability:reliabilityRows?reliabilitySum/reliabilityRows:null,reliabilityRows,realStakeRows,reliability:reliabilityLabel(resolved),ciLowPct:ci.lowPct,ciHighPct:ci.highPct,excludedMissingIndex}, bands:BAND_DEFINITIONS.map(b=>finalize(map.get(b.key))) };
}
function prepare(rows = [], sport = 'CALCIO', scope = 'AI_SIGNALS') {
    const normalized=normalizeSport(sport), real=text(scope).toUpperCase()==='REAL_STAKE';
    return rows.filter(row=>isResolved(row)&&isActive(row)&&isSingle(row)&&inferSport(row)===normalized&&(!real||number(row.stake,0)>0));
}
function scopeReport(rows,sport,scope){
    const prepared=prepare(rows,sport,scope), overall=aggregate(prepared,sport), groups=new Map();
    for(const row of prepared){const key=competition(row,sport);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
    return {scope,rowPolicy:scope==='REAL_STAKE'?'WON_LOST_SINGLE_ACTIVE_STAKE_GT_ZERO':'WON_LOST_SINGLE_ACTIVE_ALL_AI_SIGNALS',overall,competitions:[...groups].map(([label,items])=>({key:label,label,...aggregate(items,sport)})).sort((a,b)=>b.summary.resolved-a.summary.resolved||a.label.localeCompare(b.label,'it'))};
}
function buildAiPredictionIndexBandPerformance(rows = [], options = {}) {
    const sport=normalizeSport(options.sport);
    return {success:true,readOnly:true,version:AI_PREDICTION_INDEX_BAND_VERSION,sport,indexMeaning:'PREMATCH_PREDICTION_INDEX_0_100',bandPolicy:'FIXED_10_POINT_BANDS_0_TO_100',bandDefinitions:BAND_DEFINITIONS.map(b=>({...b,max:b.max>100?100:b.max})),scopes:{AI_SIGNALS:scopeReport(rows,sport,'AI_SIGNALS'),REAL_STAKE:scopeReport(rows,sport,'REAL_STAKE')},safeguards:{readOnly:true,outcomeUsedOnlyForAggregation:true,pendingExcluded:true,voidPushExcluded:true,multiExcluded:true,conflictsExcluded:true,indexDoesNotAuthorizeStake:true}};
}
module.exports={AI_PREDICTION_INDEX_BAND_VERSION,BAND_DEFINITIONS,normalizeSport,inferSport,resolveReliability,resolvePredictionIndex,buildAiPredictionIndexBandPerformance};
