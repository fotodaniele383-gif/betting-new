'use strict';

const crypto = require('crypto');
const audit13 = require('./certifiedTradingOutcomeSearchAudit13');
const footballDataProvider = require('./calcioFootballDataProvider');

const VERSION = 'AUDIT14_CERTIFIED_OUTCOME_COVERAGE_RECOVERY_V1';
const POLICY_VERSION = 'AUDIT14_EXPLICIT_ALIAS_REFRESH_FAIL_CLOSED_V1';
const SOURCE = 'FOOTBALL_DATA_ARCHIVE_AUDIT14';

function text(v) { return String(v == null ? '' : v).trim(); }
function sha256(v) { return crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex'); }

const TEAM_ALIASES = Object.freeze({
  'arsenal fc': 'arsenal', 'coventry city': 'coventry', 'sc paderborn': 'paderborn', 'paderborn 07': 'paderborn',
  'as monaco': 'monaco', 'espanyol': 'espanol', 'rcd espanyol': 'espanol', 'sc freiburg': 'freiburg',
  'real betis': 'betis', 'real betis balompie': 'betis', 'tottenham hotspur': 'tottenham',
  'eintracht frankfurt': 'ein frankfurt', 'rayo vallecano': 'vallecano', 'brighton and hove albion': 'brighton',
  'brighton hove albion': 'brighton', 'atalanta bc': 'atalanta', 'inter milan': 'inter', 'internazionale': 'inter',
  'as roma': 'roma', 'rc lens': 'lens', 'newcastle united': 'newcastle', 'borussia dortmund': 'dortmund',
  'hamburger sv': 'hamburg', 'fsv mainz 05': 'mainz', 'mainz 05': 'mainz', 'bayer leverkusen': 'leverkusen',
  'ca osasuna': 'osasuna', 'celta vigo': 'celta', 'rc celta': 'celta', 'athletic bilbao': 'ath bilbao',
  'athletic club': 'ath bilbao', 'real racing club de santander': 'santander', 'racing santander': 'santander',
  'leeds united': 'leeds', 'hull city': 'hull', 'us catanzaro 1929': 'catanzaro', 'hellas verona': 'verona',
  'parma calcio 1913': 'parma', 'como 1907': 'como', 'ac monza': 'monza', 'ssc napoli': 'napoli',
  'ss lazio': 'lazio', 'ac milan': 'milan', 'juventus fc': 'juventus', 'bologna fc': 'bologna',
  'genoa cfc': 'genoa', 'udinese calcio': 'udinese', 'us lecce': 'lecce', 'acf fiorentina': 'fiorentina',
  'vfl wolfsburg': 'wolfsburg', 'vfb stuttgart': 'stuttgart', 'fc augsburg': 'augsburg',
  'werder bremen': 'bremen', 'sv werder bremen': 'bremen', 'tsg hoffenheim': 'hoffenheim',
  'rb leipzig': 'leipzig', 'fc st pauli': 'st pauli', '1 fc heidenheim': 'heidenheim',
  'real madrid cf': 'real madrid', 'fc barcelona': 'barcelona', 'girona fc': 'girona', 'sevilla fc': 'sevilla',
  'villarreal cf': 'villarreal', 'getafe cf': 'getafe', 'valencia cf': 'valencia', 'deportivo alaves': 'alaves',
  'rcd mallorca': 'mallorca', 'real valladolid': 'valladolid', 'ud las palmas': 'las palmas',
  'nottingham forest': 'nottingham', 'nottingham forest fc': 'nottingham', 'west ham united': 'west ham',
  'wolverhampton wanderers': 'wolves', 'wolverhampton': 'wolves', 'leicester city': 'leicester',
  'ipswich town': 'ipswich', 'southampton fc': 'southampton', 'crystal palace fc': 'crystal palace',
  'aston villa fc': 'aston villa', 'afc bournemouth': 'bournemouth', 'brentford fc': 'brentford',
  'everton fc': 'everton', 'fulham fc': 'fulham', 'liverpool fc': 'liverpool', 'chelsea fc': 'chelsea'
});

function canonicalTeam(v) {
  const n = audit13.normalizeTeam(v);
  return TEAM_ALIASES[n] || n;
}
function compactCanonical(v) { return canonicalTeam(v).replace(/\s+/g, ''); }

function csvRows(snapshot) {
  if (!snapshot?.valid || !snapshot.csvData) return [];
  const split = footballDataProvider._private?.splitCsvLine;
  if (typeof split !== 'function') return [];
  const lines = String(snapshot.csvData).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = split(lines[0]).map(text);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  if (['Date','HomeTeam','AwayTeam','FTHG','FTAG'].some(k => idx[k] == null)) return [];
  return lines.slice(1).map(line => {
    const c = split(line); const d = footballDataProvider.parseFootballDataDate(c[idx.Date]);
    const hg = Number(c[idx.FTHG]), ag = Number(c[idx.FTAG]);
    if (!d || !text(c[idx.HomeTeam]) || !text(c[idx.AwayTeam]) || !Number.isFinite(hg) || !Number.isFinite(ag)) return null;
    return { dateKey:d.toISOString().slice(0,10), homeTeam:text(c[idx.HomeTeam]), awayTeam:text(c[idx.AwayTeam]), homeGoals:hg, awayGoals:ag, rowHash:sha256(line) };
  }).filter(Boolean);
}

function targetDateKey(row, now) {
  const d = audit13.parseEventInstant(row.canonical_match_datetime || row.match_date, now || new Date());
  return d ? d.toISOString().slice(0,10) : '';
}

function classifySnapshot(row, snapshot, options = {}) {
  const code = audit13.getFootballDataLeagueCode(row);
  const dateKey = targetDateKey(row, options.now);
  if (!code) return { status:'LEAGUE_UNMAPPED', resolvable:false, code:'', dateKey };
  if (!dateKey) return { status:'EVENT_TIME_UNKNOWN', resolvable:false, code, dateKey:'' };
  if (!snapshot?.valid) return { status:'SNAPSHOT_UNAVAILABLE', resolvable:false, code, dateKey };
  const rows = csvRows(snapshot);
  const dated = rows.filter(x => x.dateKey === dateKey);
  if (!dated.length) return { status:'DATE_NOT_IN_SNAPSHOT', resolvable:false, code, dateKey, snapshotLatest:snapshot.inspection?.latestMatchAt || null };
  const h = compactCanonical(row.home_team), a = compactCanonical(row.away_team);
  if (!h || !a) return { status:'TEAM_IDENTITY_MISSING', resolvable:false, code, dateKey };
  const exact = dated.filter(x => compactCanonical(x.homeTeam) === h && compactCanonical(x.awayTeam) === a);
  if (exact.length === 1) return { status:'CERTIFIED_CANONICAL_MATCH', resolvable:true, code, dateKey, match:exact[0], matchMethod:'DATE_HOME_AWAY_EXPLICIT_ALIAS' };
  if (exact.length > 1) return { status:'AMBIGUOUS_CANONICAL_MATCH', resolvable:false, code, dateKey, candidateCount:exact.length };
  const swapped = dated.filter(x => compactCanonical(x.homeTeam) === a && compactCanonical(x.awayTeam) === h);
  if (swapped.length) return { status:'IDENTITY_CONFLICT_HOME_AWAY_SWAPPED', resolvable:false, code, dateKey, candidateCount:swapped.length };
  return { status:'TEAM_IDENTITY_MISMATCH', resolvable:false, code, dateKey, dateCandidateCount:dated.length };
}

function buildResolution(row, snapshot, classified) {
  const m = classified.match;
  const home = compactCanonical(row.home_team), away = compactCanonical(row.away_team);
  const rawEvidence = {
    version:VERSION, policyVersion:POLICY_VERSION, source:SOURCE, code:classified.code, dateKey:classified.dateKey,
    homeTeam:m.homeTeam, awayTeam:m.awayTeam, homeGoals:m.homeGoals, awayGoals:m.awayGoals,
    canonicalHome:home, canonicalAway:away, rowHash:m.rowHash,
    snapshotSha256:snapshot.inspection?.sha256 || snapshot.metadata?.sha256 || null,
    snapshotFetchedAt:snapshot.metadata?.fetchedAt || null, snapshotUrl:snapshot.metadata?.url || null,
    matchMethod:classified.matchMethod
  };
  return {
    homeGoals:m.homeGoals, awayGoals:m.awayGoals, totalGoals:m.homeGoals+m.awayGoals,
    winnerSide:m.homeGoals>m.awayGoals?1:m.homeGoals<m.awayGoals?2:0,
    source:SOURCE, sourceTier:'CERTIFIED_ARCHIVE',
    sourceEventId:`FD14:${classified.code}:${classified.dateKey}:${sha256({home,away}).slice(0,16)}`,
    observedAt:snapshot.metadata?.fetchedAt || new Date().toISOString(), rawEvidence, evidenceHash:sha256(rawEvidence),
    providerCompleted:true, confidence:0.997, matchMethod:classified.matchMethod,
    note:`AUDIT14: risultato recuperato con alias espliciti, stessa lega/data e identita home/away coerente.`
  };
}

async function resolveFootballCertified(row = {}, options = {}) {
  const exact13 = audit13.resolveFootballFromLocalArchive(row, options);
  if (exact13) return { resolution:exact13, trace:{ status:'AUDIT13_EXACT_MATCH', refreshed:false, resolvable:true } };
  const code = audit13.getFootballDataLeagueCode(row);
  if (!code) return { resolution:null, trace:{ status:'LEAGUE_UNMAPPED', refreshed:false, resolvable:false } };
  let snapshot = (options.readLocalLeagueSnapshot || footballDataProvider.readLocalLeagueSnapshot)({ code, cacheDir:options.cacheDir });
  let classified = classifySnapshot(row, snapshot, options);
  if (classified.resolvable) return { resolution:buildResolution(row, snapshot, classified), trace:{...classified, refreshed:false} };

  const refreshable = classified.status === 'DATE_NOT_IN_SNAPSHOT' || classified.status === 'SNAPSHOT_UNAVAILABLE';
  if (refreshable && options.allowNetworkRefresh === true) {
    const getLeagueCsv = options.getLeagueCsv || footballDataProvider.getLeagueCsv;
    await getLeagueCsv({ code, forceRefresh:true, cacheDir:options.cacheDir, timeoutMs:options.timeoutMs, operationId:`AUDIT14_REFRESH_${code}_${Date.now()}` });
    snapshot = (options.readLocalLeagueSnapshot || footballDataProvider.readLocalLeagueSnapshot)({ code, cacheDir:options.cacheDir });
    classified = classifySnapshot(row, snapshot, options);
    if (classified.resolvable) return { resolution:buildResolution(row, snapshot, classified), trace:{...classified, refreshed:true} };
    return { resolution:null, trace:{...classified, refreshed:true} };
  }
  return { resolution:null, trace:{...classified, refreshed:false} };
}

function classifyFootballPending(row = {}, options = {}) {
  const code = audit13.getFootballDataLeagueCode(row);
  if (!code) return { status:'LEAGUE_UNMAPPED', code:'', resolvable:false };
  const snapshot = (options.readLocalLeagueSnapshot || footballDataProvider.readLocalLeagueSnapshot)({ code, cacheDir:options.cacheDir });
  const exact13 = audit13.resolveFootballFromLocalArchive(row, options);
  if (exact13) return { status:'LOCAL_EXACT_CERTIFIED', code, resolvable:true, matchMethod:exact13.matchMethod };
  return classifySnapshot(row, snapshot, options);
}

module.exports = { VERSION, POLICY_VERSION, SOURCE, TEAM_ALIASES, canonicalTeam, compactCanonical, classifyFootballPending, resolveFootballCertified, _private:{csvRows, classifySnapshot, buildResolution} };
