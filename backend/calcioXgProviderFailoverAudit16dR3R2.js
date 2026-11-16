'use strict';

const AUDIT16D_R3_R2_XG_FAILOVER_VERSION = 'BETTINGAPP_R27_MULTISOURCE_OBSERVED_XG_FAILOVER_V2';
const footballDataXg=require('./calcioFootballDataXgR13');
const MIN_VALID_TEAMS = 8;
// R62: Understat season is '2026/2027', not the numeric 2026.
function seasonStartYear(value) {
  const raw = String(value ?? '').trim();
  const match = /^(?:\D*)(20\d{2})(?:\s*[\/-]\s*(20\d{2}))?$/.exec(raw);
  if (!match) return null;
  const start = Number(match[1]);
  return match[2] && Number(match[2]) !== start + 1 ? null : start;
}
function usableXg(value) {
  return value !== null && value !== undefined && String(value).trim() !== ''
    && Number.isFinite(Number(value)) && Number(value) > 0;
}
function resolveOperationalXgEvidenceMode({ providerState = {}, seasonEvidence = {}, hasBothTeams = false, homeXg = null, awayXg = null } = {}) {
  const sourceClass = String(providerState.sourceClass || '').toUpperCase();
  const providerId = String(providerState.providerId || '').toUpperCase();
  if (sourceClass === 'PROXY' || providerId === 'GOAL_SHOT_PROXY') return 'GOAL_SHOT_PROXY';
  if (!hasBothTeams || !usableXg(homeXg) || !usableXg(awayXg)) return 'GOAL_SHOT_PROXY';
  if (sourceClass === 'MODEL_ESTIMATED') return 'MODEL_ESTIMATED_XG';
  const status = String(seasonEvidence.status || 'UNKNOWN_SEASON');
  // No promotion of LKG, stale, unknown-season or model-estimated xG.
  if (sourceClass === 'LIVE_CERTIFIED' && status === 'CURRENT_SEASON_XG') return 'STRONG_REAL_XG';
  return status;
}

