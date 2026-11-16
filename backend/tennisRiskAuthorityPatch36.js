'use strict';

const baseAuthority = require('./tennisStakeAuthorityPatch35');

const VERSION = 'TENNIS_FINAL_RISK_AUTHORITY_V1_PATCH36';
const WTA_STALE_LIMIT_DAYS = 21;

function number(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function upper(value) { return String(value == null ? '' : value).toUpperCase(); }
function normalizeTour(input = {}) {
  const text = upper(`${input.tour || ''} ${input.league || ''} ${input.betType || input.bet_type || ''}`);
  return text.includes('WTA') ? 'WTA' : text.includes('ATP') ? 'ATP' : 'UNKNOWN';
}
function freshness(input = {}) {
  const source = input.dataReadiness || input.freshness || {};
  return {
    status: upper(source.sourceFreshnessStatus || source.status || 'UNAVAILABLE'),
    days: Number.isFinite(Number(source.sourceFreshnessDays ?? source.dataAgeDays)) ? Number(source.sourceFreshnessDays ?? source.dataAgeDays) : null,
    providerId: source.sourceProviderId || source.providerId || null,
    latestMatchAt: source.sourceLatestMatchAt || source.latestMatchAt || null
  };
}
function decide(input = {}) {
  const base = baseAuthority.decide(input);
  const tour = normalizeTour(input);
  const source = freshness(input);
  let finalStake = number(base.finalStake, 0);
  let status = base.status;
  let reason = base.reason;
  let circuitBreaker = false;
  if (tour === 'WTA' && (source.status === 'STALE' || source.status === 'UNAVAILABLE' || (source.days !== null && source.days > WTA_STALE_LIMIT_DAYS))) {
    finalStake = 0;
    status = 'PAPER_ONLY_WTA_TECHNICAL_DATA_STALE';
    reason = `WTA match-level ${source.status || 'UNAVAILABLE'}${source.days === null ? '' : ` da ${source.days.toFixed(1)} giorni`}: nessuna autorità stake fino a refresh certificato.`;
    circuitBreaker = true;
  }
  return {
    ...base,
    version: VERSION,
    baseAuthorityVersion: base.version,
    finalStake,
    status,
    reason,
    tour,
    dataFreshnessStatus: source.status,
    dataFreshnessDays: source.days,
    dataProviderId: source.providerId,
    dataLatestMatchAt: source.latestMatchAt,
    wtaStaleLimitDays: WTA_STALE_LIMIT_DAYS,
    circuitBreaker,
    soleFinalStakeAuthority: true,
    modelAuthority: false,
    qualityAuthority: false,
    settlementAuthority: false,
    clvAuthority: false
  };
}
function toPersistenceFields(decision = {}, at = new Date().toISOString()) {
  return {
    tennis_stake_authority_version: decision.version || VERSION,
    tennis_stake_authority_status: decision.status || 'UNKNOWN',
    tennis_stake_authority_proposed_stake: number(decision.proposedStake, 0),
    tennis_stake_authority_final_stake: number(decision.finalStake, 0),
    tennis_stake_authority_sample: number(decision.sample, 0),
    tennis_stake_authority_reliability: decision.reliability || 'NO_SAMPLE',
    tennis_stake_authority_reason: decision.reason || '',
    tennis_stake_authority_decided_at: at,
    tennis_risk_authority_version: decision.version || VERSION,
    tennis_risk_authority_status: decision.status || 'UNKNOWN',
    tennis_risk_authority_reason: decision.reason || '',
    tennis_risk_authority_tour: decision.tour || 'UNKNOWN',
    tennis_risk_authority_freshness_status: decision.dataFreshnessStatus || 'UNAVAILABLE',
    tennis_risk_authority_freshness_days: decision.dataFreshnessDays,
    tennis_risk_authority_circuit_breaker: decision.circuitBreaker ? 1 : 0,
    tennis_risk_authority_decided_at: at
  };
}
function health() {
  return {
    version: VERSION,
    baseAuthorityVersion: baseAuthority.VERSION,
    wtaStaleLimitDays: WTA_STALE_LIMIT_DAYS,
    wtaStaleCircuitBreaker: true,
    soleFinalStakeAuthority: true,
    noStakeIncrease: true,
    modelAuthority: false,
    qualityAuthority: false,
    settlementAuthority: false,
    clvAuthority: false
  };
}
module.exports = { VERSION, WTA_STALE_LIMIT_DAYS, normalizeTour, freshness, decide, toPersistenceFields, health };
