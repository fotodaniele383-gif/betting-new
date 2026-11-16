'use strict';

// STEP91_GATE_STATUS_CANONICALIZER
// Fonte unica per codici/stati Gate usati da backend, migrazioni e UI.

const GATE_STATUS_CANONICALIZER_VERSION = 'STEP91_GATE_STATUS_CANONICALIZER_V1';

const CANONICAL_GATE_STATUSES = {
  BLOCKED_HARD: {
    code: 'BLOCKED_HARD',
    label: 'BLOCCATA HARD',
    allowBet: false,
    auditOnly: true,
    severity: 'ERROR',
    rank: 1
  },
  BLOCKED_SOFT: {
    code: 'BLOCKED_SOFT',
    label: 'BLOCCATA SOFT',
    allowBet: false,
    auditOnly: true,
    severity: 'WARN',
    rank: 2
  },
  WATCHLIST_MICRO: {
    code: 'WATCHLIST_MICRO',
    label: 'WATCHLIST MICRO',
    allowBet: false,
    auditOnly: true,
    severity: 'WARN',
    rank: 3
  },
  APPROVED_WITH_CAP: {
    code: 'APPROVED_WITH_CAP',
    label: 'APPROVATA CON CAP',
    allowBet: true,
    auditOnly: false,
    severity: 'OK',
    rank: 4
  },
  APPROVED: {
    code: 'APPROVED',
    label: 'APPROVATA',
    allowBet: true,
    auditOnly: false,
    severity: 'OK',
    rank: 5
  },
  APPROVED_FULL_STAKE: {
    code: 'APPROVED_FULL_STAKE',
    label: 'APPROVATA STAKE PIENO',
    allowBet: true,
    auditOnly: false,
    severity: 'OK',
    rank: 6
  }
};

function normalizeText(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[🎾⚽✅🟢🔴🟡🟣]/g, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalizeGateStatus(input = {}, fallbackCode = 'BLOCKED_HARD') {
  // La decisione Step90 pre_match_gate_label è più recente dei legacy status DB.
  // Se presente e positiva/bloccante deve prevalere su APPROVATA CON CAP storico.
  if (input && typeof input === 'object' && input.pre_match_gate_label) {
    const pre = normalizeText(input.pre_match_gate_label);
    if (pre.includes('APPROVATA STAKE PIENO')) return { ...CANONICAL_GATE_STATUSES.APPROVED_FULL_STAKE, original: input.pre_match_gate_label };
    if (pre === 'APPROVATA') return { ...CANONICAL_GATE_STATUSES.APPROVED, original: input.pre_match_gate_label };
    if (pre.includes('APPROVATA CON CAP')) return { ...CANONICAL_GATE_STATUSES.APPROVED_WITH_CAP, original: input.pre_match_gate_label };
    if (pre.includes('WATCHLIST')) return { ...CANONICAL_GATE_STATUSES.WATCHLIST_MICRO, original: input.pre_match_gate_label };
    if (pre.includes('BLOCCATA SOFT')) return { ...CANONICAL_GATE_STATUSES.BLOCKED_SOFT, original: input.pre_match_gate_label };
    if (pre.includes('BLOCCATA HARD')) return { ...CANONICAL_GATE_STATUSES.BLOCKED_HARD, original: input.pre_match_gate_label };
  }

  const raw = typeof input === 'string' ? input : [
    input.code,
    input.status,
    input.label,
    input.professional_gate_status,
    input.tennis_operational_status,
    input.calcio_gate_status,
    input.calcio_operational_status,
    input.action
  ].filter(Boolean).join(' ');

  const text = normalizeText(raw);
  const blockType = normalizeText(typeof input === 'object' ? input.blockType : '');
  const allowBet = typeof input === 'object' ? input.allowBet : undefined;
  const professionalUse = typeof input === 'object' ? input.professionalUse : undefined;

  let code = fallbackCode;
  if (text.includes('APPROVATA STAKE PIENO') || text.includes('APPROVED FULL STAKE') || text.includes('FULL STAKE')) code = 'APPROVED_FULL_STAKE';
  else if (text === 'APPROVATA' || text.includes('APPROVED STEP90') || text.includes('PREMATCH APPROVED')) code = 'APPROVED';
  else if (text.includes('APPROVATA CON CAP') || text.includes('APPROVED WITH CAP') || text.includes('APPROVED STANDARD')) code = 'APPROVED_WITH_CAP';
  else if (text.includes('WATCHLIST') || text.includes('MICRO') || text.includes('CONSENSUS')) code = 'WATCHLIST_MICRO';
  else if (text.includes('BLOCCATA SOFT') || text.includes('BLOCKED SOFT') || blockType === 'SOFT') code = 'BLOCKED_SOFT';
  else if (text.includes('BLOCCATA HARD') || text.includes('BLOCKED HARD') || text.includes('NO BET') || text.includes('OPPOSITE SIDE CONFLICT')) code = 'BLOCKED_HARD';
  else if (allowBet === true && professionalUse === true) code = 'APPROVED_FULL_STAKE';
  else if (allowBet === true) code = 'APPROVED_WITH_CAP';
  else if (allowBet === false && blockType === 'SOFT') code = 'BLOCKED_SOFT';
  else if (allowBet === false) code = 'BLOCKED_HARD';

  const base = CANONICAL_GATE_STATUSES[code] || CANONICAL_GATE_STATUSES[fallbackCode] || CANONICAL_GATE_STATUSES.BLOCKED_HARD;
  return { ...base, original: raw || null };
}

function gateLabelFromStatus(input, fallbackCode) {
  return canonicalizeGateStatus(input, fallbackCode).label;
}

function gateAllowsBet(input, fallbackCode) {
  return canonicalizeGateStatus(input, fallbackCode).allowBet === true;
}

module.exports = {
  GATE_STATUS_CANONICALIZER_VERSION,
  CANONICAL_GATE_STATUSES,
  canonicalizeGateStatus,
  gateLabelFromStatus,
  gateAllowsBet,
  normalizeGateStatusText: normalizeText
};