function teamCount(teams) { return teams && typeof teams === 'object' ? Object.keys(teams).length : 0; }
function isUnderstatLive(state = {}, teams = {}) {
  const status = String(state?.status || '');
  const source = String(state?.source || '');
  return teamCount(teams) >= MIN_VALID_TEAMS && !/LKG|MEMORY_CACHE|CIRCUIT|UNAVAILABLE|PROXY/i.test(status) && !/^(LKG|MEMORY_CACHE)$/i.test(source);
}
function isUnderstatLkg(state = {}, teams = {}) {
  const status = String(state?.status || '');
  const source = String(state?.source || '');
  return teamCount(teams) >= MIN_VALID_TEAMS && (/LKG|MEMORY_CACHE/i.test(status) || /^(LKG|MEMORY_CACHE)$/i.test(source));
}
function isSecondaryLive(result = {}) {
  return teamCount(result?.teams) >= MIN_VALID_TEAMS && result?.state?.status === 'READY_LIVE' && result?.state?.sourceClass === 'LIVE_CERTIFIED';
}
function isSecondaryLkg(result = {}) {
  return teamCount(result?.teams) >= MIN_VALID_TEAMS && result?.state?.sourceClass === 'LKG_CERTIFIED';
}
function understatStateToSelection(leagueName, primary = {}, sourceClass, status, reason) {
  const state = primary?.state || {};
  const seasonStart = seasonStartYear(state.seasonStart ?? state.season);
  return {
    teams: primary?.teams || {},
    state: {
      version: AUDIT16D_R3_R2_XG_FAILOVER_VERSION,
      providerId: 'UNDERSTAT', providerFamily: 'UNDERSTAT_XG', status, sourceClass,
      leagueName, season: state.season ?? null, seasonName: seasonStart === null ? null : `${seasonStart}/${seasonStart + 1}`,
      seasonStart,
      teamCount: teamCount(primary?.teams), selectionReason: reason,
      primaryStatus: state.status || null, primarySource: state.source || null,
      chain: [{ providerId: 'UNDERSTAT', status: state.status || 'UNKNOWN', sourceClass }],
      directStakeAuthority: false, directGateAuthority: false
    }
  };
}
function secondaryToSelection(leagueName, secondary = {}, sourceClass, status, reason, chain = []) {
  const s = secondary?.state || {};
  return {
    teams: secondary?.teams || {},
    state: {
      version: AUDIT16D_R3_R2_XG_FAILOVER_VERSION,
      providerId: 'SPORTMONKS', providerFamily: 'SPORTMONKS_XG', status, sourceClass,
      leagueName, leagueId: s.leagueId ?? null, seasonId: s.seasonId ?? null, seasonName: s.seasonName ?? null,
      seasonStart: seasonStartYear(s.seasonStart ?? s.season ?? s.seasonName),
      fetchedAt: s.fetchedAt || null, teamCount: teamCount(secondary?.teams), selectionReason: reason,
      secondaryStatus: s.status || null, secondaryError: s.error || null,
      chain: [...chain, { providerId: 'SPORTMONKS', status: s.status || 'UNKNOWN', sourceClass: s.sourceClass || sourceClass }],
      directStakeAuthority: false, directGateAuthority: false
    }
  };
}
function proxySelection(leagueName, chain = [], reason = 'NO_CERTIFIED_XG_PROVIDER_AVAILABLE') {
  return {
    teams: {},
    state: {
      version: AUDIT16D_R3_R2_XG_FAILOVER_VERSION,
      providerId: 'GOAL_SHOT_PROXY', providerFamily: 'DECLARED_PROXY', status: 'PROXY_ONLY', sourceClass: 'PROXY',
      leagueName, seasonStart: null, teamCount: 0, selectionReason: reason, chain,
      directStakeAuthority: false, directGateAuthority: false
    }
  };
}
function fromPrimaryOnly({ leagueName = '', primary = null } = {}) {
  if (isUnderstatLive(primary?.state, primary?.teams)) return understatStateToSelection(leagueName, primary, 'LIVE_CERTIFIED', 'PRIMARY_READY', 'UNDERSTAT_LIVE_PRIMARY');
  if (isUnderstatLkg(primary?.state, primary?.teams)) return understatStateToSelection(leagueName, primary, 'LKG_CERTIFIED', 'LKG_READY', 'UNDERSTAT_LKG_ONLY');
  return proxySelection(leagueName, [{ providerId: 'UNDERSTAT', status: primary?.state?.status || 'UNAVAILABLE', sourceClass: 'NONE' }]);
}
async function resolveLeague(leagueKey, config, primary, secondaryProvider, publicProvider = null) {
  const leagueName = config?.name || leagueKey;
  const primaryChain = [{ providerId: 'UNDERSTAT', status: primary?.state?.status || 'UNAVAILABLE', sourceClass: isUnderstatLive(primary?.state, primary?.teams) ? 'LIVE_CERTIFIED' : (isUnderstatLkg(primary?.state, primary?.teams) ? 'LKG_CERTIFIED' : 'NONE') }];
  if (isUnderstatLive(primary?.state, primary?.teams)) {
    return understatStateToSelection(leagueName, primary, 'LIVE_CERTIFIED', 'PRIMARY_READY', 'UNDERSTAT_LIVE_PRIMARY');
  }

  let secondary = null;
  try { secondary = await secondaryProvider.getSportmonksLeagueXg(leagueName); }
  catch (error) {
    secondary = { teams: {}, state: { status: 'UNAVAILABLE', sourceClass: 'NONE', error: error?.code || error?.message } };
  }
  if (isSecondaryLive(secondary)) {
    return secondaryToSelection(leagueName, secondary, 'LIVE_CERTIFIED', 'SECONDARY_READY', 'PRIMARY_NOT_LIVE_SECONDARY_CERTIFIED', primaryChain);
  }

  // R27: published match-level xG in public CSV. Unlike Understat or a direct
  // licensed Sportmonks feed, the third-party publisher cannot certify upstream
  // xG modelling. Therefore sourceClass stays LKG_CERTIFIED (<=0.25 weight),
  // even when just downloaded. NEVER direct stake/gate authority.
  let publicData=null;
  if(publicProvider && typeof publicProvider.getLeagueXg === 'function'){
    try { publicData = await publicProvider.getLeagueXg(leagueName); }
    catch(err){ publicData={teams:{},state:{status:'UNAVAILABLE',error:String(err?.code||err?.message||'XG_PUBLISHER_ERROR').slice(0,160)}}; }
  }
  const ps=publicData?.state || {};
  const expectedYear = (()=>{const d=new Date();return d.getUTCFullYear()-(d.getUTCMonth()<6?1:0)})();
  if(ps.providerId==='XGTABLES_PUBLIC' && ps.sourceClass==='LKG_CERTIFIED' &&
      ['PUBLISHED_CURRENT_FETCH','PUBLISHED_CURRENT_CACHE','PUBLISHED_LKG_AFTER_ERROR'].includes(ps.status) &&
      seasonStartYear(ps.seasonStart)===expectedYear && teamCount(publicData?.teams)>=MIN_VALID_TEAMS &&
      ps.directStakeAuthority===false && ps.directGateAuthority===false){
    return {teams:publicData.teams, state:{...ps,
      version:AUDIT16D_R3_R2_XG_FAILOVER_VERSION,
      selectionReason:'R27_THIRD_PARTY_PUBLISHED_XG_NOT_STAKE_AUTHORITY',
      chain:[...primaryChain,
        {providerId:'SPORTMONKS',status:secondary?.state?.status||'UNAVAILABLE',sourceClass:secondary?.state?.sourceClass||'NONE'},
        {providerId:'XGTABLES_PUBLIC',status:ps.status,sourceClass:'LKG_CERTIFIED',evidenceClass:ps.evidenceClass}],
      directStakeAuthority:false,directGateAuthority:false}};
  }
  // R14: Understat actually acquired in the current season is a valid published
  // observation even if read from LKG. Do not replace it with a different
  // model simply for lacking LIVE freshness. Never select prior-season LKG.
  const now = new Date();
  const expectedSeasonStart = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear()-1;
  const observedSeasonStart = seasonStartYear(primary?.state?.seasonStart ?? primary?.state?.season);
  if (isUnderstatLkg(primary?.state,primary?.teams) && observedSeasonStart === expectedSeasonStart) {
    return understatStateToSelection(leagueName,primary,'LKG_CERTIFIED','CURRENT_SEASON_LKG_READY','UNDERSTAT_CURRENT_SEASON_OBSERVED_VALID');
  }
  // R13: independent published xG observation stream, current-season CSV.
  // Never supersedes LIVE understat/Sportmonks; never claims primary Understat.
  // Only eligible with hash-matched current metadata and >=6 dated observations/team.
  const published=footballDataXg.fromLocal({leagueKey,leagueName,now:new Date()});
  if (published.state?.status==='PUBLISHER_OBSERVED_LKG') {
    return {teams:published.teams,state:{...published.state,version:AUDIT16D_R3_R2_XG_FAILOVER_VERSION,
      chain:[...primaryChain,{providerId:'SPORTMONKS',status:secondary?.state?.status||'UNAVAILABLE',sourceClass:secondary?.state?.sourceClass||'NONE'},
        {providerId:'FOOTBALL_DATA_XG',status:'PUBLISHER_OBSERVED_LKG',sourceClass:'LKG_CERTIFIED',originPrimaryModelVerified:false}],
      originalUnderstatLkgAvailable:isUnderstatLkg(primary?.state,primary?.teams)} };
  }
  // LKG selection occurs only after both live paths failed. Prefer the freshest declared season.
  const candidates = [];
  if (isUnderstatLkg(primary?.state, primary?.teams)) {
    candidates.push({ kind: 'UNDERSTAT', seasonStart: seasonStartYear(primary?.state?.seasonStart ?? primary?.state?.season) || 0, value: understatStateToSelection(leagueName, primary, 'LKG_CERTIFIED', 'LKG_READY', 'LIVE_PROVIDERS_UNAVAILABLE_UNDERSTAT_LKG') });
  }
  if (isSecondaryLkg(secondary)) {
    candidates.push({ kind: 'SPORTMONKS', seasonStart: seasonStartYear(secondary?.state?.seasonStart ?? secondary?.state?.seasonName) || 0, value: secondaryToSelection(leagueName, secondary, 'LKG_CERTIFIED', 'LKG_READY', 'LIVE_PROVIDERS_UNAVAILABLE_SPORTMONKS_LKG', primaryChain) });
  }
  candidates.sort((a,b) => b.seasonStart - a.seasonStart || (a.kind === 'SPORTMONKS' ? -1 : 1));
  if (candidates[0]) {
    candidates[0].value.state.chain = [...primaryChain, { providerId: 'SPORTMONKS', status: secondary?.state?.status || 'UNAVAILABLE', sourceClass: secondary?.state?.sourceClass || 'NONE' }];
    return candidates[0].value;
  }
  return proxySelection(leagueName, [...primaryChain, { providerId: 'SPORTMONKS', status: secondary?.state?.status || 'UNAVAILABLE', sourceClass: secondary?.state?.sourceClass || 'NONE' }]);
}
async function prefetch({ leagueKeys = [], leagueConfig = {}, understatPrefetch = {}, secondaryProvider, publicProvider = null, concurrency = 2 } = {}) {
  if (!secondaryProvider || typeof secondaryProvider.getSportmonksLeagueXg !== 'function') throw new Error('R3_R2_SECONDARY_PROVIDER_REQUIRED');
  const startedAt = new Date().toISOString();
  const byLeague = {};
  let cursor = 0;
  async function worker() {
    while (cursor < leagueKeys.length) {
      const idx = cursor++;
      const key = leagueKeys[idx];
      byLeague[key] = await resolveLeague(key, leagueConfig[key] || { name: key }, understatPrefetch?.byLeague?.[key] || null, secondaryProvider, publicProvider);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(Number(concurrency) || 2, leagueKeys.length || 1)) }, worker));
  const selections = leagueKeys.map(key => ({ leagueKey: key, leagueName: leagueConfig[key]?.name || key, ...byLeague[key]?.state }));
  const diagnostics = {
    version: AUDIT16D_R3_R2_XG_FAILOVER_VERSION, startedAt, completedAt: new Date().toISOString(),
    selected: selections.reduce((acc, x) => { acc[x.providerId || 'UNKNOWN'] = (acc[x.providerId || 'UNKNOWN'] || 0) + 1; return acc; }, {}),
    leagues: selections, directStakeAuthority: false, directGateAuthority: false
  };
  return { version: AUDIT16D_R3_R2_XG_FAILOVER_VERSION, byLeague, diagnostics };
}
function buildSeasonEvidence(state = {}, kickoffDate, classifySeasonForKickoff) {
  if (!state || state.providerId === 'GOAL_SHOT_PROXY' || state.sourceClass === 'PROXY') {
    return { status: 'GOAL_SHOT_PROXY', authorityWeight: 0.20, sourceStart: null, expectedStart: null, providerId: 'GOAL_SHOT_PROXY', sourceClass: 'PROXY' };
  }
  // AUDIT16D_R3_R3B_SERIE_B_MODEL_ESTIMATED_XG_V1
  // A declared model estimate may participate in the existing xG blend, but it is
  // never promoted to LIVE_CERTIFIED/LKG_CERTIFIED and never gains more authority
  // than the legacy GOAL_SHOT_PROXY path.
  if (state.sourceClass === 'MODEL_ESTIMATED' || state.evidenceClass === 'MODEL_ESTIMATED_XG') {
    const sourceStart = seasonStartYear(state.seasonStart ?? state.season ?? state.seasonName);
    return {
      status: 'MODEL_ESTIMATED_XG',
      authorityWeight: Math.min(Number(state.authorityWeight) || 0.20, 0.20),
      sourceStart,
      expectedStart: null,
      providerId: state.providerId || 'SERIE_B_ESTIMATED_XG',
      sourceClass: 'MODEL_ESTIMATED',
      selectionReason: state.selectionReason || 'DECLARED_MODEL_ESTIMATE'
    };
  }
  const seasonStart = seasonStartYear(state.seasonStart ?? state.season ?? state.seasonName);
  let evidence = null;
  if (seasonStart !== null && typeof classifySeasonForKickoff === 'function') evidence = classifySeasonForKickoff(seasonStart, kickoffDate);
  if (!evidence) evidence = { status: 'UNKNOWN_SEASON', authorityWeight: state.sourceClass === 'LIVE_CERTIFIED' ? 0.50 : 0.20, sourceStart: seasonStart, expectedStart: null };
  if (state.sourceClass === 'LKG_CERTIFIED') {
    evidence = { ...evidence, authorityWeight: Math.min(Number(evidence.authorityWeight) || 0.25, 0.25), status: evidence.status === 'CURRENT_SEASON_XG' ? 'CURRENT_SEASON_XG_LKG' : evidence.status };
  }
  return { ...evidence, providerId: state.providerId, sourceClass: state.sourceClass, selectionReason: state.selectionReason || null };
}

module.exports = {
  AUDIT16D_R3_R2_XG_FAILOVER_VERSION,
  MIN_VALID_TEAMS, seasonStartYear, resolveOperationalXgEvidenceMode,
  isUnderstatLive, isUnderstatLkg, isSecondaryLive, isSecondaryLkg,
  fromPrimaryOnly, resolveLeague, prefetch, buildSeasonEvidence, proxySelection
};
