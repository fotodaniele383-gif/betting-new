const path = require('path');

const STEP110_TENNIS_CERTIFIED_RESULT_NAME_TIME_REPAIR = 'STEP110_TENNIS_CERTIFIED_RESULT_NAME_TIME_REPAIR';
const STEP110_CERTIFIED_SOURCE = 'STEP110_CERTIFIED_REUTERS_WTA_RG2026';

const STEP110_CERTIFIED_RESULTS = [
  {
    datePrefix: '04/06/2026',
    isoDate: '2026-06-04',
    home: 'Diana Shnaider',
    away: 'Maja Chwalinska',
    winner: 'Maja Chwalinska',
    winnerSide: 2,
    totalGames: 23,
    score: '7-6(4) 6-4',
    source: STEP110_CERTIFIED_SOURCE
  }
];

function normalizeName(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function samePlayer(a = '', b = '') {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const la = na.split(' ').filter(Boolean).pop();
  const lb = nb.split(' ').filter(Boolean).pop();
  const ia = na[0];
  const ib = nb[0];
  return Boolean(la && lb && la === lb && (!ia || !ib || ia === ib));
}

function round(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const p = Math.pow(10, decimals);
  return Math.round(n * p) / p;
}

function evaluateMoneyline(row, certified) {
  const prediction = String(row.prediction || '').trim().toUpperCase();
  const predicted = prediction === '1'
    ? row.home_team
    : (prediction === '2' ? row.away_team : (row.predicted_player_name || ''));
  if (!predicted || !certified?.winner) return null;
  return samePlayer(predicted, certified.winner);
}

function findCertifiedForRow(row = {}) {
  return STEP110_CERTIFIED_RESULTS.find(item => {
    const dateOk = String(row.match_date || '').startsWith(item.datePrefix) || String(row.match_date || '').startsWith(item.isoDate);
    if (!dateOk) return false;
    const direct = samePlayer(row.home_team, item.home) && samePlayer(row.away_team, item.away);
    const reverse = samePlayer(row.home_team, item.away) && samePlayer(row.away_team, item.home);
    return direct || reverse;
  }) || null;
}

function columnSet(db, table = 'ai_forward_test') {
  return new Set(db.prepare('PRAGMA table_info(' + table + ')').all().map(r => r.name));
}

function updateRow(db, columns, row, certified) {
  const result = evaluateMoneyline(row, certified);
  if (result === null) return false;
  const status = result ? 'WON' : 'LOST';
  const stake = Number(row.stake) || 0;
  const odd = Number(row.odd) || 0;
  let profit = 0;
  if (status === 'WON') profit = round(stake * Math.max(0, odd - 1), 2);
  if (status === 'LOST') profit = stake > 0 ? -round(stake, 2) : 0;
  const predicted = row.prediction === '1' ? row.home_team : (row.prediction === '2' ? row.away_team : row.predicted_player_name);
  const note = 'STEP110 risultato certificato per audit name/time matching; Shnaider-Chwalinska risolto da fonte ufficiale/giornalistica. Score: ' + certified.score;
  const fields = {
    status,
    profit,
    settlement_source: certified.source,
    settlement_note: note,
    settled_at: new Date().toISOString(),
    total_games: certified.totalGames,
    winner_side: certified.winnerSide,
    winner_player_name: certified.winner,
    predicted_player_name: predicted || null,
    side_mapping_verified: 1,
    side_identity_version: STEP110_TENNIS_CERTIFIED_RESULT_NAME_TIME_REPAIR,
    sport_type: 'TENNIS',
    data_quality: row.data_quality || 'CURRENT_BOOTSTRAP',
    engine_version: row.engine_version || '11.1'
  };
  const allowed = Object.entries(fields).filter(([k]) => columns.has(k));
  if (!allowed.length) return false;
  const sql = 'UPDATE ai_forward_test SET ' + allowed.map(([k]) => k + ' = ?').join(', ') + ' WHERE id = ?';
  db.prepare(sql).run(...allowed.map(([, v]) => v), row.id);
  return true;
}

function repairStep110CertifiedResults(dbPath = path.join(__dirname, 'database_betting.db')) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  try {
    const columns = columnSet(db);
    const rows = db.prepare("SELECT * FROM ai_forward_test WHERE (home_team LIKE '%Shnaider%' AND away_team LIKE '%Chwalinska%') OR (home_team LIKE '%Chwalinska%' AND away_team LIKE '%Shnaider%')").all();
    let repaired = 0;
    const details = [];
    for (const row of rows) {
      const certified = findCertifiedForRow(row);
      if (!certified) continue;
      const before = { id: row.id, status: row.status, profit: row.profit, settlement_source: row.settlement_source };
      const ok = updateRow(db, columns, row, certified);
      if (ok) {
        repaired += 1;
        details.push({ before, after: { id: row.id, status: evaluateMoneyline(row, certified) ? 'WON' : 'LOST', source: certified.source } });
      }
    }
    return { success: true, step: STEP110_TENNIS_CERTIFIED_RESULT_NAME_TIME_REPAIR, repaired, details };
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(repairStep110CertifiedResults(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ success: false, step: STEP110_TENNIS_CERTIFIED_RESULT_NAME_TIME_REPAIR, error: error.message || String(error) }, null, 2));
    process.exit(1);
  }
}

module.exports = {
  STEP110_TENNIS_CERTIFIED_RESULT_NAME_TIME_REPAIR,
  STEP110_CERTIFIED_SOURCE,
  STEP110_CERTIFIED_RESULTS,
  normalizeName,
  samePlayer,
  findCertifiedForRow,
  evaluateMoneyline,
  repairStep110CertifiedResults
};
