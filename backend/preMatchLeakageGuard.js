'use strict';

// STEP91_PREMATCH_LEAKAGE_GUARD
// Guardrail unico per impedire che dati post-match/current closing line entrino
// nei contesti pre-match di DeepScan / Value Evaluator.

const PRE_MATCH_LEAKAGE_GUARD_VERSION = 'STEP91_PRE_MATCH_LEAKAGE_GUARD_V1';

const FORBIDDEN_PRE_MATCH_FIELDS = [
  'clv',
  'clvPct',
  'clv_pct',
  'clv_edge',
  'closingOdd',
  'closing_odd',
  'closing_odds',
  'result',
  'profit',
  'settledAt',
  'settled_at'
];

function assertPreMatchOnlyContext(ctx = {}, options = {}) {
  if (!ctx || typeof ctx !== 'object') return true;
  const forbidden = Array.isArray(options.forbidden) ? options.forbidden : FORBIDDEN_PRE_MATCH_FIELDS;
  const allowHistoricalAggregates = options.allowHistoricalAggregates !== false;

  for (const key of forbidden) {
    if (Object.prototype.hasOwnProperty.call(ctx, key) && ctx[key] !== undefined && ctx[key] !== null) {
      throw new Error(`PRE_MATCH_LEAKAGE_GUARD: forbidden field ${key}`);
    }
  }

  // Gli aggregati storici dichiarati sono ammessi perché non sono la closing line
  // della giocata corrente. Le chiavi vietate sopra restano bloccanti.
  if (allowHistoricalAggregates) return true;
  return true;
}

function stripForbiddenPreMatchFields(ctx = {}) {
  if (!ctx || typeof ctx !== 'object') return ctx;
  const clone = { ...ctx };
  for (const key of FORBIDDEN_PRE_MATCH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(clone, key)) delete clone[key];
  }
  return clone;
}

module.exports = {
  PRE_MATCH_LEAKAGE_GUARD_VERSION,
  FORBIDDEN_PRE_MATCH_FIELDS,
  assertPreMatchOnlyContext,
  stripForbiddenPreMatchFields
};
