'use strict';

const crypto = require('crypto');

const PAPER_TRADING_IDENTITY_VERSION = 'BETTING_PATCH_12_PAPER_RESULT_IDENTITY_V1';
const ACTIVE = 1;
const INACTIVE = 0;

function text(value) { return String(value ?? '').trim(); }
function upper(value) { return text(value).toUpperCase(); }
function normalize(value) {
  return text(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '-');
}
function finite(value, fallback = null) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function sha(value) { return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32); }
function hasColumn(db, table, column) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column); }
  catch { return false; }
}
function addColumn(db, definition) {
  const name = definition.trim().split(/\s+/)[0].replace(/["'`]/g, '');
  if (!hasColumn(db, 'ai_forward_test', name)) db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${definition}`);
}
function detectSport(row = {}) {
  const all = upper([row.sport_type, row.bet_type, row.strategy_tag, row.league, row.tour_type].join(' '));
  return all.includes('TENNIS') || all.includes('ATP') || all.includes('WTA') ? 'TENNIS' : 'CALCIO';
}
function normalizeDate(value) {
  const raw = text(value);
  if (!raw) return 'date-unknown';
  // European application dates must be parsed before Date.parse: otherwise
  // 10/07/2026 may be interpreted as October 7 instead of 10 July.
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [,d,mo,y] = m;
    return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  const short = raw.match(/^(\d{1,2})\/(\d{1,2})(?:,?\s*(\d{1,2}):(\d{2}))?/);
  if (short) return `${new Date().getFullYear()}-${String(short[2]).padStart(2,'0')}-${String(short[1]).padStart(2,'0')}`;
  const direct = Date.parse(raw);
  if (Number.isFinite(direct)) return new Date(direct).toISOString().slice(0, 10);
  return normalize(raw);
}
function normalizePrediction(value, pointLine = null) {
  const p = upper(value).replace(/\s+/g, '');
  const line = finite(pointLine, null);
  return line === null ? p : `${p}@${line}`;
}
function eventIdentity(row = {}) {
  const sport = detectSport(row);
  const date = normalizeDate(row.canonical_match_datetime || row.match_date || row.date || row.commence_time);
  if (sport === 'TENNIS') {
    const players = [normalize(row.home_team || row.home), normalize(row.away_team || row.away)].filter(Boolean).sort();
    if (players.length === 2 && date !== 'date-unknown') return `tennis-canonical:${date}:${players.join('~')}`;
    const strong = text(row.tennis_event_fingerprint || row.tennis_canonical_match_key || row.provider_event_id || row.clv_event_fingerprint);
    return strong ? `tennis-event:${normalize(strong)}` : `tennis-fallback:${date}:${players.join('~')}`;
  }
  const home = normalize(row.home_team || row.home), away = normalize(row.away_team || row.away);
  if (home && away && date !== 'date-unknown') return `calcio-canonical:${date}:${home}:${away}`;
  const strong = text(row.calcio_event_key || row.match_exposure_key || row.calcio_provider_event_id || row.provider_event_id);
  return strong ? `calcio-event:${normalize(strong)}` : `calcio-fallback:${date}:${home}:${away}`;
}
function marketIdentity(row = {}) {
  return [normalize(row.market_type || row.bet_type || 'single'), normalizePrediction(row.prediction, row.point_line)].join(':');
}
function buildPaperResultKey(row = {}) {
  const sport = detectSport(row);
  return `${sport.toLowerCase()}|${sha(`${eventIdentity(row)}|${marketIdentity(row)}`)}`;
}
function completenessScore(row = {}) {
  const fields = ['eventIdentity','calcio_event_key','tennis_event_fingerprint','provider_event_id','estimated_prob','edge_pp','ev_pct','stake','profit','ds_action','quality_final_label','calcio_prediction_reliability_score','settlement_source','settled_at'];
  let score = fields.reduce((sum, key) => sum + (row[key] !== null && row[key] !== undefined && text(row[key]) !== '' ? 1 : 0), 0);
  const status = upper(row.status);
  if (['WON','LOST','VOID','PUSH'].includes(status)) score += 20;
  if (finite(row.stake, 0) > 0) score += 2;
  return score;
}
function ensureSchema(db) {
  addColumn(db, 'paper_result_key TEXT');
  addColumn(db, 'paper_result_active INTEGER DEFAULT 1');
  addColumn(db, 'paper_result_duplicate_of INTEGER');
  addColumn(db, 'paper_result_revision INTEGER DEFAULT 1');
  addColumn(db, 'paper_result_dedup_reason TEXT');
  addColumn(db, 'paper_result_dedup_at TEXT');
  addColumn(db, 'paper_result_identity_version TEXT');
  addColumn(db, 'paper_result_conflict INTEGER DEFAULT 0');
  addColumn(db, 'paper_result_conflict_statuses TEXT');
  // Patch 12 cumulative schema: selector diagnostics are nullable and never rewrite historical values.
  addColumn(db, 'candidate_selection_version TEXT');
  addColumn(db, 'candidate_selection_score REAL');
  addColumn(db, 'candidate_selection_tier TEXT');
  addColumn(db, 'candidate_selection_reason TEXT');
  return true;
}
function repairDuplicates(db, options = {}) {
  ensureSchema(db);
  const rows = db.prepare("SELECT * FROM ai_forward_test").all();
  const now = options.now || new Date().toISOString();
  const groups = new Map();
  for (const row of rows) {
    const key = buildPaperResultKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const report = { version: PAPER_TRADING_IDENTITY_VERSION, scanned: rows.length, groups: groups.size, duplicateGroups: 0, deactivated: 0, mergedFields: 0, existingColumnsPreserved: true, conflicts: [] };
  const tx = db.transaction(() => {
    for (const [key, group] of groups) {
      const ranked = [...group].sort((a,b) => completenessScore(b)-completenessScore(a) || Number(b.id)-Number(a.id));
      const survivor = ranked[0];
      const statuses = [...new Set(group.map(row => upper(row.status)).filter(Boolean))];
      const conflict = statuses.filter(s => ['WON','LOST','VOID','PUSH'].includes(s)).length > 1;
      if (group.length > 1) {
        report.duplicateGroups++;
        if (conflict) report.conflicts.push({ key, survivorId: survivor.id, ids: group.map(r=>r.id), statuses });
      }
      db.prepare(`UPDATE ai_forward_test SET paper_result_key=?, paper_result_active=1, paper_result_duplicate_of=NULL, paper_result_identity_version=?, paper_result_revision=COALESCE(paper_result_revision,1), paper_result_dedup_reason=?, paper_result_conflict=?, paper_result_conflict_statuses=? WHERE id=?`)
        .run(key, PAPER_TRADING_IDENTITY_VERSION, conflict ? `ACTIVE_SURVIVOR_SETTLEMENT_CONFLICT_MANUAL_REVIEW:${statuses.join('/')}` : null, conflict ? 1 : 0, conflict ? statuses.join('/') : null, survivor.id);
      for (const duplicate of ranked.slice(1)) {
        db.prepare(`UPDATE ai_forward_test SET paper_result_key=?, paper_result_active=0, paper_result_duplicate_of=?, paper_result_identity_version=?, paper_result_dedup_reason=?, paper_result_dedup_at=?, paper_result_conflict=?, paper_result_conflict_statuses=? WHERE id=?`)
          .run(key, survivor.id, PAPER_TRADING_IDENTITY_VERSION, conflict ? `DUPLICATE_HIDDEN_SETTLEMENT_CONFLICT_MANUAL_REVIEW:${statuses.join('/')}` : 'DUPLICATE_MERGED_NON_DESTRUCTIVE', now, conflict ? 1 : 0, conflict ? statuses.join('/') : null, duplicate.id);
        report.deactivated++;
      }
    }
    db.exec('DROP INDEX IF EXISTS ux_ai_forward_test_active_paper_result_key');
    db.exec('CREATE UNIQUE INDEX ux_ai_forward_test_active_paper_result_key ON ai_forward_test(paper_result_key) WHERE paper_result_active=1 AND paper_result_key IS NOT NULL');
  });
  tx();
  return report;
}
function findActiveByKey(db, row = {}) {
  if (!hasColumn(db, 'ai_forward_test', 'paper_result_key')) return null;
  const key = buildPaperResultKey(row);
  const found = db.prepare('SELECT * FROM ai_forward_test WHERE paper_result_key=? AND COALESCE(paper_result_active,1)=1 ORDER BY id DESC LIMIT 1').get(key);
  return found ? { ...found, paperResultKey: key } : null;
}
function persistenceFields(row = {}) {
  return {
    paper_result_key: buildPaperResultKey(row),
    paper_result_active: ACTIVE,
    paper_result_revision: Math.max(1, Number(row.paper_result_revision || 1)),
    paper_result_identity_version: PAPER_TRADING_IDENTITY_VERSION,
    paper_result_conflict: 0,
    paper_result_conflict_statuses: null
  };
}
function activeWhere(alias = '') { const p = alias ? `${alias}.` : ''; return `COALESCE(${p}paper_result_active,1)=1`; }

module.exports = {
  PAPER_TRADING_IDENTITY_VERSION,
  ACTIVE, INACTIVE,
  detectSport, normalizeDate, buildPaperResultKey, ensureSchema, repairDuplicates,
  findActiveByKey, persistenceFields, activeWhere, completenessScore
};
