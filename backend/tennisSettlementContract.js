'use strict';

const crypto = require('crypto');
const { resolveScoringRules } = require('./tennisScoringRulesAudit02');

const TENNIS_SETTLEMENT_CONTRACT_VERSION = 'TENNIS_SETTLEMENT_CONTRACT_V2_AUDIT02';
const SETTLEMENT_STATES = Object.freeze({
  PENDING: 'PENDING',
  PROPOSED: 'PROPOSED',
  VERIFIED: 'VERIFIED',
  CONFLICT: 'CONFLICT',
  VOID: 'VOID',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
  REJECTED: 'REJECTED'
});

const SETTLEMENT_SCHEMA_COLUMNS = Object.freeze([
  ['settlement_contract_status', 'TEXT'],
  ['settlement_contract_reason', 'TEXT'],
  ['settlement_contract_version', 'TEXT'],
  ['settlement_source_event_id', 'TEXT'],
  ['settlement_winner_name', 'TEXT'],
  ['settlement_score', 'TEXT'],
  ['settlement_observed_at', 'TEXT'],
  ['settlement_confidence', 'REAL'],
  ['settlement_evidence_hash', 'TEXT'],
  ['settlement_event_fingerprint', 'TEXT'],
  ['settlement_market_fingerprint', 'TEXT'],
  ['settlement_operation_id', 'TEXT'],
  ['settlement_source_tier', 'TEXT']
]);

