'use strict';

// STEP91_TENNIS_PLAYER_IDENTITY
// Normalizzazione unica per feed, settlement, duplicate check e UI storico.

const TENNIS_PLAYER_IDENTITY_VERSION = 'STEP91_TENNIS_PLAYER_IDENTITY_V1';

const DIACRITICS_RE = /[\u0300-\u036f]/g;
const PARTICLES = new Set(['DE', 'DEL', 'DELLA', 'DI', 'DA', 'DOS', 'DAS', 'VAN', 'VON', 'LE', 'LA']);
const GENERATIONAL_SUFFIXES = new Set(['JR', 'JUNIOR', 'II', 'III', 'IV']);

function normalizePlayerName(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .replace(/[’'`]/g, ' ')
    .replace(/\b([A-Z])\./gi, '$1 ')
    .replace(/[^a-zA-Z\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function tokenizePlayerName(value = '') {
  return normalizePlayerName(value).split(' ').filter(Boolean);
}

function stripGenerationalSuffix(value = '') {
  const tokens = tokenizePlayerName(value);
  if (tokens.length < 2) return normalizePlayerName(value);
  const last = tokens[tokens.length - 1];
  if (!GENERATIONAL_SUFFIXES.has(last)) return tokens.join(' ');
  return tokens.slice(0, -1).join(' ');
}

function buildSafeIdentityCandidates(value = '') {
  const exact = normalizePlayerName(value);
  const suffixless = stripGenerationalSuffix(value);
  return [...new Set([exact, suffixless].filter(Boolean))];
}

function buildPlayerIdentity(value = '') {
  const tokens = tokenizePlayerName(value);
  const surname = tokens.length ? tokens[tokens.length - 1] : '';
  const given = tokens.slice(0, -1).filter(t => !PARTICLES.has(t));
  const initials = given.map(t => t[0]).join('');
  const compact = tokens.join(' ');
  const key = [surname, initials || given.join('')].filter(Boolean).join('|');
  const possibleKeys = new Set([key || compact]);

  // Copre formati: Jannik Sinner, Sinner J, Sinner J., Sinner Janik.
  if (tokens.length >= 2) {
    const first = tokens[0];
    const rest = tokens.slice(1).filter(t => !PARTICLES.has(t));
    const restInitials = rest.map(t => t[0]).join('');
    possibleKeys.add([first, restInitials || rest.join('')].filter(Boolean).join('|'));
  }

  return {
    original: String(value || ''),
    normalized: compact,
    tokens,
    surname,
    given,
    initials,
    key: key || compact,
    possibleKeys: Array.from(possibleKeys).filter(Boolean)
  };
}

function haveCompatibleIdentityKeys(pa, pb) {
  const aKeys = new Set(pa.possibleKeys || [pa.key]);
  for (const key of pb.possibleKeys || [pb.key]) {
    if (aKeys.has(key)) return true;
  }
  return false;
}

function isSamePlayerStrict(a, b) {
  const pa = buildPlayerIdentity(a);
  const pb = buildPlayerIdentity(b);
  if (!pa.normalized || !pb.normalized) return false;
  if (pa.normalized === pb.normalized) return true;
  if (haveCompatibleIdentityKeys(pa, pb)) return true;
  if (pa.surname && pa.surname === pb.surname) {
    if (!pa.initials || !pb.initials) return true;
    return pa.initials[0] === pb.initials[0];
  }
  return false;
}

function isSameMatchPair(a1, a2, b1, b2) {
  return (isSamePlayerStrict(a1, b1) && isSamePlayerStrict(a2, b2)) ||
         (isSamePlayerStrict(a1, b2) && isSamePlayerStrict(a2, b1));
}

function buildCanonicalTennisMatchKey(playerA, playerB, date = '', scope = '') {
  const a = buildPlayerIdentity(playerA).key;
  const b = buildPlayerIdentity(playerB).key;
  const pair = [a, b].sort().join('__VS__');
  const day = String(date || '').slice(0, 10);
  const s = String(scope || '').toUpperCase().replace(/\s+/g, '_');
  return [day, s, pair].filter(Boolean).join('__');
}

module.exports = {
  TENNIS_PLAYER_IDENTITY_VERSION,
  normalizePlayerName,
  stripGenerationalSuffix,
  buildSafeIdentityCandidates,
  buildPlayerIdentity,
  isSamePlayerStrict,
  isSameMatchPair,
  buildCanonicalTennisMatchKey
};
