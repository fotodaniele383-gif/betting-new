'use strict';

const CALCIO_MULTI_PROVIDER_EVIDENCE_VERSION = 'BETTINGAPP_R13_MULTI_PROVIDER_CERTIFICATION_20261108';

const PROVIDERS = Object.freeze([
  Object.freeze({ id:'FOOTBALL_DATA_LOCAL', cost:'ZERO_KEY', authority:'HISTORICAL_QUANTITATIVE', family:'RESULTS_HISTORY', order:1, cache:'LOCAL_LKG' }),
  Object.freeze({ id:'CLUB_ELO_CSV', cost:'ZERO_KEY', authority:'STRENGTH_QUANTITATIVE', family:'STRENGTH_RATING', order:2, cache:'DAILY_LKG' }),
  Object.freeze({ id:'UNDERSTAT_JSON', cost:'ZERO_KEY', authority:'XG_QUANTITATIVE', family:'EXPECTED_GOALS', order:3, cache:'LOCAL_LKG' }),
  Object.freeze({ id:'PAPER_TRADING_LOCAL', cost:'ZERO_KEY', authority:'EMPIRICAL_AUDIT', family:'MODEL_AUDIT', order:4, cache:'SQLITE' }),
  Object.freeze({ id:'NEWS_RSS_MULTI_SOURCE', cost:'ZERO_KEY', authority:'QUALITATIVE_ONLY', family:'TEAM_NEWS', order:5, cache:'TTL_CACHE' }),
  Object.freeze({ id:'THE_ODDS_API', cost:'METERED', authority:'LIVE_MARKET', family:'MARKET', order:6, cache:'TTL_CACHE_FIRST' })
]);

function bool(v){ return v === true || v === 1 || String(v).toLowerCase() === 'true'; }
function num(v,f=0){ const n=Number(v); return Number.isFinite(n)?n:f; }
function buildEvidenceHealth(context = {}) {
  const understat = context.understatState || context.understatProviderState || {};
  const sourceAudit = context.sourceAudit || {};
  const clubElo = context.clubEloEvidence || {};
  const understatCertificate = (Array.isArray(sourceAudit.sources) ? sourceAudit.sources : []).find(s => s.id === 'UNDERSTAT_XG') || {};
  const sourceMode = String(context.xgEvidenceMode || context.understatAuthorityStatus || '').toUpperCase();
  const stateMode = String(understat.sourceClass || context.xgSourceClass || '').toUpperCase();
  const providerId = String(context.xgProviderId || understat.providerId || '').toUpperCase();
  const directVerified = bool(context.hasBothXg) && sourceMode === 'STRONG_REAL_XG'
    && stateMode === 'LIVE_CERTIFIED' && providerId === 'UNDERSTAT'
    && bool(context.xgSeasonVerified) && bool(context.xgTeamPairVerified);
  const sourceCertified = understatCertificate.status === 'AVAILABLE'
    && understatCertificate.authority === 'MODEL_INPUT'
    && understatCertificate.available === true && bool(context.hasBothXg);
  const realUnderstat = directVerified || sourceCertified;
  const rows = [
    { id:'FOOTBALL_DATA_LOCAL', status: context.footballDataLoaded === false ? 'UNAVAILABLE' : 'AVAILABLE', quantitative:true, authoritative:context.footballDataLoaded !== false },
    { id:'CLUB_ELO_CSV', status: clubElo.available ? (clubElo.authoritative ? 'AVAILABLE' : 'LKG') : 'UNAVAILABLE', quantitative:true, authoritative:clubElo.authoritative === true },
    { id:'UNDERSTAT_JSON', status: realUnderstat ? 'AVAILABLE' : (understat.lastKnownGoodAvailable || String(understat.status||'').includes('LKG') ? 'LKG_PRIOR' : 'FALLBACK'), quantitative:true, authoritative:realUnderstat },
    { id:'PAPER_TRADING_LOCAL', status: num(context.historicalSample,0)>0 ? 'AVAILABLE' : 'NO_SAMPLE', quantitative:false, authoritative:false },
    { id:'NEWS_RSS_MULTI_SOURCE', status: num(sourceAudit.coveragePct ?? sourceAudit.sourceCoverageConfidence,0)>0 ? 'AVAILABLE' : 'PARTIAL', quantitative:false, authoritative:false },
    { id:'THE_ODDS_API', status: context.oddsAvailable === false ? 'UNAVAILABLE' : 'AVAILABLE', quantitative:true, authoritative:context.oddsAvailable !== false }
  ];
  const available = rows.filter(x=>['AVAILABLE','LKG','LKG_PRIOR'].includes(x.status)).length;
  const usableQuant = rows.filter(x=>x.quantitative && ['AVAILABLE','LKG','LKG_PRIOR'].includes(x.status)).length;
  const authoritativeRows = rows.filter(x=>x.quantitative && x.authoritative && x.status === 'AVAILABLE');
  const authoritativeFamilies = [...new Set(authoritativeRows.map(row => PROVIDERS.find(p=>p.id===row.id)?.family).filter(Boolean))];
  const authoritativeQuant = authoritativeFamilies.length;
  return {
    version: CALCIO_MULTI_PROVIDER_EVIDENCE_VERSION,
    policy: 'CACHE_AND_ZERO_KEY_FIRST_THEN_METERED_LIVE_MARKET',
    providers: rows.map(row=>({ ...PROVIDERS.find(p=>p.id===row.id), ...row })),
    availableProviders: available,
    quantitativeProviders: usableQuant,
    authoritativeQuantitativeProviders: authoritativeQuant,
    authoritativeFamilies,
    coveragePct: Math.round(available / rows.length * 100),
    status: authoritativeQuant >= 3 ? 'MULTI_PROVIDER_STRONG' : authoritativeQuant >= 2 ? 'MULTI_PROVIDER_USABLE' : 'MULTI_PROVIDER_FRAGILE',
    safeguards: {
      noProbabilityInflationFromProviderCount:true,
      qualitativeSourcesNeverDirectlyChangeProbability:true,
      understatPriorIsNotRealXg:true,
      xgRequiresProvenanceAndBothTeams:true,
      providerFamiliesDeduplicated:true,
      noNewMeteredCalls:true
    }
  };
}
module.exports = { CALCIO_MULTI_PROVIDER_EVIDENCE_VERSION, PROVIDERS, buildEvidenceHealth };
