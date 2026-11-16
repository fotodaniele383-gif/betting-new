'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = 'TENNIS_SETTLEMENT_TRUTH_V1_PATCH34_R4';
const IDENTITY_VERSION = 'TENNIS_SETTLEMENT_IDENTITY_AUTHORITY_V1_PATCH34_R4';
const COMPLETED_SEED_VERSION = 'TENNIS_OFFICIAL_SETTLEMENT_SEED_V3_PATCH34_R4';
const LIFECYCLE_EVIDENCE_VERSION = 'TENNIS_SETTLEMENT_LIFECYCLE_EVIDENCE_V1_PATCH34_R4';
const COMPLETED_PATH = path.join(__dirname, 'tennisOfficialSettlementSeedPatch34R4.json');
const LIFECYCLE_PATH = path.join(__dirname, 'tennisSettlementLifecycleEvidencePatch34R4.json');

function text(value) { return String(value == null ? '' : value).trim(); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
function sha256(value) {
  const material = typeof value === 'string' ? value : JSON.stringify(stable(value));
  return crypto.createHash('sha256').update(material).digest('hex');
}
function normalizeName(value) {
  return text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, ' ').replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function lastName(value) { const p = normalizeName(value).split(' ').filter(Boolean); return p[p.length - 1] || ''; }
function samePlayer(a, b) {
  const aa = normalizeName(a), bb = normalizeName(b);
  if (!aa || !bb) return false;
  if (aa === bb) return true;
  const la = lastName(aa), lb = lastName(bb);
  return Boolean(la && la === lb && aa[0] === bb[0]);
}
function parseDateKey(value) {
  const raw = text(value);
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0,10) : '';
}
function pairMatches(record, row = {}) {
  const home = row.home_team || row.home;
  const away = row.away_team || row.away;
  return (samePlayer(record.home, home) && samePlayer(record.away, away)) ||
    (samePlayer(record.home, away) && samePlayer(record.away, home));
}
function verifyRecord(record) {
  const copy = { ...record };
  const expected = text(copy.recordHash);
  delete copy.recordHash;
  return Boolean(expected && sha256(copy) === expected);
}
function loadJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function loadCompletedSeed() {
  const seed = loadJson(COMPLETED_PATH);
  const valid = seed.version === COMPLETED_SEED_VERSION && Array.isArray(seed.records) &&
    seed.records.every(verifyRecord) && sha256(seed.records) === seed.seedHash;
  if (!valid) throw new Error('PATCH34_R4_COMPLETED_SEED_INTEGRITY_FAILED');
  return seed;
}
function loadLifecycleEvidence() {
  const evidence = loadJson(LIFECYCLE_PATH);
  const valid = evidence.version === LIFECYCLE_EVIDENCE_VERSION && Array.isArray(evidence.records) &&
    evidence.records.every(verifyRecord) && sha256(evidence.records) === evidence.evidenceHash;
  if (!valid) throw new Error('PATCH34_R4_LIFECYCLE_EVIDENCE_INTEGRITY_FAILED');
  return evidence;
}
function findRecord(row, records) {
  const betId = Number(row?.id || row?.betId || 0);
  const date = parseDateKey(row?.canonical_match_datetime || row?.match_date || row?.date);
  const direct = records.find(r => Number(r.betId) === betId && pairMatches(r, row));
  if (direct) return direct;
  const matches = records.filter(r => pairMatches(r, row) && (!date || r.date === date));
  return matches.length === 1 ? matches[0] : null;
}
function winnerSide(row, winnerName) {
  if (samePlayer(winnerName, row.home_team || row.home)) return 1;
  if (samePlayer(winnerName, row.away_team || row.away)) return 2;
  return null;
}
function buildCompletedResolution(row, record) {
  const side = winnerSide(row, record.winner);
  if (!side) return null;
  return {
    winner: side,
    winnerName: record.winner,
    winner_player_name: record.winner,
    totalGames: Number(record.totalGames),
    score: record.score,
    scoreOrientation: 'WINNER_FIRST',
    isVoid: false,
    source: record.source,
    sourceEventId: record.sourceEventId,
    observedAt: record.observedAt,
    providerCompleted: true,
    confidence: Number(record.confidence || 0.999),
    evidenceHash: record.recordHash,
    officialUrl: record.sourceUrl,
    identityAuthority: 'PLAYER_PAIR_AND_PREDICTED_PLAYER_CERTIFIED',
    identityVersion: IDENTITY_VERSION,
    bypassLegacyFingerprintMismatch: true,
    patch34R4Truth: true,
    rawEvidence: { ...record, truthVersion: VERSION },
    note: 'Patch 34 R4: risultato ufficiale firmato; identità verificata per coppia giocatori e predicted_player_name.'
  };
}
function buildLifecycleResolution(row, record) {
  const side = record.winner ? winnerSide(row, record.winner) : null;
  return {
    winner: side,
    winnerName: record.winner || null,
    winner_player_name: record.winner || null,
    totalGames: null,
    score: record.score || null,
    isVoid: false,
    source: record.source,
    sourceEventId: record.sourceEventId,
    observedAt: record.observedAt,
    providerCompleted: false,
    confidence: 0.999,
    evidenceHash: record.recordHash,
    officialUrl: record.sourceUrl,
    lifecycleStatus: record.status,
    lifecycleReason: record.reason,
    nonFinal: true,
    automaticSettlement: false,
    requiresBookmakerRule: record.requiresBookmakerRule === true,
    identityAuthority: 'PLAYER_PAIR_CERTIFIED_NON_FINAL',
    identityVersion: IDENTITY_VERSION,
    patch34R4Truth: true,
    rawEvidence: { ...record, truthVersion: VERSION },
    note: record.status === 'RETIREMENT_REVIEW'
      ? 'Patch 34 R4: risultato con ritiro ufficiale acquisito; settlement subordinato alla regola bookmaker.'
      : 'Patch 34 R4: match sospeso/incompleto; nessuna chiusura automatica prima del completamento.'
  };
}
function resolve(row, options = {}) {
  const completed = findRecord(row, (options.completedSeed || loadCompletedSeed()).records || []);
  if (completed) return buildCompletedResolution(row, completed);
  const lifecycle = findRecord(row, (options.lifecycleEvidence || loadLifecycleEvidence()).records || []);
  if (lifecycle) return buildLifecycleResolution(row, lifecycle);
  return null;
}
function expectedOutcome(row, resolution) {
  if (!resolution || resolution.nonFinal) return null;
  const predicted = text(row.predicted_player_name);
  if (predicted) return samePlayer(predicted, resolution.winnerName) ? 'WON' : 'LOST';
  const side = text(row.prediction);
  return side === String(resolution.winner) ? 'WON' : side === '1' || side === '2' ? 'LOST' : null;
}
function canRecoverProtectedManualReview(row, resolution) {
  const reason = text(row?.settlement_contract_reason).toUpperCase();
  return Boolean(resolution?.patch34R4Truth && !resolution.nonFinal && resolution.bypassLegacyFingerprintMismatch &&
    ['OFFICIAL_EVENT_MARKET_FINGERPRINT_MISMATCH','OFFICIAL_EVENT_FINGERPRINT_MISMATCH'].includes(reason));
}
function canBypassFingerprintMismatch(row, resolution) {
  if (!resolution?.patch34R4Truth || resolution.nonFinal || !resolution.bypassLegacyFingerprintMismatch) return false;
  const pairOk = pairMatches({ home: row.home_team, away: row.away_team }, row) &&
    (samePlayer(resolution.winnerName, row.home_team) || samePlayer(resolution.winnerName, row.away_team));
  const predicted = text(row.predicted_player_name);
  const predictedOk = !predicted || samePlayer(predicted, row.home_team) || samePlayer(predicted, row.away_team);
  return pairOk && predictedOk;
}
function health() {
  const completed = loadCompletedSeed();
  const lifecycle = loadLifecycleEvidence();
  return {
    success: true, healthy: true, status: 'READY', version: VERSION, identityVersion: IDENTITY_VERSION,
    completedSeedVersion: completed.version, completedRecords: completed.records.length, completedSeedHash: completed.seedHash,
    lifecycleEvidenceVersion: lifecycle.version, lifecycleRecords: lifecycle.records.length, lifecycleEvidenceHash: lifecycle.evidenceHash,
    automaticSettlementRecords: completed.records.filter(r => r.automaticSettlement === true).length,
    nonFinalAutoSettlement: false, retirementAutoSettlement: false,
    sourcePriority: 'PATCH34_R4_SIGNED_OFFICIAL_TRUTH_BEFORE_CACHE_WEB_API',
    fingerprintPolicy: 'OFFICIAL_PLAYER_PAIR_IDENTITY_CAN_RECOVER_LEGACY_ALIAS_MISMATCH'
  };
}

module.exports = {
  VERSION, IDENTITY_VERSION, COMPLETED_SEED_VERSION, LIFECYCLE_EVIDENCE_VERSION,
  normalizeName, samePlayer, parseDateKey, pairMatches, verifyRecord,
  loadCompletedSeed, loadLifecycleEvidence, resolve, expectedOutcome,
  canRecoverProtectedManualReview, canBypassFingerprintMismatch, health, sha256
};