function text(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return text(value).toUpperCase(); }
function number(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function clamp(value, min, max) { const n = number(value); return n == null ? min : Math.max(min, Math.min(max, n)); }
function normalizeName(value) {
  return text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function lastName(value) { const parts = normalizeName(value).split(' ').filter(Boolean); return parts[parts.length - 1] || ''; }
function isSamePlayer(a, b) {
  const aa = normalizeName(a), bb = normalizeName(b);
  if (!aa || !bb) return false;
  if (aa === bb) return true;
  const la = lastName(a), lb = lastName(b);
  if (!la || la !== lb) return false;
  const ia = aa[0], ib = bb[0];
  return !ia || !ib || ia === ib;
}
function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableObject(value[key])]));
  }
  return value;
}
function hashEvidence(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableObject(value))).digest('hex');
}
function parseTs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  const n = Number(value);
  if (Number.isFinite(n) && text(value) !== '') return n < 1e12 ? n * 1000 : n;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
}
function isTotals(match = {}) {
  return /TOTAL|OVER|UNDER|OU|GAMES/.test(upper(match.market_type || match.market || match.prediction));
}
function isPendingLikeSource(source) {
  return /PENDING|SCORE_NOT_AVAILABLE|NOT_READY|API_EXHAUSTED|NO_EVALUATION|TIMEOUT/.test(upper(source));
}
function classifySourceTier(source, resolution = {}) {
  const s = upper(source);
  if (s === 'AUDIT06_DOCUMENTED_RESULTS') return 'STRUCTURED_WEB';
  if (resolution.conflict === true) return 'CONFLICT';
  if (isPendingLikeSource(s)) return 'PENDING';
  if (s === 'MANUAL_FORCE' || s.includes('MANUAL')) return 'MANUAL';
  if (/STEP10[7-9]_CERTIFIED|STEP110_CERTIFIED|CERTIFIED_REUTERS|CERTIFIED_AP|ATP_OFFICIAL_RESULTS_PATCH29|WTA_OFFICIAL_RESULTS_PATCH29|OFFICIAL_TOUR_RESULTS_PATCH29/.test(s)) return 'CERTIFIED';
  if (s === 'ODDS_API_SCORES' || s.includes('THE_ODDS_API')) return 'PROVIDER';
  if (s.startsWith('TENNISMYLIFE')) return 'STRUCTURED_WEB';
  if (s.includes('WEB_FALLBACK') || s.includes('DUCKDUCKGO') || s.includes('AI_SEARCH')) return 'WEAK_WEB';
  if (s.includes('LOCAL_RESULT_VAULT') || s.includes('CACHE')) {
    return upper(resolution.settlementContractStatus || resolution.contractStatus) === SETTLEMENT_STATES.VERIFIED ? 'VERIFIED_CACHE' : 'LEGACY_CACHE';
  }
  return s ? 'UNKNOWN_SOURCE' : 'MISSING_SOURCE';
}
function parseScore(score) {
  const raw = text(score).replace(/[–—−]/g,'-');
  const empty = {available:!!raw,valid:false,setCount:0,totalGames:null};
  if (!raw) return {...empty,reason:'SCORE_MISSING'};
  if (/\b(?:RET(?:IRED|IREMENT)?|WALKOVER|VOID|CANCEL(?:LED|ED)?|SUSPEND(?:ED)?|INTERRUPTED|ABANDONED|DEFAULT(?:ED)?|DEF)\b|W\s*\/\s*O/i.test(raw))
    return {...empty,requiresReview:true,reason:'EXCEPTIONAL_RESULT_REQUIRES_BOOKMAKER_REVIEW'};
  const re=/(\d{1,2})\s*[-:]\s*(\d{1,2})(?:\s*\((\d{1,2})(?:\s*[-:]\s*(\d{1,2}))?\))?/g;
  const sets=[], annotations=[];let m, end=0;
  while((m=re.exec(raw))) {
    if(!/^[\s,;]*$/.test(raw.slice(end,m.index)))return {...empty,reason:'SCORE_UNPARSEABLE'};
    sets.push([Number(m[1]),Number(m[2])]);annotations.push(m[3]===undefined?null:[Number(m[3]),m[4]===undefined?null:Number(m[4])]);end=re.lastIndex;
  }
  if(!sets.length||!/^[\s,;]*$/.test(raw.slice(end)))return {...empty,reason:'SCORE_UNPARSEABLE'};
  const sane=sets.every(([a,b],i)=>{
    const hi=Math.max(a,b),lo=Math.min(a,b);
    return ((hi===6&&lo<=4)||(hi===7&&(lo===5||lo===6)))&&(!annotations[i]||(hi===7&&lo===6));
  });
  return {available:true,valid:sane,setCount:sets.length,totalGames:sets.reduce((n,[a,b])=>n+a+b,0),sets,annotations,reason:sane?'SCORE_OK':'SCORE_INVALID_OR_INCOMPLETE_SET'};
}
function validateCompletedMatch(audit,format) {
  if(!audit.valid)return audit.reason;
  const needed=format.bestOf===5?3:2;let a=0,b=0;
  for(let i=0;i<audit.sets.length;i++) {
    if(a===needed||b===needed)return 'SCORE_AFTER_MATCH_COMPLETED';
    const [x,y]=audit.sets[i], annotation=audit.annotations[i];
    const target=a===needed-1&&b===needed-1?format.finalSetTieBreakTarget:7;
    if(annotation&&annotation[1]!==null) {
      const [p,q]=annotation,hi=Math.max(p,q),lo=Math.min(p,q);
      if(!((hi===target&&lo<=target-2)||(hi>target&&hi-lo===2))||(p>q)!==(x>y))return 'INVALID_TIEBREAK_POINTS';
    }
    if(x>y)a++;else b++;
  }
  audit.setsWon=[a,b];audit.scoreWinnerSide=a>b?1:2;
  return a===needed||b===needed?null:'MATCH_NOT_COMPLETED';
}
function buildSourceEventId(match = {}, resolution = {}) {
  const explicit = text(resolution.sourceEventId || resolution.source_event_id || resolution.eventId || resolution.id);
  if (explicit) return explicit;
  const source = upper(resolution.source);
  if (!source || isPendingLikeSource(source)) return '';
  const material = {
    source,
    date: match.canonical_match_datetime || match.match_date || null,
    home: normalizeName(match.home_team || match.home),
    away: normalizeName(match.away_team || match.away),
    winner: normalizeName(resolution.winnerName || resolution.winner_player_name || ''),
    score: text(resolution.score || resolution.rawScore || ''),
    totalGames: number(resolution.totalGames)
  };
  return `${source.replace(/[^A-Z0-9]+/g, '_').slice(0, 32)}:${hashEvidence(material).slice(0, 20)}`;
}
function buildEvidenceMaterial(match = {}, resolution = {}, context = {}) {
  return {
    source: text(resolution.source),
    sourceEventId: buildSourceEventId(match, resolution),
    observedAt: resolution.observedAt || resolution.observed_at || context.observedAt || new Date().toISOString(),
    eventFingerprint: text(match.tennis_event_fingerprint || context.eventFingerprint),
    marketFingerprint: text(match.tennis_market_fingerprint || context.marketFingerprint),
    home: text(match.home_team || match.home),
    away: text(match.away_team || match.away),
    winnerName: text(resolution.winnerName || resolution.winner_player_name),
    winnerSide: resolution.winner,
    score: text(resolution.score || resolution.rawScore),
    totalGames: resolution.totalGames,
    providerCompleted: resolution.providerCompleted ?? null,
    scoreOrientation: resolution.scoreOrientation || 'CANONICAL',
    scoringRules: resolveScoringRules(match),
    rawEvidence: resolution.rawEvidence || resolution.raw || resolution.evidence || null
  };
}
function evaluateTennisSettlementContract(match = {}, resolution = {}, context = {}) {
  const source = text(resolution.source);
  const sourceTier = classifySourceTier(source, resolution);
  const eventFingerprint = text(match.tennis_event_fingerprint || context.eventFingerprint);
  const marketFingerprint = text(match.tennis_market_fingerprint || context.marketFingerprint);
  const observedAt = resolution.observedAt || resolution.observed_at || context.observedAt || new Date().toISOString();
  const observedTs = parseTs(observedAt);
  const matchTs = parseTs((upper(source)==='AUDIT06_DOCUMENTED_RESULTS' && match.canonical_event_time_safety_utc) || match.canonical_match_datetime || match.match_date || context.matchStart);
  const sourceEventId = buildSourceEventId(match, resolution);
  const winnerName = text(resolution.winnerName || resolution.winner_player_name);
  const winnerSide = resolution.winner === 'VOID' ? null : number(resolution.winner);
  const score = text(resolution.score || resolution.rawScore);
  const scoreAudit = parseScore(score);
  const totals = isTotals(match);
  const reasons = [];
  if (upper(source) === 'AUDIT06_DOCUMENTED_RESULTS' && !require('./audit06SettlementReceipt')(match,resolution)) reasons.push('AUDIT06_RECEIPT_MISMATCH');
  const format = resolveScoringRules(match);

  if (resolution.conflict === true || sourceTier === 'CONFLICT') reasons.push('CONFLICTING_EVIDENCE');
  if (!source) reasons.push('MISSING_SOURCE');
  if (isPendingLikeSource(source)) reasons.push('PENDING_OR_UNAVAILABLE_SOURCE');
  if (!eventFingerprint) reasons.push('MISSING_EVENT_FINGERPRINT');
  if (!marketFingerprint) reasons.push('MISSING_MARKET_FINGERPRINT');
  if (!sourceEventId) reasons.push('MISSING_SOURCE_EVENT_ID');
  if (observedTs == null) reasons.push('MISSING_OBSERVED_TIMESTAMP');
  if (matchTs == null) reasons.push('MISSING_MATCH_TIMESTAMP');
  if (matchTs != null && observedTs != null && observedTs < matchTs) reasons.push('EVIDENCE_BEFORE_MATCH_START');

  const isVoid = resolution.isVoid === true || resolution.winner === 'VOID' || resolution.totalGames === 'VOID';
  const exceptional = isVoid || scoreAudit.requiresReview === true || resolution.requiresBookmakerRule === true || resolution.automaticSettlement === false || /RETIRE|SUSPEND|CANCEL|WALKOVER|ABANDON|INTERRUPT/i.test(text(resolution.status));
  if (exceptional) reasons.push('EXCEPTIONAL_RESULT_REQUIRES_BOOKMAKER_REVIEW');
  if (!format.supported) reasons.push('UNSUPPORTED_SCORING_FORMAT');
  if (resolution.providerCompleted != null && resolution.providerCompleted !== true) reasons.push('PROVIDER_NOT_COMPLETED');
  if (!isVoid && ![1,2].includes(winnerSide)) reasons.push('MISSING_CANONICAL_WINNER_SIDE');
  if (!isVoid) {
    if (![1, 2].includes(winnerSide) && !winnerName) reasons.push('MISSING_WINNER');
    if (winnerName && !isSamePlayer(winnerName, match.home_team || match.home) && !isSamePlayer(winnerName, match.away_team || match.away)) reasons.push('WINNER_NOT_IN_CANONICAL_PAIR');
    if (winnerName && winnerSide === 1 && !isSamePlayer(winnerName, match.home_team || match.home)) reasons.push('WINNER_SIDE_NAME_MISMATCH');
    if (winnerName && winnerSide === 2 && !isSamePlayer(winnerName, match.away_team || match.away)) reasons.push('WINNER_SIDE_NAME_MISMATCH');
  }

  if (scoreAudit.available && !scoreAudit.valid) reasons.push(scoreAudit.reason);
  if (scoreAudit.valid && !scoreAudit.isVoid && scoreAudit.setCount > format.bestOf) reasons.push('SCORE_EXCEEDS_MATCH_FORMAT');
  if (scoreAudit.valid && format.supported && !exceptional) {
    const completionReason=validateCompletedMatch(scoreAudit,format);
    if(completionReason)reasons.push(completionReason);
    else {
      const orientation=upper(resolution.scoreOrientation || 'CANONICAL');
      if(!['CANONICAL','WINNER_FIRST'].includes(orientation))reasons.push('UNKNOWN_SCORE_ORIENTATION');
      else if(orientation==='WINNER_FIRST' ? scoreAudit.scoreWinnerSide!==1 : scoreAudit.scoreWinnerSide!==winnerSide)reasons.push('SCORE_WINNER_MISMATCH');
    }
  }
  // Provider aggregate scores are not sets; preserve the explicit completed moneyline path.
  if (!scoreAudit.available && !(sourceTier==='PROVIDER' && resolution.providerCompleted===true && !totals) && !isVoid) reasons.push('MISSING_SCORE_OR_PROVIDER_COMPLETION');
  if (totals) {
    const totalGames = number(resolution.totalGames);
    if (resolution.totalGames == null || resolution.totalGames === '' || typeof resolution.totalGames === 'boolean' || !Number.isInteger(totalGames) || totalGames <= 0) reasons.push('TOTALS_WITHOUT_TOTAL_GAMES');
    if (scoreAudit.valid && !scoreAudit.isVoid && totalGames != null && Math.abs(scoreAudit.totalGames - totalGames) > 0.01) reasons.push('TOTAL_GAMES_SCORE_MISMATCH');
  }

  const evidenceMaterial = buildEvidenceMaterial(match, resolution, { ...context, observedAt });
  const evidenceHash = text(resolution.evidenceHash || resolution.evidence_hash) || hashEvidence(evidenceMaterial);
  if (!evidenceHash) reasons.push('MISSING_EVIDENCE_HASH');

  let status;
  if (resolution.conflict === true || sourceTier === 'CONFLICT') status = SETTLEMENT_STATES.CONFLICT;
  else if (isPendingLikeSource(source) || !source) status = SETTLEMENT_STATES.PENDING;
  else if (exceptional || !format.supported) status = SETTLEMENT_STATES.MANUAL_REVIEW;
  else if (sourceTier === 'MANUAL') status = SETTLEMENT_STATES.MANUAL_REVIEW;
  else if (sourceTier === 'WEAK_WEB' || sourceTier === 'LEGACY_CACHE' || sourceTier === 'UNKNOWN_SOURCE' || sourceTier === 'MISSING_SOURCE') {
    status = SETTLEMENT_STATES.PROPOSED;
    if (!reasons.length) reasons.push(`SOURCE_TIER_${sourceTier}_REQUIRES_REVIEW`);
  }
  else if (isVoid && reasons.filter(r => !['MISSING_WINNER'].includes(r)).length === 0) status = SETTLEMENT_STATES.VOID;
  else if (reasons.length === 0 && ['CERTIFIED', 'PROVIDER', 'STRUCTURED_WEB', 'VERIFIED_CACHE'].includes(sourceTier)) status = SETTLEMENT_STATES.VERIFIED;
  else if (reasons.some(r => ['WINNER_NOT_IN_CANONICAL_PAIR', 'WINNER_SIDE_NAME_MISMATCH', 'SCORE_EXCEEDS_MATCH_FORMAT', 'TOTAL_GAMES_SCORE_MISMATCH'].includes(r))) status = SETTLEMENT_STATES.REJECTED;
  else status = SETTLEMENT_STATES.PROPOSED;

  const autoSettleAllowed = status === SETTLEMENT_STATES.VERIFIED || status === SETTLEMENT_STATES.VOID;
  const baseConfidence = number(resolution.confidence);
  const defaultConfidence = ({ CERTIFIED: 0.99, PROVIDER: 0.97, STRUCTURED_WEB: 0.90, VERIFIED_CACHE: 0.95, WEAK_WEB: 0.55, MANUAL: 0.50 }[sourceTier] || 0.40);
  const confidence = clamp(baseConfidence == null ? defaultConfidence : baseConfidence, 0, 1);

  return {
    version: TENNIS_SETTLEMENT_CONTRACT_VERSION,
    status,
    autoSettleAllowed,
    reason: reasons.join('|') || 'CONTRACT_OK',
    reasons,
    source,
    sourceTier,
    sourceEventId,
    winnerName: winnerName || null,
    winnerSide,
    score: score || null,
    observedAt: new Date(observedTs || Date.now()).toISOString(),
    confidence,
    evidenceHash,
    eventFingerprint: eventFingerprint || null,
    marketFingerprint: marketFingerprint || null,
    matchFormatBestOf: format.bestOf,
    scoringRules: format,
    scoreOrientation: upper(resolution.scoreOrientation || 'CANONICAL'),
    scoreAudit,
    isVoid,
    totals
  };
}
function buildSettlementContractFields(match = {}, resolution = {}, context = {}) {
  const result = evaluateTennisSettlementContract(match, resolution, context);
  return {
    settlement_contract_status: result.status,
    settlement_contract_reason: result.reason,
    settlement_contract_version: result.version,
    settlement_source_event_id: result.sourceEventId || null,
    settlement_winner_name: result.winnerName,
    settlement_score: result.score,
    settlement_observed_at: result.observedAt,
    settlement_confidence: result.confidence,
    settlement_evidence_hash: result.evidenceHash,
    settlement_event_fingerprint: result.eventFingerprint,
    settlement_market_fingerprint: result.marketFingerprint,
    settlement_operation_id: context.operationId || null,
    settlement_source_tier: result.sourceTier
  };
}

module.exports = {
  TENNIS_SETTLEMENT_CONTRACT_VERSION,
  SETTLEMENT_STATES,
  SETTLEMENT_SCHEMA_COLUMNS,
  normalizeName,
  isSamePlayer,
  hashEvidence,
  parseTs,
  parseScore,
  classifySourceTier,
  buildSourceEventId,
  evaluateTennisSettlementContract,
  buildSettlementContractFields
};
